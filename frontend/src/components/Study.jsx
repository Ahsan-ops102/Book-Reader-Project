import { useState } from 'react';
import { saveBookState } from '../api.js';
import Dialog from './Dialog.jsx';
export default function Study({
  books,
  onRefresh
}) {
  const [revealed, setRevealed] = useState(false),
    [error, setError] = useState(''),
    [editing, setEditing] = useState(null),
    [deleting, setDeleting] = useState(null),
    [busy, setBusy] = useState(false);
  const all = books.flatMap(b => (b.state?.flashcards || []).map(c => ({
    ...c,
    book: b
  })));
  const cards = all.filter(c => !c.due || c.due <= Date.now()).sort((a, b) => (a.due || 0) - (b.due || 0)),
    card = cards[0];
  async function updateCard(current, next) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const flashcards = current.book.state.flashcards.flatMap(c => c.id === current.id ? next ? [next] : [] : [c]);
      await saveBookState(current.book.id, {
        ...current.book.state,
        flashcards
      }, current.book.state_version || 0);
      setRevealed(false);
      setEditing(null);
      setDeleting(null);
      await onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function grade(good) {
    const interval = good ? Math.max(1, (card.interval || 0) * 2 || 1) : 0;
    const {
      book,
      ...value
    } = card;
    await updateCard(card, {
      ...value,
      interval,
      due: Date.now() + (good ? interval * 86400000 : 600000)
    });
  }
  return <section className="study"><div className="eyebrow">Spaced practice</div><h2>{cards.length ? `${cards.length} cards ready to review` : 'You’re caught up'}</h2><p>Save useful AI answers as flashcards while reading. Review them here when they are due.</p>{card && <article className="study-card"><small>{card.book.title}</small><h3>{card.front}</h3>{revealed ? <><p className="preserve-lines">{card.back}</p><div className="action-row"><button disabled={busy} onClick={() => grade(false)}>Review again</button><button disabled={busy} className="primary" onClick={() => grade(true)}>I remembered</button></div></> : <button className="primary" onClick={() => setRevealed(true)}>Reveal answer</button>}</article>}<details><summary>Manage saved cards ({all.length})</summary>{all.map(c => <div className="list-row" key={c.id}><span>{c.front.slice(0, 120)}<small> · {c.book.title}</small></span><button onClick={() => setEditing(c)}>Edit</button><button onClick={() => setDeleting(c)}>Delete</button></div>)}</details>{editing && <Dialog title="Edit flashcard" onClose={() => setEditing(null)}><label>Question<textarea value={editing.front} maxLength={6000} onChange={e => setEditing({
          ...editing,
          front: e.target.value
        })} /></label><label>Answer<textarea value={editing.back} maxLength={30000} onChange={e => setEditing({
          ...editing,
          back: e.target.value
        })} /></label><button disabled={busy} onClick={() => {
        const {
          book,
          ...next
        } = editing;
        updateCard(editing, next);
      }}>Save card</button></Dialog>}{deleting && <Dialog title="Delete flashcard?" onClose={() => setDeleting(null)}><p>This removes the saved card from your account.</p><button disabled={busy} className="danger" onClick={() => updateCard(deleting, null)}>Delete card</button></Dialog>}{error && <p role="alert" className="notice error">{error}</p>}</section>;
}
