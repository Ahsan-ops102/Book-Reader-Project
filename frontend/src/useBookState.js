import { useEffect, useRef, useState } from 'react';
import { getBookState, saveBookState, accountKey } from './api.js';
const empty = {
  bookmarks: [],
  highlights: [],
  flashcards: [],
  tags: [],
  notes: '',
  chat: []
};
export default function useBookState(id) {
  const [data, setData] = useState(empty),
    [status, setStatus] = useState('Loading notes…'),
    [ready, setReady] = useState(false);
  const ref = useRef({
    data: empty,
    version: 0,
    dirty: false,
    busy: false
  });
  useEffect(() => {
    let active = true;
    const key = accountKey(`notes:${id}`);
    let cached;
    try {
      cached = JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      cached = null;
    }
    ref.current = {
      data: {
        ...empty,
        ...cached?.data
      },
      version: cached?.version || 0,
      dirty: !!cached?.dirty,
      busy: false
    };
    setData(ref.current.data);
    getBookState(id).then(remote => {
      if (!active) return;
      if (ref.current.dirty) {
        if (ref.current.version !== remote.version) {
          setStatus('Sync conflict: local draft retained');
          return;
        }
      } else {
        ref.current.data = {
          ...empty,
          ...remote.data
        };
        ref.current.version = remote.version;
        // Legacy notes are imported only after ownership of this exact book is verified.
        if (!remote.version && !Object.keys(remote.data).length) {
          try {
            const legacy = {
              bookmarks: JSON.parse(localStorage.getItem(`reader_bm_${id}`) || '[]'),
              highlights: JSON.parse(localStorage.getItem(`reader_hl_${id}`) || '[]'),
              flashcards: JSON.parse(localStorage.getItem(`reader_fc_${id}`) || '[]')
            };
            const oldTag = JSON.parse(localStorage.getItem('reader_tags') || '{}')[id];
            if (oldTag) legacy.tags = [oldTag];
            if (Object.values(legacy).some(value => value.length)) {
              ref.current.data = {
                ...empty,
                ...legacy
              };
              ref.current.dirty = true;
              persist();
            }
          } catch {
            setStatus('Some old notes could not be read; the original local data was kept.');
          }
        }
        setData(ref.current.data);
      }
      setStatus('Saved');
    }).catch(() => active && setStatus('Offline · notes kept on this device')).finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, [id]);
  function persist() {
    try {
      localStorage.setItem(accountKey(`notes:${id}`), JSON.stringify(ref.current));
    } catch {
      setStatus('Device storage is full. Export your notes.');
    }
  }
  function update(key, value) {
    setData(prev => {
      const next = {
        ...prev,
        [key]: typeof value === 'function' ? value(prev[key] ?? empty[key]) : value
      };
      ref.current.data = next;
      ref.current.dirty = true;
      persist();
      setStatus('Unsynced changes');
      return next;
    });
  }
  async function resolveConflict(choice) {
    const state = ref.current;
    if (state.busy) throw new Error('A save is in progress. Try again shortly.');
    state.busy = true;
    try {
      const remote = await getBookState(id);
      // Keep both snapshots locally before any explicit conflict resolution.
      localStorage.setItem(accountKey(`notes-recovery:${id}`), JSON.stringify({
        local: state.data,
        remote: remote.data,
        savedAt: Date.now()
      }));
      if (choice === 'cloud') {
        state.data = {
          ...empty,
          ...remote.data
        };
        state.version = remote.version;
        state.dirty = false;
      } else {
        const saved = await saveBookState(id, state.data, remote.version);
        state.version = saved.version;
        state.dirty = false;
      }
      setData(state.data);
      persist();
      setStatus('Saved · recovery copy retained on this device');
    } finally {
      state.busy = false;
    }
  }
  async function flush() {
    const state = ref.current;
    if (!ready || !state.dirty || state.busy) return;
    state.busy = true;
    const snapshot = state.data;
    try {
      const result = await saveBookState(id, snapshot, state.version);
      state.version = result.version;
      state.dirty = state.data !== snapshot;
      setStatus(state.dirty ? 'Unsynced changes' : 'Saved');
      persist();
    } catch (e) {
      setStatus(e.status === 409 ? 'Sync conflict: local draft retained. Export before reloading.' : 'Offline · notes kept on this device');
    } finally {
      state.busy = false;
    }
  }
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(flush, 2500);
    window.addEventListener('online', flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', flush);
      flush();
    };
  }, [id, ready]);
  return {
    data,
    update,
    status,
    ready,
    flush,
    resolveConflict
  };
}
