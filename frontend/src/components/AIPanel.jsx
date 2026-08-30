import { useEffect, useRef, useState } from 'react';
export default function AIPanel({
  bookId,
  page,
  selectedText,
  state,
  onClose,
  onJump,
  assistant
}) {
  const [question, setQuestion] = useState(''),
    [fromPage, setFromPage] = useState(page),
    [toPage, setToPage] = useState(page);
  const end = useRef(null),
    messages = state.data.chat || [];
  useEffect(() => {
    end.current?.scrollIntoView({
      block: 'nearest'
    });
  }, [messages.length]);
  const { busy, error } = assistant;
  function send(prompt, summary = false, range = {}) {
    const value = prompt || question || 'Explain the current page simply.';
    setQuestion('');
    return assistant.send(value, { summary, range });
  }
  return <aside className="reader-panel ai-chat" aria-label="Reading assistant"><div className="panel-header"><h2>Reading assistant</h2><button onClick={onClose} aria-label="Close assistant">×</button></div><p className="privacy-hint">Your selection or current page and relevant indexed pages are sent to Gemini. Answers can be wrong; check the cited pages.</p>{selectedText && <blockquote className="selection-preview">{selectedText.slice(0, 1200)}</blockquote>}<div className="action-row"><button disabled={busy || !state.ready} onClick={() => send('Explain this passage simply.')}>Explain</button><button disabled={busy || !state.ready} onClick={() => send('Define the key terms in this passage.')}>Define</button><button disabled={busy || !state.ready} onClick={() => send('Write a concise question and answer for studying this passage.')}>Study question</button><button disabled={busy || !state.ready} onClick={() => send('Summarize this book.', true)}>Book summary</button></div><details><summary>Summarize a chapter or page range</summary><label>First page<input type="number" min="1" value={fromPage} onChange={e => setFromPage(Number(e.target.value))} /></label><label>Last page<input type="number" min={fromPage} value={toPage} onChange={e => setToPage(Number(e.target.value))} /></label><button disabled={busy || !state.ready} onClick={() => send(`Summarize pages ${fromPage}–${toPage}.`, true, {
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
            assistant.clearError();
          }}>Save flashcard</button></>}</article>)}{busy && <p role="status">Reading the supplied sources…</p>}<div ref={end} /></div>{error && <p role="status" className="notice">{error}</p>}<form className="chat-input" onSubmit={e => {
      e.preventDefault();
      send();
    }}><label className="sr-only" htmlFor="ai-question">Your question</label><textarea id="ai-question" value={question} maxLength={6000} onChange={e => setQuestion(e.target.value)} placeholder="Ask about your selection or current page…" /><button className="primary" disabled={busy || !state.ready}>Ask</button></form><button className="text-button" onClick={() => state.update('chat', [])}>Clear this conversation</button></aside>;
}
