import { Component, Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { getAuthToken, setAuthToken, clearAuthToken, loginUser, registerUser, getConfig, getSettings, saveSettings, sharedShelf, accountKey } from './api.js';
import './index.css';
import './modern.css';
const Library = lazy(() => import('./components/Library.jsx'));
const Reader = lazy(() => import('./components/Reader.jsx'));
const Writer = lazy(() => import('./components/Writer.jsx'));
class ErrorBoundary extends Component {
  state = {
    error: false
  };
  static getDerivedStateFromError() {
    return {
      error: true
    };
  }
  render() {
    return this.state.error ? <main className="auth-card"><h1>This screen could not open</h1><p>Your cloud files have not been removed. Reload to try again.</p><button onClick={() => window.location.reload()}>Reload</button></main> : this.props.children;
  }
}
function SharedShelf() {
  const [data, setData] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    sharedShelf(location.pathname.split('/').pop()).then(setData).catch(e => setError(e.message));
  }, []);
  return <main className="page"><h1>Shared reading shelf</h1><p>Only book details are shared. Files and private notes remain private.</p>{error && <p role="alert">{error}</p>}{data?.books.map((b, i) => <article className="list-row" key={i}><strong>{b.title}</strong><span>{b.author}</span><span>{b.status}</span></article>)}</main>;
}
function AuthGate({
  children
}) {
  const [authenticated, setAuthenticated] = useState(!!getAuthToken()),
    [isLogin, setIsLogin] = useState(true),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [invite, setInvite] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [config, setConfig] = useState({
      registration: 'invite'
    });
  useEffect(() => {
    getConfig().then(setConfig).catch(() => {});
    const expired = () => {
      clearAuthToken();
      setAuthenticated(false);
      setError('Your session expired. Sign in again; local drafts have been retained.');
    };
    window.addEventListener('reader_session_expired', expired);
    return () => window.removeEventListener('reader_session_expired', expired);
  }, []);
  useEffect(() => {
    const apply = () => {
      const theme = localStorage.getItem(accountKey('theme')) || 'warm';
      document.documentElement.setAttribute('data-reader-theme', theme === 'auto' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'warm' : theme);
    };
    apply();
    window.addEventListener('reader_theme_changed', apply);
    if (authenticated) getSettings().then(s => {
      if (s.theme) localStorage.setItem(accountKey('theme'), s.theme);
      apply();
    }).catch(() => {});
    return () => window.removeEventListener('reader_theme_changed', apply);
  }, [authenticated]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = isLogin ? await loginUser(username, password) : await registerUser(username, password, invite);
      setAuthToken(result.token);
      setAuthenticated(true);
      setPassword('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (authenticated) return children;
  return <main className="auth-wrap"><form className="auth-card" onSubmit={submit}><div className="eyebrow">A quieter place for your books</div><h1>The Reading Room</h1><p>{isLogin ? 'Welcome back. Your library is waiting.' : 'Create your private reading space.'}</p><label>Username<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required maxLength={80} /></label><label>Password<input type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} minLength={isLogin ? 1 : 12} value={password} onChange={e => setPassword(e.target.value)} required /></label>{!isLogin && config.registration === 'invite' && <label>Invitation code<input value={invite} onChange={e => setInvite(e.target.value)} required /></label>}{!isLogin && <small>Use at least 12 characters. Private drafts stay on this device until synced.</small>}{error && <p className="notice error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}</button><button type="button" className="text-button" onClick={() => {
        setIsLogin(!isLogin);
        setError('');
      }}>{isLogin ? 'Create an account' : 'Already registered? Sign in'}</button><small>Sessions are kept in this tab. Sign out on shared devices.</small></form></main>;
}
export default function App() {
  return <ErrorBoundary>{location.pathname.startsWith('/share/') ? <SharedShelf /> : <AuthGate><Suspense fallback={<div className="loading-screen" role="status">Opening your reading room…</div>}><Routes><Route path="/" element={<Library />} /><Route path="/book/:id" element={<Reader />} /><Route path="/writer" element={<Writer />} /><Route path="*" element={<main className="page"><h1>Page not found</h1><a href="/">Back to library</a></main>} /></Routes></Suspense></AuthGate>}</ErrorBoundary>;
}
