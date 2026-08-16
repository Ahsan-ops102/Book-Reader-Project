import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import AIPanel from "./AIPanel.jsx";
import { getBook, bookFileSource, updateProgress, updatePageCount } from "../api.js";
import "./Reader.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const RENDER_WIDTH = 760; // base page width in px at zoom = 1
const PAGE_GAP = 24;
const WINDOW_RADIUS = 3; // windowed virtual rendering for smooth 60fps

export default function Reader() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [numPages, setNumPages] = useState(null);
  const [pageRatio, setPageRatio] = useState(1.3);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [loadError, setLoadError] = useState("");
  const [pdfDoc, setPdfDoc] = useState(null);

  // Reader Settings & Themes (Persisted in localStorage)
  const [theme, setTheme] = useState(() => localStorage.getItem("reader_theme") || "warm");
  const [viewMode, setViewMode] = useState(() => localStorage.getItem("reader_view_mode") || "scroll"); // "scroll" | "single"
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Drawers & Panels
  const [panelOpen, setPanelOpen] = useState(false); // AI Panel
  const [sidebarTab, setSidebarTab] = useState(null); // null | "outline" | "bookmarks"
  const [outline, setOutline] = useState([]);
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`reader_bm_${id}`)) || [];
    } catch {
      return [];
    }
  });

  // Selection & Quick AI Floating action
  const [selection, setSelection] = useState("");
  const [askButton, setAskButton] = useState(null);

  // Audio / Text-to-Speech (TTS)
  const [speaking, setSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [speechText, setSpeechText] = useState("");

  const scrollRef = useRef(null);
  const readerRootRef = useRef(null);
  const restoredRef = useRef(false);
  const saveTimer = useRef(null);
  const fileSource = useRef(bookFileSource(id)).current;

  const pageWidth = RENDER_WIDTH * zoom;
  const pageHeight = pageWidth * pageRatio;

  // Apply theme to document / container
  useEffect(() => {
    localStorage.setItem("reader_theme", theme);
    document.documentElement.setAttribute("data-reader-theme", theme);
    return () => {
      document.documentElement.removeAttribute("data-reader-theme");
    };
  }, [theme]);

  // Persist view mode
  useEffect(() => {
    localStorage.setItem("reader_view_mode", viewMode);
  }, [viewMode]);

  // Persist bookmarks per book
  useEffect(() => {
    localStorage.setItem(`reader_bm_${id}`, JSON.stringify(bookmarks));
  }, [bookmarks, id]);

  // Load book metadata
  useEffect(() => {
    getBook(id)
      .then((book) => {
        setTitle(book.title);
        setCurrentPage(book.current_page || 1);
        setZoom(book.zoom || 1.0);
      })
      .catch(() => setLoadError("Couldn't load book metadata."));
  }, [id]);

  // PDF Document loaded callback
  function onDocumentLoad(pdf) {
    setPdfDoc(pdf);
    setNumPages(pdf.numPages);
    updatePageCount(id, pdf.numPages).catch(() => {});

    // Compute aspect ratio
    pdf.getPage(1).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      setPageRatio(viewport.height / viewport.width);
    });

    // Extract PDF Table of Contents Outline
    pdf.getOutline().then(async (outlines) => {
      if (!outlines || outlines.length === 0) return;
      // Resolve destinations to page numbers
      const parsed = [];
      for (const item of outlines.slice(0, 50)) {
        try {
          let pageNum = 1;
          if (typeof item.dest === "string") {
            const dest = await pdf.getDestination(item.dest);
            if (dest) {
              const pageIndex = await pdf.getPageIndex(dest[0]);
              pageNum = pageIndex + 1;
            }
          } else if (Array.isArray(item.dest)) {
            const pageIndex = await pdf.getPageIndex(item.dest[0]);
            pageNum = pageIndex + 1;
          }
          parsed.push({ title: item.title, pageNumber: pageNum });
        } catch {
          // ignore unresolvable outline item
        }
      }
      setOutline(parsed);
    }).catch(() => {});
  }

  // Restore scroll position in scroll mode
  useLayoutEffect(() => {
    if (viewMode !== "scroll" || restoredRef.current || !numPages || !scrollRef.current) return;
    const target = (currentPage - 1) * (pageHeight + PAGE_GAP);
    scrollRef.current.scrollTop = target;
    restoredRef.current = true;
  }, [numPages, pageHeight, viewMode, currentPage]);

  const saveProgress = useCallback(
    (page, z) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        updateProgress(id, page, z).catch(() => {});
      }, 700);
    },
    [id]
  );

  function handleScroll() {
    if (viewMode !== "scroll" || !scrollRef.current || !numPages) return;
    const scrollTop = scrollRef.current.scrollTop;
    const page = Math.min(numPages, Math.max(1, Math.round(scrollTop / (pageHeight + PAGE_GAP)) + 1));
    if (page !== currentPage) {
      setCurrentPage(page);
      saveProgress(page, zoom);
    }
  }

  function jumpToPage(page) {
    const clamped = Math.min(numPages || page, Math.max(1, page));
    setCurrentPage(clamped);
    if (viewMode === "scroll" && scrollRef.current) {
      scrollRef.current.scrollTop = (clamped - 1) * (pageHeight + PAGE_GAP);
    }
    saveProgress(clamped, zoom);
  }

  function changeZoom(delta) {
    const next = Math.min(2.4, Math.max(0.5, +(zoom + delta).toFixed(2)));
    setZoom(next);
    saveProgress(currentPage, next);
  }

  // Bookmarks handling
  const isBookmarked = bookmarks.some((b) => b.page === currentPage);
  function toggleBookmark() {
    if (isBookmarked) {
      setBookmarks((prev) => prev.filter((b) => b.page !== currentPage));
    } else {
      const newBm = {
        page: currentPage,
        title: `Page ${currentPage}`,
        createdAt: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      };
      setBookmarks((prev) => [...prev, newBm].sort((a, b) => a.page - b.page));
    }
  }

  // Selection & quick AI
  function handleMouseUp() {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text) {
      setAskButton(null);
      return;
    }
    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelection(text);
      setAskButton({ x: rect.left + rect.width / 2, y: rect.top });
    } catch {
      setAskButton(null);
    }
  }

  // Text-To-Speech (Native Web Speech API)
  function speakText(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speechRate;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    setSpeechText(text.slice(0, 80) + "…");
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  function toggleSpeechForCurrentSelection() {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    } else {
      const textToRead = selection || `Reading page ${currentPage}`;
      speakText(textToRead);
    }
  }

  function stopSpeech() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }

  // Fullscreen toggle
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      readerRootRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }

  // Keyboard navigation shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      // Don't trigger if user is typing in an input or textarea
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;

      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        jumpToPage(currentPage - 1);
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        jumpToPage(currentPage + 1);
      } else if (e.key === "+" || e.key === "=") {
        changeZoom(0.1);
      } else if (e.key === "-") {
        changeZoom(-0.1);
      } else if (e.key.toLowerCase() === "b") {
        toggleBookmark();
      } else if (e.key.toLowerCase() === "f") {
        toggleFullscreen();
      } else if (e.key.toLowerCase() === "a") {
        setPanelOpen((v) => !v);
      } else if (e.key === "Escape") {
        setPanelOpen(false);
        setSidebarTab(null);
        setAskButton(null);
        stopSpeech();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const start = Math.max(1, currentPage - WINDOW_RADIUS);
  const end = Math.min(numPages || 1, currentPage + WINDOW_RADIUS);
  const slots = numPages ? Array.from({ length: numPages }, (_, i) => i + 1) : [];

  return (
    <div className={`reader theme-${theme} ${isFullscreen ? "is-fullscreen" : ""}`} ref={readerRootRef}>
      {/* Top Main Toolbar */}
      <header className="reader-toolbar">
        <div className="toolbar-left">
          <button className="toolbar-btn icon-btn" onClick={() => navigate("/")} title="Back to library (Esc)">
            ←
          </button>
          <button
            className={`toolbar-btn icon-btn ${sidebarTab === "outline" ? "active" : ""}`}
            onClick={() => setSidebarTab((curr) => (curr === "outline" ? null : "outline"))}
            title="Table of Contents / Chapters"
          >
            📑
          </button>
          <button
            className={`toolbar-btn icon-btn ${sidebarTab === "bookmarks" ? "active" : ""}`}
            onClick={() => setSidebarTab((curr) => (curr === "bookmarks" ? null : "bookmarks"))}
            title="Bookmarks list"
          >
            🔖
          </button>
          <span className="toolbar-title" title={title}>{title}</span>
        </div>

        {/* Center Page Navigator */}
        <div className="toolbar-center">
          <div className="toolbar-group nav-group">
            <button
              onClick={() => jumpToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              title="Previous page (←)"
              className="toolbar-btn nav-arrow"
            >
              ‹
            </button>
            <div className="page-input-wrap">
              <input
                type="number"
                min="1"
                max={numPages || 1}
                value={currentPage}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) jumpToPage(val);
                }}
                className="page-direct-input"
              />
              <span className="page-total">/ {numPages ?? "…"}</span>
            </div>
            <button
              onClick={() => jumpToPage(currentPage + 1)}
              disabled={numPages ? currentPage >= numPages : false}
              title="Next page (→)"
              className="toolbar-btn nav-arrow"
            >
              ›
            </button>
          </div>
        </div>

        {/* Right Action Tools */}
        <div className="toolbar-right">
          {/* Bookmark current page */}
          <button
            className={`toolbar-btn bookmark-toggle ${isBookmarked ? "bookmarked" : ""}`}
            onClick={toggleBookmark}
            title={isBookmarked ? "Remove bookmark" : "Bookmark this page (B)"}
          >
            {isBookmarked ? "★ Saved" : "☆ Bookmark"}
          </button>

          {/* View Mode Toggle */}
          <button
            className="toolbar-btn view-mode-btn"
            onClick={() => setViewMode((m) => (m === "scroll" ? "single" : "scroll"))}
            title={viewMode === "scroll" ? "Switch to Single Page flip" : "Switch to Continuous Scroll"}
          >
            {viewMode === "scroll" ? "📜 Continuous" : "📄 Single Page"}
          </button>

          {/* Zoom Controls */}
          <div className="toolbar-group zoom-group">
            <button onClick={() => changeZoom(-0.1)} title="Zoom out (-)" className="toolbar-btn">
              −
            </button>
            <span className="toolbar-zoom">{Math.round(zoom * 100)}%</span>
            <button onClick={() => changeZoom(0.1)} title="Zoom in (+)" className="toolbar-btn">
              +
            </button>
          </div>

          {/* Theme Switcher Dropdown */}
          <div className="theme-switcher">
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="theme-select"
              title="Reading Theme"
            >
              <option value="warm">☀️ Warm</option>
              <option value="sepia">📜 Sepia</option>
              <option value="dark">🌙 Dark</option>
              <option value="oled">🖤 OLED</option>
            </select>
          </div>

          {/* Text-to-Speech button */}
          <button
            className={`toolbar-btn audio-btn ${speaking ? "speaking" : ""}`}
            onClick={toggleSpeechForCurrentSelection}
            title="Read aloud (Text-to-Speech)"
          >
            {speaking ? "🔊 Pause" : "🎧 Listen"}
          </button>

          {/* Fullscreen button */}
          <button
            className="toolbar-btn icon-btn"
            onClick={toggleFullscreen}
            title="Fullscreen mode (F)"
          >
            {isFullscreen ? "↙" : "↗"}
          </button>

          {/* AI Panel trigger */}
          <button
            className={`toolbar-ai ${panelOpen ? "active" : ""}`}
            onClick={() => setPanelOpen((v) => !v)}
            title="Ask AI Assistant (A)"
          >
            ✨ Ask AI
          </button>
        </div>
      </header>

      {/* Floating Audio Status Bar when speaking */}
      {speaking && (
        <div className="audio-player-banner">
          <div className="audio-status-dot" />
          <span className="audio-label">Listening to:</span>
          <span className="audio-sample">{speechText}</span>
          <div className="audio-controls">
            <select
              value={speechRate}
              onChange={(e) => {
                const rate = parseFloat(e.target.value);
                setSpeechRate(rate);
                stopSpeech();
              }}
              className="audio-rate-select"
              title="Speech Speed"
            >
              <option value="0.8">0.8x</option>
              <option value="1.0">1.0x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
            </select>
            <button className="audio-stop-btn" onClick={stopSpeech}>
              ✕ Stop
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <div className="reader-error-banner">
          <p>⚠️ {loadError}</p>
        </div>
      )}

      {/* Main Content Area */}
      <div className="reader-body">
        {/* Left Side Drawer: Outline or Bookmarks */}
        {sidebarTab && (
          <aside className="reader-sidebar">
            <div className="sidebar-header">
              <h3>{sidebarTab === "outline" ? "📑 Table of Contents" : "🔖 Saved Bookmarks"}</h3>
              <button onClick={() => setSidebarTab(null)} className="sidebar-close-btn">
                ✕
              </button>
            </div>

            <div className="sidebar-content">
              {sidebarTab === "outline" ? (
                outline.length > 0 ? (
                  <ul className="outline-list">
                    {outline.map((item, idx) => (
                      <li
                        key={idx}
                        className={`outline-item ${currentPage === item.pageNumber ? "active" : ""}`}
                        onClick={() => {
                          jumpToPage(item.pageNumber);
                          setSidebarTab(null);
                        }}
                      >
                        <span className="outline-item-title">{item.title}</span>
                        <span className="outline-item-page">p.{item.pageNumber}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="sidebar-empty">
                    <p>No table of contents outline found in this PDF.</p>
                  </div>
                )
              ) : (
                bookmarks.length > 0 ? (
                  <ul className="bookmarks-list">
                    {bookmarks.map((bm) => (
                      <li key={bm.page} className="bookmark-item">
                        <div
                          className="bookmark-click-zone"
                          onClick={() => {
                            jumpToPage(bm.page);
                            setSidebarTab(null);
                          }}
                        >
                          <span className="bookmark-page-badge">★ Page {bm.page}</span>
                          <span className="bookmark-date">{bm.createdAt}</span>
                        </div>
                        <button
                          className="bookmark-delete-btn"
                          onClick={() => setBookmarks((prev) => prev.filter((b) => b.page !== bm.page))}
                          title="Remove bookmark"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="sidebar-empty">
                    <p>No bookmarks saved yet.</p>
                    <button className="sidebar-action-btn" onClick={toggleBookmark}>
                      + Bookmark Page {currentPage}
                    </button>
                  </div>
                )
              )}
            </div>
          </aside>
        )}

        {/* Reader Canvas / Document View */}
        <main
          className={`reader-scroll ${viewMode === "single" ? "single-mode" : "scroll-mode"}`}
          ref={scrollRef}
          onScroll={handleScroll}
          onMouseUp={handleMouseUp}
        >
          <Document
            file={fileSource}
            onLoadSuccess={onDocumentLoad}
            onLoadError={() => setLoadError("Couldn't render this PDF file.")}
            loading={
              <div className="reader-loading-wrap">
                <div className="loading-spinner" />
                <p>Opening your book…</p>
              </div>
            }
          >
            {viewMode === "single" ? (
              /* Single Page Mode */
              <div className="single-page-wrapper" style={{ width: pageWidth }}>
                <div className="page-slot single" style={{ minHeight: pageHeight }}>
                  <Page
                    pageNumber={currentPage}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer={true}
                    loading=""
                    className="pdf-page-canvas"
                  />
                </div>
              </div>
            ) : (
              /* Continuous Scroll Mode (Virtualized window) */
              <div className="reader-pages" style={{ width: pageWidth }}>
                {slots.map((n) => (
                  <div
                    key={n}
                    className="page-slot"
                    style={{ height: pageHeight, marginBottom: PAGE_GAP }}
                  >
                    {n >= start && n <= end ? (
                      <Page
                        pageNumber={n}
                        width={pageWidth}
                        renderAnnotationLayer={false}
                        renderTextLayer={true}
                        loading=""
                        className="pdf-page-canvas"
                      />
                    ) : (
                      <div className="page-placeholder">Page {n}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Document>
        </main>
      </div>

      {/* Floating "Ask AI about this" selection button */}
      {askButton && (
        <button
          className="ask-ai-floating"
          style={{ left: askButton.x, top: askButton.y - 48 }}
          onClick={() => {
            setPanelOpen(true);
            setAskButton(null);
          }}
        >
          ✨ Ask AI about this
        </button>
      )}

      {/* Interactive AI Assistant Panel */}
      <AIPanel
        open={panelOpen}
        selectedText={selection}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  );
}
