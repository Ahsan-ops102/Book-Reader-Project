import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import db from "../db.js";
import { uploadToR2, getFromR2, deleteFromR2 } from "../storage.js";

// Store uploads in memory (buffer) so we can forward them to R2
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are accepted"));
    }
    cb(null, true);
  },
});

const router = express.Router();

// List all books with their reading progress
router.get("/", async (_req, res) => {
  try {
    const result = await db.execute(
      `SELECT b.id, b.title, b.page_count, b.uploaded_at,
              COALESCE(p.current_page, 1) AS current_page,
              COALESCE(p.zoom, 1.0) AS zoom
       FROM books b
       LEFT JOIN progress p ON p.book_id = b.id
       ORDER BY COALESCE(p.updated_at, b.uploaded_at) DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("List books failed:", err);
    res.status(500).json({ error: "Failed to list books" });
  }
});

// Upload a new PDF
router.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const id = crypto.randomUUID();
  const filename = `${id}.pdf`;
  const title = req.body.title?.trim() || req.file.originalname.replace(/\.pdf$/i, "");

  try {
    // Upload the PDF buffer to Cloudflare R2
    await uploadToR2(filename, req.file.buffer, "application/pdf");

    // Record in Turso
    await db.batch(
      [
        {
          sql: "INSERT INTO books (id, title, filename) VALUES (?, ?, ?)",
          args: [id, title, filename],
        },
        {
          sql: "INSERT INTO progress (book_id, current_page) VALUES (?, 1)",
          args: [id],
        },
      ],
      "write"
    );

    res.status(201).json({ id, title });
  } catch (err) {
    console.error("Upload failed:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Fetch one book's metadata + progress
router.get("/:id", async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT b.id, b.title, b.page_count,
                   COALESCE(p.current_page, 1) AS current_page,
                   COALESCE(p.zoom, 1.0) AS zoom
            FROM books b
            LEFT JOIN progress p ON p.book_id = b.id
            WHERE b.id = ?`,
      args: [req.params.id],
    });
    if (result.rows.length === 0) return res.status(404).json({ error: "Book not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Get book failed:", err);
    res.status(500).json({ error: "Failed to get book" });
  }
});

// Serve the raw PDF file (streamed from R2)
router.get("/:id/file", async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT filename FROM books WHERE id = ?",
      args: [req.params.id],
    });
    if (result.rows.length === 0) return res.status(404).json({ error: "Book not found" });

    const r2Response = await getFromR2(result.rows[0].filename);
    res.setHeader("Content-Type", "application/pdf");
    // r2Response.Body is a readable stream — pipe it to the HTTP response
    r2Response.Body.transformToWebStream().pipeTo(
      new WritableStream({
        write(chunk) { res.write(chunk); },
        close() { res.end(); },
        abort(err) { console.error("Stream error:", err); res.end(); },
      })
    );
  } catch (err) {
    console.error("Serve file failed:", err);
    res.status(500).json({ error: "Failed to serve file" });
  }
});

// Record the total page count once the frontend has parsed the PDF
router.patch("/:id/pages", async (req, res) => {
  try {
    const { pageCount } = req.body;
    await db.execute({
      sql: "UPDATE books SET page_count = ? WHERE id = ?",
      args: [pageCount, req.params.id],
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Update pages failed:", err);
    res.status(500).json({ error: "Failed to update page count" });
  }
});

// Update reading progress
router.put("/:id/progress", async (req, res) => {
  try {
    const { currentPage, zoom } = req.body;
    await db.execute({
      sql: "UPDATE progress SET current_page = ?, zoom = ?, updated_at = datetime('now') WHERE book_id = ?",
      args: [currentPage, zoom ?? 1.0, req.params.id],
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Update progress failed:", err);
    res.status(500).json({ error: "Failed to update progress" });
  }
});

// Remove a book entirely (R2 file + DB rows)
router.delete("/:id", async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT filename FROM books WHERE id = ?",
      args: [req.params.id],
    });
    if (result.rows.length === 0) return res.status(404).json({ error: "Book not found" });

    // Delete from R2 (fire-and-forget is fine, but we await for safety)
    await deleteFromR2(result.rows[0].filename).catch((err) =>
      console.error("R2 delete warning:", err)
    );

    await db.execute({
      sql: "DELETE FROM books WHERE id = ?",
      args: [req.params.id],
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Delete book failed:", err);
    res.status(500).json({ error: "Failed to delete book" });
  }
});

export default router;
