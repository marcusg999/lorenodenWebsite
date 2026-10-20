'use strict';
/* SQLite backend. Synchronous underneath, presented async so both drivers
   share one interface. Used for local development with no setup. */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS content (
  key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE, username TEXT, password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT '', last_login TEXT
);
CREATE TABLE IF NOT EXISTS reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL,
  used_at TEXT, created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY, expires INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_hits (
  bucket TEXT NOT NULL, window_start INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
CREATE TABLE IF NOT EXISTS nav      (id INTEGER PRIMARY KEY AUTOINCREMENT, position INTEGER NOT NULL DEFAULT 0, label TEXT DEFAULT '', href TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS releases (id INTEGER PRIMARY KEY AUTOINCREMENT, position INTEGER NOT NULL DEFAULT 0, tag TEXT DEFAULT '', title TEXT DEFAULT '', body TEXT DEFAULT '', link_label TEXT DEFAULT '', url TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS tracks   (id INTEGER PRIMARY KEY AUTOINCREMENT, position INTEGER NOT NULL DEFAULT 0, title TEXT DEFAULT '', artist TEXT DEFAULT '', album TEXT DEFAULT '', category TEXT DEFAULT 'Features', role TEXT DEFAULT '', source TEXT DEFAULT '', embed TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS shows    (id INTEGER PRIMARY KEY AUTOINCREMENT, position INTEGER NOT NULL DEFAULT 0, kind TEXT DEFAULT 'past', date_label TEXT DEFAULT '', venue TEXT DEFAULT '', location TEXT DEFAULT '', note TEXT DEFAULT '', url TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS credits  (id INTEGER PRIMARY KEY AUTOINCREMENT, position INTEGER NOT NULL DEFAULT 0, meta TEXT DEFAULT '', title TEXT DEFAULT '', body TEXT DEFAULT '', url TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS press    (id INTEGER PRIMARY KEY AUTOINCREMENT, position INTEGER NOT NULL DEFAULT 0, meta TEXT DEFAULT '', title TEXT DEFAULT '', url TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS shots    (id INTEGER PRIMARY KEY AUTOINCREMENT, position INTEGER NOT NULL DEFAULT 0, src TEXT DEFAULT '', alt TEXT DEFAULT '', caption_bold TEXT DEFAULT '', caption TEXT DEFAULT '', width INTEGER DEFAULT 1600, height INTEGER DEFAULT 1000, shape TEXT DEFAULT 'a');
CREATE TABLE IF NOT EXISTS links    (id INTEGER PRIMARY KEY AUTOINCREMENT, position INTEGER NOT NULL DEFAULT 0, label TEXT DEFAULT '', href TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
CREATE INDEX IF NOT EXISTS idx_reset_user ON reset_tokens(user_id);
`;

function create() {
  const file = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'site.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  let depth = 0;

  return {
    kind: 'sqlite',
    async init() {
      db.exec(SCHEMA);
      // Older databases predate the email column.
      const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
      if (!cols.includes('email')) {
        db.exec('ALTER TABLE users ADD COLUMN email TEXT');
        db.prepare(`UPDATE users SET email = lower(username) WHERE username LIKE '%_@_%.__%'`).run();
      }
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL');
    },
    /** $1-style placeholders are translated to SQLite's ?. */
    async query(sql, params = []) {
      const text = sql.replace(/\$(\d+)/g, '?');
      const stmt = db.prepare(text);
      return /^\s*(select|with|.*returning)/is.test(text)
        ? { rows: stmt.all(...params) }
        : { rows: [], rowCount: stmt.run(...params).changes };
    },
    /* better-sqlite3's own db.transaction() cannot wrap an async callback,
       so the statements are issued directly. depth guards against nesting,
       which SQLite would otherwise reject. */
    async transaction(fn) {
      if (depth++) { try { return await fn(this); } finally { depth--; } }
      db.exec('BEGIN');
      try { const out = await fn(this); db.exec('COMMIT'); return out; }
      catch (e) { try { db.exec('ROLLBACK'); } catch { /* already unwound */ } throw e; }
      finally { depth--; }
    },
    async columnsOf(table) {
      return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name).filter(n => n !== 'id');
    },
    async close() { db.close(); },
  };
}
module.exports = { create, SCHEMA };
