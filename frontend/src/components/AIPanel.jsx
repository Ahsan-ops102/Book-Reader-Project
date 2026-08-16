import { forwardRef, useEffect, useRef, useState } from "react";
import { queryAI } from "../api.js";
import "./AIPanel.css";

const QUICK_ACTIONS = [
  {
    id: "summary",
    icon: "💡",
    label: "3 Key Points",
    prompt: "Summarize this passage into 3 concise bullet points with main takeaways.",
  },
  {
    id: "eli5",
    icon: "👶",
    label: "Explain Like I'm 5",
    prompt: "Explain this passage like I'm 5 years old in simple, vivid language.",
  },
  {
    id: "quiz",
    icon: "🧠",
    label: "Quiz Me",
    prompt: "Create a 1-question multiple choice flashcard quiz based on this passage with the correct answer hidden below.",
  },
  {
    id: "vocab",
    icon: "📖",
    label: "Key Vocabulary",
    prompt: "Highlight and define the 2-3 most important or challenging words/concepts in this passage.",
  },
  {
    id: "actionable",
    icon: "🎯",
    label: "Actionable Advice",
    prompt: "What is the single most actionable lesson or insight from this passage?",
  },
];

const AIPanel = forwardRef(function AIPanel(
  { open, selectedText, initialQuery, onClose, onQueryConsumed },
  ref
) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]); // [{ role: 'user'|'ai', text, time }]
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedIdx, setCopiedIdx] = useState(null);
  const messagesEndRef = useRef(null);
  const initialQueryFired = useRef(false);

  // When selection changes, clear errors
  useEffect(() => {
    if (selectedText) {
      setError("");
    }
  }, [selectedText]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-fire initialQuery (e.g. when user clicks "Define")
  useEffect(() => {
    if (initialQuery && open && !initialQueryFired.current) {
      initialQueryFired.current = true;
      handleSend(initialQuery);
      onQueryConsumed?.();
    }
    if (!initialQuery) {
      initialQueryFired.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, open]);

  async function handleSend(promptText) {
    const textToAsk = (promptText || question).trim();
    if (!textToAsk && !selectedText) return;

    const userMessage = {
      role: "user",
      text: textToAsk || "Summarize this passage",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setLoading(true);
    setError("");

    try {
      const res = await queryAI(selectedText || "Selected passage context", textToAsk || undefined);
      const aiMessage = {
        role: "ai",
        text: res.answer,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch {
      setError("Failed to get response from AI. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(text, idx) {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  function clearHistory() {
    setMessages([]);
    setError("");
  }

  return (
    <aside
      ref={ref}
      className={`ai-panel ${open ? "open" : ""}`}
      aria-label="AI Reading Companion"
      onClick={(e) => e.stopPropagation()} // prevent click-outside when clicking inside
    >
      {/* Header */}
      <div className="ai-panel-header">
        <div className="ai-header-left">
          <span className="ai-sparkle-icon">✨</span>
          <div>
            <h3>Reading Assistant</h3>
            <span className="ai-model-tag">Gemini Flash</span>
          </div>
        </div>
        <div className="ai-header-right">
          {messages.length > 0 && (
            <button className="ai-clear-btn" onClick={clearHistory} title="Clear conversation">
              🗑️
            </button>
          )}
          <button onClick={onClose} className="ai-close-btn" aria-label="Close AI panel" title="Close (Esc)">
            ✕
          </button>
        </div>
      </div>

      {/* Selected Passage Card */}
      {selectedText ? (
        <div className="ai-selection-card">
          <div className="ai-selection-header">
            <span>Selected Passage</span>
          </div>
          <blockquote className="ai-selection-text">
            "{selectedText}"
          </blockquote>
        </div>
      ) : (
        <div className="ai-no-selection-hint">
          <span>💡 Select any text in the book to unlock instant summaries, explanations, and vocabulary definitions.</span>
        </div>
      )}

      {/* Quick Action Chips */}
      {selectedText && (
        <div className="quick-actions-bar">
          <span className="quick-actions-label">Quick Actions:</span>
          <div className="quick-actions-scroll">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                className="quick-action-chip"
                onClick={() => handleSend(action.prompt)}
                disabled={loading}
              >
                <span>{action.icon}</span> {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Messages Stream */}
      <div className="ai-messages-container">
        {messages.length === 0 && !loading && (
          <div className="ai-welcome-box">
            <span className="ai-welcome-icon">💬</span>
            <h4>Your AI Study Partner</h4>
            <p>Ask anything about what you're reading, get summaries, or break down difficult concepts.</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`ai-message-row ${msg.role}`}>
            <div className={`ai-message-bubble ${msg.role}`}>
              <div className="ai-message-content">{msg.text}</div>
              <div className="ai-message-footer">
                <span className="ai-message-time">{msg.time}</span>
                {msg.role === "ai" && (
                  <button
                    className="ai-copy-btn"
                    onClick={() => handleCopy(msg.text, idx)}
                    title="Copy to clipboard"
                  >
                    {copiedIdx === idx ? "✓ Copied" : "📋 Copy"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="ai-message-row ai">
            <div className="ai-message-bubble ai loading-bubble">
              <div className="ai-typing-dots">
                <span />
                <span />
                <span />
              </div>
              <span className="ai-typing-text">Analyzing & thinking…</span>
            </div>
          </div>
        )}

        {error && (
          <div className="ai-error-banner">
            <span>⚠️ {error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form
        className="ai-input-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <input
          type="text"
          placeholder={selectedText ? "Ask anything about this selection…" : "Ask a reading question…"}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={loading}
          className="ai-input-field"
        />
        <button
          type="submit"
          disabled={loading || (!question.trim() && !selectedText)}
          className="ai-send-btn"
          title="Send query"
        >
          ➤
        </button>
      </form>
    </aside>
  );
});

export default AIPanel;
