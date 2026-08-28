import "dotenv/config";
import express from "express";
import cors from "cors";
import booksRouter from "./routes/books.js";
import aiRouter from "./routes/ai.js";
import documentsRouter from "./routes/documents.js";

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
app.use(express.json({ limit: "5mb" }));

// Simple shared-password gate. Only active once APP_PASSWORD is set in .env —
// leave it blank for local development so there's no friction.
app.use((req, res, next) => {
  if (!APP_PASSWORD) return next();
  if (req.path === "/api/health") return next(); // let health checks through
  const provided = req.header("x-app-password");
  if (provided !== APP_PASSWORD) {
    return res.status(401).json({ error: "Incorrect or missing password" });
  }
  next();
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/books", booksRouter);
app.use("/api/ai", aiRouter);
app.use("/api/documents", documentsRouter);

app.listen(PORT, () => {
  console.log(`Reader backend running on http://localhost:${PORT}`);
  if (!APP_PASSWORD) {
    console.log("APP_PASSWORD is not set — running with no login gate (fine for local use).");
  }
});

