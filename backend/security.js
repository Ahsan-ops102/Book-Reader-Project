import crypto from 'node:crypto';
export const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32 || jwtSecret.includes('please_change')) throw new Error('JWT_SECRET must contain at least 32 bytes of random data.');
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new HttpError(status, message);
};
export const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
export function text(value, name, max = 300, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || !optional && !value.trim() || value.length > max) fail(400, `${name} must be text of at most ${max} characters`);
  return value.trim();
}
export function integer(value, name, min = 0, max = 1000000) {
  if (!Number.isInteger(value) || value < min || value > max) fail(400, `${name} must be between ${min} and ${max}`);
  return value;
}
export function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail(400, 'Invalid identifier');
  return value;
}
export const randomId = () => crypto.randomUUID();
export function rateLimit(max, windowMs, key = req => req.user?.id || req.ip) {
  const entries = new Map();
  const timer = setInterval(() => {
    for (const [k, v] of entries) if (v.until <= Date.now()) entries.delete(k);
  }, windowMs);
  timer.unref();
  return (req, res, next) => {
    const k = key(req),
      now = Date.now();
    let e = entries.get(k);
    if (!e || e.until <= now) {
      e = {
        count: 0,
        until: now + windowMs
      };
      entries.set(k, e);
    }
    if (++e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.until - now) / 1000));
      return res.status(429).json({
        error: 'Too many requests. Please try again shortly.'
      });
    }
    next();
  };
}
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}
