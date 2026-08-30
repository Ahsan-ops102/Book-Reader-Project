import express from 'express';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import db from '../db.js';
import { uploadToR2, getFromR2, deleteFromR2 } from '../storage.js';
import { route, fail, text, integer, id, randomId, rateLimit } from '../security.js';
import { upload, uploadGate, fileBuffer, validateZip, quota, imageType } from '../files.js';
const router = express.Router();
export async function ownedBook(req, includeTrash = false) {
  const b = (await db.execute({
    sql: `SELECT b.*,COALESCE(p.current_page,1) current_page,COALESCE(p.zoom,1) zoom FROM books b LEFT JOIN progress p ON p.book_id=b.id WHERE b.id=? AND b.user_id=? ${includeTrash ? '' : 'AND b.deleted_at IS NULL'}`,
    args: [id(req.params.id), req.user.id]
  })).rows[0];
  if (!b) fail(404, 'Book not found');
  return b;
}
router.get('/', route(async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 500)),
    offset = Math.max(0, Number(req.query.offset) || 0);
  res.json((await db.execute({
    sql: `SELECT b.*,COALESCE(p.current_page,1) current_page,COALESCE(p.zoom,1) zoom,COALESCE(p.updated_at,b.uploaded_at) last_read_at,s.data state_data,s.version state_version FROM books b LEFT JOIN progress p ON p.book_id=b.id LEFT JOIN book_state s ON s.book_id=b.id WHERE b.user_id=? AND b.deleted_at IS ${req.query.trash === '1' ? 'NOT ' : ''}NULL ORDER BY COALESCE(p.updated_at,b.uploaded_at) DESC LIMIT ? OFFSET ?`,
    args: [req.user.id, limit, offset]
  })).rows.map(({
    filename,
    ...b
  }) => ({
    ...b,
    state: JSON.parse(b.state_data || '{}'),
    state_data: undefined
  })));
}));
router.post('/upload', uploadGate, upload.single('file'), route(async (req, res) => {
  const buffer = await fileBuffer(req),
    format = /\.epub$/i.test(req.file.originalname) ? 'epub' : 'pdf';
  if (format === 'pdf' && !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) fail(400, 'This file does not contain a valid PDF header.');
  if (format === 'epub') await validateZip(buffer, 'epub');
  await quota(req.user.id, buffer.length);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const duplicate = (await db.execute({
    sql: 'SELECT id,title FROM books WHERE user_id=? AND sha256=? AND deleted_at IS NULL',
    args: [req.user.id, hash]
  })).rows[0];
  if (duplicate) return res.json({
    ...duplicate,
    duplicate: true
  });
  const bookId = randomId(),
    filename = `books/${req.user.id}/${bookId}.${format}`,
    title = text(req.body.title || req.file.originalname.replace(/\.(pdf|epub)$/i, ''), 'Title');
  await uploadToR2(filename, buffer, format === 'pdf' ? 'application/pdf' : 'application/epub+zip');
  try {
    await db.batch([{
      sql: 'INSERT INTO books(id,title,filename,user_id,format,size_bytes,sha256) VALUES(?,?,?,?,?,?,?)',
      args: [bookId, title, filename, req.user.id, format, buffer.length, hash]
    }, {
      sql: 'INSERT INTO progress(book_id) VALUES(?)',
      args: [bookId]
    }], 'write');
  } catch (e) {
    await deleteFromR2(filename).catch(() => {});
    throw e;
  }
  res.status(201).json({
    id: bookId,
    title,
    format
  });
}));
router.get('/:id', route(async (req, res) => {
  const {
    filename,
    ...b
  } = await ownedBook(req);
  res.json(b);
}));
router.get('/:id/file', route(async (req, res) => {
  const book = await ownedBook(req),
    range = req.headers.range;
  if (range && !/^bytes=\d*-\d*$/.test(range)) fail(416, 'Only a single byte range is supported.');
  const obj = await getFromR2(book.filename, range);
  res.setHeader('Content-Type', book.format === 'epub' ? 'application/epub+zip' : 'application/pdf');
  res.setHeader('Accept-Ranges', 'bytes');
  if (obj.ContentLength != null) res.setHeader('Content-Length', obj.ContentLength);
  if (obj.ContentRange) {
    res.status(206);
    res.setHeader('Content-Range', obj.ContentRange);
  }
  await pipeline(obj.Body, res);
}));
router.patch('/:id', route(async (req, res) => {
  const book = await ownedBook(req);
  const fields = {},
    body = req.body;
  for (const name of ['title', 'author', 'isbn', 'language', 'publisher']) if (body[name] !== undefined) fields[name] = text(body[name], name, name === 'title' ? 300 : 200, name !== 'title');
  if (body.status !== undefined) {
    if (!['unread', 'reading', 'finished', 'paused'].includes(body.status)) fail(400, 'Invalid reading status');
    fields.status = body.status;
    if (body.status === 'finished' && (book.status !== 'finished' || !book.finished_at)) fields.finished_at = new Date().toISOString();
  }
  if (body.favorite !== undefined) {
    if (typeof body.favorite !== 'boolean') fail(400, 'Favorite must be true or false');
    fields.favorite = body.favorite ? 1 : 0;
  }
  if (Object.keys(fields).length) await db.execute({
    sql: `UPDATE books SET ${Object.keys(fields).map(k => `${k}=?`).join(',')} WHERE id=? AND user_id=?`,
    args: [...Object.values(fields), req.params.id, req.user.id]
  });
  res.json({
    ok: true
  });
}));
router.patch('/:id/pages', route(async (req, res) => {
  await ownedBook(req);
  const pages = integer(req.body.pageCount, 'Page count', 1, 100000);
  await db.execute({
    sql: 'UPDATE books SET page_count=? WHERE id=? AND user_id=?',
    args: [pages, req.params.id, req.user.id]
  });
  res.json({
    ok: true
  });
}));
router.put('/:id/progress', route(async (req, res) => {
  const b = await ownedBook(req),
    page = integer(req.body.currentPage, 'Page', 1, b.page_count || 100000),
    zoom = req.body.zoom ?? 1;
  if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 0.25 || zoom > 4) fail(400, 'Zoom must be between 0.25 and 4.');
  await db.batch([{
    sql: "UPDATE progress SET current_page=?,zoom=?,updated_at=datetime('now') WHERE book_id=?",
    args: [page, zoom, b.id]
  }, {
    sql: "UPDATE books SET status=CASE WHEN status='unread' AND ?>1 THEN 'reading' ELSE status END WHERE id=?",
    args: [page, b.id]
  }], 'write');
  res.json({
    ok: true
  });
}));
router.get('/:id/state', route(async (req, res) => {
  await ownedBook(req);
  const s = (await db.execute({
    sql: 'SELECT data,version FROM book_state WHERE book_id=? AND user_id=?',
    args: [req.params.id, req.user.id]
  })).rows[0];
  res.json({
    data: JSON.parse(s?.data || '{}'),
    version: s?.version || 0
  });
}));
router.put('/:id/state', route(async (req, res) => {
  const b = await ownedBook(req),
    version = integer(req.body.version, 'Version'),
    data = req.body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Buffer.byteLength(JSON.stringify(data)) > 512000) fail(400, 'Book notes exceed the supported size.');
  for (const key of Object.keys(data)) if (!['bookmarks', 'highlights', 'flashcards', 'tags', 'notes', 'chat'].includes(key)) fail(400, 'Unknown note type');
  for (const key of ['bookmarks', 'highlights', 'flashcards', 'tags', 'chat']) if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].length > 3000)) fail(400, `Invalid ${key}`);
  if (data.notes !== undefined) text(data.notes, 'Notes', 200000, true);
  for (const tag of data.tags || []) text(tag, 'Collection', 100);
  for (const key of ['bookmarks', 'highlights', 'flashcards', 'chat']) for (const item of data[key] || []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(400, `Invalid ${key} item`);
    if (key === 'bookmarks' || key === 'highlights') integer(item.page, 'Page', 1, 100000);
    if (key === 'highlights' || key === 'flashcards') text(item.id, 'Note ID', 100);
    if (key === 'highlights' || key === 'chat') text(item.text, 'Text', 100000, true);
    if (key === 'flashcards') {
      text(item.front, 'Question', 100000, true);
      text(item.back, 'Answer', 100000, true);
    }
    if (key === 'chat' && !['user', 'ai'].includes(item.role)) fail(400, 'Invalid message role');
    if (item.rects !== undefined) {
      if (!Array.isArray(item.rects) || item.rects.length > 1000) fail(400, 'Invalid highlight rectangles');
      for (const rect of item.rects) {
        if (!rect || typeof rect !== 'object') fail(400, 'Invalid highlight rectangle');
        integer(rect.page, 'Page', 1, 100000);
        for (const coord of ['left', 'top', 'width', 'height']) if (typeof rect[coord] !== 'number' || !Number.isFinite(rect[coord]) || rect[coord] < 0 || rect[coord] > 100) fail(400, 'Invalid highlight coordinates');
      }
    }
  }
  const result = version === 0 ? await db.execute({
    sql: 'INSERT OR IGNORE INTO book_state(book_id,user_id,data,version) VALUES(?,?,?,1)',
    args: [b.id, req.user.id, JSON.stringify(data)]
  }) : await db.execute({
    sql: 'UPDATE book_state SET data=?,version=version+1 WHERE book_id=? AND user_id=? AND version=?',
    args: [JSON.stringify(data), b.id, req.user.id, version]
  });
  if (result.rowsAffected !== 1) fail(409, 'Notes changed on another device. Your local draft is retained.');
  res.json({
    version: version + 1
  });
}));
router.put('/:id/text', route(async (req, res) => {
  const b = await ownedBook(req),
    pages = req.body.pages;
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 20) fail(400, 'Send at most 20 pages per batch.');
  await db.batch(pages.map(p => ({
    sql: 'INSERT INTO book_pages(book_id,page,text) VALUES(?,?,?) ON CONFLICT(book_id,page) DO UPDATE SET text=excluded.text',
    args: [b.id, integer(p.page, 'Page', 1, b.page_count || 100000), text(p.text, 'Page text', 60000, true)]
  })), 'write');
  res.json({
    ok: true
  });
}));
router.get('/:id/text', route(async (req, res) => {
  await ownedBook(req);
  res.json((await db.execute({
    sql: 'SELECT page,text FROM book_pages WHERE book_id=? ORDER BY page',
    args: [req.params.id]
  })).rows);
}));
const coverCache = new Map();
router.get('/:id/cover-candidates', rateLimit(30, 3600000), route(async (req, res) => {
  const b = await ownedBook(req),
    q = new URLSearchParams({
      title: b.title,
      fields: 'key,title,author_name,cover_i,edition_key,isbn',
      limit: '8'
    });
  if (b.author) q.set('author', b.author);
  if (b.isbn) {
    q.delete('title');
    q.set('q', `isbn:${b.isbn.replace(/[^0-9Xx]/g, '')}`);
  }
  const cacheKey = q.toString();
  if (coverCache.get(cacheKey)?.until > Date.now()) return res.json(coverCache.get(cacheKey).data);
  const response = await fetch(`https://openlibrary.org/search.json?${q}`, {
    headers: {
      'User-Agent': process.env.COVER_LOOKUP_USER_AGENT || 'ReadingRoom/2.0 (personal book library)'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) fail(502, 'Cover lookup is temporarily unavailable.');
  const json = await response.json();
  let candidates = (json.docs || []).filter(d => Number.isInteger(d.cover_i)).map(d => ({
    title: d.title,
    author: d.author_name?.join(', ') || '',
    source: 'Open Library',
    url: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false`,
    reference: `https://openlibrary.org${d.key}`,
    isbn: d.isbn?.[0] || ''
  }));
  if (!candidates.length && process.env.GOOGLE_BOOKS_API_KEY) {
    const query = b.isbn ? `isbn:${b.isbn}` : `intitle:${b.title}${b.author ? ' inauthor:' + b.author : ''}`;
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?${new URLSearchParams({
      q: query,
      maxResults: '8',
      key: process.env.GOOGLE_BOOKS_API_KEY
    })}`, {
      signal: AbortSignal.timeout(15000)
    });
    if (r.ok) {
      const data = await r.json();
      candidates = (data.items || []).filter(d => d.volumeInfo?.imageLinks?.thumbnail).map(d => ({
        title: d.volumeInfo.title,
        author: d.volumeInfo.authors?.join(', ') || '',
        source: 'Google Books',
        url: d.volumeInfo.imageLinks.thumbnail.replace(/^http:/, 'https:'),
        reference: d.volumeInfo.infoLink || '',
        isbn: d.volumeInfo.industryIdentifiers?.[0]?.identifier || ''
      }));
    }
  }
  if (coverCache.size > 200) coverCache.clear();
  coverCache.set(cacheKey, {
    until: Date.now() + 600000,
    data: candidates
  });
  res.json(candidates);
}));
router.put('/:id/cover-reference', route(async (req, res) => {
  const b = await ownedBook(req);
  const ref = text(req.body.url, 'Cover URL', 2000);
  let url;
  try {
    url = new URL(ref);
  } catch {
    fail(400, 'Invalid cover URL');
  }
  if (url.protocol !== 'https:' || !(url.hostname === 'covers.openlibrary.org' && /^\/b\/id\/\d+-L.jpg$/.test(url.pathname) || url.hostname === 'books.google.com' && url.pathname === '/books')) fail(400, 'Choose a cover from the supported providers.');
  await db.execute({
    sql: "UPDATE books SET cover_kind='published',cover_size_bytes=0,cover_ref=?,cover_updated_at=? WHERE id=? AND user_id=?",
    args: [ref, new Date().toISOString(), req.params.id, req.user.id]
  });
  if (['extracted', 'uploaded', 'generated'].includes(b.cover_kind) && b.cover_ref) await deleteFromR2(b.cover_ref).catch(() => {});
  res.json({
    ok: true
  });
}));
router.post('/:id/cover', uploadGate, upload.single('file'), route(async (req, res) => {
  const b = await ownedBook(req),
    buffer = await fileBuffer(req);
  if (buffer.length > 4 * 1024 * 1024) fail(413, 'Cover must be smaller than 4 MB.');
  await quota(req.user.id, Math.max(0, buffer.length - (b.cover_size_bytes || 0)));
  const type = imageType(buffer),
    kind = ['extracted', 'generated'].includes(req.body.kind) ? req.body.kind : 'uploaded',
    key = `covers/${req.user.id}/${b.id}/${randomId()}`;
  await uploadToR2(key, buffer, type);
  try {
    await db.execute({
      sql: 'UPDATE books SET cover_kind=?,cover_ref=?,cover_updated_at=?,cover_size_bytes=? WHERE id=? AND user_id=?',
      args: [kind, key, new Date().toISOString(), buffer.length, b.id, req.user.id]
    });
  } catch (e) {
    await deleteFromR2(key).catch(() => {});
    throw e;
  }
  if (['extracted', 'uploaded', 'generated'].includes(b.cover_kind) && b.cover_ref) await deleteFromR2(b.cover_ref).catch(() => {});
  res.json({
    ok: true
  });
}));
router.get('/:id/cover', route(async (req, res) => {
  const b = await ownedBook(req);
  if (!['extracted', 'uploaded', 'generated'].includes(b.cover_kind) || !b.cover_ref) fail(404, 'No stored cover');
  const obj = await getFromR2(b.cover_ref);
  res.setHeader('Content-Type', obj.ContentType || 'image/png');
  if (obj.ContentLength) res.setHeader('Content-Length', obj.ContentLength);
  await pipeline(obj.Body, res);
}));
router.delete('/:id', route(async (req, res) => {
  await ownedBook(req);
  await db.execute({
    sql: "UPDATE books SET deleted_at=datetime('now') WHERE id=? AND user_id=?",
    args: [req.params.id, req.user.id]
  });
  res.json({
    ok: true
  });
}));
router.post('/:id/restore', route(async (req, res) => {
  const b = await ownedBook(req, true);
  if (b.sha256 && (await db.execute({
    sql: 'SELECT id FROM books WHERE user_id=? AND sha256=? AND deleted_at IS NULL AND id!=?',
    args: [req.user.id, b.sha256, b.id]
  })).rows.length) fail(409, 'An identical book is already in your library.');
  await db.execute({
    sql: 'UPDATE books SET deleted_at=NULL WHERE id=? AND user_id=?',
    args: [b.id, req.user.id]
  });
  res.json({
    ok: true
  });
}));
router.delete('/:id/permanent', route(async (req, res) => {
  const b = await ownedBook(req, true);
  if (!b.deleted_at) fail(400, 'Move this book to trash first.');
  await deleteFromR2(b.filename);
  if (['extracted', 'uploaded', 'generated'].includes(b.cover_kind) && b.cover_ref) await deleteFromR2(b.cover_ref);
  await db.batch(['book_state', 'book_pages', 'progress', 'reading_sessions'].map(table => ({
    sql: `DELETE FROM ${table} WHERE book_id=?`,
    args: [b.id]
  })).concat({
    sql: 'DELETE FROM books WHERE id=? AND user_id=?',
    args: [b.id, req.user.id]
  }), 'write');
  res.json({
    ok: true
  });
}));
export default router;
