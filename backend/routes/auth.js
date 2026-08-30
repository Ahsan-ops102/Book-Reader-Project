import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { jwtSecret, route, fail, text, randomId, rateLimit } from '../security.js';
const router = express.Router();
router.use(rateLimit(15, 15 * 60 * 1000, req => req.ip));
function credentials(body, register = false) {
  const username = text(body.username, 'Username', 80).normalize('NFKC');
  const password = body.password;
  if (typeof password !== 'string' || Buffer.byteLength(password) > 72 || password.length < (register ? 12 : 1)) fail(400, register ? 'Use a password of at least 12 characters and at most 72 bytes.' : 'Enter a valid password.');
  return {
    username,
    password
  };
}
async function issue(user) {
  const sid = randomId(),
    expires = Date.now() + 7 * 86400000;
  await db.execute({
    sql: 'INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)',
    args: [sid, user.id, expires]
  });
  return {
    token: jwt.sign({
      id: user.id,
      username: user.username,
      sid
    }, jwtSecret, {
      expiresIn: '7d',
      algorithm: 'HS256',
      issuer: 'reading-room',
      audience: 'reading-room'
    }),
    username: user.username,
    userId: user.id
  };
}
router.post('/register', route(async (req, res) => {
  if (process.env.REGISTRATION_MODE !== 'open' && (!process.env.INVITE_CODE || req.body.inviteCode !== process.env.INVITE_CODE)) fail(403, 'Registration requires a valid invitation code.');
  const {
    username,
    password
  } = credentials(req.body, true);
  if ((await db.execute({
    sql: 'SELECT id FROM users WHERE username = ? COLLATE NOCASE',
    args: [username]
  })).rows.length) fail(409, 'This username is already registered.');
  const user = {
    id: randomId(),
    username
  };
  const hash = await bcrypt.hash(password, 12);
  try {
    await db.execute({
      sql: 'INSERT INTO users(id,username,password_hash) VALUES(?,?,?)',
      args: [user.id, username, hash]
    });
  } catch (err) {
    if (String(err.code).includes('CONSTRAINT')) fail(409, 'This username is already registered.');
    throw err;
  }
  res.status(201).json(await issue(user));
}));
router.post('/login', route(async (req, res) => {
  const {
    username,
    password
  } = credentials(req.body);
  const user = (await db.execute({
    sql: 'SELECT * FROM users WHERE username = ? COLLATE NOCASE',
    args: [username]
  })).rows[0];
  const valid = await bcrypt.compare(password, user?.password_hash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
  if (!user || !valid) fail(401, 'Invalid username or password');
  res.json(await issue(user));
}));
export default router;
