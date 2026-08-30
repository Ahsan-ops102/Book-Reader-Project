import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listBooks, uploadBook, deleteBook, restoreBook, purgeBook, updateBook, saveBookState, fetchBookBlob, logoutUser, createShare, getConfig } from '../api.js';
import { cacheGet, cacheSet, cacheRemove } from '../offline.js';
import Cover from './Cover.jsx';
import BookDetails from './BookDetails.jsx';
import Settings from './Settings.jsx';
import StatsPanel from './StatsPanel.jsx';
import Study from './Study.jsx';
import Dialog from './Dialog.jsx';
import {prepareOfflineShell} from '../offlineShell.js';
import { needsPdfCover } from '../coverQueue.js';
export default function Library() {
  const nav = useNavigate(),
    input = useRef(null),
    cancel = useRef(false),
    uploadBusy = useRef(false),
    attemptedCovers = useRef(new Set());
  const [books, setBooks] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [tab, setTab] = useState('books'),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [tag, setTag] = useState('all'),
    [sort, setSort] = useState('recent'),
    [view, setView] = useState('grid'),
    [limit, setLimit] = useState(60),
    [favorite, setFavorite] = useState(false),
    [details, setDetails] = useState(null),
    [settings, setSettings] = useState(false),
    [queue, setQueue] = useState([]),
    [confirm, setConfirm] = useState(null),
    [selected, setSelected] = useState([]),
    [share, setShare] = useState(''),
    [maxMB, setMaxMB] = useState(64);
  async function refresh() {
    setLoading(true);
    try {
      const data = await listBooks(tab === 'trash');
      setBooks(data);
      if (tab !== 'trash') await cacheSet('library', data);
      setError('');
      if (details) setDetails(data.find(b => b.id === details.id) || null);
    } catch (e) {
      const cached = tab !== 'trash' ? await cacheGet('library').catch(() => null) : null;
      if (cached) setBooks(cached);
      setError(cached ? 'Offline library · showing the last synced shelf' : e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    setSelected([]);
  }, [tab]);
  useEffect(() => {
    getConfig().then(c => setMaxMB(c.maxUploadMB)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!loading && tab === 'books' && navigator.onLine && books.some(b => needsPdfCover(b) && !attemptedCovers.current.has(b.id))) fillMissingCovers({ automatic: true });
  }, [books, loading, tab]);
  useEffect(() => {
    cancel.current = false;
    const reconnect = () => { attemptedCovers.current.clear(); refresh(); };
    window.addEventListener('online', reconnect);
    return () => { cancel.current = true; window.removeEventListener('online', reconnect); };
  }, []);
  const tags = [...new Set(books.flatMap(b => b.state?.tags || []))].sort();
  const filtered = useMemo(() => {
    let result = books.filter(b => `${b.title} ${b.author} ${b.isbn}`.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || b.status === status) && (tag === 'all' || b.state?.tags?.includes(tag)) && (!favorite || !!b.favorite));
    if (sort === 'title') result.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'added') result.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
    return result;
  }, [books, query, status, tag, sort, favorite]);
  const continueBook = books.find(b => b.status === 'reading');
  async function run(fn) {
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function uploadFiles(files) {
    if (uploadBusy.current) return;
    uploadBusy.current = true;
    cancel.current = false;
    const batch = [...files].map(file => ({
      file,
      name: file.name,
      status: 'Queued',
      progress: 0
    }));
    setQueue(batch);
    for (let i = 0; i < batch.length; i++) {
      if (cancel.current) {
        batch[i].status = 'Cancelled';
        setQueue([...batch]);
        continue;
      }
      try {
        const item = batch[i];
        if (!/\.(pdf|epub)$/i.test(item.name)) throw new Error('Choose PDF or EPUB files');
        if (item.file.size > maxMB * 1024 * 1024) throw new Error(`File exceeds ${maxMB} MB`);
        item.status = 'Uploading';
        setQueue([...batch]);
        const book = await uploadBook(item.file, item.name.replace(/\.(pdf|epub)$/i, '').replace(/[_]+/g, ' '), p => {
          item.progress = p;
          setQueue([...batch]);
        });
        if (!book.duplicate && book.format !== 'epub') {
          item.status = 'Extracting cover';
          setQueue([...batch]);
          try {
            await (await import('../bookTools.js')).extractBook(item.file, book);
          } catch (e) {
            item.status = `Uploaded · cover needs attention: ${e.message}`;
            setQueue([...batch]);
            continue;
          }
        }
        item.status = book.duplicate ? 'Already in your library' : 'Ready';
      } catch (e) {
        batch[i].status = e.message;
      }
      setQueue([...batch]);
    }
    uploadBusy.current = false;
    await refresh();
  }
  async function download(b) {
    const blob = await fetchBookBlob(b.id);
    await cacheSet(`file:${b.id}`, blob);
    await cacheSet(`book:${b.id}`, b);
    setError(`“${b.title}” downloaded. ${await prepareOfflineShell()}`);
  }
  async function fillMissingCovers({ automatic = false } = {}) {
    if (uploadBusy.current) return;
    const missing = books.filter(b => needsPdfCover(b) && (!automatic || !attemptedCovers.current.has(b.id)));
    if (!missing.length) {
      if (!automatic) setError('Every PDF already has a cover. Choose Details & cover to change one.');
      return;
    }
    uploadBusy.current = true;
    cancel.current = false;
    missing.forEach(book => attemptedCovers.current.add(book.id));
    const batch = missing.map(book => ({
      name: book.title,
      status: 'Queued',
      book
    }));
    setQueue([...batch]);
    try {
      const {
        extractBook
      } = await import('../bookTools.js');
      for (const item of batch) {
        if (cancel.current) {
          item.status = 'Cancelled';
          setQueue([...batch]);
          continue;
        }
        item.status = 'Extracting PDF cover';
        setQueue([...batch]);
        try {
          await extractBook(await fetchBookBlob(item.book.id), item.book, () => {}, {
            preserveMetadata: true
          });
          item.status = 'Cover saved';
        } catch (e) {
          item.status = e.message;
        }
        setQueue([...batch]);
      }
    } finally {
      uploadBusy.current = false;
      await refresh();
    }
  }
  async function editTags(book, value) {
    const next = value.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20);
    await saveBookState(book.id, {
      ...book.state,
      tags: next
    }, book.state_version || 0);
    await refresh();
  }
  return <main className="page library-page" onDragOver={e => e.preventDefault()} onDrop={e => {
    e.preventDefault();
    uploadFiles(e.dataTransfer.files);
  }}><header className="page-header"><div><div className="eyebrow">Your personal library</div><h1>The Reading Room</h1><p>{books.length} {books.length === 1 ? 'book' : 'books'} · a little space to think</p></div><div className="action-row"><button onClick={() => setSettings(true)}>Preferences</button><button onClick={() => logoutUser()}>Sign out</button><button className="primary" disabled={uploadBusy.current} onClick={() => input.current.click()}>+ Add books</button><input hidden multiple ref={input} type="file" accept=".pdf,.epub" onChange={e => {
          uploadFiles(e.target.files);
          e.target.value = '';
        }} /></div></header><nav className="tabs" aria-label="Library sections">{[['books', 'My books'], ['study', 'Flashcards'], ['stats', 'Reading stats'], ['trash', 'Trash']].map(([value, label]) => <button key={value} aria-current={tab === value ? 'page' : undefined} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}<button onClick={() => nav('/writer')}>Writer ↗</button></nav>
 {error && <div role="status" className="notice"><span>{error}</span><button onClick={refresh}>Retry / refresh</button><button aria-label="Dismiss" onClick={() => setError('')}>×</button></div>}
 {!!queue.length && <section className="upload-queue" aria-label="Upload queue">{queue.map((q, i) => <div key={i}><strong>{q.name}</strong><span>{q.status}{q.status === 'Uploading' ? ` · ${q.progress}%` : ''}</span></div>)}<button onClick={() => uploadBusy.current ? cancel.current = true : setQueue([])}>{uploadBusy.current ? 'Stop after current file' : 'Dismiss queue'}</button></section>}
 {tab === 'stats' ? <StatsPanel books={books} /> : tab === 'study' ? <Study books={books} onRefresh={refresh} /> : <>{tab === 'books' && continueBook && !query && status === 'all' && <section className="continue-reading"><Cover book={continueBook} /><div><div className="eyebrow">Pick up where you left off</div><h2>{continueBook.title}</h2><p>{continueBook.author || 'Your next chapter awaits'} · Page {continueBook.current_page}</p><button className="primary" onClick={() => nav(`/book/${continueBook.id}`)}>Continue reading →</button></div></section>}
 <div className="library-controls"><label className="search-field"><span className="sr-only">Search books</span><input placeholder="Search title, author, or ISBN…" value={query} onChange={e => setQuery(e.target.value)} /></label><label><span className="sr-only">Reading status</span><select value={status} onChange={e => setStatus(e.target.value)}>{['all', 'unread', 'reading', 'finished', 'paused'].map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}</select></label><label><span className="sr-only">Collection</span><select value={tag} onChange={e => setTag(e.target.value)}><option value="all">All collections</option>{tags.map(t => <option key={t}>{t}</option>)}</select></label><select aria-label="Sort books" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Recently read</option><option value="title">Title A–Z</option><option value="added">Recently added</option></select><button aria-pressed={favorite} onClick={() => setFavorite(!favorite)}>☆ Favorites</button><button aria-label="Toggle list view" onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>{view === 'grid' ? 'List view' : 'Grid view'}</button><button onClick={() => {
          setQuery('');
          setStatus('all');
          setTag('all');
          setFavorite(false);
        }}>Reset</button></div>
 {tab === 'books' && <div className="action-row"><button disabled={uploadBusy.current} onClick={fillMissingCovers}>Fill missing PDF covers</button><small>Missing PDF covers are filled automatically when you open your library. Existing covers and titles are kept.</small></div>}
 {tab === 'trash' && <p>Trashed books can be restored. Permanent deletion also removes their annotations and cannot be undone.</p>}
 {!!selected.length && tab === 'books' && <div className="notice"><span>{selected.length} books selected</span><button onClick={() => setConfirm({
          title: 'Share selected book details?',
          description: 'Only titles, authors and reading statuses will be accessible to anyone with the link for 7 days. PDFs and notes remain private.',
          action: async () => {
            const result = await createShare(selected, 7);
            setShare(`${location.origin}/share/${result.id}`);
          }
        })}>Create share link</button><button onClick={() => setSelected([])}>Clear selection</button></div>}
 {loading && !books.length ? <div role="status" className="skeleton-grid">{[1, 2, 3, 4].map(i => <div key={i} className="skeleton" />)}</div> : !filtered.length ? <section className="empty-state"><h2>{books.length ? 'No matching books' : 'A shelf of possibilities'}</h2><p>{books.length ? 'Try another search or reset your filters.' : 'Add PDF or EPUB files, or drop a collection here.'}</p><button className="primary" onClick={() => input.current.click()}>Choose books</button></section> : <div className={view === 'grid' ? 'shelf-grid' : 'shelf-list'}>{filtered.slice(0, limit).map(b => <article className="shelf-card" key={b.id}><button className="cover-button" onClick={() => tab === 'trash' ? setDetails(b) : nav(`/book/${b.id}`)} aria-label={`Open ${b.title}`}><Cover book={b} /></button><div className="shelf-info"><div className="title-line"><h3>{b.title}</h3>{tab !== 'trash' && <button aria-label={`${b.favorite ? 'Unfavorite' : 'Favorite'} ${b.title}`} onClick={() => run(() => updateBook(b.id, {
                favorite: !b.favorite
              }))}>{b.favorite ? '★' : '☆'}</button>}</div><p>{b.author || 'Author not set'}</p><div className="book-status"><span>{b.status}</span><span>{b.page_count ? `${b.current_page} / ${b.page_count}` : b.format?.toUpperCase()}</span></div><progress aria-label="Reading position" value={b.current_page || 0} max={b.page_count || 1} />{tab !== 'trash' && <label className="collection-field">Collections<input key={(b.state?.tags || []).join(',')} defaultValue={(b.state?.tags || []).join(', ')} placeholder="Fiction, Research…" onBlur={e => e.target.value !== (b.state?.tags || []).join(', ') && run(() => editTags(b, e.target.value))} /></label>}<div className="card-actions">{tab === 'trash' ? <><button onClick={() => run(() => restoreBook(b.id))}>Restore</button><button className="danger" onClick={() => setConfirm({
                  title: 'Delete permanently?',
                  description: `“${b.title}” and its notes will be permanently removed.`,
                  action: () => purgeBook(b.id)
                })}>Delete forever</button></> : <><button onClick={() => setDetails(b)}>Details & cover</button><button onClick={() => download(b).catch(e => setError(e.message))}>Offline</button><button aria-label={`Move ${b.title} to trash`} onClick={() => setConfirm({
                  title: 'Move book to trash?',
                  description: `You can restore “${b.title}” later.`,
                  action: () => deleteBook(b.id)
                })}>Trash</button><label className="share-check"><input type="checkbox" checked={selected.includes(b.id)} onChange={e => setSelected(e.target.checked ? [...selected, b.id] : selected.filter(x => x !== b.id))} /> Share</label></>}</div></div></article>)}</div>}{filtered.length > limit && <button className="load-more" onClick={() => setLimit(limit + 60)}>Show more books</button>}</>}
 {details && tab !== 'trash' && <BookDetails book={details} onClose={() => setDetails(null)} onSaved={refresh} />}{settings && <Settings onClose={() => setSettings(false)} />}{confirm && <Dialog title={confirm.title} onClose={() => setConfirm(null)}><p>{confirm.description}</p><div className="action-row"><button onClick={() => setConfirm(null)}>Cancel</button><button className="primary" onClick={() => {
          const action = confirm.action;
          setConfirm(null);
          run(action);
        }}>Confirm</button></div></Dialog>}{share && <Dialog title="Your share link" onClose={() => setShare('')}><p>Anyone with this link can see the selected book details until expiry. Revoke it in Preferences.</p><input readOnly value={share} onFocus={e => e.target.select()} /><button onClick={() => navigator.clipboard.writeText(share).then(() => setError('Share link copied.')).catch(() => setError('Select and copy the link manually.'))}>Copy link</button></Dialog>}</main>;
}
