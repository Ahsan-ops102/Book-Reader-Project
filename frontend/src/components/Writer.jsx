import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import {
  fixTextWithAI, transformTextWithAI,
  listDocuments, createDocument, getDocumentContent,
  saveDocument, deleteDocument, uploadDocument,
} from "../api.js";
import "./Writer.css";

/* ── SVG icon helpers ─────────────────────────────────── */
const icons = {
  bold: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>,
  italic: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>,
  underline: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>,
  strike: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><path d="M16 6H8a4 4 0 0 0 0 8h8"/><path d="M8 18h8a4 4 0 0 0 0-8"/></svg>,
  highlight: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  code: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  alignLeft: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>,
  alignCenter: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>,
  alignRight: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>,
  bulletList: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg>,
  orderedList: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/></svg>,
  quote: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>,
  hr: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="12" x2="21" y2="12"/><circle cx="7" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="17" cy="12" r="1" fill="currentColor"/></svg>,
  undo: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>,
  redo: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  sparkles: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z"/><path d="M19 15l.88 2.12L22 18l-2.12.88L19 21l-.88-2.12L16 18l2.12-.88z"/></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  print: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>,
  fullscreen: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>,
  exitFullscreen: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>,
  clear: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  back: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  folder: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  download: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  wand: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2L19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2L11 5"/></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
};

const AI_OPERATIONS = [
  { id: "paraphrase", label: "Paraphrase", icon: "🔄", desc: "Reword while keeping meaning" },
  { id: "formal", label: "Make Formal", icon: "🎩", desc: "Professional tone" },
  { id: "casual", label: "Make Casual", icon: "😊", desc: "Friendly tone" },
  { id: "expand", label: "Expand", icon: "📖", desc: "Add more detail" },
  { id: "shorten", label: "Shorten", icon: "✂️", desc: "Make more concise" },
  { id: "summarize", label: "Summarize", icon: "📋", desc: "2-3 sentence summary" },
  { id: "bullets", label: "To Bullets", icon: "📌", desc: "Convert to bullet points" },
];

const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#fef08a" }, { name: "Green", value: "#bbf7d0" },
  { name: "Blue", value: "#bfdbfe" }, { name: "Pink", value: "#fbcfe8" },
  { name: "Orange", value: "#fed7aa" }, { name: "Purple", value: "#e9d5ff" },
];

const TEXT_COLORS = [
  { name: "Default", value: "inherit" }, { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" }, { name: "Green", value: "#22c55e" },
  { name: "Blue", value: "#3b82f6" }, { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
];

/* ── Find & Replace Panel ─────────────────────────────── */
function FindReplacePanel({ editor, onClose }) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  function countMatches() {
    if (!editor || !findText) { setMatchCount(0); return; }
    const text = editor.getText();
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = text.match(regex);
    setMatchCount(matches ? matches.length : 0);
  }
  useEffect(() => { countMatches(); }, [findText, editor]);
  function handleReplace() { if (!editor || !findText) return; const html = editor.getHTML(); const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); editor.commands.setContent(html.replace(regex, replaceText)); countMatches(); }
  function handleReplaceAll() { if (!editor || !findText) return; const html = editor.getHTML(); const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"); editor.commands.setContent(html.replace(regex, replaceText)); countMatches(); }
  return (
    <div className="find-replace-panel">
      <div className="find-replace-row">
        <div className="find-input-wrap">{icons.search}<input type="text" placeholder="Find…" value={findText} onChange={(e) => setFindText(e.target.value)} autoFocus />{findText && <span className="find-count">{matchCount} {matchCount === 1 ? "match" : "matches"}</span>}</div>
        <div className="find-input-wrap"><input type="text" placeholder="Replace with…" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} /></div>
        <button className="find-action-btn" onClick={handleReplace} disabled={!findText}>Replace</button>
        <button className="find-action-btn accent" onClick={handleReplaceAll} disabled={!findText}>Replace All</button>
        <button className="find-close-btn" onClick={onClose}>{icons.clear}</button>
      </div>
    </div>
  );
}

/* ── AI Tools Panel ───────────────────────────────────── */
function AIToolsPanel({ editor, onClose }) {
  const [processing, setProcessing] = useState(null);
  const [result, setResult] = useState(null);
  async function runOp(opId) {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, "\n");
    const text = selectedText || editor.getText();
    if (!text.trim()) return;
    setProcessing(opId); setResult(null);
    try {
      const { result: transformed } = await transformTextWithAI(text, opId);
      setResult({ opId, text: transformed, wasSelection: !!selectedText });
    } catch (err) { setResult({ opId, error: err.message || "Failed" }); }
    finally { setProcessing(null); }
  }
  function applyResult() {
    if (!result || result.error || !editor) return;
    if (result.wasSelection) {
      editor.chain().focus().deleteSelection().insertContent(result.text.split("\n").map(p => `<p>${p}</p>`).join("")).run();
    } else {
      const paragraphs = result.text.split(/\n\n+/);
      const html = paragraphs.map(p => { const lines = p.split("\n").map(l => l.trim()).filter(Boolean); return `<p>${lines.join("<br>")}</p>`; }).join("");
      editor.commands.setContent(html);
    }
    setResult(null);
  }
  return (
    <div className="ai-tools-panel">
      <div className="ai-tools-header"><span className="ai-tools-title">{icons.wand} AI Writing Tools</span><button className="find-close-btn" onClick={onClose}>{icons.clear}</button></div>
      <p className="ai-tools-hint">Select text to transform a portion, or use on the entire document.</p>
      <div className="ai-ops-grid">
        {AI_OPERATIONS.map(op => (
          <button key={op.id} className={`ai-op-card ${processing === op.id ? "processing" : ""}`} onClick={() => runOp(op.id)} disabled={!!processing}>
            <span className="ai-op-icon">{op.icon}</span><span className="ai-op-label">{op.label}</span><span className="ai-op-desc">{op.desc}</span>
            {processing === op.id && <span className="ai-op-spinner" />}
          </button>
        ))}
      </div>
      {result && (
        <div className={`ai-result-box ${result.error ? "error" : ""}`}>
          {result.error ? <p className="ai-result-error">⚠️ {result.error}</p> : (<>
            <p className="ai-result-label">✨ {AI_OPERATIONS.find(o => o.id === result.opId)?.label} Result:</p>
            <div className="ai-result-preview">{result.text}</div>
            <div className="ai-result-actions"><button className="ai-result-apply" onClick={applyResult}>Apply to Document</button><button className="ai-result-discard" onClick={() => setResult(null)}>Discard</button></div>
          </>)}
        </div>
      )}
    </div>
  );
}

/* ── Keyboard Shortcuts Modal ─────────────────────────── */
function ShortcutsModal({ onClose }) {
  const shortcuts = [
    { keys: "⌘ B", action: "Bold" }, { keys: "⌘ I", action: "Italic" }, { keys: "⌘ U", action: "Underline" },
    { keys: "⌘ ⇧ S", action: "Strikethrough" }, { keys: "⌘ Z", action: "Undo" }, { keys: "⌘ ⇧ Z", action: "Redo" },
    { keys: "⌘ ⇧ 7", action: "Ordered List" }, { keys: "⌘ ⇧ 8", action: "Bullet List" }, { keys: "⌘ F", action: "Find & Replace" },
  ];
  return (
    <div className="shortcuts-overlay" onClick={onClose}><div className="shortcuts-modal" onClick={e => e.stopPropagation()}>
      <div className="shortcuts-header"><h3>⌨️ Keyboard Shortcuts</h3><button className="find-close-btn" onClick={onClose}>{icons.clear}</button></div>
      <div className="shortcuts-grid">{shortcuts.map(s => (<div key={s.keys} className="shortcut-item"><kbd>{s.keys}</kbd><span>{s.action}</span></div>))}</div>
    </div></div>
  );
}

/* ── Main Toolbar ─────────────────────────────────────── */
function WriterToolbar({ editor, onFix, fixing, onToggleFindReplace, showFindReplace, onToggleAITools, showAITools, onToggleFullscreen, isFullscreen, onPrint, showHighlightPicker, setShowHighlightPicker, showTextColorPicker, setShowTextColorPicker }) {
  if (!editor) return null;
  return (
    <div className="writer-toolbar-container"><div className="writer-toolbar">
      <select className="toolbar-heading-select" value={editor.isActive("heading",{level:1})?"h1":editor.isActive("heading",{level:2})?"h2":editor.isActive("heading",{level:3})?"h3":"p"} onChange={e=>{const v=e.target.value;if(v==="p")editor.chain().focus().setParagraph().run();else editor.chain().focus().toggleHeading({level:parseInt(v[1])}).run();}}>
        <option value="p">Normal Text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
      </select>
      <div className="toolbar-separator"/>
      <button className={`toolbar-btn ${editor.isActive("bold")?"active":""}`} onClick={()=>editor.chain().focus().toggleBold().run()} title="Bold (⌘B)">{icons.bold}</button>
      <button className={`toolbar-btn ${editor.isActive("italic")?"active":""}`} onClick={()=>editor.chain().focus().toggleItalic().run()} title="Italic (⌘I)">{icons.italic}</button>
      <button className={`toolbar-btn ${editor.isActive("underline")?"active":""}`} onClick={()=>editor.chain().focus().toggleUnderline().run()} title="Underline (⌘U)">{icons.underline}</button>
      <button className={`toolbar-btn ${editor.isActive("strike")?"active":""}`} onClick={()=>editor.chain().focus().toggleStrike().run()} title="Strikethrough">{icons.strike}</button>
      <div className="toolbar-dropdown-wrap">
        <button className={`toolbar-btn ${editor.isActive("highlight")?"active":""}`} onClick={()=>setShowHighlightPicker(!showHighlightPicker)} title="Highlight">{icons.highlight}</button>
        {showHighlightPicker && <div className="toolbar-color-picker">{HIGHLIGHT_COLORS.map(c=>(<button key={c.value} className="color-swatch" style={{background:c.value}} title={c.name} onClick={()=>{editor.chain().focus().toggleHighlight({color:c.value}).run();setShowHighlightPicker(false);}}/>))}<button className="color-swatch remove-color" title="Remove" onClick={()=>{editor.chain().focus().unsetHighlight().run();setShowHighlightPicker(false);}}>{icons.clear}</button></div>}
      </div>
      <div className="toolbar-dropdown-wrap">
        <button className="toolbar-btn" onClick={()=>setShowTextColorPicker(!showTextColorPicker)} title="Text Color"><span style={{borderBottom:"3px solid var(--accent)",paddingBottom:"1px",fontWeight:700,fontSize:"13px"}}>A</span></button>
        {showTextColorPicker && <div className="toolbar-color-picker">{TEXT_COLORS.map(c=>(<button key={c.value} className="color-swatch text-color-swatch" style={{color:c.value==="inherit"?"var(--text)":c.value}} title={c.name} onClick={()=>{if(c.value==="inherit")editor.chain().focus().unsetColor().run();else editor.chain().focus().setColor(c.value).run();setShowTextColorPicker(false);}}>A</button>))}</div>}
      </div>
      <button className={`toolbar-btn ${editor.isActive("code")?"active":""}`} onClick={()=>editor.chain().focus().toggleCode().run()} title="Inline Code">{icons.code}</button>
      <div className="toolbar-separator"/>
      <button className={`toolbar-btn ${editor.isActive({textAlign:"left"})?"active":""}`} onClick={()=>editor.chain().focus().setTextAlign("left").run()} title="Left">{icons.alignLeft}</button>
      <button className={`toolbar-btn ${editor.isActive({textAlign:"center"})?"active":""}`} onClick={()=>editor.chain().focus().setTextAlign("center").run()} title="Center">{icons.alignCenter}</button>
      <button className={`toolbar-btn ${editor.isActive({textAlign:"right"})?"active":""}`} onClick={()=>editor.chain().focus().setTextAlign("right").run()} title="Right">{icons.alignRight}</button>
      <div className="toolbar-separator"/>
      <button className={`toolbar-btn ${editor.isActive("bulletList")?"active":""}`} onClick={()=>editor.chain().focus().toggleBulletList().run()} title="Bullet List">{icons.bulletList}</button>
      <button className={`toolbar-btn ${editor.isActive("orderedList")?"active":""}`} onClick={()=>editor.chain().focus().toggleOrderedList().run()} title="Numbered List">{icons.orderedList}</button>
      <button className={`toolbar-btn ${editor.isActive("blockquote")?"active":""}`} onClick={()=>editor.chain().focus().toggleBlockquote().run()} title="Blockquote">{icons.quote}</button>
      <button className="toolbar-btn" onClick={()=>editor.chain().focus().setHorizontalRule().run()} title="Rule">{icons.hr}</button>
      <div className="toolbar-separator"/>
      <button className="toolbar-btn" onClick={()=>editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">{icons.undo}</button>
      <button className="toolbar-btn" onClick={()=>editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">{icons.redo}</button>
      <div className="toolbar-separator"/>
      <button className={`toolbar-btn ${showFindReplace?"active":""}`} onClick={onToggleFindReplace} title="Find & Replace">{icons.search}</button>
      <button className="toolbar-btn" onClick={onPrint} title="Print">{icons.print}</button>
      <button className="toolbar-btn" onClick={onToggleFullscreen} title="Focus Mode">{isFullscreen?icons.exitFullscreen:icons.fullscreen}</button>
      <div className="toolbar-separator"/>
      <button className={`toolbar-btn toolbar-btn-ai-toggle ${showAITools?"active":""}`} onClick={onToggleAITools} title="AI Tools">{icons.wand} AI Tools</button>
      <button className={`toolbar-btn toolbar-btn-fix ${fixing?"fixing":""}`} onClick={onFix} disabled={fixing} title="Fix all errors with AI">
        {fixing ? <><span className="fix-spinner"/> Fixing…</> : <>{icons.sparkles} Fix All Errors</>}
      </button>
    </div></div>
  );
}

/* ══════════════════════════════════════════════════════════
   WRITER COMPONENT
   ══════════════════════════════════════════════════════════ */
export default function Writer() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Document state
  const [currentDocId, setCurrentDocId] = useState(null);
  const [docTitle, setDocTitle] = useState("Untitled Document");
  const [isEditing, setIsEditing] = useState(false);
  const [docs, setDocs] = useState(null); // null = loading
  const [loadingDoc, setLoadingDoc] = useState(false);

  // UI state
  const [fixing, setFixing] = useState(false);
  const [banner, setBanner] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showAITools, setShowAITools] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const dragCounterRef = useRef(0);
  const saveTimerRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Start writing your masterpiece…" }),
      Highlight.configure({ multicolor: true }),
      TextStyle, Color,
    ],
    content: "",
    editable: true,
    autofocus: false,
  });

  // Load document list
  function refreshDocs() {
    listDocuments().then(setDocs).catch(() => setDocs([]));
  }
  useEffect(() => { refreshDocs(); }, []);

  // Auto-save to cloud every 15s
  useEffect(() => {
    if (!editor || !isEditing || !currentDocId) return;
    saveTimerRef.current = setInterval(async () => {
      const html = editor.getHTML();
      if (!html || html === "<p></p>") return;
      try {
        setSaving(true);
        await saveDocument(currentDocId, html, docTitle);
        setLastSaved(new Date());
      } catch (err) {
        console.error("Auto-save failed:", err);
      } finally { setSaving(false); }
    }, 15000);
    return () => clearInterval(saveTimerRef.current);
  }, [editor, isEditing, currentDocId, docTitle]);

  // Keyboard shortcut: Cmd+F
  useEffect(() => {
    function handleKeyDown(e) { if ((e.metaKey||e.ctrlKey)&&e.key==="f"&&isEditing) { e.preventDefault(); setShowFindReplace(v=>!v); } }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEditing]);

  // Close color pickers
  useEffect(() => {
    function handleClick() { setShowHighlightPicker(false); setShowTextColorPicker(false); }
    if (showHighlightPicker || showTextColorPicker) { setTimeout(() => window.addEventListener("click", handleClick), 0); return () => window.removeEventListener("click", handleClick); }
  }, [showHighlightPicker, showTextColorPicker]);

  // Stats
  const getStats = useCallback(() => {
    if (!editor) return { words: 0, chars: 0, sentences: 0, paragraphs: 0, readingTime: 0 };
    const text = editor.getText();
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { words, chars: text.length, sentences: text.split(/[.!?]+/).filter(s => s.trim()).length, paragraphs: text.split(/\n\n+/).filter(p => p.trim()).length, readingTime: Math.max(1, Math.ceil(words / 200)) };
  }, [editor]);
  const [stats, setStats] = useState({ words: 0, chars: 0, sentences: 0, paragraphs: 0, readingTime: 0 });
  useEffect(() => { if (!editor) return; const u = () => setStats(getStats()); editor.on("update", u); return () => editor.off("update", u); }, [editor, getStats]);

  // ── Open an existing document from cloud ──────────────
  async function openDocument(doc) {
    setLoadingDoc(true);
    try {
      const data = await getDocumentContent(doc.id);
      if (data.format === "html") {
        editor?.commands.setContent(data.html || "");
      } else {
        // It's a raw .docx binary — shouldn't happen via JSON endpoint, but handle gracefully
        editor?.commands.setContent("<p>This document needs to be re-uploaded.</p>");
      }
      setCurrentDocId(doc.id);
      setDocTitle(doc.title);
      setIsEditing(true);
      setLastSaved(null);
    } catch (err) {
      setBanner({ type: "error", msg: `Failed to open document: ${err.message}` });
    } finally { setLoadingDoc(false); }
  }

  // ── Create a new blank document (saved to cloud immediately) ──
  async function handleNewBlank() {
    try {
      const { id, title } = await createDocument("Untitled Document", "<p></p>");
      setCurrentDocId(id);
      setDocTitle(title);
      editor?.commands.setContent("");
      setIsEditing(true);
      setTimeout(() => editor?.commands.focus(), 100);
    } catch (err) {
      setBanner({ type: "error", msg: `Failed to create document: ${err.message}` });
    }
  }

  // ── Upload a .docx file → store on cloud → open in editor ──
  async function handleUploadDocx(file) {
    if (!file) return;
    try {
      const { id, title } = await uploadDocument(file, file.name.replace(/\.docx?$/i, ""));
      // Now fetch the content — it's stored as raw .docx on R2
      // We need to convert it to HTML client-side with mammoth
      const mammoth = await import("mammoth");
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      const html = result.value;
      // Save the HTML version back to the cloud
      await saveDocument(id, html, title);
      setCurrentDocId(id);
      setDocTitle(title);
      editor?.commands.setContent(html);
      setIsEditing(true);
      refreshDocs();
    } catch (err) {
      setBanner({ type: "error", msg: `Upload failed: ${err.message}` });
    }
  }

  function handleFileInput(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) handleUploadDocx(file);
  }

  // ── Delete a document ──
  async function handleDeleteDoc(id, title) {
    if (!confirm(`Delete "${title || "this document"}"? This cannot be undone.`)) return;
    try {
      await deleteDocument(id);
      refreshDocs();
      if (currentDocId === id) { setIsEditing(false); setCurrentDocId(null); }
    } catch { setBanner({ type: "error", msg: "Failed to delete document." }); }
  }

  // ── Manual save ──
  async function handleManualSave() {
    if (!editor || !currentDocId) return;
    setSaving(true);
    try {
      await saveDocument(currentDocId, editor.getHTML(), docTitle);
      setLastSaved(new Date());
      setBanner({ type: "success", msg: "💾 Document saved to cloud!" });
    } catch (err) {
      setBanner({ type: "error", msg: `Save failed: ${err.message}` });
    } finally { setSaving(false); }
  }

  // ── Back to document list ──
  async function handleBackToList() {
    // Save before leaving
    if (editor && currentDocId) {
      const html = editor.getHTML();
      if (html && html !== "<p></p>") {
        try { await saveDocument(currentDocId, html, docTitle); } catch {}
      }
    }
    setIsEditing(false);
    setCurrentDocId(null);
    setLastSaved(null);
    refreshDocs();
  }

  // Drag & drop
  function handleDragEnter(e) { e.preventDefault(); e.stopPropagation(); dragCounterRef.current += 1; if (e.dataTransfer.items?.length > 0) setIsDragging(true); }
  function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); dragCounterRef.current -= 1; if (dragCounterRef.current <= 0) { setIsDragging(false); dragCounterRef.current = 0; } }
  function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); }
  function handleDrop(e) { e.preventDefault(); e.stopPropagation(); setIsDragging(false); dragCounterRef.current = 0; const file = e.dataTransfer.files?.[0]; if (file) handleUploadDocx(file); }

  // ── AI Fix (preserves HTML formatting) ─────────────────
  async function handleFix() {
    if (!editor || fixing) return;
    const html = editor.getHTML();
    const text = editor.getText();
    if (!text.trim()) { setBanner({ type: "error", msg: "Nothing to fix — the document is empty." }); return; }
    setFixing(true); setBanner(null);
    try {
      const { fixedText } = await fixTextWithAI(text);
      // Rebuild as paragraphs preserving structure
      const paragraphs = fixedText.split(/\n\n+/);
      const fixedHtml = paragraphs.map(p => {
        const lines = p.split("\n").map(l => l.trim()).filter(Boolean);
        return `<p>${lines.join("<br>")}</p>`;
      }).join("");
      editor.commands.setContent(fixedHtml);
      setBanner({ type: "success", msg: "✅ All grammar and spelling errors have been fixed!" });
    } catch (err) {
      setBanner({ type: "error", msg: `Failed to fix: ${err.message || "Unknown error"}` });
    } finally { setFixing(false); }
  }

  // Export
  async function handleExport() {
    if (!editor) return;
    const htmlContent = editor.getHTML();
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docTitle}</title></head><body>${htmlContent}</body></html>`;
    try {
      const htmlToDocx = (await import("html-to-docx")).default;
      const blob = await htmlToDocx(fullHtml, null, { table: { row: { cantSplit: true } }, footer: true, pageNumber: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${docTitle || "document"}.docx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { setBanner({ type: "error", msg: "Export failed." }); }
  }

  // Print
  function handlePrint() {
    if (!editor) return;
    const html = editor.getHTML();
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docTitle}</title><style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:20px;line-height:1.8;color:#222;}h1{font-size:28px;}h2{font-size:22px;}h3{font-size:18px;}blockquote{border-left:3px solid #ccc;padding-left:16px;color:#555;font-style:italic;}code{background:#f3f3f3;padding:2px 5px;border-radius:3px;}</style></head><body><h1>${docTitle}</h1>${html}</body></html>`);
    w.document.close(); w.print();
  }

  // Clear banner
  useEffect(() => { if (!banner) return; const t = setTimeout(() => setBanner(null), 5000); return () => clearTimeout(t); }, [banner]);

  // Format date
  function formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr + "Z");
    const now = new Date();
    const diffMs = now - d;
    if (diffMs < 60000) return "Just now";
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
    if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // ─── LANDING: Document Library ────────────────────────
  if (!isEditing) {
    return (
      <div className="writer writer-landing" onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
        {isDragging && (
          <div className="drag-drop-overlay"><div className="drag-drop-card"><span className="drag-drop-icon">📥</span><h2>Drop your .docx here</h2><p>It will be uploaded to your cloud library</p></div></div>
        )}
        <header className="writer-header">
          <div className="writer-brand">
            <div className="writer-title-row"><h1>The Writing Desk</h1></div>
            <p className="writer-subtitle">
              {docs?.length ? `${docs.length} document${docs.length === 1 ? "" : "s"} in your cloud library` : "Your AI-powered document editor — create, edit, perfect."}
            </p>
          </div>
          <div className="writer-header-actions">
            <button className="writer-btn writer-btn-back" onClick={() => navigate("/")}>{icons.back} Library</button>
            <button className="writer-btn writer-btn-secondary" onClick={() => fileInputRef.current?.click()}>{icons.folder} Upload .docx</button>
            <button className="writer-btn writer-btn-primary" onClick={handleNewBlank}>+ New Document</button>
          </div>
        </header>

        {banner && (<div className={`writer-fix-banner ${banner.type}`}><span>{banner.msg}</span><button className="banner-close" onClick={() => setBanner(null)}>{icons.clear}</button></div>)}

        <main className="writer-main">
          {docs === null ? (
            <div className="writer-loading"><div className="loading-spinner" /><p>Loading your documents…</p></div>
          ) : docs.length === 0 ? (
            <div className="writer-empty-state">
              <div className="writer-landing-grid">
                <div className={`writer-dropzone ${isDragging ? "dragging" : ""}`} onClick={() => fileInputRef.current?.click()}>
                  <div className="dropzone-glow" /><span className="drop-icon">📄</span><h2>Upload a Document</h2><p>Drag & drop a <strong>.docx</strong> file or click to browse</p>
                </div>
                <div className="writer-dropzone blank-zone" onClick={handleNewBlank}>
                  <div className="dropzone-glow glow-alt" /><span className="drop-icon">✍️</span><h2>Start Fresh</h2><p>Begin with a blank canvas and write freely</p>
                </div>
              </div>
              <div className="writer-features-bar">
                <span className="feature-chip">✨ AI Error Fix</span><span className="feature-chip">🔄 Paraphrase</span>
                <span className="feature-chip">🎩 Tone Control</span><span className="feature-chip">🔍 Find & Replace</span>
                <span className="feature-chip">☁️ Cloud Saved</span><span className="feature-chip">📥 Export .docx</span>
              </div>
            </div>
          ) : (
            <div className="doc-grid">
              {docs.map(doc => (
                <div key={doc.id} className="doc-card" onClick={() => openDocument(doc)}>
                  <div className="doc-card-icon">📝</div>
                  <div className="doc-card-info">
                    <h3 className="doc-card-title">{doc.title}</h3>
                    <div className="doc-card-meta">
                      <span>{doc.word_count?.toLocaleString() || 0} words</span>
                      <span>·</span>
                      <span>{formatDate(doc.updated_at)}</span>
                    </div>
                  </div>
                  <button className="doc-card-delete" onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id, doc.title); }} title="Delete">{icons.trash}</button>
                </div>
              ))}
            </div>
          )}
        </main>

        <input ref={fileInputRef} type="file" accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={handleFileInput} />
        {loadingDoc && <div className="doc-loading-overlay"><div className="loading-spinner" /><p>Opening document…</p></div>}
      </div>
    );
  }

  // ─── EDITOR VIEW ──────────────────────────────────────
  return (
    <div className={`writer ${isFullscreen ? "writer-fullscreen" : ""}`}>
      <header className="writer-header">
        <div className="writer-brand"><div className="writer-title-row"><h1>The Writing Desk</h1></div></div>
        <div className="writer-header-actions">
          <button className="writer-btn writer-btn-back" onClick={handleBackToList}>{icons.back} My Docs</button>
          <button className="writer-btn writer-btn-secondary" onClick={() => fileInputRef.current?.click()}>{icons.folder} Open</button>
          <button className="writer-btn writer-btn-secondary" onClick={handleManualSave} disabled={saving}>{saving ? "Saving…" : "💾 Save"}</button>
          <button className="writer-btn writer-btn-primary" onClick={handleExport}>{icons.download} Export .docx</button>
          <button className="writer-btn writer-btn-ghost" onClick={() => setShowShortcuts(true)}>⌨️</button>
        </div>
      </header>

      <input ref={fileInputRef} type="file" accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={handleFileInput} />

      {banner && (<div className={`writer-fix-banner ${banner.type}`}><span>{banner.msg}</span><button className="banner-close" onClick={() => setBanner(null)}>{icons.clear}</button></div>)}

      <WriterToolbar editor={editor} onFix={handleFix} fixing={fixing} onToggleFindReplace={() => setShowFindReplace(v => !v)} showFindReplace={showFindReplace} onToggleAITools={() => setShowAITools(v => !v)} showAITools={showAITools} onToggleFullscreen={() => setIsFullscreen(v => !v)} isFullscreen={isFullscreen} onPrint={handlePrint} showHighlightPicker={showHighlightPicker} setShowHighlightPicker={setShowHighlightPicker} showTextColorPicker={showTextColorPicker} setShowTextColorPicker={setShowTextColorPicker} />

      {showFindReplace && <FindReplacePanel editor={editor} onClose={() => setShowFindReplace(false)} />}
      {showAITools && <AIToolsPanel editor={editor} onClose={() => setShowAITools(false)} />}

      <div className="writer-doc-title-row">
        <input className="writer-doc-title" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Document title…" />
      </div>

      <div className="writer-stats-bar">
        <span className="stat-item"><span className="stat-label">Words</span><span className="stat-value">{stats.words.toLocaleString()}</span></span>
        <span className="stat-item"><span className="stat-label">Characters</span><span className="stat-value">{stats.chars.toLocaleString()}</span></span>
        <span className="stat-item"><span className="stat-label">Reading</span><span className="stat-value">{stats.readingTime} min</span></span>
        {lastSaved && <span className="stat-item auto-save-indicator"><span className="save-dot"/><span className="stat-label">Saved {lastSaved.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span></span>}
        <span className="stat-item cloud-badge">☁️ Cloud</span>
      </div>

      <div className="writer-editor-wrapper"><EditorContent editor={editor} /></div>
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
