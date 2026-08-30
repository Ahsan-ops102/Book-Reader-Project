import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { getBook, bookFileSource, updateProgress, updatePageCount, accountKey, saveBookText, getBookText, ocrPage, fetchBookBlob, createDocument } from '../api.js';
import { cacheGet, cacheSet, enqueueSession } from '../offline.js';
import { escapeHtml } from '../sanitize.js';
import useBookState from '../useBookState.js';
import AIPanel from './AIPanel.jsx';
import useReadingAssistant from '../useReadingAssistant.js';
import { selectionPopoverStyle, selectWordAtPoint } from '../selection.js';
import EpubView from './EpubView.jsx';
import Dialog from './Dialog.jsx';
import {prepareOfflineShell} from '../offlineShell.js';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ReaderScreen({
  id
}) {
  const nav = useNavigate(),
    [params] = useSearchParams(),
    state = useBookState(id),
    scroll = useRef(null),
    selectingPointer = useRef(false),
    root = useRef(null),
    textCache = useRef(new Map()),
    saving = useRef(false),
    pending = useRef(null),
    restore = useRef(false),
    activeAt = useRef(Date.now()),
    session = useRef({
      seconds: 0,
      pages: new Set()
    }),
    indexAbort = useRef(null);
  const [book, setBook] = useState(null),
    [source, setSource] = useState(null),
    [pdf, setPdf] = useState(null),
    [pages, setPages] = useState(0),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1),
    [fit, setFit] = useState(true),
    [width, setWidth] = useState(760),
    [ratios, setRatios] = useState({}),
    [mode, setMode] = useState('scroll'),
    [panel, setPanel] = useState(params.has('action') ? 'ai' : null),
    [outline, setOutline] = useState([]),
    [selection, setSelection] = useState(null),
    [selecting, setSelecting] = useState(false),
    [search, setSearch] = useState(''),
    [matches, setMatches] = useState([]),
    [matchIndex, setMatchIndex] = useState(0),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [options, setOptions] = useState(false),
    [speaking, setSpeaking] = useState(false),
    [paused, setPaused] = useState(false),
    [rate, setRate] = useState(1),
    [voice, setVoice] = useState(''),
    [voices, setVoices] = useState([]),
    [continuous, setContinuous] = useState(false),
    [fontSize, setFontSize] = useState(20),
    [epubText, setEpubText] = useState(''),
    [pomo, setPomo] = useState(1500),
    [pomoOn, setPomoOn] = useState(false),
    [confirm, setConfirm] = useState(null),
    [ambient, setAmbient] = useState('');
  const isEpub = book?.format === 'epub',
    pageWidth = Math.max(180, (fit ? width : 760) * zoom),
    offsets = useMemo(() => {
      const values = [0];
      for (let n = 1; n <= pages; n++) values.push(values[n - 1] + pageWidth * (ratios[n] || 1.414) + 24);
      return values;
    }, [pages, pageWidth, ratios]);
  const assistant = useReadingAssistant({
    bookId: id, state,
    getSource: async () => ({ text: selection?.text || (await pageText(page)).slice(0, 30000), page: selection?.page || page }),
    prepareSummary: async (range) => {
      if (isEpub) {
        await saveBookText(id, [{ page, text: epubText.slice(0, 60000) }]);
        return;
      }
      if (!pdf) throw new Error('The book is still loading. Try again in a moment.');
      const first = range.fromPage || 1, last = range.toPage || pages;
      if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last > pages || first > last) throw new Error('Choose a page range within this book.');
      let batch = [];
      for (let n = first; n <= last; n++) {
        batch.push({ page: n, text: (await pageText(n)).slice(0, 60000) });
        if (batch.length === 20 || n === last) { await saveBookText(id, batch); batch = []; }
      }
    }
  });
  function selectionAI(mode) {
    if (assistant.busy) return;
    assistant.clearQuick();
    setPanel(mode === 'meaning' ? null : 'ai');
    assistant.send(mode === 'meaning' ? 'Give the meaning of this word or passage in one or two short sentences.' : 'Explain the entire selected word or passage in clear, simple language, with a helpful example when appropriate.', { mode, source: selection ? {text:selection.text,page:selection.page} : undefined });
  }
  useEffect(() => {
    function outside(event) {
      if (event.target.closest?.('.ai-chat,.selection-popover,[data-ai-trigger]')) return;
      if (event.target.closest?.('.reading-canvas')) { selectingPointer.current = true; setSelecting(true); }
      setSelection(null);
      setPanel(current => current === 'ai' ? null : current);
      assistant.clearQuick();
    }
    const finish = () => { selectingPointer.current = false; setSelecting(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish); };
  }, []);
  useEffect(() => {
    let active = true;
    setError('');
    (async () => {
      let b;
      try {
        b = await getBook(id);
        await cacheSet(`book:${id}`, b).catch(() => {});
      } catch (e) {
        b = await cacheGet(`book:${id}`).catch(() => null);
        if (!b) throw e;
        setMessage('Offline · using downloaded content');
      }
      if (!active) return;
      setBook(b);
      let local;
      try {
        local = JSON.parse(localStorage.getItem(accountKey(`progress:${id}`)) || 'null');
      } catch {
        local = null;
      }
      setPage(local?.pending ? local.page : b.current_page || 1);
      setZoom(local?.zoom || b.zoom || 1);
      if (local?.pending) pending.current = local;
      const cached = await cacheGet(`file:${id}`).catch(() => null);
      if (active) setSource(cached ? {
        data: new Uint8Array(await cached.arrayBuffer())
      } : bookFileSource(id));
    })().catch(e => active && setError(e.message));
    return () => {
      active = false;
      window.speechSynthesis?.cancel();
      indexAbort.current?.abort();
    };
  }, [id]);
  useEffect(() => {
    if (!scroll.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(180, entries[0].contentRect.width - 32)));
    observer.observe(scroll.current);
    return () => observer.disconnect();
  }, [book]);
  const persistProgress = useCallback((p, z) => {
    const value = {
      page: p,
      zoom: z,
      pending: true
    };
    pending.current = value;
    try {
      localStorage.setItem(accountKey(`progress:${id}`), JSON.stringify(value));
    } catch {
      setMessage('Device storage is full. Reading position will sync online.');
    }
  }, [id]);
  useEffect(() => {
    async function flush() {
      if (!pending.current || saving.current || !book) return;
      saving.current = true;
      const snapshot = pending.current;
      try {
        await updateProgress(id, snapshot.page, snapshot.zoom);
        if (pending.current === snapshot) {
          pending.current = null;
          localStorage.setItem(accountKey(`progress:${id}`), JSON.stringify({
            ...snapshot,
            pending: false
          }));
        }
      } catch {
        setMessage('Reading position saved on this device · waiting to sync');
      } finally {
        saving.current = false;
      }
    }
    const timer = setInterval(flush, 1500);
    window.addEventListener('online', flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', flush);
      flush();
    };
  }, [book, id]);
  useEffect(() => {
    if (book) {
      persistProgress(page, zoom);
      session.current.pages.add(page);
    }
  }, [page, zoom, book?.id]);
  useEffect(() => {
    if (restore.current || !pdf || !pages || !scroll.current) return;
    scroll.current.scrollTop = offsets[Math.max(0, page - 1)] || 0;
    restore.current = true;
  }, [pdf, pages, offsets]);
  useEffect(() => {
    const touch = () => activeAt.current = Date.now();
    for (const event of ['pointerdown', 'keydown', 'scroll', 'touchstart']) window.addEventListener(event, touch, true);
    let ticks = 0;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - activeAt.current < 120000 && book) {
        session.current.seconds++;
        ticks++;
      }
      if (ticks >= 60) {
        flushSession();
        ticks = 0;
      }
    }, 1000);
    function flushSession() {
      const s = session.current;
      if (!s.seconds) return;
      session.current = {
        seconds: 0,
        pages: new Set()
      };
      enqueueSession({
        id: crypto.randomUUID(),
        bookId: id,
        day: localDay(),
        seconds: Math.min(300, s.seconds),
        pages: s.pages.size
      }).catch(() => {});
    }
    const hidden = () => {
      if (document.visibilityState === 'hidden') flushSession();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearInterval(timer);
      flushSession();
      document.removeEventListener('visibilitychange', hidden);
      for (const event of ['pointerdown', 'keydown', 'scroll', 'touchstart']) window.removeEventListener(event, touch, true);
    };
  }, [book?.id, id]);
  useEffect(() => {
    if (!pomoOn) return;
    const until = Date.now() + pomo * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.round((until - Date.now()) / 1000));
      setPomo(left);
      if (!left) {
        setPomoOn(false);
        setPomo(300);
        setMessage('Focus session complete. Take a five-minute break.');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [pomoOn]);
  useEffect(() => {
    const speech = window.speechSynthesis;
    if (!speech) return;
    const load = () => setVoices(speech.getVoices());
    load();
    speech.addEventListener('voiceschanged', load);
    return () => speech.removeEventListener('voiceschanged', load);
  }, []);
  function jump(p) {
    const next = Math.max(1, Math.min(pages || 1, Number(p) || 1));
    setPage(next);
    if (mode === 'scroll' && scroll.current && !isEpub) scroll.current.scrollTop = offsets[next - 1] || 0;
  }
  function handleScroll() {
    setSelection(null); assistant.clearQuick();
    if (mode !== 'scroll' || !pages || isEpub) return;
    const top = scroll.current.scrollTop + 30;
    let lo = 0,
      hi = pages;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (offsets[mid] <= top) lo = mid;else hi = mid - 1;
    }
    setPage(Math.min(pages, lo + 1));
  }
  async function loaded(doc) {
    setPdf(doc);
    setPages(doc.numPages);
    updatePageCount(id, doc.numPages).catch(() => {});
    const all = await doc.getOutline().catch(() => []);
    async function walk(items, depth = 0) {
      const rows = [];
      for (const item of items || []) {
        let destination = item.dest;
        if (typeof destination === 'string') destination = await doc.getDestination(destination);
        let target = 1;
        try {
          target = typeof destination?.[0] === 'number' ? destination[0] + 1 : (await doc.getPageIndex(destination[0])) + 1;
        } catch {}
        rows.push({
          title: item.title,
          page: target,
          depth
        });
        rows.push(...(await walk(item.items, depth + 1)));
      }
      return rows;
    }
    setOutline(await walk(all));
    getBookText(id).then(rows => rows.forEach(r => textCache.current.set(r.page, r.text))).catch(() => {});
  }
  async function pageText(n) {
    if (isEpub) return epubText;
    if (!pdf) throw new Error('The book is still loading. Try again in a moment.');
    if (textCache.current.has(n)) return textCache.current.get(n);
    const p = await pdf.getPage(n),
      content = await p.getTextContent(),
      value = content.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('');
    textCache.current.set(n, value);
    return value;
  }
  useEffect(() => {
    let cancelled = false;
    if (!search.trim()) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = [];
        const needle = search.toLowerCase();
        for (let n = 1; n <= (isEpub ? 1 : pages); n++) {
          if (cancelled) return;
          const value = isEpub ? epubText : await pageText(n);
          let offset = value.toLowerCase().indexOf(needle);
          while (offset >= 0) {
            result.push({
              page: isEpub ? page : n,
              snippet: value.slice(Math.max(0, offset - 45), offset + needle.length + 90)
            });
            offset = value.toLowerCase().indexOf(needle, offset + needle.length);
            if (result.length >= 1000) break;
          }
          if (result.length >= 1000) break;
        }
        if (!cancelled) {
          setMatches(result);
          setMatchIndex(0);
        }
      } catch (e) {
        setError(e.message);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, pdf, pages, epubText]);
  const renderText = useCallback(({
    str
  }) => {
    if (!search.trim()) return escapeHtml(str);
    const needle = search.trim().toLowerCase(),
      lower = str.toLowerCase();
    let html = '',
      from = 0,
      index = lower.indexOf(needle);
    while (index >= 0) {
      html += escapeHtml(str.slice(from, index)) + '<mark>' + escapeHtml(str.slice(index, index + needle.length)) + '</mark>';
      from = index + needle.length;
      index = lower.indexOf(needle, from);
    }
    return html + escapeHtml(str.slice(from));
  }, [search]);
  function capture() {
    if (selectingPointer.current) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount || !sel.toString().trim()) {
      // Touch browsers may collapse the native range when a bubble is pressed.
      if (!assistant.quick) setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!scroll.current?.contains(range.commonAncestorContainer)) return;
    const rects = [];
    for (const area of scroll.current.querySelectorAll('[data-page]')) {
      const box = area.getBoundingClientRect();
      for (const r of range.getClientRects()) {
        const left = Math.max(box.left, r.left),
          right = Math.min(box.right, r.right),
          top = Math.max(box.top, r.top),
          bottom = Math.min(box.bottom, r.bottom);
        if (right > left && bottom > top) rects.push({
          page: Number(area.dataset.page),
          left: (left - box.left) / box.width * 100,
          top: (top - box.top) / box.height * 100,
          width: (right - left) / box.width * 100,
          height: (bottom - top) / box.height * 100
        });
      }
    }
    const box = range.getBoundingClientRect();
    const selectedText = sel.toString().trim().slice(0, 30000), selectedPage = rects[0]?.page || page;
    // selectionchange also fires after mouseup and when the text layer settles.
    // Re-capturing the same selection must not discard an in-flight answer.
    if (selectedText !== selection?.text || selectedPage !== selection?.page) assistant.clearQuick();
    setSelection({
      viewport: {left:box.left,top:box.top,width:box.width,bottom:box.bottom},
      text: selectedText,
      page: selectedPage,
      rects
    });
  }
  useEffect(() => {
    const captureSettled = () => {
      if (!document.activeElement?.closest?.('.ai-chat,.selection-toolbar,.quick-meaning')) capture();
    };
    const timer = { current: null };
    const changed = () => { clearTimeout(timer.current); timer.current = setTimeout(captureSettled, 180); };
    document.addEventListener('selectionchange', changed);
    return () => { clearTimeout(timer.current); document.removeEventListener('selectionchange', changed); };
  });
  function selectWord(event) {
    if (selectWordAtPoint(document, event.clientX, event.clientY, scroll.current)) { event.preventDefault(); capture(); }
  }
  function highlight(color) {
    if (!selection) return;
    state.update('highlights', prev => [...prev, {
      ...selection,
      color,
      id: crypto.randomUUID()
    }]);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }
  function bookmark() {
    state.update('bookmarks', prev => prev.some(b => b.page === page) ? prev.filter(b => b.page !== page) : [...prev, {
      page,
      title: `${isEpub ? 'Section' : 'Page'} ${page}`,
      createdAt: new Date().toISOString()
    }]);
  }
  async function speak(n = page) {
    try {
      const speech = window.speechSynthesis;
      if (!speech) throw new Error('Speech is unavailable in this browser.');
      speech.cancel();
      const value = selection?.text || (await pageText(n));
      if (!value.trim()) throw new Error('This page has no selectable text. Run OCR first.');
      const chunks = value.match(/[\s\S]{1,700}(?:\s|$)/g) || [value];
      let index = 0;
      setSpeaking(true);
      setPaused(false);
      const next = () => {
        if (index >= chunks.length) {
          setSpeaking(false);
          if (continuous && !selection && n < pages && !isEpub) {
            jump(n + 1);
            speak(n + 1);
          }
          return;
        }
        const utterance = new SpeechSynthesisUtterance(chunks[index++]);
        utterance.rate = rate;
        utterance.voice = voices.find(v => v.voiceURI === voice) || null;
        utterance.onend = next;
        utterance.onerror = () => setSpeaking(false);
        speech.speak(utterance);
      };
      next();
    } catch (e) {
      setError(e.message);
    }
  }
  function exportNotes() {
    const lines = [`# ${book.title}`, ''];
    for (const b of state.data.bookmarks) lines.push(`- Bookmark: page ${b.page}`);
    for (const h of state.data.highlights) lines.push(`\n> ${h.text}\n\nPage ${h.page} · ${location.origin}/book/${id}#page=${h.page}`);
    lines.push('\n## Notes\n', state.data.notes || '');
    for (const c of state.data.flashcards) lines.push(`\nQ: ${c.front}\n\nA: ${c.back}`);
    const url = URL.createObjectURL(new Blob([lines.join('\n')], {
        type: 'text/markdown'
      })),
      a = document.createElement('a');
    a.href = url;
    a.download = book.title.replace(/[^\p{L}\p{N} -]/gu, '') + '-notes.md';
    a.click();
    URL.revokeObjectURL(url);
  }
  async function action(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') { setPanel(null); setSelection(null); assistant.clearQuick(); return; }
      if (e.target.closest('input,textarea,select,[contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        jump(page + 1);
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        jump(page - 1);
      }
      if (e.key === 'b') bookmark();
      if (e.key === 'Escape') {
        setPanel(null);
        setSelection(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  if (!book) return <main className="page"><button onClick={() => nav('/')}>← Library</button><p role="status">{error || 'Opening your book…'}</p></main>;
  const shown = mode === 'single' ? [page] : Array.from({
    length: pages
  }, (_, i) => i + 1);
  const bookmarks = state.data.bookmarks || [];
  return <div className="reader-shell" ref={root}><header className="reader-top"><button onClick={() => nav('/')}>← Library</button><div className="reader-name"><strong>{book.title}</strong><small>{state.status}</small></div><button onClick={() => setPanel(panel === 'contents' ? null : 'contents')}>Contents</button><button onClick={() => setPanel(panel === 'search' ? null : 'search')}>Search</button><button onClick={bookmark} aria-pressed={bookmarks.some(b => b.page === page)}>☆ Bookmark</button><button onClick={() => setPanel(panel === 'notes' ? null : 'notes')}>Notes</button><button className="primary" data-ai-trigger onClick={() => setPanel(panel === 'ai' ? null : 'ai')}>Ask AI</button><button onClick={() => setOptions(true)}>Settings</button></header><div className="reader-workspace">{panel === 'ai' ? <AIPanel bookId={id} page={selection?.page || page} selectedText={selection?.text || ''} state={state} assistant={assistant} onClose={() => setPanel(null)} onJump={jump} /> : panel && <aside className="reader-panel"><div className="panel-header"><h2>{panel === 'contents' ? 'Contents & bookmarks' : panel === 'search' ? 'Search this book' : 'Reading notes'}</h2><button onClick={() => setPanel(null)} aria-label="Close panel">×</button></div>{panel === 'contents' ? <><h3>Chapters</h3>{outline.length ? outline.map((o, i) => <button className="outline-link" style={{
            paddingLeft: 12 + (o.depth || 0) * 12
          }} key={i} onClick={() => jump(o.page)}>{o.title}<small>{o.page}</small></button>) : <p>No embedded table of contents.</p>}<h3>Bookmarks</h3>{bookmarks.map(b => <div className="list-row" key={b.page}><button onClick={() => jump(b.page)}>{b.title || `Page ${b.page}`}</button><button aria-label="Remove bookmark" onClick={() => state.update('bookmarks', prev => prev.filter(x => x.page !== b.page))}>×</button></div>)}{!isEpub && pdf && <details><summary>Page thumbnails</summary><div className="thumbnail-grid"><Document file={source}>{Array.from({
                  length: Math.min(pages, 100)
                }, (_, i) => <button key={i} onClick={() => jump(i + 1)}><Page pageNumber={i + 1} width={95} renderTextLayer={false} renderAnnotationLayer={false} /><small>{i + 1}</small></button>)}</Document></div><small>First 100 pages. Use the page navigator for the full book.</small></details>}</> : panel === 'search' ? <><input aria-label="Search text" value={search} onChange={e => setSearch(e.target.value)} placeholder={isEpub ? 'Search current section…' : 'Find in this PDF…'} /><p>{matches.length} {matches.length === 1 ? 'occurrence' : 'occurrences'}{matches.length === 1000 ? ' (first 1,000 shown)' : ''}</p>{matches.map((m, i) => <button className="search-result" key={i} onClick={() => {
            setMatchIndex(i);
            jump(m.page);
          }}><strong>Page {m.page}</strong><span>{m.snippet}</span></button>)}</> : <><label>Your notes<textarea className="notes-editor" value={state.data.notes || ''} maxLength={200000} onChange={e => state.update('notes', e.target.value)} placeholder="Write thoughts, questions, and connections…" /></label><button onClick={exportNotes}>Export Markdown</button>{state.status.includes('conflict') && <button onClick={() => setConfirm('notes-conflict')}>Resolve sync conflict</button>}<button onClick={() => action(async () => {
            const doc = await createDocument(`${book.title} — Notes`, `<h1>${escapeHtml(book.title)}</h1><p>${escapeHtml(state.data.notes || '').replace(/\n/g, '<br>')}</p>`);
            nav(`/writer?doc=${doc.id}`);
          })}>Open notes in Writer</button><h3>Highlights</h3>{state.data.highlights.map(h => <article className="highlight-note" key={h.id}><button onClick={() => jump(h.page)}>Page {h.page}</button><p>{h.text}</p><button onClick={() => state.update('highlights', prev => prev.filter(x => x.id !== h.id))}>Remove</button></article>)}</>}</aside>}
 <main className="reading-canvas" ref={scroll} onScroll={handleScroll} onMouseUp={capture} onDoubleClick={selectWord} onKeyUp={capture}>{isEpub ? <EpubView book={book} page={page} onPages={setPages} onOutline={setOutline} fontSize={fontSize} onText={setEpubText} /> : source && <Document file={source} onLoadSuccess={loaded} onLoadError={e => setError(`Could not open the PDF: ${e.message}`)} onItemClick={({
          pageNumber
        }) => pageNumber && jump(pageNumber)} loading={<p role="status">Loading PDF pages…</p>}>{shown.map(n => <div className="pdf-page-wrap" data-page={n} key={n} style={{
            width: pageWidth,
            height: pageWidth * (ratios[n] || 1.414),
            marginBottom: 24
          }}>{mode === 'single' || Math.abs(n - page) <= 2 ? <><Page pageNumber={n} width={pageWidth} customTextRenderer={search.trim() ? renderText : undefined} renderTextLayer renderAnnotationLayer onLoadSuccess={p => {
                const v = p.getViewport({
                    scale: 1
                  }),
                  ratio = v.height / v.width;
                setRatios(prev => prev[n] === ratio ? prev : {
                  ...prev,
                  [n]: ratio
                });
              }} />{state.data.highlights.flatMap(h => (h.rects || []).filter(r => r.page === n).map((r, i) => <span className={`highlight-overlay ${h.color}`} key={`${h.id}-${i}`} style={{
                left: r.left + '%',
                top: r.top + '%',
                width: r.width + '%',
                height: r.height + '%'
              }} />))}</> : <span className="page-placeholder">Page {n}</span>}</div>)}</Document>}</main></div>
 <footer className="reader-bottom"><button disabled={page <= 1} onClick={() => jump(page - 1)}>← Previous</button><label>{isEpub ? 'Section' : 'Page'} <input type="number" min="1" max={pages || 1} value={page} onChange={e => jump(e.target.value)} /> / {pages || '…'}</label><button disabled={page >= pages} onClick={() => jump(page + 1)}>Next →</button>{!isEpub && <><button onClick={() => setZoom(z => Math.max(.25, +(z - .1).toFixed(2)))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(z => Math.min(4, +(z + .1).toFixed(2)))} aria-label="Zoom in">+</button><button onClick={() => {
          setFit(true);
          setZoom(1);
        }}>Fit width</button></>}<span className="sync-label">{message}</span></footer>{error && <div className="reader-notice notice error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
 {selection && !selecting && <div className="selection-popover" style={selectionPopoverStyle(selection.viewport, window.innerWidth)} onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.preventDefault()}>
 {assistant.quick && <section className="quick-meaning" role="dialog" aria-label="Quick meaning"><div className="panel-header"><strong>Quick meaning</strong><small>{assistant.model}</small><button aria-label="Close quick meaning" onClick={assistant.clearQuick}>×</button></div><p role="status" className="preserve-lines">{assistant.quick.loading ? `Finding the meaning… ${assistant.elapsed}s` : assistant.quick.error || assistant.quick.text}</p>{assistant.quick.loading && <button onClick={assistant.cancel}>Cancel request</button>}{assistant.quick.error && <button disabled={assistant.busy} onClick={() => selectionAI('meaning')}>Try again</button>}</section>}
 <div className="selection-toolbar" role="toolbar" aria-label="Selected text actions"><div className="selection-primary"><button className="selection-bubble" disabled={assistant.busy} onClick={() => selectionAI('explain')}>Explain</button><button className="selection-bubble" disabled={assistant.busy} onClick={() => selectionAI('meaning')}>Quick meaning</button><button onClick={() => {setSelection(null);assistant.clearQuick();}} aria-label="Dismiss selection">×</button></div><div className="selection-secondary">{['yellow', 'green', 'pink', 'blue'].map(c => <button key={c} className={`color-dot ${c}`} aria-label={`Highlight ${c}`} onClick={() => highlight(c)} />)}<button onClick={() => speak()}>Read aloud</button></div></div></div>}
 {options && <Dialog title="Reading tools" onClose={() => setOptions(false)}><div className="form-grid">{!isEpub ? <label>Page layout<select value={mode} onChange={e => setMode(e.target.value)}><option value="scroll">Continuous scroll</option><option value="single">Single page</option></select></label> : <label>Text size<input type="range" min="14" max="36" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} /></label>}<label>Speech voice<select value={voice} onChange={e => setVoice(e.target.value)}><option value="">System default</option>{voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}</select></label><label>Speech speed<select value={rate} onChange={e => setRate(Number(e.target.value))}>{[.75, 1, 1.25, 1.5, 2].map(r => <option key={r}>{r}</option>)}</select></label><label><input type="checkbox" checked={continuous} onChange={e => setContinuous(e.target.checked)} /> Continue to next PDF page</label></div><div className="action-row"><button onClick={() => speak()}>Read page aloud</button><button disabled={!speaking} onClick={() => {
          paused ? window.speechSynthesis.resume() : window.speechSynthesis.pause();
          setPaused(!paused);
        }}>{paused ? 'Resume' : 'Pause'}</button><button onClick={() => {
          window.speechSynthesis?.cancel();
          setSpeaking(false);
        }}>Stop</button><button onClick={() => root.current?.requestFullscreen?.().catch(() => setError('Fullscreen is unavailable.'))}>Fullscreen</button></div><hr /><h3>Focus</h3><button onClick={() => setPomoOn(!pomoOn)}>{pomoOn ? 'Pause' : 'Start'} timer · {Math.floor(pomo / 60)}:{String(pomo % 60).padStart(2, '0')}</button><button onClick={() => {
        setPomoOn(false);
        setPomo(1500);
      }}>Reset 25 minutes</button><label>Ambient audio<select value={ambient} onChange={e => setAmbient(e.target.value)}><option value="">Off</option><option value="https://actions.google.com/sounds/v1/weather/rain_heavy_loud.ogg">Rain</option><option value="https://actions.google.com/sounds/v1/ambiences/coffee_shop.ogg">Cafe</option></select></label><hr /><h3>Text & AI preparation</h3><p>Indexing saves extracted text to your account’s cloud library. OCR sends a page image to Gemini. Provider charges may apply.</p><div className="action-row"><button disabled={busy || !pdf} onClick={() => action(async () => {
          indexAbort.current = new AbortController();
          await (await import('../bookTools.js')).indexPdf(pdf, id, setMessage, indexAbort.current.signal);
          setMessage('Book indexed. Page-cited questions and summaries are ready.');
        })}>Index PDF text</button>{busy && <button onClick={() => indexAbort.current?.abort()}>Cancel indexing</button>}<button disabled={busy || !pdf} onClick={() => setConfirm('ocr')}>OCR current page</button><button disabled={busy} onClick={() => action(async () => {
          await cacheSet(`file:${id}`, await fetchBookBlob(id));
          await cacheSet(`book:${id}`, book);
          setMessage('Book downloaded. ' + await prepareOfflineShell());
        })}>Download for offline reading</button></div>{isEpub && <button onClick={() => action(async () => {
        await saveBookText(id, [{
          page,
          text: epubText.slice(0, 60000)
        }]);
        setMessage('This EPUB section is indexed for AI.');
      })}>Index this EPUB section</button>}{(message || busy) && <p role="status" className="notice">{busy ? 'Working…' : message}</p>}</Dialog>}
 {confirm === 'notes-conflict' && <Dialog title="Choose which notes to keep" onClose={() => setConfirm(null)}><p>Another device saved a different version. Export your notes first if you want to compare them. A recovery copy of both versions will also stay on this device.</p><div className="action-row"><button onClick={exportNotes}>Export my draft</button><button onClick={() => action(async () => {
          await state.resolveConflict('cloud');
          setConfirm(null);
        })}>Use cloud version</button><button onClick={() => action(async () => {
          await state.resolveConflict('local');
          setConfirm(null);
        })}>Replace cloud with my draft</button></div></Dialog>}
 {confirm === 'ocr' && <Dialog title="Send this page for OCR?" onClose={() => setConfirm(null)}><p>An image of page {page} will be sent to Gemini for transcription, then saved to your book’s text index. Review the extracted text for errors.</p><button className="primary" onClick={() => {
        setConfirm(null);
        action(async () => {
          const blob = await (await import('../bookTools.js')).pageImage(pdf, page, 1400);
          const image = await new Promise(resolve => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.readAsDataURL(blob);
          });
          const result = await ocrPage(id, image);
          textCache.current.set(page, result.text);
          await saveBookText(id, [{
            page,
            text: result.text
          }]);
          setMessage('OCR text saved. Search, speech, and AI can now use this page.');
        });
      }}>Transcribe page</button></Dialog>}{ambient && <audio src={ambient} autoPlay loop onError={() => setError('Ambient audio could not be loaded.')} style={{
      display: 'none'
    }} />}</div>;
}
export default function Reader() {
  const {
    id
  } = useParams();
  return <ReaderScreen key={id} id={id} />;
}
