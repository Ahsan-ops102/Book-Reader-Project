import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import db from './db.js';
import { storageHealth } from './storage.js';
import { jwtSecret, route, fail, HttpError, securityHeaders, rateLimit } from './security.js';
import authRouter from './routes/auth.js';
import booksRouter from './routes/books.js';
import documentsRouter from './routes/documents.js';
import aiRouter from './routes/ai.js';
import accountRouter from './routes/account.js';
export const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim().replace(/\/$/, ''));
if (origins.includes('*')) throw new Error('ALLOWED_ORIGINS must contain explicit origins.');
app.use(securityHeaders, cors({
  origin: (origin, cb) => cb(null, !origin || origins.includes(origin.replace(/\/$/, ''))),
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Retry-After']
}));
app.use(rateLimit(600, 60000, req => req.ip));
app.use(express.json({
  limit: '6mb'
}));
app.get('/api/health', (_req, res) => res.json({
  ok: true
}));
app.get('/api/config', (_req, res) => res.json({
  registration: process.env.REGISTRATION_MODE === 'open' ? 'open' : 'invite',
  maxUploadMB: Number(process.env.MAX_UPLOAD_MB || 64),
  aiEnabled: !!process.env.GEMINI_API_KEY,
  coverGenerationEnabled: !!process.env.GEMINI_COVER_MODEL && !!process.env.GEMINI_API_KEY
}));
app.use('/api/auth', authRouter);
app.get('/api/shared/:id', route(async (req, res) => {
  const row = (await db.execute({
    sql: 'SELECT data FROM shares WHERE id=? AND expires_at>?',
    args: [req.params.id, Date.now()]
  })).rows[0];
  if (!row) fail(404, 'This share has expired or was revoked.');
  res.json(JSON.parse(row.data));
}));
app.use((req, res, next) => {
  Promise.resolve().then(async () => {
    const token = req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) fail(401, 'Please sign in.');
    let user;
    try {
      user = jwt.verify(token, jwtSecret, {
        algorithms: ['HS256'],
        issuer: 'reading-room',
        audience: 'reading-room'
      });
    } catch {
      fail(401, 'Your session has expired. Please sign in again.');
    }
    const session = (await db.execute({
      sql: 'SELECT id FROM sessions WHERE id=? AND user_id=? AND expires_at>?',
      args: [user.sid || '', user.id || '', Date.now()]
    })).rows[0];
    if (!session) fail(401, 'Your session has expired. Please sign in again.');
    req.user = user;
    // route() intentionally handles rejected promises; continue only after verification.
    next();
  }).catch(next);
});
app.post('/api/logout', route(async (req, res) => {
  await db.execute({
    sql: 'DELETE FROM sessions WHERE id=?',
    args: [req.user.sid]
  });
  res.status(204).end();
}));
app.post('/api/password', rateLimit(5, 3600000), route(async (req, res) => {
  const {
    currentPassword,
    newPassword
  } = req.body;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 12 || Buffer.byteLength(newPassword) > 72) fail(400, 'Use a new password of 12 characters or more (at most 72 bytes).');
  const user = (await db.execute({
    sql: 'SELECT password_hash FROM users WHERE id=?',
    args: [req.user.id]
  })).rows[0];
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) fail(403, 'Current password is incorrect.');
  await db.batch([{
    sql: 'UPDATE users SET password_hash=? WHERE id=?',
    args: [await bcrypt.hash(newPassword, 12), req.user.id]
  }, {
    sql: 'DELETE FROM sessions WHERE user_id=?',
    args: [req.user.id]
  }], 'write');
  res.json({
    ok: true
  });
}));
app.get('/api/health/services', route(async (req, res) => {
  await Promise.all([db.execute('SELECT 1'), storageHealth()]);
  res.json({
    database: 'ok',
    storage: 'ok'
  });
}));
app.use('/api/books', booksRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/ai', rateLimit(Number(process.env.AI_REQUESTS_PER_HOUR || 60), 3600000), aiRouter);
app.use('/api/account', accountRouter);
app.use((_req, res) => res.status(404).json({
  error: 'Not found'
}));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : err.name === 'MulterError' ? 400 : 500);
  const requestId = crypto.randomUUID();
  if (status >= 500) console.error(JSON.stringify({
    requestId,
    path: req.path,
    name: err.name,
    code: err.code || 'INTERNAL_ERROR'
  }));
  res.status(status).json({
    error: status >= 500 && !(err instanceof HttpError) ? 'The request could not be completed. Please retry.' : err.message,
    requestId
  });
});
if (process.env.NO_LISTEN !== '1') {
  const server = app.listen(Number(process.env.PORT || 3001), process.env.HOST || '127.0.0.1', () => console.log('Reading Room API is ready.'));
  server.requestTimeout = 120000;
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
