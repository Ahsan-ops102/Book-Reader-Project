import { useNavigate } from "react-router-dom";

// A warm, modern palette of book binding colors — bright and inviting
const BINDINGS = [
  ["#C9553D", "#9E3A2A"],   // terracotta
  ["#3B8574", "#2A6356"],   // sage green
  ["#4A7AB5", "#345A8A"],   // sky blue
  ["#8B6BAE", "#6B4D8A"],   // lavender
  ["#D4874D", "#B06A38"],   // amber
  ["#5B8A72", "#3E6B54"],   // forest
  ["#C97B8B", "#A85C6C"],   // rose
  ["#6B8DAE", "#4D6F8A"],   // steel blue
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export default function BookCard({ book, onDelete }) {
  const navigate = useNavigate();
  const [c1, c2] = BINDINGS[hashString(book.title) % BINDINGS.length];
  const hasPages = Boolean(book.page_count);
  const progressPct = hasPages
    ? Math.min(100, Math.round((book.current_page / book.page_count) * 100))
    : 0;

  return (
    <div className="book-card">
      <button
        className="book-cover"
        style={{ background: `linear-gradient(160deg, ${c1}, ${c2})` }}
        onClick={() => navigate(`/book/${book.id}`)}
        aria-label={`Open ${book.title}`}
      >
        <span className="book-cover-title">{book.title}</span>
        {hasPages && (
          <span
            className="book-ribbon"
            style={{ height: `${18 + progressPct * 0.6}%` }}
            title={`${progressPct}% read`}
          />
        )}
      </button>

      <div className="book-meta">
        <p className="book-title">{book.title}</p>
        <p className="book-progress">
          {hasPages ? `${progressPct}% · p.${book.current_page} of ${book.page_count}` : "Not started"}
        </p>
      </div>

      <button className="book-delete" onClick={onDelete} aria-label={`Remove ${book.title}`}>
        ✕
      </button>
    </div>
  );
}
