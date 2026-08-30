import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { fixTextWithAI, transformTextWithAI, listDocuments, createDocument, getDocumentContent, documentVersions, getDocumentVersion, restoreDocument, purgeDocument, getBook, accountKey, logoutUser, saveDocument, deleteDocument, uploadDocument, clearAuthToken } from "../api.js";
import "./Writer.css";
import Dialog from "./Dialog.jsx";
import { safeHtml, plainToHtml, escapeHtml } from "../sanitize.js";
import { Node } from "@tiptap/core";

/* ── SVG icon helpers ─────────────────────────────────── */
const icons = {
  bold: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /></svg>,
  italic: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" /></svg>,
  underline: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" /><line x1="4" y1="21" x2="20" y2="21" /></svg>,
  strike: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><path d="M16 6H8a4 4 0 0 0 0 8h8" /><path d="M8 18h8a4 4 0 0 0 0-8" /></svg>,
  highlight: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>,
  code: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>,
  alignLeft: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></svg>,
  alignCenter: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>,
  alignRight: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="6" y1="18" x2="21" y2="18" /></svg>,
  bulletList: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4" cy="6" r="1.5" fill="currentColor" /><circle cx="4" cy="12" r="1.5" fill="currentColor" /><circle cx="4" cy="18" r="1.5" fill="currentColor" /></svg>,
  orderedList: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" /></svg>,
  quote: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" /><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z" /></svg>,
  hr: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="12" x2="21" y2="12" /><circle cx="7" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="17" cy="12" r="1" fill="currentColor" /></svg>,
  undo: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>,
  redo: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>,
  sparkles: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z" /><path d="M19 15l.88 2.12L22 18l-2.12.88L19 21l-.88-2.12L16 18l2.12-.88z" /></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
  print: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>,
  fullscreen: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>,
  exitFullscreen: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>,
  clear: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  back: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>,
  folder: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>,
  download: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  wand: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" /><path d="M17.8 11.8L19 13" /><path d="M15 9h.01" /><path d="M17.8 6.2L19 5" /><path d="m3 21 9-9" /><path d="M12.2 6.2L11 5" /></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
};
const AI_OPERATIONS = [{
  id: "paraphrase",
  label: "Paraphrase",
  icon: "🔄",
  desc: "Reword while keeping meaning"
}, {
  id: "formal",
  label: "Make Formal",
  icon: "🎩",
  desc: "Professional tone"
}, {
  id: "casual",
  label: "Make Casual",
  icon: "😊",
  desc: "Friendly tone"
}, {
  id: "expand",
  label: "Expand",
  icon: "📖",
  desc: "Add more detail"
}, {
  id: "shorten",
  label: "Shorten",
  icon: "✂️",
  desc: "Make more concise"
}, {
  id: "summarize",
  label: "Summarize",
  icon: "📋",
  desc: "2-3 sentence summary"
}, {
  id: "bullets",
  label: "To Bullets",
  icon: "📌",
  desc: "Convert to bullet points"
}];
const HIGHLIGHT_COLORS = [{
  name: "Yellow",
  value: "#fef08a"
}, {
  name: "Green",
  value: "#bbf7d0"
}, {
  name: "Blue",
  value: "#bfdbfe"
}, {
  name: "Pink",
  value: "#fbcfe8"
}, {
  name: "Orange",
  value: "#fed7aa"
}, {
  name: "Purple",
  value: "#e9d5ff"
}];
const TEXT_COLORS = [{
  name: "Default",
  value: "inherit"
}, {
  name: "Red",
  value: "#ef4444"
}, {
  name: "Orange",
  value: "#f97316"
}, {
  name: "Green",
  value: "#22c55e"
}, {
  name: "Blue",
  value: "#3b82f6"
}, {
  name: "Purple",
  value: "#a855f7"
}, {
  name: "Pink",
  value: "#ec4899"
}];

/* ── Find & Replace Panel ─────────────────────────────── */
function FindReplacePanel({
  editor,
  onClose
}) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  function countMatches() {
    if (!editor || !findText) {
      setMatchCount(0);
      return;
    }
    const text = editor.getText();
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = text.match(regex);
    setMatchCount(matches ? matches.length : 0);
  }
  useEffect(() => {
    countMatches();
  }, [findText, editor]);
  function replaceMatches(all) {
    if (!editor || !findText) return;
    const matches = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      let i = node.text.toLowerCase().indexOf(findText.toLowerCase());
      while (i >= 0) {
        matches.push({
          from: pos + i,
          to: pos + i + findText.length
        });
        i = node.text.toLowerCase().indexOf(findText.toLowerCase(), i + findText.length);
      }
    });
    const chosen = all ? matches : matches.slice(0, 1);
    let transaction = editor.state.tr;
    for (const match of chosen.reverse()) transaction = transaction.insertText(replaceText, match.from, match.to);
    editor.view.dispatch(transaction);
    countMatches();
  }
  const handleReplace = () => replaceMatches(false),
    handleReplaceAll = () => replaceMatches(true);
  return <div className="find-replace-panel">
      <div className="find-replace-row">
        <div className="find-input-wrap">{icons.search}<input type="text" aria-label="Find text" placeholder="Find…" value={findText} onChange={e => setFindText(e.target.value)} autoFocus />{findText && <span className="find-count">{matchCount} {matchCount === 1 ? "match" : "matches"}</span>}</div>
        <div className="find-input-wrap"><input type="text" aria-label="Replace with" placeholder="Replace with…" value={replaceText} onChange={e => setReplaceText(e.target.value)} /></div>
        <button className="find-action-btn" onClick={handleReplace} disabled={!findText}>Replace</button>
        <button className="find-action-btn accent" onClick={handleReplaceAll} disabled={!findText}>Replace All</button>
        <button aria-label="Close find and replace" className="find-close-btn" onClick={onClose}>{icons.clear}</button>
      </div>
    </div>;
}

/* ── AI Tools Panel ───────────────────────────────────── */
/* ── Keyboard Shortcuts Modal ─────────────────────────── */
function ShortcutsModal({
  onClose
}) {
  const shortcuts = [{
    keys: "⌘ B",
    action: "Bold"
  }, {
    keys: "⌘ I",
    action: "Italic"
  }, {
    keys: "⌘ U",
    action: "Underline"
  }, {
    keys: "⌘ ⇧ S",
    action: "Strikethrough"
  }, {
    keys: "⌘ Z",
    action: "Undo"
  }, {
    keys: "⌘ ⇧ Z",
    action: "Redo"
  }, {
    keys: "⌘ ⇧ 7",
    action: "Ordered List"
  }, {
    keys: "⌘ ⇧ 8",
    action: "Bullet List"
  }, {
    keys: "⌘ F",
    action: "Find & Replace"
  }];
  return <Dialog title="Keyboard shortcuts" onClose={onClose}><p>Use Ctrl instead of ⌘ on Windows and Linux.</p><div className="shortcuts-grid">{shortcuts.map(s => <div key={s.keys} className="shortcut-item"><kbd>{s.keys}</kbd><span>{s.action}</span></div>)}</div></Dialog>;
}

/* ── Main Toolbar ─────────────────────────────────────── */
function WriterToolbar({
  editor,
  onFix,
  fixing,
  onToggleFindReplace,
  showFindReplace,
  onToggleAITools,
  showAITools,
  onToggleFullscreen,
  isFullscreen,
  onPrint,
  showHighlightPicker,
  setShowHighlightPicker,
  showTextColorPicker,
  setShowTextColorPicker
}) {
  if (!editor) return null;
  return <div className="writer-toolbar-container"><div className="writer-toolbar">
      <select aria-label="Paragraph style" className="toolbar-heading-select" value={editor.isActive("heading", {
        level: 1
      }) ? "h1" : editor.isActive("heading", {
        level: 2
      }) ? "h2" : editor.isActive("heading", {
        level: 3
      }) ? "h3" : "p"} onChange={e => {
        const v = e.target.value;
        if (v === "p") editor.chain().focus().setParagraph().run();else editor.chain().focus().toggleHeading({
          level: parseInt(v[1])
        }).run();
      }}>
        <option value="p">Normal Text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
      </select>
      <div className="toolbar-separator" />
      <button className={`toolbar-btn ${editor.isActive("bold") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (⌘B)">{icons.bold}</button>
      <button className={`toolbar-btn ${editor.isActive("italic") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (⌘I)">{icons.italic}</button>
      <button className={`toolbar-btn ${editor.isActive("underline") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (⌘U)">{icons.underline}</button>
      <button className={`toolbar-btn ${editor.isActive("strike") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">{icons.strike}</button>
      <div className="toolbar-dropdown-wrap">
        <button className={`toolbar-btn ${editor.isActive("highlight") ? "active" : ""}`} onClick={() => setShowHighlightPicker(!showHighlightPicker)} title="Highlight">{icons.highlight}</button>
        {showHighlightPicker && <div className="toolbar-color-picker">{HIGHLIGHT_COLORS.map(c => <button key={c.value} className="color-swatch" style={{
            background: c.value
          }} title={c.name} onClick={() => {
            editor.chain().focus().toggleHighlight({
              color: c.value
            }).run();
            setShowHighlightPicker(false);
          }} />)}<button className="color-swatch remove-color" title="Remove" onClick={() => {
            editor.chain().focus().unsetHighlight().run();
            setShowHighlightPicker(false);
          }}>{icons.clear}</button></div>}
      </div>
      <div className="toolbar-dropdown-wrap">
        <button className="toolbar-btn" onClick={() => setShowTextColorPicker(!showTextColorPicker)} title="Text Color"><span style={{
            borderBottom: "3px solid var(--accent)",
            paddingBottom: "1px",
            fontWeight: 700,
            fontSize: "13px"
          }}>A</span></button>
        {showTextColorPicker && <div className="toolbar-color-picker">{TEXT_COLORS.map(c => <button key={c.value} className="color-swatch text-color-swatch" style={{
            color: c.value === "inherit" ? "var(--text)" : c.value
          }} title={c.name} onClick={() => {
            if (c.value === "inherit") editor.chain().focus().unsetColor().run();else editor.chain().focus().setColor(c.value).run();
            setShowTextColorPicker(false);
          }}>A</button>)}</div>}
      </div>
      <button className={`toolbar-btn ${editor.isActive("code") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline Code">{icons.code}</button>
      <div className="toolbar-separator" />
      <button className={`toolbar-btn ${editor.isActive({
        textAlign: "left"
      }) ? "active" : ""}`} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Left">{icons.alignLeft}</button>
      <button className={`toolbar-btn ${editor.isActive({
        textAlign: "center"
      }) ? "active" : ""}`} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Center">{icons.alignCenter}</button>
      <button className={`toolbar-btn ${editor.isActive({
        textAlign: "right"
      }) ? "active" : ""}`} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Right">{icons.alignRight}</button>
      <div className="toolbar-separator" />
      <button className={`toolbar-btn ${editor.isActive("bulletList") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List">{icons.bulletList}</button>
      <button className={`toolbar-btn ${editor.isActive("orderedList") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered List">{icons.orderedList}</button>
      <button className={`toolbar-btn ${editor.isActive("blockquote") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">{icons.quote}</button>
      <button className="toolbar-btn" onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Rule">{icons.hr}</button>
      <div className="toolbar-separator" />
      <button className="toolbar-btn" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">{icons.undo}</button>
      <button className="toolbar-btn" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">{icons.redo}</button>
      <div className="toolbar-separator" />
      <button className={`toolbar-btn ${showFindReplace ? "active" : ""}`} onClick={onToggleFindReplace} title="Find & Replace">{icons.search}</button>
      <button className="toolbar-btn" onClick={onPrint} title="Print">{icons.print}</button>
      <button className="toolbar-btn" onClick={onToggleFullscreen} title="Focus Mode">{isFullscreen ? icons.exitFullscreen : icons.fullscreen}</button>
      <div className="toolbar-separator" />
      <button className={`toolbar-btn toolbar-btn-ai-toggle ${showAITools ? "active" : ""}`} onClick={onToggleAITools} title="AI Tools">{icons.wand} AI Tools</button>
      <button className={`toolbar-btn toolbar-btn-fix ${fixing ? "fixing" : ""}`} onClick={onFix} disabled={fixing} title="Fix all errors with AI">
        {fixing ? <><span className="fix-spinner" /> Reviewing…</> : <>{icons.sparkles} Review grammar</>}
      </button>
    </div></div>;
}

/* ══════════════════════════════════════════════════════════
   WRITER COMPONENT
   ══════════════════════════════════════════════════════════ */
const SafeImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: {
        default: ''
      },
      alt: {
        default: ''
      }
    };
  },
  parseHTML() {
    return [{
      tag: 'img[src]'
    }];
  },
  renderHTML({
    HTMLAttributes
  }) {
    return ['img', HTMLAttributes];
  }
});
const Table = Node.create({
  name: 'table',
  group: 'block',
  content: 'tableRow+',
  parseHTML() {
    return [{
      tag: 'table'
    }];
  },
  renderHTML() {
    return ['table', ['tbody', 0]];
  }
});
const TableRow = Node.create({
  name: 'tableRow',
  content: '(tableCell | tableHeader)+',
  parseHTML() {
    return [{
      tag: 'tr'
    }];
  },
  renderHTML() {
    return ['tr', 0];
  }
});
const TableCell = Node.create({
  name: 'tableCell',
  content: 'block+',
  parseHTML() {
    return [{
      tag: 'td'
    }];
  },
  renderHTML() {
    return ['td', 0];
  }
});
const TableHeader = Node.create({
  name: 'tableHeader',
  content: 'block+',
  parseHTML() {
    return [{
      tag: 'th'
    }];
  },
  renderHTML() {
    return ['th', 0];
  }
});
export default function Writer() {
  const navigate = useNavigate(),
    fileInputRef = useRef(null),
    saveRef = useRef(null),
    dirtyRef = useRef(false),
    versionRef = useRef(0),
    busyRef = useRef(false),
    currentRef = useRef(null),
    titleRef = useRef('Untitled Document'),
    savedSnapshot = useRef(''),
    aiSnapshot = useRef(null);
  const [currentDocId, setCurrentDocId] = useState(null),
    [docTitle, setDocTitle] = useState('Untitled Document'),
    [docs, setDocs] = useState([]),
    [isEditing, setIsEditing] = useState(false),
    [loading, setLoading] = useState(false),
    [banner, setBanner] = useState(null),
    [saveStatus, setSaveStatus] = useState('Saved'),
    [fixing, setFixing] = useState(false),
    [aiResult, setAIResult] = useState(null),
    [showAITools, setShowAITools] = useState(false),
    [showFindReplace, setShowFindReplace] = useState(false),
    [isFullscreen, setIsFullscreen] = useState(false),
    [showHighlightPicker, setShowHighlightPicker] = useState(false),
    [showTextColorPicker, setShowTextColorPicker] = useState(false),
    [showShortcuts, setShowShortcuts] = useState(false),
    [versions, setVersions] = useState(null),
    [recovery, setRecovery] = useState(null),
    [trash, setTrash] = useState(false),
    [confirm, setConfirm] = useState(null),
    [words, setWords] = useState(0),
    [search, setSearch] = useState('');
  const editor = useEditor({
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': 'Document content',
        'aria-multiline': 'true'
      }
    },
    extensions: [StarterKit.configure({
      heading: {
        levels: [1, 2, 3]
      }
    }), TextAlign.configure({
      types: ['heading', 'paragraph']
    }), Placeholder.configure({
      placeholder: 'A thought worth keeping…'
    }), Highlight.configure({
      multicolor: true
    }), TextStyle, Color, SafeImage, Table, TableRow, TableCell, TableHeader],
    content: '',
    onUpdate: ({
      editor
    }) => {
      dirtyRef.current = true;
      setWords(editor.getText().trim().split(/\s+/).filter(Boolean).length);
      setSaveStatus('Unsaved changes');
      cacheDraft(editor.getHTML());
      clearTimeout(saveRef.current);
      saveRef.current = setTimeout(() => persist(), 1800);
    }
  });
  function cacheDraft(html) {
    if (!currentRef.current) return;
    try {
      localStorage.setItem(accountKey(`draft:${currentRef.current}`), JSON.stringify({
        html,
        title: titleRef.current,
        revision: versionRef.current,
        updatedAt: Date.now()
      }));
    } catch {
      setBanner({
        type: 'error',
        msg: 'Device storage is full. Save or export this document now.'
      });
    }
  }
  async function refreshDocs() {
    try {
      setDocs(await listDocuments(trash));
    } catch (e) {
      setBanner({
        type: 'error',
        msg: e.message
      });
    }
  }
  useEffect(() => {
    refreshDocs();
  }, [trash]);
  useEffect(() => {
    if (!editor) return;
    const docId = new URLSearchParams(location.search).get('doc');
    if (docId) openDocument({
      id: docId,
      title: 'Document'
    });
  }, [editor]);
  useEffect(() => {
    const before = e => {
      if (dirtyRef.current) {
        cacheDraft(editor?.getHTML() || '');
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const retry = () => persist();
    window.addEventListener('beforeunload', before);
    window.addEventListener('online', retry);
    return () => {
      clearTimeout(saveRef.current);
      window.removeEventListener('beforeunload', before);
      window.removeEventListener('online', retry);
    };
  }, [editor]);
  useEffect(() => {
    function handle(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        persist();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && isEditing) {
        e.preventDefault();
        setShowFindReplace(v => !v);
      }
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isEditing, editor]);
  async function persist() {
    if (!editor || !currentRef.current || !dirtyRef.current) return true;
    if (busyRef.current) return false;
    busyRef.current = true;
    const docId = currentRef.current,
      html = safeHtml(editor.getHTML()),
      title = titleRef.current,
      snapshot = html + '\n' + title;
    setSaveStatus('Saving…');
    try {
      const result = await saveDocument(docId, html, title, versionRef.current);
      if (currentRef.current === docId) {
        versionRef.current = result.revision;
        savedSnapshot.current = snapshot;
        dirtyRef.current = safeHtml(editor.getHTML()) + '\n' + titleRef.current !== snapshot;
        setSaveStatus(dirtyRef.current ? 'Unsaved changes' : 'Saved to cloud');
        if (!dirtyRef.current) localStorage.removeItem(accountKey(`draft:${docId}`));else {
          cacheDraft(editor.getHTML());
          clearTimeout(saveRef.current);
          saveRef.current = setTimeout(() => persist(), 1800);
        }
      }
      return !dirtyRef.current;
    } catch (e) {
      cacheDraft(html);
      setSaveStatus(e.status === 409 ? 'Conflict · draft safe on this device' : 'Offline / save failed · draft safe');
      setBanner({
        type: 'error',
        msg: e.message
      });
      return false;
    } finally {
      busyRef.current = false;
    }
  }
  async function decodeContent(data) {
    if (data.format === 'html') return safeHtml(data.html || '<p></p>');
    const mammoth = await import('mammoth');
    const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
    const result = await mammoth.convertToHtml({
      arrayBuffer: bytes.buffer
    }, {
      convertImage: mammoth.images.imgElement(async image => ({
        src: 'data:' + image.contentType + ';base64,' + (await image.read('base64'))
      }))
    });
    return safeHtml(result.value);
  }
  function activate(docId, title, html, revision) {
    currentRef.current = docId;
    titleRef.current = title;
    versionRef.current = revision;
    setCurrentDocId(docId);
    setDocTitle(title);
    editor.commands.setContent(safeHtml(html), {
      emitUpdate: false
    });
    setWords(editor.getText().trim().split(/\s+/).filter(Boolean).length);
    dirtyRef.current = false;
    savedSnapshot.current = safeHtml(html) + '\n' + title;
    setIsEditing(true);
    setSaveStatus('Saved');
    setAIResult(null);
  }
  async function openDocument(doc) {
    if (dirtyRef.current && !(await persist())) return;
    setLoading(true);
    try {
      const data = await getDocumentContent(doc.id),
        html = await decodeContent(data);
      activate(doc.id, data.title || doc.title, html, data.revision);
      const draft = JSON.parse(localStorage.getItem(accountKey(`draft:${doc.id}`)) || 'null');
      if (draft && (draft.html !== html || draft.title !== data.title)) setRecovery(draft);
    } catch (e) {
      setBanner({
        type: 'error',
        msg: e.message
      });
    } finally {
      setLoading(false);
    }
  }
  async function newDocument() {
    if (dirtyRef.current && !(await persist())) return;
    try {
      const doc = await createDocument('Untitled Document', '<p></p>');
      activate(doc.id, doc.title, '<p></p>', doc.revision);
      await refreshDocs();
    } catch (e) {
      setBanner({
        type: 'error',
        msg: e.message
      });
    }
  }
  async function upload(file) {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) {
      setBanner({
        type: 'error',
        msg: 'Choose a DOCX file. Legacy DOC files must be converted first.'
      });
      return;
    }
    if (dirtyRef.current && !(await persist())) return;
    setLoading(true);
    try {
      const doc = await uploadDocument(file, file.name.replace(/\.docx$/i, ''));
      const mammoth = await import('mammoth'),
        result = await mammoth.convertToHtml({
          arrayBuffer: await file.arrayBuffer()
        }, {
          convertImage: mammoth.images.imgElement(async image => ({
            src: 'data:' + image.contentType + ';base64,' + (await image.read('base64'))
          }))
        });
      const html = safeHtml(result.value);
      activate(doc.id, doc.title, html, doc.revision);
      dirtyRef.current = true;
      await persist();
      await refreshDocs();
      if (result.messages?.length) setBanner({
        type: 'info',
        msg: 'Import complete. Some source formatting may differ; the original DOCX is preserved in version history.'
      });
    } catch (e) {
      setBanner({
        type: 'error',
        msg: e.message
      });
    } finally {
      setLoading(false);
    }
  }
  async function leave() {
    if (dirtyRef.current && !(await persist())) return;
    setIsEditing(false);
    setCurrentDocId(null);
    currentRef.current = null;
    await refreshDocs();
  }
  async function runAI(operation) {
    if (!editor || fixing) return;
    const {
        from,
        to
      } = editor.state.selection,
      text = editor.state.doc.textBetween(from, to, '\n\n') || editor.getText({
        blockSeparator: '\n\n'
      });
    if (!text.trim()) return;
    aiSnapshot.current = {
      html: editor.getHTML(),
      from,
      to,
      selection: from !== to,
      text
    };
    setFixing(true);
    setAIResult(null);
    try {
      const response = operation === 'fix' ? await fixTextWithAI(text) : await transformTextWithAI(text, operation);
      setAIResult({
        text: response.fixedText || response.result,
        operation
      });
    } catch (e) {
      setBanner({
        type: 'error',
        msg: e.message
      });
    } finally {
      setFixing(false);
    }
  }
  function applyAI() {
    const snapshot = aiSnapshot.current;
    if (editor.getHTML() !== snapshot.html) {
      setBanner({
        type: 'error',
        msg: 'The document changed while AI was working. Copy the suggestion or run it again; no text was replaced.'
      });
      return;
    }
    if (snapshot.selection) {
      editor.chain().focus().insertContentAt({
        from: snapshot.from,
        to: snapshot.to
      }, {
        type: 'text',
        text: aiResult.text
      }).run();
      setAIResult(null);
      return;
    }
    const blocks = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock) blocks.push({
        node,
        pos
      });
    });
    const replacements = aiResult.text.split(/\n\s*\n/);
    if (replacements.length !== blocks.length) {
      setBanner({
        type: 'error',
        msg: 'The suggestion changes the paragraph structure. Use “Save as new document” to preserve your original formatting.'
      });
      return;
    }
    let transaction = editor.state.tr;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const {
          node,
          pos
        } = blocks[i],
        old = node.textContent,
        next = replacements[i];
      let prefix = 0,
        suffix = 0;
      while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
      while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
      if (old !== next) transaction = transaction.insertText(next.slice(prefix, next.length - suffix), pos + 1 + prefix, pos + 1 + old.length - suffix);
    }
    editor.view.dispatch(transaction);
    setAIResult(null);
  }
  async function exportDocx() {
    try {
      const module = await import('../docxExport.js');
      await module.downloadDocx(editor.getJSON(), docTitle);
    } catch (e) {
      setBanner({
        type: 'error',
        msg: `Export failed: ${e.message}`
      });
    }
  }
  function print() {
    const w = window.open('', '_blank');
    if (!w) {
      setBanner({
        type: 'error',
        msg: 'Allow popups to open the print preview.'
      });
      return;
    }
    w.opener = null;
    w.document.write(`<!doctype html><html><head><title>${escapeHtml(docTitle)}</title><style>body{font:16px/1.7 Georgia;margin:40px;max-width:750px}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px}img{max-width:100%}</style></head><body>${safeHtml(editor.getHTML())}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }
  async function act(fn) {
    try {
      await fn();
      await refreshDocs();
    } catch (e) {
      setBanner({
        type: 'error',
        msg: e.message
      });
    }
  }
  return <main className={`page writer-modern ${isFullscreen ? 'writer-focus' : ''}`}><header className="page-header"><div><div className="eyebrow">Keep a thought, build an idea</div><h1>{isEditing ? 'Your writing space' : 'Writer'}</h1></div><div className="action-row">{isEditing ? <><button onClick={leave}>← Documents</button><button className="primary" onClick={persist}>Save now</button><button onClick={exportDocx}>Export DOCX</button><button onClick={() => act(async () => {
            const html = safeHtml(editor.getHTML()),
              title = titleRef.current + ' (copy)';
            const copy = await createDocument(title, html);
            activate(copy.id, title, html, copy.revision);
            await refreshDocs();
          })}>Save as new copy</button><button onClick={() => act(async () => setVersions(await documentVersions(currentDocId)))}>Version history</button></> : <><button onClick={() => navigate('/')}>← Library</button><button onClick={() => setTrash(!trash)}>{trash ? 'Active documents' : 'Trash'}</button><button onClick={() => fileInputRef.current.click()}>Import DOCX</button><button className="primary" onClick={newDocument}>+ New document</button></>}</div></header><input type="file" hidden ref={fileInputRef} accept=".docx" onChange={e => {
      upload(e.target.files[0]);
      e.target.value = '';
    }} />{banner && <div className={`notice ${banner.type === 'error' ? 'error' : ''}`} role="status"><span>{banner.msg}</span><button aria-label="Dismiss message" onClick={() => setBanner(null)}>×</button></div>}{loading && <p role="status">Opening document…</p>}
 {isEditing ? <><div className="document-title-row"><label className="sr-only" htmlFor="document-title">Document title</label><input id="document-title" className="document-title" value={docTitle} maxLength={300} onChange={e => {
          setDocTitle(e.target.value);
          titleRef.current = e.target.value;
          dirtyRef.current = true;
          cacheDraft(editor.getHTML());
          setSaveStatus('Unsaved changes');
          clearTimeout(saveRef.current);
          saveRef.current = setTimeout(persist, 1800);
        }} /><span role="status">{saveStatus}</span><small>{words} words</small></div><WriterToolbar editor={editor} onFix={() => runAI('fix')} fixing={fixing} onToggleFindReplace={() => setShowFindReplace(!showFindReplace)} showFindReplace={showFindReplace} onToggleAITools={() => setShowAITools(!showAITools)} showAITools={showAITools} onToggleFullscreen={() => setIsFullscreen(!isFullscreen)} isFullscreen={isFullscreen} onPrint={print} showHighlightPicker={showHighlightPicker} setShowHighlightPicker={setShowHighlightPicker} showTextColorPicker={showTextColorPicker} setShowTextColorPicker={setShowTextColorPicker} />{showFindReplace && <FindReplacePanel editor={editor} onClose={() => setShowFindReplace(false)} />}<div className="writer-editor-layout"><div className="writing-paper"><EditorContent editor={editor} /></div>{showAITools && <aside className="writing-tools"><h2>AI suggestions</h2><p>Selected text, or the whole document, is sent to Gemini. Review every suggestion before applying it.</p>{AI_OPERATIONS.map(op => <button key={op.id} disabled={fixing} onClick={() => runAI(op.id)}>{op.label}</button>)}<button disabled={fixing} onClick={() => runAI('fix')}>Proofread</button><button onClick={() => setShowShortcuts(true)}>Keyboard shortcuts</button></aside>}</div>{aiResult && <section className="ai-review"><h2>Review suggestion</h2><div className="diff-grid"><div><h3>Original</h3><p className="preserve-lines">{aiSnapshot.current.text}</p></div><div><h3>Suggested</h3><p className="preserve-lines">{aiResult.text}</p></div></div><div className="action-row"><button className="primary" onClick={applyAI}>Apply reviewed changes</button><button onClick={() => act(async () => {
            await createDocument(`${docTitle} — AI draft`, plainToHtml(aiResult.text));
            setAIResult(null);
            setBanner({
              type: 'info',
              msg: 'Saved as a separate document. Your original is unchanged.'
            });
          })}>Save as new document</button><button onClick={() => setAIResult(null)}>Discard</button></div></section>}</> : <><input aria-label="Search documents" placeholder="Search your documents…" value={search} onChange={e => setSearch(e.target.value)} /><div className="document-grid">{docs.filter(d => d.title.toLowerCase().includes(search.toLowerCase())).map(d => <article key={d.id}><button className="document-open" onClick={() => !trash && openDocument(d)}><span>▤</span><h2>{d.title}</h2><p>{d.word_count || 0} words · Updated {new Date(d.updated_at + 'Z').toLocaleDateString()}</p></button><div className="action-row">{trash ? <><button onClick={() => act(() => restoreDocument(d.id))}>Restore</button><button onClick={() => setConfirm({
                title: 'Delete document forever?',
                action: () => purgeDocument(d.id)
              })}>Delete forever</button></> : <button onClick={() => setConfirm({
              title: 'Move document to trash?',
              action: () => deleteDocument(d.id)
            })}>Trash</button>}</div></article>)}</div>{!docs.length && <section className="empty-state"><h2>{trash ? 'Trash is empty' : 'Start with a blank page'}</h2><p>Create a document or import a DOCX file. Originals and previous saves are preserved.</p></section>}</>}
 {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}{versions && <Dialog title="Document version history" onClose={() => setVersions(null)}><p>Restoring an earlier version creates a new save. It never removes later versions.</p>{!versions.length && <p>No previous versions yet.</p>}{versions.map(v => <div className="list-row" key={v.id}><span>Revision {v.revision} · {v.word_count} words · {v.created_at}</span><button onClick={() => act(async () => {
          if (dirtyRef.current && !(await persist())) return;
          const data = await getDocumentVersion(currentDocId, v.id);
          editor.commands.setContent(await decodeContent(data));
          await persist();
          setVersions(null);
        })}>Restore this version</button></div>)}</Dialog>}{recovery && <Dialog title="A recovery draft is available" onClose={() => setRecovery(null)}><p>A local draft differs from the cloud copy. Recover it into a new document so neither version is overwritten.</p><button className="primary" onClick={() => act(async () => {
        const doc = await createDocument(`${recovery.title} — Recovered`, safeHtml(recovery.html));
        setRecovery(null);
        await openDocument(doc);
      })}>Recover as new document</button><button onClick={() => {
        localStorage.removeItem(accountKey(`draft:${currentDocId}`));
        setRecovery(null);
      }}>Keep cloud version</button></Dialog>}{confirm && <Dialog title={confirm.title} onClose={() => setConfirm(null)}><p>{confirm.title.includes('forever') ? 'This removes the document and all saved versions permanently.' : 'You can restore it from Trash.'}</p><button onClick={() => setConfirm(null)}>Cancel</button><button className="primary" onClick={() => {
        const fn = confirm.action;
        setConfirm(null);
        act(fn);
      }}>Confirm</button></Dialog>}</main>;
}
