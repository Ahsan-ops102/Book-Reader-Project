import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
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
  const location = useLocation();

  const [title, setTitle] = useState("");
  const [numPages, setNumPages] = useState(null);
  const [pageRatio, setPageRatio] = useState(1.3);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);

  const currentPageRef = useRef(currentPage);
  const zoomRef = useRef(zoom);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Flush exact progress on unmount
  useEffect(() => {
    return () => {
      updateProgress(id, currentPageRef.current, zoomRef.current).catch(() => {});
    };
  }, [id]);
  const [loadError, setLoadError] = useState("");
  const [pdfDoc, setPdfDoc] = useState(null);

  // Reader Settings & Themes (Persisted in localStorage)
  const [themePref, setThemePref] = useState(() => localStorage.getItem("reader_theme") || "warm");
  
  // Computed theme: if "auto", check time, else use the raw preference
  const [theme, setTheme] = useState(themePref);
  useEffect(() => {
    if (themePref === "auto") {
      const hour = new Date().getHours();
      setTheme((hour >= 19 || hour < 7) ? "dark" : "warm");
    } else {
      setTheme(themePref);
    }
  }, [themePref]);

  const [ambientTrack, setAmbientTrack] = useState(() => localStorage.getItem("reader_ambient") || "none");

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
  const [initialQuery, setInitialQuery] = useState(""); // auto-fire query when Define is clicked

  // Pomodoro Timer & Session Tracking
  const [pomoTime, setPomoTime] = useState(25 * 60);
  const [isPomoActive, setIsPomoActive] = useState(false);
  const [isPomoBreak, setIsPomoBreak] = useState(false);

  // PDF Text Search
  const [searchText, setSearchText] = useState("");
  const [searchMatches, setSearchMatches] = useState([]);
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  // Highlights / Annotations
  const [highlights, setHighlights] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`reader_hl_${id}`)) || [];
    } catch {
      return [];
    }
  });

  // Audio / Text-to-Speech (TTS)
  const [speaking, setSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [speechText, setSpeechText] = useState("");

  const scrollRef = useRef(null);
  const readerRootRef = useRef(null);
  const aiPanelRef = useRef(null);
  const restoredRef = useRef(false);
  const saveTimer = useRef(null);
  const searchTimer = useRef(null);
  const fileSource = useRef(bookFileSource(id)).current;

  const pageWidth = RENDER_WIDTH * zoom;
  const pageHeight = pageWidth * pageRatio;

  // Apply theme to document / container
  useEffect(() => {
    localStorage.setItem("reader_theme", themePref);
    document.documentElement.setAttribute("data-reader-theme", theme);
    return () => {
      document.documentElement.removeAttribute("data-reader-theme");
    };
  }, [theme, themePref]);

  // Persist ambient track
  useEffect(() => {
    localStorage.setItem("reader_ambient", ambientTrack);
  }, [ambientTrack]);


  // Persist view mode
  useEffect(() => {
    localStorage.setItem("reader_view_mode", viewMode);
  }, [viewMode]);

  // Persist bookmarks per book
  useEffect(() => {
    localStorage.setItem(`reader_bm_${id}`, JSON.stringify(bookmarks));
  }, [bookmarks, id]);

  // Persist highlights per book
  useEffect(() => {
    localStorage.setItem(`reader_hl_${id}`, JSON.stringify(highlights));
  }, [highlights, id]);

  // Execute PDF Document Search
  useEffect(() => {
    if (!searchText.trim() || !pdfDoc) {
      setSearchMatches([]);
      return;
    }
    let active = true;
    setIsSearching(true);
    clearTimeout(searchTimer.current);

    searchTimer.current = setTimeout(async () => {
      const matches = [];
      const query = searchText.toLowerCase();
      try {
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          if (!active) break;
          const page = await pdfDoc.getPage(i);
          const content = await page.getTextContent();
          const str = content.items.map((it) => it.str).join(" ");
          if (str.toLowerCase().includes(query)) {
            matches.push(i);
          }
        }
        if (active) {
          setSearchMatches(matches);
          setSearchMatchIdx(0);
          if (matches.length > 0) {
            jumpToPage(matches[0]);
          }
        }
      } catch (err) {}
      if (active) setIsSearching(false);
    }, 600);

    return () => {
      active = false;
      clearTimeout(searchTimer.current);
    };
  }, [searchText, pdfDoc]);

  // Handle auto-summarize action from Library
  useEffect(() => {
    if (!pdfDoc) return;
    const params = new URLSearchParams(location.search);
    if (params.get("action") === "summarize") {
      // Remove query param to prevent re-firing on refresh
      navigate(`/book/${id}`, { replace: true });
      
      const extractAndSummarize = async () => {
        try {
          // Extract first ~10 pages to give the AI context about the book
          const maxPages = Math.min(10, pdfDoc.numPages);
          let fullText = "";
          for (let i = 1; i <= maxPages; i++) {
            const page = await pdfDoc.getPage(i);
            const content = await page.getTextContent();
            fullText += content.items.map(it => it.str).join(" ") + " ";
          }
          const safeText = fullText.slice(0, 4000); // Prevent massive payloads
          setInitialQuery(`Please write a comprehensive 1-page summary of this book based on the following intro text:\n\n${safeText}`);
          setPanelOpen(true);
        } catch (err) {
          console.error("Failed to extract text for summary", err);
        }
      };
      extractAndSummarize();
    }
  }, [pdfDoc, location.search, navigate, id]);

  function nextMatch() {
    if (searchMatches.length === 0) return;
    const nextIdx = (searchMatchIdx + 1) % searchMatches.length;
    setSearchMatchIdx(nextIdx);
    jumpToPage(searchMatches[nextIdx]);
  }
  
  function prevMatch() {
    if (searchMatches.length === 0) return;
    const prevIdx = (searchMatchIdx - 1 + searchMatches.length) % searchMatches.length;
    setSearchMatchIdx(prevIdx);
    jumpToPage(searchMatches[prevIdx]);
  }

  function exportNotes() {
    let md = `# Reading Notes: ${title}\n\n`;
    
    if (bookmarks.length > 0) {
      md += `## Bookmarks\n`;
      bookmarks.forEach(p => md += `- Page ${p}\n`);
      md += `\n`;
    }

    if (highlights.length > 0) {
      md += `## Highlights\n`;
      highlights.forEach(hl => {
        md += `- **Page ${hl.pageNumber}**: "${hl.text}"\n`;
      });
      md += `\n`;
    }

    const flashcards = JSON.parse(localStorage.getItem(`reader_fc_${id}`)) || [];
    if (flashcards.length > 0) {
      md += `## Flashcards (Q&A)\n`;
      flashcards.forEach(fc => {
        md += `- **Q:** ${fc.front}\n  **A:** ${fc.back}\n`;
      });
      md += `\n`;
    }

    if (!bookmarks.length && !highlights.length && !flashcards.length) {
      alert("No notes or highlights to export yet!");
      return;
    }

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}_Notes.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Active Reading Session Tracking
  useEffect(() => {
    const trackInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        const total = parseInt(localStorage.getItem("reader_total_minutes") || "0", 10);
        localStorage.setItem("reader_total_minutes", (total + 1).toString());
      }
    }, 60000);
    return () => clearInterval(trackInterval);
  }, []);

  // Pomodoro Timer Logic
  useEffect(() => {
    if (!isPomoActive) return;
    const interval = setInterval(() => {
      setPomoTime((t) => {
        if (t <= 1) {
          setIsPomoActive(false);
          const nextIsBreak = !isPomoBreak;
          setIsPomoBreak(nextIsBreak);
          alert(nextIsBreak ? "Time for a 5-minute break! ☕" : "Break is over! Time to focus. 📚");
          return nextIsBreak ? 5 * 60 : 25 * 60;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isPomoActive, isPomoBreak]);

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

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
    
    // Compute aspect ratio first, then set numPages so scroll restoration uses the right height
    pdf.getPage(1).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      setPageRatio(viewport.height / viewport.width);
      
      setNumPages(pdf.numPages);
      updatePageCount(id, pdf.numPages).catch(() => {});
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

  // Selection & quick AI / Highlighting
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

  function addHighlight(color) {
    if (!selection) return;
    const newHl = {
      text: selection,
      color,
      page: currentPage,
      id: Date.now().toString(),
    };
    setHighlights((prev) => [...prev, newHl]);
    setAskButton(null);
    window.getSelection()?.removeAllRanges();
  }

  // Custom Text Renderer for react-pdf to inject <mark> for highlights and search
  const textRenderer = useCallback(
    (textItem) => {
      let content = textItem.str;
      if (!content) return content;

      // 1. Search Query Highlighting
      if (searchText.trim()) {
        const regex = new RegExp(`(${searchText.trim()})`, "gi");
        const parts = content.split(regex);
        if (parts.length > 1) {
          return parts.map((part, i) =>
            regex.test(part) ? <mark key={i} className="search-highlight">{part}</mark> : part
          );
        }
      }

      // 2. Annotation Highlighting
      // (Basic string matching: if this textItem string contains a highlighted text)
      for (const hl of highlights) {
        if (hl.page === currentPage && content.includes(hl.text)) {
          const parts = content.split(hl.text);
          return parts.map((part, i) => (
            <span key={i}>
              {part}
              {i < parts.length - 1 && <mark className={`hl-${hl.color}`}>{hl.text}</mark>}
            </span>
          ));
        }
      }

      return content;
    },
    [searchText, highlights, currentPage]
  );

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
          <button
            className={`toolbar-btn icon-btn ${sidebarTab === "highlights" ? "active" : ""}`}
            onClick={() => setSidebarTab((curr) => (curr === "highlights" ? null : "highlights"))}
            title="My Highlights"
          >
            🖍️
          </button>
          <span className="toolbar-title" title={title}>{title}</span>
        </div>

        {/* Center Page Navigator & Search */}
        <div className="toolbar-center">
          <div className="pdf-search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search PDF…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pdf-search-input"
            />
            {searchText && (
              <div className="pdf-search-controls">
                {isSearching ? (
                  <span className="search-spinner" />
                ) : (
                  <span className="search-matches">
                    {searchMatches.length > 0 ? `${searchMatchIdx + 1}/${searchMatches.length}` : "0"}
                  </span>
                )}
                <button onClick={prevMatch} disabled={searchMatches.length === 0} title="Previous match">↑</button>
                <button onClick={nextMatch} disabled={searchMatches.length === 0} title="Next match">↓</button>
                <button onClick={() => setSearchText("")} title="Clear">✕</button>
              </div>
            )}
          </div>
          
          <div className="toolbar-separator" />

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
              value={themePref}
              onChange={(e) => setThemePref(e.target.value)}
              className="theme-select"
              title="Reading Theme"
            >
              <option value="auto">⏱️ Auto (Day/Night)</option>
              <option value="warm">☀️ Warm</option>
              <option value="sepia">📜 Sepia</option>
              <option value="dark">🌙 Dark</option>
              <option value="oled">🖤 OLED</option>
            </select>
          </div>

          {/* Ambient Sounds Dropdown */}
          <div className="ambient-switcher">
            <select
              value={ambientTrack}
              onChange={(e) => setAmbientTrack(e.target.value)}
              className="theme-select"
              title="Ambient Background Sound"
            >
              <option value="none">🔇 No Sound</option>
              <option value="https://actions.google.com/sounds/v1/weather/rain_heavy_loud.ogg">🌧️ Rain</option>
              <option value="https://actions.google.com/sounds/v1/ambiences/fire.ogg">🔥 Fireplace</option>
              <option value="https://actions.google.com/sounds/v1/ambiences/coffee_shop.ogg">☕ Cafe</option>
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

          {/* Pomodoro Timer */}
          <button
            className={`toolbar-btn pomo-btn ${isPomoActive ? (isPomoBreak ? "break" : "active") : ""}`}
            onClick={() => setIsPomoActive(!isPomoActive)}
            title="Pomodoro Focus Timer (25m Focus / 5m Break)"
          >
            🍅 {formatTime(pomoTime)}
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
        {/* Left Side Drawer: Outline, Bookmarks, Highlights */}
        {sidebarTab && (
          <aside className="reader-sidebar">
            <div className="sidebar-header">
              <h3>
                {sidebarTab === "outline" && "📑 Table of Contents"}
                {sidebarTab === "bookmarks" && "🔖 Saved Bookmarks"}
                {sidebarTab === "highlights" && "🖍️ My Highlights"}
              </h3>
              <div className="sidebar-header-actions">
                {(sidebarTab === "highlights" || sidebarTab === "bookmarks") && (
                  <button onClick={exportNotes} className="export-notes-btn" title="Export as Markdown">
                    📤 Export
                  </button>
                )}
                <button onClick={() => setSidebarTab(null)} className="sidebar-close-btn">
                  ✕
                </button>
              </div>
            </div>

            <div className="sidebar-content">
              {sidebarTab === "outline" && (
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
              )}

              {sidebarTab === "bookmarks" && (
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

              {sidebarTab === "highlights" && (
                highlights.length > 0 ? (
                  <ul className="bookmarks-list">
                    {highlights.map((hl) => (
                      <li key={hl.id} className="bookmark-item highlight-item">
                        <div
                          className="bookmark-click-zone"
                          onClick={() => {
                            jumpToPage(hl.page);
                          }}
                        >
                          <div className={`hl-swatch ${hl.color}`} />
                          <span className="hl-text-preview">"{hl.text}"</span>
                          <span className="bookmark-date">p.{hl.page}</span>
                        </div>
                        <button
                          className="bookmark-delete-btn"
                          onClick={() => setHighlights((prev) => prev.filter((h) => h.id !== hl.id))}
                          title="Remove highlight"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="sidebar-empty">
                    <p>No highlights yet.</p>
                    <p style={{fontSize: 12, marginTop: 8}}>Select any text in the book and choose a color to highlight it.</p>
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
                    customTextRenderer={textRenderer}
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
                        customTextRenderer={textRenderer}
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

      {/* Floating selection action buttons: "Define" + "Ask AI" + Highlights */}
      {askButton && (
        <div className="floating-actions" style={{ left: askButton.x, top: askButton.y - 48 }}>
          <div className="highlight-colors">
            <button className="hl-btn yellow" onClick={() => addHighlight("yellow")} title="Highlight yellow"></button>
            <button className="hl-btn green" onClick={() => addHighlight("green")} title="Highlight green"></button>
            <button className="hl-btn pink" onClick={() => addHighlight("pink")} title="Highlight pink"></button>
            <button className="hl-btn blue" onClick={() => addHighlight("blue")} title="Highlight blue"></button>
          </div>
          <button
            className="define-floating"
            onClick={() => {
              setInitialQuery(`Define this word/phrase clearly and concisely, then give a simple example sentence: "${selection}"`);
              setPanelOpen(true);
              setAskButton(null);
            }}
          >
            📚 Define
          </button>
          <button
            className="ask-ai-floating"
            onClick={() => {
              setInitialQuery("");
              setPanelOpen(true);
              setAskButton(null);
            }}
          >
            ✨ Ask AI
          </button>
        </div>
      )}

      {/* Click-outside overlay to close AI panel */}
      {panelOpen && (
        <div
          className="ai-panel-backdrop"
          onClick={() => setPanelOpen(false)}
        />
      )}

      {/* Interactive AI Assistant Panel */}
      <AIPanel
        ref={aiPanelRef}
        open={panelOpen}
        selectedText={selection}
        initialQuery={initialQuery}
        bookId={id}
        onClose={() => setPanelOpen(false)}
        onQueryConsumed={() => setInitialQuery("")}
      />

      {/* Ambient Audio Player */}
      {ambientTrack !== "none" && (
        <audio src={ambientTrack} autoPlay loop style={{ display: "none" }} />
      )}
    </div>
  );
}
