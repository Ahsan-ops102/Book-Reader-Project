import { useEffect, useState } from 'react';
import { getSettings, saveSettings, accountKey, exportAccount, changePassword, logoutUser, listShares, revokeShare } from '../api.js';
import { clearOffline } from '../offline.js';
import Dialog from './Dialog.jsx';
import {offlineShellStatus,prepareOfflineShell} from '../offlineShell.js';
export default function Settings({
  onClose
}) {
  const [data, setData] = useState({
      theme: localStorage.getItem(accountKey('theme')) || 'warm',
      dailyMinutes: 20,
      annualBooks: 12
    }),
    [message, setMessage] = useState(''),
    [password, setPassword] = useState(''),
    [next, setNext] = useState(''),
    [shares, setShares] = useState([]), [offlineStatus,setOfflineStatus] = useState(offlineShellStatus);
  useEffect(() => {
    getSettings().then(s => setData(d => ({
      ...d,
      ...s
    }))).catch(e => setMessage(e.message));
    listShares().then(setShares).catch(() => {});
  }, []);
  useEffect(() => { const refresh = () => setOfflineStatus(offlineShellStatus); window.addEventListener('reader_offline_status',refresh); prepareOfflineShell().then(setOfflineStatus); return () => window.removeEventListener('reader_offline_status',refresh); }, []);
  async function run(fn) {
    try {
      await fn();
    } catch (e) {
      setMessage(e.message);
    }
  }
  return <Dialog title="Preferences & privacy" onClose={onClose}><label>Appearance<select value={data.theme} onChange={e => {
        const theme = e.target.value;
        setData({
          ...data,
          theme
        });
        localStorage.setItem(accountKey('theme'), theme);
        window.dispatchEvent(new Event('reader_theme_changed'));
      }}>{['warm', 'sepia', 'dark', 'oled', 'auto'].map(t => <option key={t}>{t}</option>)}</select></label><div className="form-grid"><label>Daily reading goal (minutes)<input type="number" min="1" max="600" value={data.dailyMinutes} onChange={e => setData({
          ...data,
          dailyMinutes: Number(e.target.value)
        })} /></label><label>Annual book goal<input type="number" min="1" max="1000" value={data.annualBooks} onChange={e => setData({
          ...data,
          annualBooks: Number(e.target.value)
        })} /></label></div><button className="primary" onClick={() => run(async () => {
      await saveSettings(data);
      setMessage('Preferences saved across devices.');
    })}>Save preferences</button><hr /><h3>Your data</h3><p role="status">{offlineStatus}</p><button onClick={() => location.reload()}>Reload app</button><p>Downloaded books and recovery drafts are stored on this device, scoped to your account. AI and cover lookup only run when you request them.</p><div className="action-row"><button onClick={() => run(async () => {
        const data = await exportAccount(),
          url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json'
          }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'reading-room-data.json';
        a.click();
        URL.revokeObjectURL(url);
        setMessage('Metadata and notes exported. Book files are downloaded separately.');
      })}>Export notes & metadata</button><button onClick={() => run(async () => {
        await clearOffline();
        setMessage('Offline book downloads and cached library removed. Recovery drafts were kept.');
      })}>Remove offline downloads</button></div><details><summary>Change password</summary><label>Current password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><label>New password (12+ characters)<input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} /></label><button onClick={() => run(async () => {
        await changePassword(password, next);
        await logoutUser();
      })}>Change password and sign out all sessions</button></details><details><summary>Manage shared shelves ({shares.length})</summary>{shares.map(s => <div className="list-row" key={s.id}><span>Expires {new Date(s.expires_at).toLocaleDateString()}</span><button onClick={() => run(async () => {
          await revokeShare(s.id);
          setShares(shares.filter(x => x.id !== s.id));
        })}>Revoke link</button></div>)}</details>{message && <p role="status" className="notice">{message}</p>}</Dialog>;
}
