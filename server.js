const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public/Frontend')));

const db = new Database(path.join(__dirname, 'astrumcare.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    date TEXT NOT NULL,
    telemetry_json TEXT NOT NULL,
    ghq_json TEXT,
    physical_score INTEGER,
    mental_score INTEGER,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  );
`);

const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (userCount === 0) {
  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  insertUser.run('admin', bcrypt.hashSync('admin123', 10), 'Flight Director (Admin)', 'admin', 'System Default');
  insertUser.run('astronaut1', bcrypt.hashSync('orbit2026', 10), 'Cmdr. Alex Mercer', 'crew', 'System Default');
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username?.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid crew username or passcode.' });
  }
  res.json({ username: user.username, fullName: user.full_name, role: user.role });
});

app.get('/api/users', (req, res) => {
  const rows = db.prepare('SELECT username, full_name AS fullName, role, created_at AS createdAt FROM users').all();
  res.json(rows);
});

app.post('/api/users', (req, res) => {
  const { username, password, fullName, role } = req.body;
  const cleanUser = username.trim().toLowerCase();
  const exists = db.prepare('SELECT username FROM users WHERE username = ?').get(cleanUser);
  if (exists) return res.status(409).json({ error: `Username "${cleanUser}" already exists.` });

  const hash = bcrypt.hashSync(password, 10);
  const createdAt = new Date().toLocaleDateString();
  db.prepare('INSERT INTO users (username, password_hash, full_name, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(cleanUser, hash, fullName.trim(), role, createdAt);
  res.status(201).json({ username: cleanUser, fullName, role, createdAt });
});

app.delete('/api/users/:username', (req, res) => {
  const target = req.params.username.toLowerCase();
  if (target === 'admin') return res.status(400).json({ error: 'Cannot delete primary admin account.' });
  db.prepare('DELETE FROM users WHERE username = ?').run(target);
  res.json({ deleted: target });
});

app.post('/api/telemetry', (req, res) => {
  const { username, telemetry, physicalScore } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const existing = db.prepare('SELECT id FROM assessments WHERE username = ? AND date = ?').get(username, today);
  if (existing) {
    db.prepare('UPDATE assessments SET telemetry_json = ?, physical_score = ? WHERE id = ?')
      .run(JSON.stringify(telemetry), physicalScore, existing.id);
  } else {
    db.prepare('INSERT INTO assessments (username, date, telemetry_json, physical_score) VALUES (?, ?, ?, ?)')
      .run(username, today, JSON.stringify(telemetry), physicalScore);
  }
  res.json({ status: 'saved', date: today });
});

app.post('/api/ghq', (req, res) => {
  const { username, ghq } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const existing = db.prepare('SELECT id FROM assessments WHERE username = ? AND date = ?').get(username, today);
  if (existing) {
    db.prepare('UPDATE assessments SET ghq_json = ?, mental_score = ? WHERE id = ?')
      .run(JSON.stringify(ghq), ghq.mentalScore, existing.id);
  } else {
    db.prepare('INSERT INTO assessments (username, date, telemetry_json, ghq_json, mental_score) VALUES (?, ?, ?, ?, ?)')
      .run(username, today, '{}', JSON.stringify(ghq), ghq.mentalScore);
  }
  res.json({ status: 'saved', date: today });
});

app.get('/api/history/:username', (req, res) => {
  const rows = db.prepare('SELECT * FROM assessments WHERE username = ? ORDER BY date ASC').all(req.params.username);
  const history = rows.map(r => {
    const t = JSON.parse(r.telemetry_json || '{}');
    const g = r.ghq_json ? JSON.parse(r.ghq_json) : null;
    return {
      date: r.date,
      physicalScore: r.physical_score ?? 100,
      mentalScore: r.mental_score ?? 100,
      hrRest: t.hrRest,
      sbp: t.sbp,
      dbp: t.dbp,
      temp: t.temp,
      spo2: t.spo2,
      massKg: t.massKg,
      sleepHrs: t.sleepHrs,
      vo2Max: t.vo2Max,
      telemetry: t,
      ghq: g
    };
  });
  res.json(history);
});

app.listen(PORT, () => {
  console.log(`AstrumCare server running on port ${PORT}`);
});
