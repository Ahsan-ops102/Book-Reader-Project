import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import db from "../db.js";
import { uploadToR2, getFromR2, deleteFromR2 } from "../storage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "application/octet-stream", // Sometimes generic for drag/drop
    ];
    if (!allowed.includes(file.mimetype) && (!file.originalname || !file.originalname.match(/\.docx?$/i))) {
      return cb(null, false); // Silently drop, req.file will be undefined
    }
    cb(null, true);
  },
});

const router = express.Router();

// List all documents, ordered by most recently edited
router.get("/", async (_req, res) => {
  try {
    const result = await db.execute(
      `SELECT id, title, word_count, created_at, updated_at
       FROM documents
       ORDER BY updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("List documents failed:", err);
    res.status(500).json({ error: "Failed to list documents" });
  }
});

// Create a new blank document (saves HTML content to R2)
router.post("/create", async (req, res) => {
  const { title, html } = req.body;
  const id = crypto.randomUUID();
  const filename = `docs/${id}.html`;
  const docTitle = title?.trim() || "Untitled Document";
  const content = html || "<p></p>";

  // Count words from plain-text extraction
  const plainText = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = plainText ? plainText.split(/\s+/).length : 0;

  try {
    await uploadToR2(filename, Buffer.from(content, "utf-8"), "text/html");

    await db.execute({
      sql: "INSERT INTO documents (id, title, filename, word_count) VALUES (?, ?, ?, ?)",
      args: [id, docTitle, filename, wordCount],
    });

    res.status(201).json({ id, title: docTitle });
  } catch (err) {
    console.error("Create document failed:", err);
    res.status(500).json({ error: "Failed to create document" });
  }
});

// Upload a .docx file — store the raw docx on R2, return metadata
// The frontend will handle converting it to HTML via mammoth client-side
router.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const id = crypto.randomUUID();
  const filename = `docs/${id}.docx`;
  const title = req.body.title?.trim() || req.file.originalname.replace(/\.docx?$/i, "");

  try {
    await uploadToR2(filename, req.file.buffer, req.file.mimetype);

    await db.execute({
      sql: "INSERT INTO documents (id, title, filename) VALUES (?, ?, ?)",
      args: [id, title, filename],
    });

    res.status(201).json({ id, title });
  } catch (err) {
    console.error("Upload document failed:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Get one document's metadata
router.get("/:id", async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT id, title, word_count, created_at, updated_at FROM documents WHERE id = ?",
      args: [req.params.id],
    });
    if (result.rows.length === 0) return res.status(404).json({ error: "Document not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Get document failed:", err);
    res.status(500).json({ error: "Failed to get document" });
  }
});

// Fetch the document content from R2 (returns HTML or streams the raw .docx)
router.get("/:id/content", async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT filename FROM documents WHERE id = ?",
      args: [req.params.id],
    });
    if (result.rows.length === 0) return res.status(404).json({ error: "Document not found" });

    const filename = result.rows[0].filename;
    const r2Response = await getFromR2(filename);

    if (filename.endsWith(".html")) {
      // HTML content — read and return as JSON
      const chunks = [];
      const stream = r2Response.Body.transformToWebStream();
      const reader = stream.getReader();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        if (value) chunks.push(value);
        done = d;
      }
      const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
      res.json({ html, format: "html" });
    } else {
      // Raw .docx — stream the binary to the client for mammoth conversion
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      r2Response.Body.transformToWebStream().pipeTo(
        new WritableStream({
          write(chunk) { res.write(chunk); },
          close() { res.end(); },
          abort(err) { console.error("Stream error:", err); res.end(); },
        })
      );
    }
  } catch (err) {
    console.error("Get content failed:", err);
    res.status(500).json({ error: "Failed to get document content" });
  }
});

// Save/update document content — overwrites the R2 file with new HTML
router.put("/:id/save", async (req, res) => {
  const { html, title } = req.body;
  if (!html) return res.status(400).json({ error: "No content provided" });

  try {
    const id = req.params.id;
    const htmlFilename = `docs/${id}.html`;
    const docxFilename = `docs/${id}.docx`;

    // Optimistically delete the .docx file if it existed
    await deleteFromR2(docxFilename).catch(() => {});

    await uploadToR2(htmlFilename, Buffer.from(html, "utf-8"), "text/html");

    // Count words
    const plainText = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const wordCount = plainText ? plainText.split(/\s+/).length : 0;

    // Use UPSERT to avoid race conditions (eventual consistency) on replicas
    if (title) {
      await db.execute({
        sql: `INSERT INTO documents (id, title, filename, word_count, updated_at)
              VALUES (?, ?, ?, ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              filename = excluded.filename,
              word_count = excluded.word_count,
              updated_at = excluded.updated_at`,
        args: [id, title, htmlFilename, wordCount],
      });
    } else {
      await db.execute({
        sql: `INSERT INTO documents (id, title, filename, word_count, updated_at)
              VALUES (?, 'Untitled Document', ?, ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
              filename = excluded.filename,
              word_count = excluded.word_count,
              updated_at = excluded.updated_at`,
        args: [id, htmlFilename, wordCount],
      });
    }

    res.json({ ok: true, wordCount });
  } catch (err) {
    console.error("Save document failed:", err);
    res.status(500).json({ error: "Failed to save document" });
  }
});

// Delete a document (R2 file + DB row)
router.delete("/:id", async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT filename FROM documents WHERE id = ?",
      args: [req.params.id],
    });
    if (result.rows.length === 0) return res.status(404).json({ error: "Document not found" });

    await deleteFromR2(result.rows[0].filename).catch((err) =>
      console.error("R2 delete warning:", err)
    );

    await db.execute({
      sql: "DELETE FROM documents WHERE id = ?",
      args: [req.params.id],
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Delete document failed:", err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

export default router;
