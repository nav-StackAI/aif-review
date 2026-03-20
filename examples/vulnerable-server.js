// Example: A deliberately vulnerable Express server for testing AIF review.
// This file contains multiple security and reliability issues that AIF should catch.

import express from "express";
import { exec } from "child_process";
import fs from "fs";

const app = express();
app.use(express.json());

// Hardcoded secret (AIF should flag this)
const API_SECRET = "sk-production-abc123-very-secret";
const DB_PASSWORD = "admin123";

// SQL injection vulnerability
app.get("/users", (req, res) => {
  const name = req.query.name;
  const query = `SELECT * FROM users WHERE name = '${name}'`;
  // db.query(query) — imagine this runs
  res.json({ query });
});

// Command injection vulnerability
app.post("/deploy", (req, res) => {
  const branch = req.body.branch;
  exec(`git checkout ${branch} && npm run build`, (err, stdout) => {
    res.json({ output: stdout, error: err?.message });
  });
});

// Path traversal vulnerability
app.get("/files/:filename", (req, res) => {
  const filepath = `/uploads/${req.params.filename}`;
  const content = fs.readFileSync(filepath, "utf-8");
  res.send(content);
});

// No rate limiting on auth endpoint
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === "admin" && password === DB_PASSWORD) {
    res.json({ token: API_SECRET }); // Leaking the API secret as a token
  } else {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

// Unhandled promise rejection
app.get("/data", async (req, res) => {
  const data = await fetch(`https://api.example.com/data?key=${API_SECRET}`);
  const json = await data.json();
  res.json(json);
});

// Missing error handling, sync file operations blocking event loop
app.post("/upload", (req, res) => {
  const content = req.body.content;
  const filename = req.body.filename;
  fs.writeFileSync(`/uploads/${filename}`, content);
  res.json({ success: true });
});

// No input validation
app.put("/users/:id", (req, res) => {
  const updates = req.body; // Accepts ANY fields, including role escalation
  // db.update('users', req.params.id, updates)
  res.json({ updated: true, fields: Object.keys(updates) });
});

app.listen(3000, () => console.log("Server running on port 3000"));
