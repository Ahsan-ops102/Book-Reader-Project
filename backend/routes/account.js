import express from 'express';
import db from '../db.js';
import { route, fail, integer, text, id, randomId } from '../security.js';
const router = express.Router();
router.get('/settings', route(async (req, res) => {
  const s = (await db.execute({
    sql: 'SELECT data FROM user_settings WHERE user_id=?',
    args: [req.user.id]
  })).rows[0];
  res.json(JSON.parse(s?.data || '{}'));
}));
router.put('/settings', route(async (req, res) => {
  const data = req.body;
  if (!data || Array.isArray(data) || JSON.stringify(data).length > 20000) fail(400, 'Invalid settings');
  if (data.theme !== undefined && !['warm', 'sepia', 'dark', 'oled', 'auto'].includes(data.theme)) fail(400, 'Invalid appearance');
  if (data.dailyMinutes !== undefined) integer(data.dailyMinutes, 'Daily reading goal', 1, 600);
  if (data.annualBooks !== undefined) integer(data.annualBooks, 'Annual book goal', 1, 1000);
  await db.execute({
    sql: 'INSERT INTO user_settings(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',
    args: [req.user.id, JSON.stringify(data)]
  });
  res.json({
    ok: true
  });
}));
router.post('/sessions', route(async (req, res) => {
  const b = req.body;
  id(b.id);
  id(b.bookId);
  const seconds = integer(b.seconds, 'Reading seconds', 1, 300),
    pages = integer(b.pages || 0, 'Pages visited', 0, 100);
  const day = text(b.day, 'Day', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) fail(400, 'Invalid session date');
  const owned = (await db.execute({
    sql: 'SELECT id FROM books WHERE id=? AND user_id=? AND deleted_at IS NULL',
    args: [b.bookId, req.user.id]
  })).rows[0];
  if (!owned) fail(404, 'Book not found');
  await db.execute({
    sql: 'INSERT OR IGNORE INTO reading_sessions(id,user_id,book_id,day,seconds,pages) VALUES(?,?,?,?,?,?)',
    args: [b.id, req.user.id, b.bookId, day, seconds, pages]
  });
  res.json({
    ok: true
  });
}));
router.get('/stats', route(async (req, res) => {
  const days = (await db.execute({
    sql: 'SELECT day,SUM(seconds) seconds,SUM(pages) pages FROM reading_sessions WHERE user_id=? GROUP BY day ORDER BY day DESC',
    args: [req.user.id]
  })).rows;
  res.json({
    days,
    totalSeconds: days.reduce((n, d) => n + Number(d.seconds), 0),
    pagesVisited: days.reduce((n, d) => n + Number(d.pages), 0)
  });
}));
router.get('/export', route(async (req, res) => {
  const result = {
    exportedAt: new Date().toISOString(),
    username: req.user.username
  };
  for (const table of ['books', 'documents', 'book_state', 'reading_sessions', 'user_settings']) result[table] = (await db.execute({
    sql: `SELECT * FROM ${table} WHERE user_id=?`,
    args: [req.user.id]
  })).rows;
  res.json(result);
}));
router.get('/shares', route(async (req, res) => {
  res.json((await db.execute({
    sql: 'SELECT id,expires_at FROM shares WHERE user_id=? ORDER BY expires_at DESC',
    args: [req.user.id]
  })).rows);
}));
router.post('/shares', route(async (req, res) => {
  const ids = req.body.bookIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) fail(400, 'Choose 1–100 books.');
  const books = [];
  for (const value of ids) {
    const row = (await db.execute({
      sql: 'SELECT title,author,status FROM books WHERE id=? AND user_id=? AND deleted_at IS NULL',
      args: [id(value), req.user.id]
    })).rows[0];
    if (!row) fail(404, 'Book not found');
    books.push(row);
  }
  const shareId = randomId(),
    expiresAt = Date.now() + integer(req.body.days || 7, 'Share duration', 1, 30) * 86400000;
  await db.execute({
    sql: 'INSERT INTO shares(id,user_id,data,expires_at) VALUES(?,?,?,?)',
    args: [shareId, req.user.id, JSON.stringify({
      title: 'Shared reading shelf',
      books
    }), expiresAt]
  });
  res.status(201).json({
    id: shareId,
    expiresAt
  });
}));
router.delete('/shares/:id', route(async (req, res) => {
  await db.execute({
    sql: 'DELETE FROM shares WHERE id=? AND user_id=?',
    args: [id(req.params.id), req.user.id]
  });
  res.json({
    ok: true
  });
}));
export default router;
