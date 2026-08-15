import { useEffect, useRef, useState } from "react";
import BookCard from "./BookCard.jsx";
import StatsPanel from "./StatsPanel.jsx";
import { listBooks, uploadBook, deleteBook } from "../api.js";
import "./Library.css";

export default function Library() {
  const [books, setBooks] = useState(null); // null = loading
  const [uploading, setUploading] = useState(null); // { name, progress } | null
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("books"); // "books" | "stats"
  const fileInputRef = useRef(null);

  function refresh() {
    listBooks()
      .then(setBooks)
      .catch(() => setError("Couldn't reach the backend. Is it running?"));
  }

  useEffect(refresh, []);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again later
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }

    const title = file.name.replace(/\.pdf$/i, "");
    setUploading({ name: title, progress: 0 });
    setError("");
    try {
      await uploadBook(file, title, (progress) => setUploading({ name: title, progress }));
      refresh();
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setUploading(null);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Remove this book from your library? This can't be undone.")) return;
    await deleteBook(id);
    refresh();
  }

  return (
    <div className="library">
      <header className="library-header">
        <div>
          <h1>The Reading Room</h1>
          <p className="library-subtitle">
            {books?.length ? `${books.length} book${books.length === 1 ? "" : "s"} on the shelf` : "Your personal library"}
          </p>
        </div>
        <button className="add-button" onClick={() => fileInputRef.current?.click()}>
          + Add a book
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={handleFile}
        />
      </header>

      {/* Tab navigation */}
      <div className="library-tabs">
        <button
          className={`library-tab ${activeTab === "books" ? "active" : ""}`}
          onClick={() => setActiveTab("books")}
        >
          📚 My Books
          {books?.length > 0 && <span className="tab-badge">{books.length}</span>}
        </button>
        <button
          className={`library-tab ${activeTab === "stats" ? "active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          📊 Reading Stats
        </button>
      </div>

      {error && <p className="library-error">{error}</p>}

      {uploading && (
        <div className="upload-banner">
          <span>Uploading "{uploading.name}"…</span>
          <div className="upload-bar">
            <div className="upload-bar-fill" style={{ width: `${uploading.progress}%` }} />
          </div>
        </div>
      )}

      {activeTab === "books" ? (
        <>
          {books === null ? (
            <p className="library-muted">Loading your shelf…</p>
          ) : books.length === 0 && !uploading ? (
            <div className="library-empty">
              <p>Your shelf is empty. Add a PDF to start reading.</p>
            </div>
          ) : (
            <div className="library-grid">
              {books.map((book) => (
                <BookCard key={book.id} book={book} onDelete={() => handleDelete(book.id)} />
              ))}
            </div>
          )}
        </>
      ) : (
        <StatsPanel books={books} />
      )}
    </div>
  );
}
