import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Library from "./components/Library.jsx";
import Reader from "./components/Reader.jsx";
import Writer from "./components/Writer.jsx";
import { listBooks, getAuthToken, setAuthToken, clearAuthToken, loginUser, registerUser } from "./api.js";
import "./App.css";

// Gates the whole app behind JWT authentication
function AuthGate({ children }) {
  const [status, setStatus] = useState("checking"); // checking | ok | needs-login
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If no token exists, immediately show login
    if (!getAuthToken()) {
      setStatus("needs-login");
      return;
    }

    listBooks()
      .then(() => setStatus("ok"))
      .catch((err) => {
        if (err.message === "UNAUTHORIZED") {
          clearAuthToken();
          setStatus("needs-login");
        } else {
          setStatus("ok");
        }
      });
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isLogin) {
        const res = await loginUser(username, password);
        setAuthToken(res.token);
      } else {
        const res = await registerUser(username, password);
        setAuthToken(res.token);
      }
      setStatus("ok");
    } catch (err) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  if (status === "checking") return null;

  if (status === "needs-login") {
    return (
      <div className="auth-gate">
        <form className="auth-card" onSubmit={submit}>
          <h1>The Reading Room</h1>
          <p>{isLogin ? "Sign in to access your library." : "Create an account to get started."}</p>
          <input
            type="text"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
          />
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? "Please wait..." : (isLogin ? "Sign In" : "Create Account")}
          </button>
          
          <div style={{ marginTop: '16px', fontSize: '14px', textAlign: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              {isLogin ? "Don't have an account? " : "Already have an account? "}
            </span>
            <button 
              type="button" 
              onClick={() => { setIsLogin(!isLogin); setError(""); }}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontWeight: 600 }}
            >
              {isLogin ? "Sign Up" : "Sign In"}
            </button>
          </div>
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
