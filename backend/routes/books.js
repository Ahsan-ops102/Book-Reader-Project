import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import db from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const id = crypto.randomUUID();
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB — plenty for a scanned book
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are accepted"));
    }
    cb(null, true);
  },
});

const router = express.Router();

// List all books with their reading progress
router.get("/", (_req, res) => {
  const books = db
    .prepare(
      `SELECT b.id, b.title, b.page_count, b.uploaded_at,
              COALESCE(p.current_page, 1) AS current_page,
              COALESCE(p.zoom, 1.0) AS zoom
       FROM books b
       LEFT JOIN progress p ON p.book_id = b.id
       ORDER BY COALESCE(p.updated_at, b.uploaded_at) DESC`
    )
    .all();
  res.json(books);
});

// Upload a new PDF
router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const id = path.parse(req.file.filename).name;
  const title = req.body.title?.trim() || req.file.originalname.replace(/\.pdf$/i, "");

  db.prepare(
    `INSERT INTO books (id, title, filename) VALUES (?, ?, ?)`
  ).run(id, title, req.file.filename);

  db.prepare(
    `INSERT INTO progress (book_id, current_page) VALUES (?, 1)`
  ).run(id);

  res.status(201).json({ id, title });
});

// Fetch one book's metadata + progress (used when opening a book directly)
router.get("/:id", (req, res) => {
  const book = db
    .prepare(
      `SELECT b.id, b.title, b.page_count,
              COALESCE(p.current_page, 1) AS current_page,
              COALESCE(p.zoom, 1.0) AS zoom
       FROM books b
       LEFT JOIN progress p ON p.book_id = b.id
       WHERE b.id = ?`
    )
    .get(req.params.id);
  if (!book) return res.status(404).json({ error: "Book not found" });
  res.json(book);
});

// Serve the raw PDF file (used by the frontend PDF.js viewer)
router.get("/:id/file", (req, res) => {
  const book = db.prepare(`SELECT filename FROM books WHERE id = ?`).get(req.params.id);
  if (!book) return res.status(404).json({ error: "Book not found" });
  res.sendFile(path.join(uploadsDir, book.filename));
});

// Record the total page count once the frontend has parsed the PDF
router.patch("/:id/pages", (req, res) => {
  const { pageCount } = req.body;
  db.prepare(`UPDATE books SET page_count = ? WHERE id = ?`).run(pageCount, req.params.id);
  res.json({ ok: true });
});

// Update reading progress (called on scroll/page change, debounced by the frontend)
router.put("/:id/progress", (req, res) => {
  const { currentPage, zoom } = req.body;
  db.prepare(
    `UPDATE progress SET current_page = ?, zoom = ?, updated_at = datetime('now') WHERE book_id = ?`
  ).run(currentPage, zoom ?? 1.0, req.params.id);
  res.json({ ok: true });
});

// Remove a book entirely (file + DB rows)
router.delete("/:id", (req, res) => {
  const book = db.prepare(`SELECT filename FROM books WHERE id = ?`).get(req.params.id);
  if (!book) return res.status(404).json({ error: "Book not found" });

  fs.rm(path.join(uploadsDir, book.filename), () => {});
  db.prepare(`DELETE FROM books WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

export default router;
