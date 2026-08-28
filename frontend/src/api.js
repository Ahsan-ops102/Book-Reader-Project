const _API_URL_RAW = import.meta.env.VITE_API_URL || "http://localhost:3001";
const API_URL = _API_URL_RAW.replace(/\/$/, "");
const PASSWORD_KEY = "reader_app_password";

export function getAppPassword() {
  return localStorage.getItem(PASSWORD_KEY) || "";
}
export function setAppPassword(pw) {
  localStorage.setItem(PASSWORD_KEY, pw);
}
export function clearAppPassword() {
  localStorage.removeItem(PASSWORD_KEY);
}

function authHeaders() {
  const pw = getAppPassword();
  return pw ? { "x-app-password": pw } : {};
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401) {
    clearAppPassword();
    throw new Error("UNAUTHORIZED");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export function listBooks() {
  return apiFetch("/api/books");
}

export function getBook(id) {
  return apiFetch(`/api/books/${id}`);
}

export function deleteBook(id) {
  return apiFetch(`/api/books/${id}`, { method: "DELETE" });
}

export function updateProgress(id, currentPage, zoom) {
  return apiFetch(`/api/books/${id}/progress`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPage, zoom }),
  });
}

export function updatePageCount(id, pageCount) {
  return apiFetch(`/api/books/${id}/pages`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageCount }),
  });
}

export function queryAI(selectedText, question) {
  return apiFetch("/api/ai/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selectedText, question }),
  });
}

// Returns the pdf.js-compatible source object, including auth header,
// so react-pdf's <Document> can fetch a protected file directly.
export function bookFileSource(id) {
  return {
    url: `${API_URL}/api/books/${id}/file`,
    httpHeaders: authHeaders(),
  };
}

// Upload with progress callback via XHR (fetch doesn't expose upload progress)
export function uploadBook(file, title, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/books/upload`);
    const pw = getAppPassword();
    if (pw) xhr.setRequestHeader("x-app-password", pw);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error("Upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    xhr.send(formData);
  });
}

export function fixTextWithAI(text) {
  return apiFetch("/api/ai/fix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export function transformTextWithAI(text, operation) {
  return apiFetch("/api/ai/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, operation }),
  });
}

// ── Document API ────────────────────────────────────────

export function listDocuments() {
  return apiFetch("/api/documents");
}

export function createDocument(title, html) {
  return apiFetch("/api/documents/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, html }),
  });
}

export function getDocumentContent(id) {
  return apiFetch(`/api/documents/${id}/content`);
}

export function saveDocument(id, html, title) {
  return apiFetch(`/api/documents/${id}/save`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, title }),
  });
}

export function deleteDocument(id) {
  return apiFetch(`/api/documents/${id}`, { method: "DELETE" });
}



export function uploadDocument(file, title, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/documents/upload`);
    const pw = getAppPassword();
    if (pw) xhr.setRequestHeader("x-app-password", pw);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title || file.name.replace(/\.docx?$/i, ""));
    xhr.send(formData);
  });
}

// Returns the raw file URL for downloading a docx from R2 (for mammoth conversion)
export function documentContentUrl(id) {
  return `${API_URL}/api/documents/${id}/content`;
}
