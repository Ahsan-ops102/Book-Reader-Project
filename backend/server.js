import "dotenv/config";
import express from "express";
import cors from "cors";
import booksRouter from "./routes/books.js";
import aiRouter from "./routes/ai.js";
import documentsRouter from "./routes/documents.js";
import authRouter from "./routes/auth.js";
import jwt from "jsonwebtoken";

const app = express();
const PORT = process.env.PORT || 3001;
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const rawOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.replace(/\/$/, "");
      if (rawOrigins.includes("*") || rawOrigins.includes(cleanOrigin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS error: Origin ${origin} not allowed`));
    },
  })
);
app.use(express.json({ limit: "50mb" }));

// JWT Authentication Middleware
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_please_change_in_production";

app.use((req, res, next) => {
  if (req.path === "/api/health" || req.path.startsWith("/api/auth")) {
    return next(); // Unprotected routes
  }

  const authHeader = req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Attach user info to request
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/books", booksRouter);
app.use("/api/ai", aiRouter);
app.use("/api/documents", documentsRouter);

app.listen(PORT, () => {
  console.log(`Reader backend running on http://localhost:${PORT}`);
});

