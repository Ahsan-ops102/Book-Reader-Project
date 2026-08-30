import multer from 'multer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import db from './db.js';
import { fail } from './security.js';
export const upload = multer({
  dest: path.join(os.tmpdir(), 'reading-room-uploads'),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_MB || 64) * 1024 * 1024,
    files: 1,
    fields: 5,
    fieldSize: 10000
  }
});
let active = 0;
export function uploadGate(req, res, next) {
  if (active >= 2) return res.status(503).json({
    error: 'Uploads are busy. Please retry shortly.'
  });
  active++;
  let done = false;
  const release = () => {
    if (done) return;
    done = true;
    active--;
    if (req.file) fs.rm(req.file.path, {
      force: true
    }).catch(() => {});
  };
  res.once('finish', release);
  res.once('close', release);
  next();
}
export async function fileBuffer(req) {
  if (!req.file) fail(400, 'Choose a file to upload.');
  return fs.readFile(req.file.path);
}
export async function validateZip(buffer, kind) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    fail(400, 'This is not a valid document archive.');
  }
  const entries = Object.values(zip.files);
  if (entries.length > 10000 || entries.reduce((n, e) => n + (e._data?.uncompressedSize || 0), 0) > 150 * 1024 * 1024) fail(413, 'The expanded document is too large.');
  if (kind === 'docx' && (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml'))) fail(400, 'Only DOCX files are supported; convert legacy DOC files first.');
  if (kind === 'epub' && (!zip.file('mimetype') || (await zip.file('mimetype').async('string')).trim() !== 'application/epub+zip')) fail(400, 'This is not a valid EPUB.');
  return zip;
}
export async function quota(userId, bytes) {
  const r = (await db.execute({
    sql: 'SELECT (SELECT COALESCE(SUM(size_bytes+cover_size_bytes),0) FROM books WHERE user_id=?) + (SELECT COALESCE(SUM(size_bytes),0) FROM documents WHERE user_id=?) AS used',
    args: [userId, userId]
  })).rows[0];
  if (Number(r.used) + bytes > Number(process.env.STORAGE_QUOTA_MB || 2048) * 1024 * 1024) fail(413, 'Account storage quota reached. Empty the trash or remove unused files.');
}
export function imageType(buf) {
  if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  fail(400, 'Choose a PNG, JPEG, or WebP cover.');
}
