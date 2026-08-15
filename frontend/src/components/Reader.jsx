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

const RENDER_WIDTH = 720; // base page width in px at zoom = 1
const PAGE_GAP = 20;
const WINDOW_RADIUS = 3; // pages rendered on each side of the current page

export default function Reader() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [numPages, setNumPages] = useState(null);
  const [pageRatio, setPageRatio] = useState(1.294); // height/width fallback ~ US Letter
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [loadError, setLoadError] = useState("");

  const [selection, setSelection] = useState(""); // text currently selected
  const [panelOpen, setPanelOpen] = useState(false);
  const [askButton, setAskButton] = useState(null); // {x, y} or null

  const scrollRef = useRef(null);
  const restoredRef = useRef(false);
  const saveTimer = useRef(null);
  const fileSource = useRef(bookFileSource(id)).current;

  const pageWidth = RENDER_WIDTH * zoom;
  const pageHeight = pageWidth * pageRatio;

  // Load book metadata (title, saved page, saved zoom)
  useEffect(() => {
    getBook(id)
      .then((book) => {
        setTitle(book.title);
        setCurrentPage(book.current_page || 1);
        setZoom(book.zoom || 1.0);
      })
      .catch(() => setLoadError("Couldn't load this book."));
  }, [id]);

  function onDocumentLoad(pdf) {
    setNumPages(pdf.numPages);
    updatePageCount(id, pdf.numPages).catch(() => {});
    pdf.getPage(1).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      setPageRatio(viewport.height / viewport.width);
    });
  }

  // Restore scroll position once we know page height + numPages
  useLayoutEffect(() => {
    if (restoredRef.current || !numPages || !scrollRef.current) return;
    const target = (currentPage - 1) * (pageHeight + PAGE_GAP);
    scrollRef.current.scrollTop = target;
    restoredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, pageHeight]);

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
    if (!scrollRef.current || !numPages) return;
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = (clamped - 1) * (pageHeight + PAGE_GAP);
    }
    saveProgress(clamped, zoom);
  }

  function changeZoom(delta) {
    const next = Math.min(2.2, Math.max(0.6, +(zoom + delta).toFixed(2)));
    setZoom(next);
    saveProgress(currentPage, next);
  }

  // Selection handling: show a small "Ask AI" button near the selected text
  function handleMouseUp() {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text) {
      setAskButton(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setSelection(text);
    setAskButton({ x: rect.left + rect.width / 2, y: rect.top });
  }

  const start = Math.max(1, currentPage - WINDOW_RADIUS);
  const end = Math.min(numPages || 1, currentPage + WINDOW_RADIUS);
  const slots = numPages ? Array.from({ length: numPages }, (_, i) => i + 1) : [];

  return (
    <div className="reader">
      <div className="reader-toolbar">
        <button className="toolbar-icon" onClick={() => navigate("/")} aria-label="Back to library">
          ←
        </button>
        <span className="toolbar-title">{title}</span>

        <div className="toolbar-spacer" />

        <div className="toolbar-group">
          <button onClick={() => jumpToPage(currentPage - 1)} aria-label="Previous page">
            ‹
          </button>
          <span className="toolbar-pagenum">
            {currentPage} / {numPages ?? "…"}
          </span>
          <button onClick={() => jumpToPage(currentPage + 1)} aria-label="Next page">
            ›
          </button>
        </div>

        <div className="toolbar-group">
          <button onClick={() => changeZoom(-0.1)} aria-label="Zoom out">
            −
          </button>
          <span className="toolbar-zoom">{Math.round(zoom * 100)}%</span>
          <button onClick={() => changeZoom(0.1)} aria-label="Zoom in">
            +
          </button>
        </div>

        <button
          className={`toolbar-ai ${panelOpen ? "active" : ""}`}
          onClick={() => setPanelOpen((v) => !v)}
        >
          Ask AI
        </button>
      </div>

      {loadError && <p className="reader-error">{loadError}</p>}

      <div className="reader-scroll" ref={scrollRef} onScroll={handleScroll} onMouseUp={handleMouseUp}>
        <Document
          file={fileSource}
          onLoadSuccess={onDocumentLoad}
          onLoadError={() => setLoadError("Couldn't render this PDF.")}
          loading={<p className="reader-loading">Opening book…</p>}
        >
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
                  />
                ) : (
                  <div className="page-placeholder">{n}</div>
                )}
              </div>
            ))}
          </div>
        </Document>
      </div>

      {askButton && (
        <button
          className="ask-ai-floating"
          style={{ left: askButton.x, top: askButton.y - 44 }}
          onClick={() => {
            setPanelOpen(true);
            setAskButton(null);
          }}
        >
          Ask AI about this
        </button>
      )}

      <AIPanel
        open={panelOpen}
        selectedText={selection}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  );
}
