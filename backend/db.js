import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Create tables on startup (batch sends all statements in one round-trip)
await client.batch(
  [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      page_count INTEGER,
      user_id TEXT REFERENCES users(id),
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS progress (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      current_page INTEGER NOT NULL DEFAULT 1,
      zoom REAL NOT NULL DEFAULT 1.0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      word_count INTEGER DEFAULT 0,
      user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ],
  "write"
);

// Safely add user_id columns if they don't exist yet (for existing DBs)
try {
  await client.execute("ALTER TABLE books ADD COLUMN user_id TEXT REFERENCES users(id)");
} catch (e) {
  // Ignore error if column already exists
}

try {
  await client.execute("ALTER TABLE documents ADD COLUMN user_id TEXT REFERENCES users(id)");
} catch (e) {
  // Ignore error if column already exists
}

export default client;

