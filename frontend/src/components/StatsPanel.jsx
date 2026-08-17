import "./StatsPanel.css";

export default function StatsPanel({ books }) {
  if (!books || books.length === 0) {
    return (
      <div className="stats-empty">
        <div className="stats-empty-icon">📊</div>
        <p>No reading stats yet.</p>
        <p className="stats-empty-hint">Upload a book and start reading to see your stats here.</p>
      </div>
    );
  }

  const totalBooks = books.length;
  const booksWithPages = books.filter((b) => b.page_count);
  const totalPages = booksWithPages.reduce((sum, b) => sum + (b.page_count || 0), 0);
  const pagesRead = booksWithPages.reduce((sum, b) => sum + (b.current_page || 0), 0);
  const completed = booksWithPages.filter((b) => b.current_page >= b.page_count).length;
  const inProgress = booksWithPages.filter((b) => b.current_page > 1 && b.current_page < b.page_count).length;
  const overallPct = totalPages > 0 ? Math.round((pagesRead / totalPages) * 100) : 0;

  const totalMinutes = parseInt(localStorage.getItem("reader_total_minutes") || "0", 10);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const timeString = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  const handleShare = () => {
    const text = `📚 My Reading Shelf:\n✅ ${completed} Books Completed\n📖 ${pagesRead.toLocaleString()} Pages Read\n⏱️ ${timeString} Focus Time\n\nTracked via Reading Room 🚀`;
    navigator.clipboard.writeText(text);
    alert("Shareable stats copied to clipboard!");
  };

  const stats = [
    {
      label: "Total Books",
      value: totalBooks,
      icon: "📚",
      color: "#4A7AB5",
      bgColor: "rgba(74, 122, 181, 0.1)",
    },
    {
      label: "Reading Time",
      value: timeString,
      subtitle: "Total focus time",
      icon: "⏱️",
      color: "#E8734A",
      bgColor: "rgba(232, 115, 74, 0.1)",
    },
    {
      label: "Pages Read",
      value: pagesRead.toLocaleString(),
      subtitle: `of ${totalPages.toLocaleString()} total`,
      icon: "📖",
      color: "#8B5CF6",
      bgColor: "rgba(139, 92, 246, 0.1)",
    },
    {
      label: "Completed",
      value: completed,
      subtitle: completed === 1 ? "book finished" : "books finished",
      icon: "✅",
      color: "#2CB79E",
      bgColor: "rgba(44, 183, 158, 0.1)",
    },
    {
      label: "In Progress",
      value: inProgress,
      subtitle: inProgress === 1 ? "book ongoing" : "books ongoing",
      icon: "📝",
      color: "#D4874D",
      bgColor: "rgba(212, 135, 77, 0.1)",
    },
  ];

  return (
    <div className="stats-panel">
      {/* Overall progress hero */}
      <div className="stats-hero">
        <div className="stats-hero-ring">
          <svg viewBox="0 0 120 120" className="progress-ring">
            <circle
              cx="60" cy="60" r="52"
              fill="none"
              stroke="var(--panel-2)"
              strokeWidth="8"
            />
            <circle
              cx="60" cy="60" r="52"
              fill="none"
              stroke="url(#progressGradient)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 52}`}
              strokeDashoffset={`${2 * Math.PI * 52 * (1 - overallPct / 100)}`}
              transform="rotate(-90 60 60)"
              className="progress-ring-fill"
            />
            <defs>
              <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#E8734A" />
                <stop offset="100%" stopColor="#F4A261" />
              </linearGradient>
            </defs>
          </svg>
          <div className="stats-hero-value">
            <span className="stats-hero-pct">{overallPct}%</span>
            <span className="stats-hero-label">overall progress</span>
          </div>
        </div>
        <div className="stats-hero-text">
          <h2>Your Reading Journey</h2>
          <p>
            {completed > 0
              ? `You've completed ${completed} ${completed === 1 ? "book" : "books"}! Keep it going 🎉`
              : pagesRead > 0
              ? `You've read ${pagesRead.toLocaleString()} pages so far. Great progress! 📖`
              : "Start reading to track your progress here."}
          </p>
          <button className="share-shelf-btn" onClick={handleShare}>
            📤 Share My Shelf
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-icon" style={{ background: stat.bgColor }}>
              {stat.icon}
            </div>
            <div className="stat-content">
              <span className="stat-value" style={{ color: stat.color }}>
                {stat.value}
              </span>
              <span className="stat-label">{stat.label}</span>
              {stat.subtitle && <span className="stat-subtitle">{stat.subtitle}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Book progress list */}
      {booksWithPages.length > 0 && (
        <div className="stats-books">
          <h3>Book Progress</h3>
          <div className="stats-book-list">
            {booksWithPages.map((book) => {
              const pct = Math.min(100, Math.round((book.current_page / book.page_count) * 100));
              const isComplete = pct >= 100;
              return (
                <div className="stats-book-row" key={book.id}>
                  <div className="stats-book-info">
                    <span className="stats-book-title">{book.title}</span>
                    <span className="stats-book-pages">
                      p.{book.current_page} of {book.page_count}
                    </span>
                  </div>
                  <div className="stats-book-bar-wrap">
                    <div className="stats-book-bar">
                      <div
                        className={`stats-book-bar-fill ${isComplete ? "complete" : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`stats-book-pct ${isComplete ? "complete" : ""}`}>{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Achievements & Badges */}
      <div className="stats-badges">
        <h3>Achievements</h3>
        <div className="badges-grid">
          <div className={`badge-card ${totalBooks >= 1 ? "unlocked" : "locked"}`}>
            <div className="badge-icon">📖</div>
            <div className="badge-info">
              <h4>First Book</h4>
              <p>Add your first book to the library.</p>
            </div>
          </div>
          <div className={`badge-card ${completed >= 1 ? "unlocked" : "locked"}`}>
            <div className="badge-icon">🎉</div>
            <div className="badge-info">
              <h4>Finisher</h4>
              <p>Complete your first book entirely.</p>
            </div>
          </div>
          <div className={`badge-card ${pagesRead >= 100 ? "unlocked" : "locked"}`}>
            <div className="badge-icon">🔥</div>
            <div className="badge-info">
              <h4>Avid Reader</h4>
              <p>Read 100 pages across your library.</p>
            </div>
          </div>
          <div className={`badge-card ${totalMinutes >= 60 ? "unlocked" : "locked"}`}>
            <div className="badge-icon">⏱️</div>
            <div className="badge-info">
              <h4>Deep Work</h4>
              <p>Read for at least 1 hour in total.</p>
            </div>
          </div>
          <div className={`badge-card ${totalBooks >= 10 ? "unlocked" : "locked"}`}>
            <div className="badge-icon">📚</div>
            <div className="badge-info">
              <h4>Librarian</h4>
              <p>Upload 10 books to your collection.</p>
            </div>
          </div>
          <div className={`badge-card locked`}>
            <div className="badge-icon">🧠</div>
            <div className="badge-info">
              <h4>Curious Mind</h4>
              <p>Ask 100 AI Questions (Coming Soon).</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
