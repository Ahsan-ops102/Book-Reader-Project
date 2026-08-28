import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BookCard from "./BookCard.jsx";
import StatsPanel from "./StatsPanel.jsx";
import { listBooks, uploadBook, deleteBook } from "../api.js";
import "./Library.css";

const STREAK_KEY = "reader_daily_streak_v1";

function getStreakData() {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return { streak: 1, lastDate: new Date().toDateString() };
    const data = JSON.parse(raw);
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (data.lastDate === today) return data;
    if (data.lastDate === yesterday) {
      const updated = { streak: data.streak + 1, lastDate: today };
      localStorage.setItem(STREAK_KEY, JSON.stringify(updated));
      return updated;
    }
    const reset = { streak: 1, lastDate: today };
    localStorage.setItem(STREAK_KEY, JSON.stringify(reset));
    return reset;
  } catch {
    return { streak: 1, lastDate: new Date().toDateString() };
  }
}

const QUOTES = [
  "A reader lives a thousand lives before he dies. — George R.R. Martin",
  "The more that you read, the more things you will know. — Dr. Seuss",
  "There is no friend as loyal as a book. — Ernest Hemingway",
  "Books are a uniquely portable magic. — Stephen King",
  "Reading brings us unknown friends. — Honoré de Balzac",
  "Once you learn to read, you will be forever free. — Frederick Douglass",
  "I have always imagined that Paradise will be a kind of library. — Jorge Luis Borges"
];

function getDailyQuote() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return QUOTES[dayOfYear % QUOTES.length];
}

export default function Library() {
  const navigate = useNavigate();
  const [books, setBooks] = useState(null); // null = loading
  const [uploading, setUploading] = useState(null); // { name, progress } | null
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [activeTab, setActiveTab] = useState("books"); // "books" | "stats" | "flashcards"
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "reading" | "completed" | "unread"
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [sortBy, setSortBy] = useState("recent"); // "recent" | "title-asc" | "progress-desc" | "newest"
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "list"
  const [isDragging, setIsDragging] = useState(false);
  const [tagsState, setTagsState] = useState(() => {
    try { return JSON.parse(localStorage.getItem("reader_tags")) || {}; } catch { return {}; }
  });

  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);
  const streak = useMemo(() => getStreakData(), []);

  function refresh() {
    listBooks()
      .then(setBooks)
      .catch(() => setError("Couldn't reach the backend. Is it running?"));
  }

  useEffect(() => {
    refresh();
    const handleTagsUpdate = () => {
      try { setTagsState(JSON.parse(localStorage.getItem("reader_tags")) || {}); } catch {}
    };
    window.addEventListener("reader_tags_updated", handleTagsUpdate);
    return () => window.removeEventListener("reader_tags_updated", handleTagsUpdate);
  }, []);

  async function processPdfFile(file) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
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
      setError("Upload failed. Please check backend connection and try again.");
    } finally {
      setUploading(null);
    }
  }

  function handleFileInputChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) processPdfFile(file);
  }

  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setIsDragging(false);
      dragCounterRef.current = 0;
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (file) processPdfFile(file);
  }

  async function handleDelete(id, title) {
    if (!confirm(`Remove "${title || "this book"}" from your library? This cannot be undone.`)) return;
    try {
      await deleteBook(id);
      refresh();
    } catch {
      setError("Failed to delete book. Try again.");
    }
  }

  const filteredBooks = useMemo(() => {
    if (!books) return [];
    let list = [...books];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((b) => b.title?.toLowerCase().includes(q));
    }

    if (statusFilter === "reading") {
      list = list.filter((b) => b.page_count && b.current_page > 1 && b.current_page < b.page_count);
    } else if (statusFilter === "completed") {
      list = list.filter((b) => b.page_count && b.current_page >= b.page_count);
    } else if (statusFilter === "unread") {
      list = list.filter((b) => !b.page_count || b.current_page <= 1);
    }

    if (collectionFilter !== "all") {
      list = list.filter((b) => tagsState[b.id] === collectionFilter);
    }

    if (sortBy === "title-asc") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "progress-desc") {
      list.sort((a, b) => {
        const pctA = a.page_count ? a.current_page / a.page_count : 0;
        const pctB = b.page_count ? b.current_page / b.page_count : 0;
        return pctB - pctA;
      });
    } else if (sortBy === "newest") {
      list.sort((a, b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0));
    }

    return list;
  }, [books, searchQuery, statusFilter, sortBy]);

  const counts = useMemo(() => {
    if (!books) return { all: 0, reading: 0, completed: 0, unread: 0 };
    let reading = 0;
    let completed = 0;
    let unread = 0;
    for (const b of books) {
      if (b.page_count && b.current_page >= b.page_count) completed++;
      else if (b.page_count && b.current_page > 1) reading++;
      else unread++;
    }
    return { all: books.length, reading, completed, unread };
  }, [books]);

  return (
    <div
      className={`library ${isDragging ? "dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drag-drop-overlay">
          <div className="drag-drop-card">
            <span className="drag-drop-icon">📥</span>
            <h2>Drop your PDF here</h2>
            <p>Release to immediately add to your bookshelf</p>
          </div>
        </div>
      )}

      <header className="library-header">
        <div className="header-brand">
          <div className="header-title-row">
            <h1>The Reading Room</h1>
            <div className="streak-pill" title="Daily Reading Streak">
              🔥 <span className="streak-num">{streak.streak}</span> day streak
            </div>
          </div>
          <p className="library-subtitle">
            {books?.length
              ? `${books.length} book${books.length === 1 ? "" : "s"} in your cloud library · ${counts.completed} completed`
              : "Your personal serene reading sanctuary"}
          </p>
          <div className="daily-quote">
            <span className="quote-icon">💡</span>
            <em>{getDailyQuote()}</em>
          </div>
        </div>

        <div className="header-actions">
          <button className="add-button" onClick={() => fileInputRef.current?.click()}>
            <span className="add-plus">+</span> Add a book
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={handleFileInputChange}
          />
        </div>
      </header>

      <div className="library-tabs-bar">
        <div className="library-tabs">
          <button
            className={`library-tab ${activeTab === "books" ? "active" : ""}`}
            onClick={() => setActiveTab("books")}
          >
            📚 My Books
          </button>
          <button
            className={`library-tab ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            📊 Reading Stats
          </button>
          <button
            className={`library-tab ${activeTab === "flashcards" ? "active" : ""}`}
            onClick={() => setActiveTab("flashcards")}
          >
            🗂️ Flashcards
          </button>
          <button
            className={`library-tab ${activeTab === "writer" ? "active" : ""}`}
            onClick={() => navigate("/writer")}
          >
            ✍️ Writer
          </button>
        </div>
      </div>

      {error && (
        <div className="library-error">
          <span>⚠️ {error}</span>
          <button onClick={() => setError("")} className="error-close">✕</button>
        </div>
      )}

      {uploading && (
        <div className="upload-banner">
          <div className="upload-info">
            <span className="upload-spinner">⏳</span>
            <span>Uploading & saving <strong>"{uploading.name}"</strong> to cloud…</span>
            <span className="upload-pct">{uploading.progress}%</span>
          </div>
          <div className="upload-bar">
            <div className="upload-bar-fill" style={{ width: `${uploading.progress}%` }} />
          </div>
        </div>
      )}

      <main className="library-main">
        {activeTab === "books" ? (
          <>
            {books && books.length > 0 && (
              <div className="library-controls-toolbar">
                <div className="library-search-box">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    placeholder="Search books by title…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="search-input"
                  />
                  {searchQuery && (
                    <button className="search-clear-btn" onClick={() => setSearchQuery("")}>
                      ✕
                    </button>
                  )}
                </div>

                <div className="filter-chips">
                  <button className={`filter-chip ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>All ({counts.all})</button>
                  <button className={`filter-chip ${statusFilter === "reading" ? "active" : ""}`} onClick={() => setStatusFilter("reading")}>Reading ({counts.reading})</button>
                  <button className={`filter-chip ${statusFilter === "completed" ? "active" : ""}`} onClick={() => setStatusFilter("completed")}>Finished ({counts.completed})</button>
                  <button className={`filter-chip ${statusFilter === "unread" ? "active" : ""}`} onClick={() => setStatusFilter("unread")}>Unread ({counts.unread})</button>
                </div>

                <div className="toolbar-right-controls">
                  <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} className="sort-select">
                    <option value="all">All Collections</option>
                    <option value="Work">Work</option>
                    <option value="Fiction">Fiction</option>
                    <option value="University">University</option>
                    <option value="Self-Help">Self-Help</option>
                  </select>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="sort-select">
                    <option value="recent">Recently Read</option>
                    <option value="title-asc">Title (A to Z)</option>
                    <option value="progress-desc">Highest Progress</option>
                    <option value="newest">Recently Added</option>
                  </select>
                </div>

                {/* View Mode Toggle (Grid vs List) */}
                <div className="view-toggle-group">
                  <button
                    className={`view-toggle-btn ${viewMode === "grid" ? "active" : ""}`}
                    onClick={() => setViewMode("grid")}
                    title="Grid View"
                    aria-label="Grid View"
                  >
                    ⊞
                  </button>
                  <button
                    className={`view-toggle-btn ${viewMode === "list" ? "active" : ""}`}
                    onClick={() => setViewMode("list")}
                    title="List View"
                    aria-label="List View"
                  >
                    ☰
                  </button>
                </div>
              </div>
          )}

          {/* Book List / Grid Display */}
          {books === null ? (
            <div className="library-loading-state">
              <div className="loading-spinner" />
              <p className="library-muted">Loading your shelf from cloud…</p>
            </div>
          ) : books.length === 0 && !uploading ? (
            <div className="library-empty" onClick={() => fileInputRef.current?.click()}>
              <div className="empty-shelf-illustration">📚✨</div>
              <h2>Your library is waiting</h2>
              <p>Click here or drag and drop any PDF book to start reading.</p>
              <button className="empty-add-btn">+ Choose a PDF</button>
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="library-no-results">
              <p>🔍 No books match your search or filter.</p>
              <button
                className="clear-filters-btn"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                }}
              >
                Reset Filters
              </button>
            </div>
          ) : viewMode === "grid" ? (
            <div className="library-grid">
              {filteredBooks.map((b) => (
                <BookCard
                  key={b.id}
                  book={b}
                  viewMode="grid"
                  onDelete={(e) => {
                    e.stopPropagation();
                    handleDelete(b.id, b.title);
                  }}
                  onSummarize={(e) => {
                    e.stopPropagation();
                    navigate(`/book/${b.id}?action=summarize`);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="library-list-container">
              {filteredBooks.map((b) => (
                <BookCard
                  key={b.id}
                  book={b}
                  viewMode="list"
                  onDelete={(e) => {
                    e.stopPropagation();
                    handleDelete(b.id, b.title);
                  }}
                  onSummarize={(e) => {
                    e.stopPropagation();
                    navigate(`/book/${b.id}?action=summarize`);
                  }}
                />
              ))}
            </div>
          )}
        </>
      ) : activeTab === "flashcards" ? (
        <div className="flashcards-view">
          <h2>Your Flashcards</h2>
          {books && books.filter(b => {
            const cards = JSON.parse(localStorage.getItem(`reader_fc_${b.id}`)) || [];
            return cards.length > 0;
          }).length === 0 ? (
            <div className="library-empty">
              <div className="empty-icon">🗂️</div>
              <h2>No flashcards yet</h2>
              <p>Open a book, select text, Ask AI, and save the response as a flashcard!</p>
            </div>
          ) : (
            <div className="flashcard-groups">
              {books && books.map(b => {
                const cards = JSON.parse(localStorage.getItem(`reader_fc_${b.id}`)) || [];
                if (cards.length === 0) return null;
                return (
                  <div key={b.id} className="flashcard-book-group">
                    <h3 className="fc-book-title">{b.title}</h3>
                    <div className="flashcard-grid">
                      {cards.map(card => (
                        <div key={card.id} className="flashcard">
                          <div className="fc-inner">
                            <div className="fc-front">
                              <span className="fc-label">Q</span>
                              <p>{card.front}</p>
                            </div>
                            <div className="fc-back">
                              <span className="fc-label">A</span>
                              <p>{card.back}</p>
                            </div>
                          </div>
                          <button 
                            className="fc-delete-btn"
                            onClick={() => {
                              const newCards = cards.filter(c => c.id !== card.id);
                              localStorage.setItem(`reader_fc_${b.id}`, JSON.stringify(newCards));
                              setRefreshCount(r => r + 1); // trigger re-render
                            }}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <StatsPanel books={books} />
      )}
      </main>
    </div>
  );
}
