'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { ALL_FIELDS } = require('./schema');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'site.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS content (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_login    TEXT
  );
  /* Password-reset tokens. Only the hash is stored, so a leaked database
     cannot be used to reset anyone's password. */
  CREATE TABLE IF NOT EXISTS reset_tokens (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    expires_at   INTEGER NOT NULL,
    used_at      TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reset_user ON reset_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_reset_expires ON reset_tokens(expires_at);
  CREATE TABLE IF NOT EXISTS nav (
    id INTEGER PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0,
    label TEXT NOT NULL DEFAULT '', href TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS releases (
    id INTEGER PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0,
    tag TEXT DEFAULT '', title TEXT NOT NULL DEFAULT '', body TEXT DEFAULT '',
    link_label TEXT DEFAULT '', url TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '', artist TEXT DEFAULT '', album TEXT DEFAULT '',
    category TEXT DEFAULT 'Features', role TEXT DEFAULT '',
    source TEXT DEFAULT '', embed TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'past', date_label TEXT DEFAULT '',
    venue TEXT DEFAULT '', location TEXT DEFAULT '', note TEXT DEFAULT '', url TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS credits (
    id INTEGER PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0,
    meta TEXT DEFAULT '', title TEXT NOT NULL DEFAULT '', body TEXT DEFAULT '', url TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS press (
    id INTEGER PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0,
    meta TEXT DEFAULT '', title TEXT NOT NULL DEFAULT '', url TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS shots (
    id INTEGER PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0,
    src TEXT NOT NULL DEFAULT '', alt TEXT DEFAULT '',
    caption_bold TEXT DEFAULT '', caption TEXT DEFAULT '',
    width INTEGER DEFAULT 1600, height INTEGER DEFAULT 1000, shape TEXT DEFAULT 'a'
  );
  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0,
    label TEXT NOT NULL DEFAULT '', href TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    expires INTEGER NOT NULL,
    data    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
`);

/* ---- migrations ------------------------------------------------------
   Sign-in moved from a username to an email address. Older databases are
   brought forward in place rather than needing a rebuild. */
const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols.includes('email')) {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
  // An account whose username was already an address keeps working.
  db.prepare(`UPDATE users SET email = lower(username) WHERE username LIKE '%_@_%.__%'`).run();
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`);

/* ---- sessions -------------------------------------------------------- */
/** Drop every stored session for one user — used after a password reset so
 *  any other signed-in browser is turned out. */
function destroyUserSessions(userId) {
  const rows = db.prepare('SELECT sid, data FROM sessions').all();
  const del = db.prepare('DELETE FROM sessions WHERE sid = ?');
  let n = 0;
  for (const r of rows) {
    try { if (JSON.parse(r.data).userId === userId) { del.run(r.sid); n++; } }
    catch { /* unreadable row, leave it for the sweeper */ }
  }
  return n;
}

/* ---- content -------------------------------------------------------- */
const qGetAll = db.prepare('SELECT key, value FROM content');
const qSet = db.prepare(`INSERT INTO content (key, value, updated_at) VALUES (?, ?, datetime('now'))
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);

function allContent() {
  const out = Object.create(null);
  for (const f of ALL_FIELDS) out[f.key] = f.def ?? '';   // defaults first
  for (const r of qGetAll.all()) out[r.key] = r.value;    // stored values win
  return out;
}
const setContent = db.transaction(pairs => { for (const [k, v] of pairs) qSet.run(k, String(v ?? '')); });

/* ---- collections ----------------------------------------------------- */
const TABLES = ['nav', 'releases', 'tracks', 'shows', 'credits', 'press', 'shots', 'links'];
function isTable(t) { return TABLES.includes(t); }
function listRows(t) {
  if (!isTable(t)) throw new Error('unknown collection: ' + t);
  return db.prepare(`SELECT * FROM ${t} ORDER BY position ASC, id ASC`).all();
}
function columnsOf(t) {
  if (!isTable(t)) throw new Error('unknown collection: ' + t);
  return db.prepare(`PRAGMA table_info(${t})`).all()
    .map(c => c.name).filter(n => n !== 'id');
}

/** Replace a collection wholesale, preserving the submitted order. */
function replaceRows(table, rows) {
  if (!isTable(table)) throw new Error('unknown collection: ' + table);
  const cols = columnsOf(table).filter(c => c !== 'position');
  const ins = db.prepare(
    `INSERT INTO ${table} (position, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`);
  db.transaction(() => {
    db.prepare(`DELETE FROM ${table}`).run();
    rows.forEach((row, i) => ins.run(i, ...cols.map(c => {
      const v = row[c];
      if (v === undefined || v === null) return '';
      return typeof v === 'number' ? v : String(v);
    })));
  })();
}

function count(table) {
  if (!isTable(table)) throw new Error('unknown collection: ' + table);
  return db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
}

module.exports = { db, DB_PATH, destroyUserSessions, allContent, setContent, listRows, replaceRows, columnsOf, count, isTable, TABLES };
