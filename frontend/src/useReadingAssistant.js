import { useEffect, useRef, useState } from 'react';
import { queryAI, summarizeBook } from './api.js';

export default function useReadingAssistant({ bookId, state, getSource, prepareSummary }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quick, setQuick] = useState(null);
  const running = useRef(false);
  const quickVersion = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function send(question, { mode = 'question', summary = false, range = {} } = {}) {
    if (running.current || !state.ready) return;
    running.current = true;
    setBusy(true);
    setError('');
    const version = ++quickVersion.current;
    if (mode === 'meaning') setQuick({ loading: true });
    const prompt = question || (mode === 'meaning' ? 'Give the quick meaning of this selection.' : 'Explain this selection clearly.');
    // Saved answers may exceed the request limit. Keep follow-ups within the API budget.
    const history = (state.data.chat || []).slice(-8).map(m => ({ role: m.role, text: String(m.text || '').slice(0, 6000) }));
    try {
      const source = await getSource();
      if (!alive.current) return;
      if (!summary && !source.text.trim()) throw new Error('This page has no selectable text. Select text on another page, or use OCR in Settings for a scanned page.');
      if (mode !== 'meaning') state.update('chat', prev => [...prev, { role: 'user', text: prompt }].slice(-100));
      if (summary) await prepareSummary(range);
      const result = summary ? await summarizeBook(bookId, range) : await queryAI(source.text, prompt, { bookId, page: source.page, history: mode === 'meaning' ? [] : history, mode });
      if (!alive.current) return;
      if (!result.answer?.trim()) throw new Error('No explanation was returned. Please try again.');
      if (mode === 'meaning') { if (quickVersion.current === version) setQuick({ text: result.answer }); }
      else state.update('chat', prev => [...prev, { role: 'ai', text: result.answer, sources: result.sources || [] }].slice(-100));
      return result;
    } catch (e) {
      if (alive.current) {
        setError(e.message);
        if (mode === 'meaning' && quickVersion.current === version) setQuick({ error: e.message });
      }
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return { busy, error, quick, send, clearQuick: () => { quickVersion.current++; setQuick(null); }, clearError: () => setError('') };
}
