'use strict';
/* Postgres backend — Supabase, or any Postgres.
 *
 *   DATABASE_URL  postgresql://postgres.<ref>:<pw>@<host>:6543/postgres
 *
 * Use Supabase's **transaction pooler** (port 6543) when the portal runs as
 * serverless functions: each invocation is short-lived and the direct port
 * would exhaust connections. The pool below is deliberately tiny for the
 * same reason. */
const fs = require('fs');
const { Pool } = require('pg');

/* TLS for the database connection.
 *
 * Verification is ON by default. Turning it off — which a lot of Supabase
 * snippets do — means anything that can get between this app and the
 * database can read and rewrite the traffic, including the session rows and
 * the password hashes. Two honest ways out if the default chain is rejected:
 *
 *   PGSSL_CA         path to Supabase's CA certificate, or the PEM itself
 *                    (Project Settings → Database → SSL Configuration)
 *   PGSSL_NO_VERIFY  last resort; logs a warning every start
 */
function tlsFor(url) {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return false;
  if (String(process.env.PGSSL_NO_VERIFY || '').toLowerCase() === 'true') {
    console.warn('[pg] TLS certificate verification is OFF (PGSSL_NO_VERIFY). ' +
                 'Set PGSSL_CA to the database CA instead.');
    return { rejectUnauthorized: false };
  }
  const ca = process.env.PGSSL_CA;
  if (ca) {
    return { rejectUnauthorized: true, ca: ca.includes('BEGIN CERTIFICATE') ? ca : fs.readFileSync(ca, 'utf8') };
  }
  return { rejectUnauthorized: true };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS content (
  key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE, username TEXT, password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT '', last_login TEXT
);
CREATE TABLE IF NOT EXISTS reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at BIGINT NOT NULL,
  used_at TEXT, created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY, expires BIGINT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_hits (
  bucket TEXT NOT NULL, window_start BIGINT NOT NULL, hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
CREATE TABLE IF NOT EXISTS nav      (id BIGSERIAL PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0, label TEXT DEFAULT '', href TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS releases (id BIGSERIAL PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0, tag TEXT DEFAULT '', title TEXT DEFAULT '', body TEXT DEFAULT '', link_label TEXT DEFAULT '', url TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS tracks   (id BIGSERIAL PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0, title TEXT DEFAULT '', artist TEXT DEFAULT '', album TEXT DEFAULT '', category TEXT DEFAULT 'Features', role TEXT DEFAULT '', source TEXT DEFAULT '', embed TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS shows    (id BIGSERIAL PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0, kind TEXT DEFAULT 'past', date_label TEXT DEFAULT '', venue TEXT DEFAULT '', location TEXT DEFAULT '', note TEXT DEFAULT '', url TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS credits  (id BIGSERIAL PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0, meta TEXT DEFAULT '', title TEXT DEFAULT '', body TEXT DEFAULT '', url TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS press    (id BIGSERIAL PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0, meta TEXT DEFAULT '', title TEXT DEFAULT '', url TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS shots    (id BIGSERIAL PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0, src TEXT DEFAULT '', alt TEXT DEFAULT '', caption_bold TEXT DEFAULT '', caption TEXT DEFAULT '', width INTEGER DEFAULT 1600, height INTEGER DEFAULT 1000, shape TEXT DEFAULT 'a');
CREATE TABLE IF NOT EXISTS links    (id BIGSERIAL PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0, label TEXT DEFAULT '', href TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
CREATE INDEX IF NOT EXISTS idx_reset_user ON reset_tokens(user_id);
`;

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required when DB_DRIVER=postgres.');

  /* PGSCHEMA puts every table in a named schema instead of public. It is how
     the test files keep out of each other's way while sharing one database —
     they run as separate processes, in parallel. Left unset in production:
     a connection pooler in transaction mode may refuse startup options. */
  const schema = String(process.env.PGSCHEMA || '').replace(/[^A-Za-z0-9_]/g, '');
  const pool = new Pool({
    connectionString: url,
    ssl: tlsFor(url),                               // set here, so sslmode= in the URL cannot weaken it
    max: Number(process.env.PGPOOL_MAX || 3),       // small: serverless wants few
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
  pool.on('error', e => console.error('[pg] idle client error:', e.message));

  return {
    kind: 'postgres',
    async init() {
      if (schema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await pool.query(SCHEMA);
    },
    async query(sql, params = []) {
      const r = await pool.query(sql, params);
      return { rows: r.rows, rowCount: r.rowCount };
    },
    async transaction(fn) {
      const client = await pool.connect();
      const scoped = {
        kind: 'postgres',
        query: async (sql, params = []) => {
          const r = await client.query(sql, params);
          return { rows: r.rows, rowCount: r.rowCount };
        },
      };
      try {
        await client.query('BEGIN');
        const out = await fn(scoped);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        throw e;
      } finally { client.release(); }
    },
    async columnsOf(table) {
      const r = await pool.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = $1
          ORDER BY ordinal_position`, [table]);
      return r.rows.map(x => x.column_name).filter(n => n !== 'id');
    },
    async close() { await pool.end(); },
  };
}
module.exports = { create, SCHEMA };
