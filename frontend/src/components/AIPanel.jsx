import { useEffect, useRef, useState } from 'react';
import { queryAI, summarizeBook } from '../api.js';
export default function AIPanel({
  bookId,
  page,
  selectedText,
  state,
  onClose,
  onJump,
  summaryRequested = false
}) {
  const [question, setQuestion] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [fromPage, setFromPage] = useState(page),
    [toPage, setToPage] = useState(page);
  const end = useRef(null),
    messages = state.data.chat || [];
  useEffect(() => {
    end.current?.scrollIntoView({
      block: 'nearest'
    });
  }, [messages.length]);
  async function send(prompt, summary = false, range = {}) {
    if (busy) return;
    setBusy(true);
    setError('');
    const q = prompt || question || 'Summarize this passage';
    const history = messages.slice(-8);
    state.update('chat', prev => [...prev, {
      role: 'user',
      text: q
    }].slice(-100));
    setQuestion('');
    try {
      const r = summary ? await summarizeBook(bookId, range) : await queryAI(selectedText, q, {
        bookId,
        page,
        history
      });
      state.update('chat', prev => [...prev, {
        role: 'ai',
        text: r.answer,
        sources: r.sources || []
      }].slice(-100));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <aside className="reader-panel ai-chat" aria-label="Reading assistant"><div className="panel-header"><h2>Reading assistant</h2><button onClick={onClose} aria-label="Close assistant">×</button></div><p className="privacy-hint">Requested passages and relevant indexed pages are sent to Gemini. Answers can be wrong; check the cited pages.</p>{selectedText && <blockquote className="selection-preview">{selectedText.slice(0, 1200)}</blockquote>}<div className="action-row"><button disabled={busy} onClick={() => send('Explain this passage simply.')}>Explain</button><button disabled={busy} onClick={() => send('Define the key terms in this passage.')}>Define</button><button disabled={busy} onClick={() => send('Write a concise question and answer for studying this passage.')}>Study question</button><button disabled={busy} onClick={() => send('Summarize the indexed book.', true)}>Book summary</button></div><details><summary>Summarize a chapter or page range</summary><label>First page<input type="number" min="1" value={fromPage} onChange={e => setFromPage(Number(e.target.value))} /></label><label>Last page<input type="number" min={fromPage} value={toPage} onChange={e => setToPage(Number(e.target.value))} /></label><button disabled={busy} onClick={() => send(`Summarize indexed pages ${fromPage}–${toPage}.`, true, {
        fromPage,
        toPage
      })}>Summarize these pages</button></details><div className="chat-messages">{messages.map((m, i) => <article key={i} className={`chat-message ${m.role}`}><small>{m.role === 'ai' ? 'Assistant' : 'You'}</small><p className="preserve-lines">{m.text}</p>{m.role === 'ai' && <><div className="action-row">{[...new Set([...m.text.matchAll(/\[p\.\s*(\d+)\]/g)].map(v => Number(v[1])))].map(p => <button key={p} onClick={() => onJump(p)}>Page {p}</button>)}</div><button onClick={() => {
            state.update('flashcards', prev => [...prev, {
              id: crypto.randomUUID(),
              front: messages[i - 1]?.text || 'Reading note',
              back: m.text,
              page,
              due: Date.now(),
              interval: 0
            }]);
            setError('Flashcard saved to your study queue.');
          }}>Save flashcard</button></>}</article>)}{busy && <p role="status">Reading the supplied sources…</p>}<div ref={end} /></div>{error && <p role="status" className="notice">{error}</p>}<form className="chat-input" onSubmit={e => {
      e.preventDefault();
      send();
    }}><label className="sr-only" htmlFor="ai-question">Your question</label><textarea id="ai-question" value={question} maxLength={6000} onChange={e => setQuestion(e.target.value)} placeholder="Ask about a selection or indexed pages…" /><button className="primary" disabled={busy}>Ask</button></form><button className="text-button" onClick={() => state.update('chat', [])}>Clear this conversation</button></aside>;
}
