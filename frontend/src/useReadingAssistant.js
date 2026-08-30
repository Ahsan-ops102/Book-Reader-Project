import { useEffect, useRef, useState } from 'react';
import { getConfig, queryAI, summarizeBook } from './api.js';

export default function useReadingAssistant({ bookId, state, getSource, prepareSummary }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [quick, setQuick] = useState(null);
  const [elapsed, setElapsed] = useState(0), [model, setModel] = useState('gemini-3.5-flash-lite');
  const [pendingMessages, setPendingMessages] = useState([]);
  const running = useRef(null), quickVersion = useRef(0), alive = useRef(true), latest = useRef(state), pending = useRef([]), lastRequest = useRef(null);
  latest.current = state;
  const saved = Array.isArray(state.data.chat) ? state.data.chat.filter(m => m && typeof m.text === 'string') : [];
  const messages = [...saved, ...pendingMessages];
  useEffect(() => {
    alive.current = true;
    getConfig().then(config => { if (alive.current && config.aiModel) setModel(config.aiModel); }).catch(() => {});
    return () => { alive.current = false; running.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!state.ready || !pending.current.length) return;
    const queued = pending.current.splice(0);
    state.update('chat', prev => [...(Array.isArray(prev) ? prev : []), ...queued].slice(-100));
    setPendingMessages([]);
  }, [state.ready]);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  function append(message) {
    if (latest.current.ready) latest.current.update('chat', prev => [...(Array.isArray(prev) ? prev : []), message].slice(-100));
    else { pending.current.push(message); setPendingMessages([...pending.current]); }
  }
  async function send(question, { mode = 'question', summary = false, range = {}, source: suppliedSource } = {}) {
    if (running.current) return;
    const controller = new AbortController(); running.current = controller;
    setBusy(true); setError('');
    const version = ++quickVersion.current;
    if (mode === 'meaning') setQuick({ loading: true });
    const prompt = question || (mode === 'meaning' ? 'Give the quick meaning of this selection.' : 'Explain this selection clearly.');
    try {
      const source = suppliedSource || await getSource();
      controller.signal.throwIfAborted();
      if (!alive.current) return;
      if (!summary && !source.text.trim()) throw new Error('This page has no selectable text. Select text on another page, or use OCR in Settings for a scanned page.');
      lastRequest.current = { question: prompt, options: {mode, summary, range, source} };
      const history = mode === 'question' ? messages.filter(m => m.text.trim()).slice(-4).map(m => ({role:m.role,text:m.text.trim().slice(0,2000)})) : [];
      if (mode !== 'meaning') append({role:'user',text:prompt});
      if (summary) await prepareSummary(range);
      controller.signal.throwIfAborted();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(summary ? 600000 : 45000)]);
      const result = summary ? await summarizeBook(bookId, range, {signal}) : await queryAI(source.text, prompt, {bookId,page:source.page,history,mode}, {signal});
      controller.signal.throwIfAborted();
      if (!alive.current) return;
      if (!result.answer?.trim()) throw new Error('No explanation was returned. Please try again.');
      if (result.model) setModel(result.model);
      const answer = result.answer + (result.truncated ? '\n\nThis answer reached its length limit. Ask a follow-up for more detail.' : '');
      if (mode === 'meaning') { if (quickVersion.current === version) setQuick({text:answer}); }
      else append({role:'ai',text:answer,sources:result.sources || []});
      return result;
    } catch (e) {
      if (alive.current) {
        const message = controller.signal.aborted ? 'Request cancelled. You can try again.' : e.name === 'TimeoutError' ? 'The AI request timed out. Please try again.' : e.message;
        setError(message);
        if (mode === 'meaning' && quickVersion.current === version) setQuick({error:message});
      }
    } finally {
      if (running.current === controller) running.current = null;
      if (alive.current) setBusy(false);
    }
  }
  return { busy, error, quick, send, elapsed, model, messages,
    cancel: () => running.current?.abort(),
    retry: () => lastRequest.current && send(lastRequest.current.question, lastRequest.current.options),
    clearQuick: () => { quickVersion.current++; setQuick(null); }, clearError: () => setError('') };
}
