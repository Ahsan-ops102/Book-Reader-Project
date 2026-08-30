const API_URL = (import.meta.env.VITE_API_URL?.trim() || '').replace(/\/+$/, '').replace(/\/api$/i, '');
export function getAuthToken() {
  return sessionStorage.getItem('reader_auth_token') || '';
}
export function setAuthToken(token) {
  sessionStorage.setItem('reader_auth_token', token);
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    sessionStorage.setItem('reader_user_id', payload.id);
  } catch {}
  localStorage.removeItem('reader_auth_token');
}
export function getUserId() {
  return sessionStorage.getItem('reader_user_id') || 'signed-out';
}
export function accountKey(key) {
  return `rr:${getUserId()}:${key}`;
}
export function clearAuthToken() {
  sessionStorage.removeItem('reader_auth_token');
  sessionStorage.removeItem('reader_user_id');
  localStorage.removeItem('reader_auth_token');
}
export function authHeaders() {
  const token = getAuthToken();
  return token ? {
    Authorization: `Bearer ${token}`
  } : {};
}
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export async function apiFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {})
      },
      signal: options.signal || AbortSignal.timeout(options.timeout || 120000)
    });
  } catch (e) {
    throw new ApiError(e.name === 'TimeoutError' ? 'Request timed out. Your local draft is retained.' : 'You are offline or the server is unavailable.', 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('reader_session_expired'));
    throw new ApiError(body.error || `Request failed (${res.status})`, res.status);
  }
  return res.status === 204 ? null : res.json();
}
const json = (method, body) => ({
  method,
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(body)
});
export const loginUser = (username, password) => apiFetch('/api/auth/login', json('POST', {
  username,
  password
}));
export const registerUser = (username, password, inviteCode) => apiFetch('/api/auth/register', json('POST', {
  username,
  password,
  inviteCode
}));
export async function logoutUser() {
  try {
    await apiFetch('/api/logout', {
      method: 'POST'
    });
  } finally {
    clearAuthToken();
    window.location.assign('/');
  }
}
export async function listBooks(trash = false) {
  const all = [];
  for (let offset = 0;; offset += 500) {
    const rows = await apiFetch(`/api/books?trash=${trash ? 1 : 0}&limit=500&offset=${offset}`);
    all.push(...rows);
    if (rows.length < 500) return all;
  }
}
export const getBook = id => apiFetch(`/api/books/${id}`);
export const updateBook = (id, data) => apiFetch(`/api/books/${id}`, json('PATCH', data));
export const deleteBook = id => apiFetch(`/api/books/${id}`, {
  method: 'DELETE'
});
export const restoreBook = id => apiFetch(`/api/books/${id}/restore`, {
  method: 'POST'
});
export const purgeBook = id => apiFetch(`/api/books/${id}/permanent`, {
  method: 'DELETE'
});
export const updateProgress = (id, currentPage, zoom) => apiFetch(`/api/books/${id}/progress`, json('PUT', {
  currentPage,
  zoom
}));
export const updatePageCount = (id, pageCount) => apiFetch(`/api/books/${id}/pages`, json('PATCH', {
  pageCount
}));
export const bookFileSource = id => ({
  url: `${API_URL}/api/books/${id}/file`,
  httpHeaders: authHeaders()
});
export async function fetchBookBlob(id) {
  const res = await fetch(`${API_URL}/api/books/${id}/file`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(120000)
  });
  if (!res.ok) throw new ApiError('Could not download this book.', res.status);
  return res.blob();
}
export const queryAI = (selectedText, question, extra = {}) => apiFetch('/api/ai/query', json('POST', {
  selectedText,
  question,
  ...extra
}));
export const summarizeBook = (bookId, range = {}) => apiFetch('/api/ai/summary', {
  ...json('POST', {
    bookId,
    ...range
  }),
  timeout: 600000
});
export const ocrPage = (bookId, image) => apiFetch('/api/ai/ocr', json('POST', {
  bookId,
  image
}));
export const generateCover = (bookId, description) => apiFetch('/api/ai/cover', json('POST', {
  bookId,
  description
}));
export const fixTextWithAI = text => apiFetch('/api/ai/fix', json('POST', {
  text
}));
export const transformTextWithAI = (text, operation) => apiFetch('/api/ai/transform', json('POST', {
  text,
  operation
}));
export const getBookState = id => apiFetch(`/api/books/${id}/state`);
export const saveBookState = (id, data, version) => apiFetch(`/api/books/${id}/state`, json('PUT', {
  data,
  version
}));
export const saveBookText = (id, pages) => apiFetch(`/api/books/${id}/text`, json('PUT', {
  pages
}));
export const getBookText = id => apiFetch(`/api/books/${id}/text`);
export const coverCandidates = id => apiFetch(`/api/books/${id}/cover-candidates`);
export const setCoverReference = (id, url) => apiFetch(`/api/books/${id}/cover-reference`, json('PUT', {
  url
}));
export async function coverBlob(book) {
  if (book.cover_kind === 'published') return book.cover_ref;
  if (!book.cover_ref) return '';
  const res = await fetch(`${API_URL}/api/books/${book.id}/cover`, {
    headers: authHeaders()
  });
  if (!res.ok) throw new Error('Cover unavailable');
  return URL.createObjectURL(await res.blob());
}
export const listDocuments = (trash = false) => apiFetch(`/api/documents?trash=${trash ? 1 : 0}`);
export const createDocument = (title, html) => apiFetch('/api/documents/create', json('POST', {
  title,
  html
}));
export const getDocumentContent = id => apiFetch(`/api/documents/${id}/content`);
export const saveDocument = (id, html, title, revision) => apiFetch(`/api/documents/${id}/save`, json('PUT', {
  html,
  title,
  revision
}));
export const deleteDocument = id => apiFetch(`/api/documents/${id}`, {
  method: 'DELETE'
});
export const restoreDocument = id => apiFetch(`/api/documents/${id}/restore`, {
  method: 'POST'
});
export const purgeDocument = id => apiFetch(`/api/documents/${id}/permanent`, {
  method: 'DELETE'
});
export const documentVersions = id => apiFetch(`/api/documents/${id}/versions`);
export const getDocumentVersion = (id, version) => apiFetch(`/api/documents/${id}/versions/${version}`);
export const documentContentUrl = id => `${API_URL}/api/documents/${id}/content`;
export const getSettings = () => apiFetch('/api/account/settings');
export const saveSettings = data => apiFetch('/api/account/settings', json('PUT', data));
export const getStats = () => apiFetch('/api/account/stats');
export const recordSession = data => apiFetch('/api/account/sessions', json('POST', data));
export const exportAccount = () => apiFetch('/api/account/export');
export const createShare = (bookIds, days) => apiFetch('/api/account/shares', json('POST', {
  bookIds,
  days
}));
export const listShares = () => apiFetch('/api/account/shares');
export const revokeShare = id => apiFetch(`/api/account/shares/${id}`, {
  method: 'DELETE'
});
export const sharedShelf = id => apiFetch(`/api/shared/${id}`);
export const changePassword = (currentPassword, newPassword) => apiFetch('/api/password', json('POST', {
  currentPassword,
  newPassword
}));
export const getConfig = () => apiFetch('/api/config');
function upload(path, file, title, onProgress, extra = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}${path}`);
    xhr.timeout = 120000;
    const token = getAuthToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress?.(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      let body;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error('Invalid upload response'));
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);else {
        if (xhr.status === 401) window.dispatchEvent(new Event('reader_session_expired'));
        reject(new ApiError(body.error || 'Upload failed', xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error('Network error. Please retry the upload.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out.'));
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    xhr.send(form);
  });
}
export const uploadBook = (file, title, onProgress) => upload('/api/books/upload', file, title, onProgress);
export const uploadDocument = (file, title, onProgress) => upload('/api/documents/upload', file, title, onProgress);
export const uploadCover = (id, file, kind = 'uploaded') => upload(`/api/books/${id}/cover`, file, '', null, {
  kind
});
