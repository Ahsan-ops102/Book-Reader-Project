import { useEffect, useState } from 'react';
import { getStats, getSettings } from '../api.js';
export default function StatsPanel({
  books
}) {
  const [stats, setStats] = useState(null),
    [settings, setSettings] = useState({
      dailyMinutes: 20,
      annualBooks: 12
    }),
    [error, setError] = useState('');
  useEffect(() => {
    getStats().then(setStats).catch(e => setError(e.message));
    getSettings().then(s => setSettings(d => ({
      ...d,
      ...s
    }))).catch(() => {});
  }, []);
  const done = books.filter(b => b.status === 'finished').length;
  const year = new Date().getFullYear(),
    annualDone = books.filter(b => b.finished_at && new Date(b.finished_at).getFullYear() === year).length;
  const today = new Date().toLocaleDateString('en-CA');
  const minutes = Math.floor((stats?.days.find(d => d.day === today)?.seconds || 0) / 60);
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  for (let i = 0; i < 3660; i++) {
    const key = cursor.toLocaleDateString('en-CA'),
      active = stats?.days.some(d => d.day === key && d.seconds >= 60);
    if (!active && i > 0) break;
    if (active) streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return <section><h2>Your reading, measured honestly</h2><p>Time counts while the book is visible and you have interacted recently. Pages visited are not claimed as pages fully read.</p><div className="stats-grid">{[['Books', books.length], ['Finished', done], ['Active minutes', Math.floor((stats?.totalSeconds || 0) / 60)], ['Pages visited', stats?.pagesVisited || 0], ['Reading streak', `${streak} days`]].map(([label, value]) => <article className="metric" key={label}><small>{label}</small><strong>{value}</strong></article>)}</div><div className="goal"><h3>Today: {minutes} / {settings.dailyMinutes} minutes</h3><progress max={settings.dailyMinutes || 20} value={minutes} /><h3>{year} goal: {annualDone} / {settings.annualBooks} finished books</h3><progress max={settings.annualBooks || 12} value={annualDone} /><small>Counts books marked finished this year. Older books without a completion date are not assigned an invented date.</small></div><h3>Recent sessions</h3>{stats?.days.slice(0, 30).map(d => <div className="list-row" key={d.day}><span>{d.day}</span><span>{Math.floor(d.seconds / 60)} active minutes</span><span>{d.pages} pages visited</span></div>)}{error && <p role="alert" className="notice error">{error}</p>}</section>;
}
