import { accountKey, recordSession } from './api.js';
let opening;
function db() {
  return opening ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('reading-room-private', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('entries');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function cacheGet(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction('entries').objectStore('entries').get(accountKey(key));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function cacheSet(key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('entries', 'readwrite');
    tx.objectStore('entries').put(value, accountKey(key));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function cacheRemove(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('entries', 'readwrite');
    tx.objectStore('entries').delete(accountKey(key));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function clearOffline() {
  const prefix = accountKey('');
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('entries', 'readwrite'),
      store = tx.objectStore('entries'),
      r = store.openCursor();
    r.onsuccess = () => {
      const cursor = r.result;
      if (cursor) {
        if (String(cursor.key).startsWith(prefix)) cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function enqueueSession(session) {
  const key = 'sessions';
  const queued = (await cacheGet(key)) || [];
  await cacheSet(key, [...queued, session]);
  await flushSessions();
}
let flushing = false;
export async function flushSessions() {
  if (flushing) return;
  flushing = true;
  try {
    const pending = (await cacheGet('sessions')) || [];
    for (const session of pending) {
      await recordSession(session);
      const current = (await cacheGet('sessions')) || [];
      await cacheSet('sessions', current.filter(s => s.id !== session.id));
    }
  } catch {} finally {
    flushing = false;
  }
}
window.addEventListener('online', flushSessions);
