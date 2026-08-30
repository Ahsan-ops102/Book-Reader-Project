if (!process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL is required; use file:./data/library.db for local development.');
const db = process.env.TURSO_DATABASE_URL.startsWith('file:') ? (await import('./localDb.js')).createLocalClient(process.env.TURSO_DATABASE_URL) : (await import('@libsql/client/web')).createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});
await db.execute('PRAGMA foreign_keys = ON');
await db.batch([`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, `CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, filename TEXT NOT NULL, page_count INTEGER, user_id TEXT REFERENCES users(id), uploaded_at TEXT NOT NULL DEFAULT (datetime('now')))`, `CREATE TABLE IF NOT EXISTS progress (book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE, current_page INTEGER NOT NULL DEFAULT 1, zoom REAL NOT NULL DEFAULT 1.0, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`, `CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, filename TEXT NOT NULL, word_count INTEGER DEFAULT 0, user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`, `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))`], 'write');
// Additive migrations preserve existing content. Signup never assigns legacy ownership.
for (const [table, fields] of Object.entries({
  books: {
    user_id: 'TEXT REFERENCES users(id)',
    author: "TEXT NOT NULL DEFAULT ''",
    isbn: "TEXT NOT NULL DEFAULT ''",
    language: "TEXT NOT NULL DEFAULT ''",
    publisher: "TEXT NOT NULL DEFAULT ''",
    format: "TEXT NOT NULL DEFAULT 'pdf'",
    size_bytes: 'INTEGER NOT NULL DEFAULT 0',
    sha256: 'TEXT',
    cover_kind: "TEXT NOT NULL DEFAULT 'placeholder'",
    cover_ref: "TEXT NOT NULL DEFAULT ''",
    cover_size_bytes: 'INTEGER NOT NULL DEFAULT 0',
    cover_updated_at: 'TEXT',
    status: "TEXT NOT NULL DEFAULT 'unread'",
    favorite: 'INTEGER NOT NULL DEFAULT 0',
    finished_at: 'TEXT',
    deleted_at: 'TEXT'
  },
  documents: {
    user_id: 'TEXT REFERENCES users(id)',
    revision: 'INTEGER NOT NULL DEFAULT 0',
    original_filename: 'TEXT',
    deleted_at: 'TEXT',
    size_bytes: 'INTEGER NOT NULL DEFAULT 0'
  }
})) {
  const existing = new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map(r => r.name));
  for (const [field, definition] of Object.entries(fields)) if (!existing.has(field)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${field} ${definition}`);
}
await db.batch([`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL)`, `CREATE TABLE IF NOT EXISTS book_state (book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 0)`, `CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL DEFAULT '{}')`, `CREATE TABLE IF NOT EXISTS reading_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), book_id TEXT NOT NULL REFERENCES books(id), day TEXT NOT NULL, seconds INTEGER NOT NULL, pages INTEGER NOT NULL DEFAULT 0)`, `CREATE TABLE IF NOT EXISTS document_versions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, filename TEXT NOT NULL, title TEXT NOT NULL, word_count INTEGER NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, `CREATE TABLE IF NOT EXISTS book_pages (book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, page INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(book_id,page))`, `CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, expires_at INTEGER NOT NULL)`, `CREATE INDEX IF NOT EXISTS books_user ON books(user_id,deleted_at)`, `CREATE UNIQUE INDEX IF NOT EXISTS books_hash ON books(user_id,sha256) WHERE sha256 IS NOT NULL AND deleted_at IS NULL`, `CREATE INDEX IF NOT EXISTS documents_user ON documents(user_id,deleted_at)`, `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`, `CREATE INDEX IF NOT EXISTS reading_user ON reading_sessions(user_id,day)`, `INSERT OR IGNORE INTO schema_migrations(version) VALUES (1)`], 'write');
export default db;
