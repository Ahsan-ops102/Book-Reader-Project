import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";

// A warm, rich palette of book binding colors — vibrant and inviting
const BINDINGS = [
  ["#D65A31", "#94381C"],   // terracotta sunset
  ["#2E8B57", "#1C5736"],   // emerald forest
  ["#3E78B2", "#234D7A"],   // sapphire ocean
  ["#8B5FA8", "#5A3873"],   // royal amethyst
  ["#E08736", "#9E5616"],   // golden amber
  ["#D1495B", "#8C2533"],   // ruby rose
  ["#00798C", "#004753"],   // teal peacock
  ["#5C6B73", "#343E44"],   // slate graphite
  ["#606C38", "#283618"],   // olive moss
  ["#BC6C25", "#804414"],   // warm saddle
];

function hashString(str = "") {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export default function BookCard({ book, onDelete, onSummarize, viewMode = "grid" }) {
  const navigate = useNavigate();

  const [tag, setTag] = useState(() => {
    try {
      const tags = JSON.parse(localStorage.getItem("reader_tags")) || {};
      return tags[book.id] || "";
    } catch { return ""; }
  });

  // Listen for tag updates across instances
  useEffect(() => {
    const handleUpdate = () => {
      const tags = JSON.parse(localStorage.getItem("reader_tags")) || {};
      setTag(tags[book.id] || "");
    };
    window.addEventListener("reader_tags_updated", handleUpdate);
    return () => window.removeEventListener("reader_tags_updated", handleUpdate);
  }, [book.id]);

  const hash = hashString(book.title);
  const [c1, c2] = BINDINGS[hash % BINDINGS.length];
  
  // Algorithmic background generator
  let bgStyle = "";
  const type = hash % 5;
  if (type === 0) bgStyle = `linear-gradient(155deg, ${c1} 0%, ${c2} 100%)`;
  else if (type === 1) bgStyle = `radial-gradient(circle at 20% 30%, ${c1}, ${c2})`;
  else if (type === 2) bgStyle = `linear-gradient(45deg, ${c1} 30%, ${c2} 90%)`;
  else if (type === 3) bgStyle = `linear-gradient(to right bottom, ${c1}, #00000030, ${c2})`;
  else bgStyle = `radial-gradient(ellipse at bottom right, ${c1}, ${c2})`;
  const hasPages = Boolean(book.page_count);
  const progressPct = hasPages
    ? Math.min(100, Math.round((book.current_page / book.page_count) * 100))
    : 0;
  const isFinished = hasPages && book.current_page >= book.page_count;

  if (viewMode === "list") {
    return (
      <div className={`book-list-item ${isFinished ? "finished" : ""}`}>
        <div
          className="book-list-spine"
          style={{ background: bgStyle }}
          onClick={() => navigate(`/book/${book.id}`)}
        >
          <span>📖</span>
        </div>

        <div className="book-list-details" onClick={() => navigate(`/book/${book.id}`)}>
          <div className="book-list-header">
            <h3 className="book-list-title">{book.title}</h3>
            {isFinished && <span className="badge-finished">✓ Finished</span>}
          </div>
          <div className="book-list-meta">
            <span className="book-list-progress-text">
              {hasPages
                ? `Page ${book.current_page} of ${book.page_count} (${progressPct}%)`
                : "Ready to read"}
            </span>
            {book.uploaded_at && (
              <span className="book-list-date">
                Added {new Date(book.uploaded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
          {hasPages && (
            <div className="book-list-bar-bg">
              <div
                className={`book-list-bar-fill ${isFinished ? "complete" : ""}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>

        <div className="book-list-actions">
          <button
            className="book-list-read-btn"
            onClick={() => navigate(`/book/${book.id}`)}
          >
            {progressPct > 0 ? "Continue" : "Read"} →
          </button>
          <button
            className="book-list-action-btn"
            onClick={onSummarize}
            title="Generate AI Summary"
          >
            ✨ Summarize
          </button>
          <button
            className="book-list-delete-btn"
            onClick={onDelete}
            title="Delete book"
            aria-label={`Delete ${book.title}`}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // Grid view (Default vibrant 3D book cover)
  return (
    <div className={`book-card ${isFinished ? "finished" : ""}`}>
      <button
        className="book-cover"
        style={{ background: bgStyle }}
        onClick={() => navigate(`/book/${book.id}`)}
        aria-label={`Open ${book.title}`}
      >
        <div className="book-spine-line" />
        <span className="book-cover-title">{book.title}</span>

        {isFinished ? (
          <span className="book-finished-ribbon" title="Book Completed">✓ Done</span>
        ) : hasPages && progressPct > 0 ? (
          <span
            className="book-ribbon"
            style={{ height: `${20 + progressPct * 0.55}%` }}
            title={`${progressPct}% read`}
          />
        ) : null}

        <div className="book-cover-footer">
          <span className="book-cover-icon">📖</span>
        </div>
      </button>

      <div className="book-meta">
        <p className="book-title" title={book.title}>{book.title}</p>
        <p className="book-progress">
          {isFinished ? (
            <span className="status-complete">Finished 🎉</span>
          ) : hasPages ? (
            `${progressPct}% · p.${book.current_page} of ${book.page_count}`
          ) : (
            "Not started"
          )}
        </p>
        <div className="book-tags">
          <button 
            className={`book-tag ${tag ? tag.toLowerCase() : "none"}`}
            onClick={(e) => {
              e.stopPropagation();
              const COLLECTIONS = ["", "Work", "Fiction", "University", "Self-Help"];
              const currentIdx = COLLECTIONS.indexOf(tag);
              const nextTag = COLLECTIONS[(currentIdx + 1) % COLLECTIONS.length];
              setTag(nextTag);
              const tags = JSON.parse(localStorage.getItem("reader_tags")) || {};
              if (nextTag) tags[book.id] = nextTag;
              else delete tags[book.id];
              localStorage.setItem("reader_tags", JSON.stringify(tags));
              window.dispatchEvent(new Event("reader_tags_updated")); // Notify Library to re-filter
            }}
            title="Click to cycle collection tag"
          >
            {tag ? `🏷️ ${tag}` : "+ Add Tag"}
          </button>
        </div>
      </div>

      <div className="book-card-actions">
        <button className="book-summarize" onClick={onSummarize} aria-label={`Summarize ${book.title}`} title="AI Summary">
          ✨
        </button>
        <button className="book-delete" onClick={onDelete} aria-label={`Remove ${book.title}`} title="Remove book">
          ✕
        </button>
      </div>
    </div>
  );
}
