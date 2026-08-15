import { useEffect, useState } from "react";
import { queryAI } from "../api.js";
import "./AIPanel.css";

export default function AIPanel({ open, selectedText, onClose }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Reset the conversation each time a new passage is selected
  useEffect(() => {
    setAnswer("");
    setError("");
    setQuestion("");
  }, [selectedText]);

  async function ask(withQuestion) {
    if (!selectedText) return;
    setLoading(true);
    setError("");
    setAnswer("");
    try {
      const res = await queryAI(selectedText, withQuestion);
      setAnswer(res.answer);
    } catch {
      setError("Something went wrong reaching the AI. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`ai-panel ${open ? "open" : ""}`}>
      <div className="ai-panel-header">
        <span>Ask AI</span>
        <button onClick={onClose} aria-label="Close AI panel">
          ✕
        </button>
      </div>

      {selectedText ? (
        <>
          <blockquote className="ai-selection">{selectedText}</blockquote>

          <button className="ai-summarize" onClick={() => ask(undefined)} disabled={loading}>
            Summarize this passage
          </button>

          <form
            className="ai-question-form"
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
          >
            <input
              type="text"
              placeholder="Or ask a specific question…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button type="submit" disabled={loading || !question.trim()}>
              Ask
            </button>
          </form>

          {loading && <p className="ai-status">Thinking…</p>}
          {error && <p className="ai-status ai-error">{error}</p>}
          {answer && <p className="ai-answer">{answer}</p>}
        </>
      ) : (
        <p className="ai-empty">Select some text in the book, then click “Ask AI about this” to summarize it or ask a question.</p>
      )}
    </div>
  );
}
