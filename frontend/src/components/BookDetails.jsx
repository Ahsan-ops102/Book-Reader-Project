import { useState } from 'react';
import { updateBook, coverCandidates, setCoverReference, uploadCover, fetchBookBlob, generateCover } from '../api.js';
import Dialog from './Dialog.jsx';
import Cover from './Cover.jsx';
export default function BookDetails({
  book,
  onClose,
  onSaved
}) {
  const [form, setForm] = useState({
      title: book.title,
      author: book.author || '',
      isbn: book.isbn || '',
      publisher: book.publisher || '',
      language: book.language || '',
      status: book.status || 'unread'
    }),
    [candidates, setCandidates] = useState([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [page, setPage] = useState(1),
    [description, setDescription] = useState('');
  async function run(fn) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      await onSaved();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await updateBook(book.id, form);
    setMessage('Details saved.');
  }
  async function extract() {
    const tools = await import('../bookTools.js'),
      pdf = await tools.openPdf({
        data: new Uint8Array(await (await fetchBookBlob(book.id)).arrayBuffer())
      });
    try {
      if (page > pdf.numPages) throw new Error('Page is outside this PDF.');
      await uploadCover(book.id, new File([await tools.pageImage(pdf, page)], 'cover.png', {
        type: 'image/png'
      }), 'extracted');
      setMessage('Cover extracted from your PDF.');
    } finally {
      await pdf.destroy();
    }
  }
  return <Dialog title="Book details & cover" onClose={onClose}><div className="details-grid"><Cover book={book} /><div className="form-grid">{['title', 'author', 'isbn', 'publisher', 'language'].map(key => <label key={key}>{key === 'isbn' ? 'ISBN' : key[0].toUpperCase() + key.slice(1)}<input value={form[key]} maxLength={key === 'title' ? 300 : 200} onChange={e => setForm({
            ...form,
            [key]: e.target.value
          })} /></label>)}<label>Reading status<select value={form.status} onChange={e => setForm({
            ...form,
            status: e.target.value
          })}>{['unread', 'reading', 'finished', 'paused'].map(s => <option key={s}>{s}</option>)}</select></label></div></div><div className="action-row"><button className="primary" disabled={busy} onClick={() => run(save)}>Save details</button><label className="button">Upload cover<input type="file" hidden accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => e.target.files[0] && run(() => uploadCover(book.id, e.target.files[0]))} /></label></div>{book.format !== 'epub' && <div className="action-row"><label>PDF cover page<input type="number" min="1" max={book.page_count || 100000} value={page} onChange={e => setPage(Math.max(1, Number(e.target.value)))} /></label><button disabled={busy} onClick={() => run(extract)}>Use this page</button></div>}<hr /><p>Find an existing published cover. This sends the title, author, or ISBN to Open Library (and Google Books if configured). Check the edition before choosing.</p><button disabled={busy} onClick={() => run(async () => {
      await save();
      const matches = await coverCandidates(book.id);
      setCandidates(matches);
      setMessage(matches.length ? 'Choose the edition that matches your book.' : 'No matching covers found. Try an ISBN or use your PDF cover.');
    })}>Find published covers</button><div className="candidate-grid">{candidates.map(c => <button key={c.url} disabled={busy} onClick={() => run(async () => {
        await setCoverReference(book.id, c.url);
        setMessage('Published cover selected.');
      })}><img src={c.url} alt={c.title} referrerPolicy="no-referrer" /><strong>{c.title}</strong><small>{c.author} · {c.source}</small></button>)}</div><details><summary>Create original AI artwork</summary><p>Optional. This is a new design, not an authentic published cover. Your title and description are sent to Gemini and may incur provider charges.</p><label>Subject or visual direction<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} /></label><button disabled={busy} onClick={() => run(async () => {
        await save();
        const result = await generateCover(book.id, description),
          tools = await import('../bookTools.js'),
          blob = await tools.composeCover(result.image, form.title, form.author);
        await uploadCover(book.id, new File([blob], 'generated.png', {
          type: 'image/png'
        }), 'generated');
        setMessage('Original artwork saved and labeled AI-generated.');
      })}>Generate and save artwork</button></details>{(message || busy) && <p className="notice" role="status">{busy ? 'Working…' : message}</p>}</Dialog>;
}
