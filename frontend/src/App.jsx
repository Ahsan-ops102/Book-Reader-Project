import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Library from "./components/Library.jsx";
import Reader from "./components/Reader.jsx";
import Writer from "./components/Writer.jsx";
import { listBooks, setAppPassword } from "./api.js";
import "./App.css";

// Gates the whole app behind a password ONLY if the backend has one set
// (APP_PASSWORD in the backend .env). Locally, with no password set,
// this resolves instantly and shows the app straight away.
function AuthGate({ children }) {
  const [status, setStatus] = useState("checking"); // checking | ok | needs-password
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    listBooks()
      .then(() => setStatus("ok"))
      .catch((err) => {
        setStatus(err.message === "UNAUTHORIZED" ? "needs-password" : "ok");
      });
  }, []);

  function submit(e) {
    e.preventDefault();
    setAppPassword(input);
    listBooks()
      .then(() => setStatus("ok"))
      .catch(() => setError("That password didn't work."));
  }

  if (status === "checking") return null;

  if (status === "needs-password") {
    return (
      <div className="auth-gate">
        <form className="auth-card" onSubmit={submit}>
          <h1>The Reading Room</h1>
          <p>This library is password-protected.</p>
          <input
            type="password"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Password"
          />
          {error && <p className="auth-error">{error}</p>}
          <button type="submit">Enter</button>
        </form>
      </div>
    );
  }

  return children;
}

export default function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/book/:id" element={<Reader />} />
        <Route path="/writer" element={<Writer />} />
      </Routes>
    </AuthGate>
  );
}
