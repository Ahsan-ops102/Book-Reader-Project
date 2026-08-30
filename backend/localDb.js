// Local/test adapter with the same small interface used by the Turso client.
// Serialized access prevents another request from joining an open transaction.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
export function createLocalClient(url) {
  const filename = path.resolve(decodeURIComponent(url.replace(/^file:/, '')));
  fs.mkdirSync(path.dirname(filename), {
    recursive: true
  });
  const connection = new DatabaseSync(filename);
  connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  let tail = Promise.resolve();
  async function acquire() {
    let release;
    const next = new Promise(r => release = r),
      previous = tail;
    tail = next;
    await previous;
    return release;
  }
  function execute(query) {
    const sql = typeof query === 'string' ? query : query.sql,
      args = typeof query === 'string' ? [] : query.args || [];
    const stmt = connection.prepare(sql);
    if (stmt.columns().length) return {
      rows: stmt.all(...args),
      rowsAffected: 0
    };
    const result = stmt.run(...args);
    return {
      rows: [],
      rowsAffected: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid
    };
  }
  return {
    async execute(query) {
      const release = await acquire();
      try {
        return execute(query);
      } finally {
        release();
      }
    },
    async batch(queries) {
      const release = await acquire();
      connection.exec('BEGIN IMMEDIATE');
      try {
        const results = queries.map(execute);
        connection.exec('COMMIT');
        return results;
      } catch (e) {
        connection.exec('ROLLBACK');
        throw e;
      } finally {
        release();
      }
    },
    async transaction() {
      const release = await acquire();
      connection.exec('BEGIN IMMEDIATE');
      let finished = false;
      return {
        execute: async query => execute(query),
        async commit() {
          if (!finished) {
            connection.exec('COMMIT');
            finished = true;
            release();
          }
        },
        async rollback() {
          if (!finished) {
            connection.exec('ROLLBACK');
            finished = true;
            release();
          }
        },
        close() {
          if (!finished) {
            connection.exec('ROLLBACK');
            finished = true;
            release();
          }
        }
      };
    },
    close() {
      connection.close();
    }
  };
}
