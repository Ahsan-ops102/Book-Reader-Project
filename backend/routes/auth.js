import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../db.js";
import crypto from "crypto";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_please_change_in_production";

router.post("/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const existingUser = await db.execute({
      sql: "SELECT * FROM users WHERE username = ?",
      args: [username],
    });

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);

    // See if this is the first user
    const usersCount = await db.execute("SELECT COUNT(*) as count FROM users");
    const isFirstUser = usersCount.rows[0].count === 0;

    await db.execute({
      sql: "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
      args: [id, username, passwordHash],
    });

    // If this is the first user, migrate all existing records to them
    if (isFirstUser) {
      console.log(`First user registered. Migrating all existing books and documents to user ${id}`);
      await db.execute({ sql: "UPDATE books SET user_id = ? WHERE user_id IS NULL", args: [id] });
      await db.execute({ sql: "UPDATE documents SET user_id = ? WHERE user_id IS NULL", args: [id] });
    }

    const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, username });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const result = await db.execute({
      sql: "SELECT * FROM users WHERE username = ?",
      args: [username],
    });

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

export default router;
