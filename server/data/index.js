'use strict';
/* The data layer. Picks a backend and exposes one async API above it.
 *
 *   DB_DRIVER=sqlite    (default)  local development, zero setup
 *   DB_DRIVER=postgres  + DATABASE_URL   Supabase, or any Postgres
 *
 * Queries are written once with $1 placeholders; the SQLite backend
 * translates them. Timestamps are passed from JavaScript rather than taken
 * from a database function, because those differ between the two. */
const { ALL_FIELDS } = require('../schema');

const TABLES = ['nav', 'releases', 'tracks', 'shows', 'credits', 'press', 'shots', 'links'];
const isTable = t => TABLES.includes(t);
const nowIso = () => new Date().toISOString();

let driver = null;
let ready = null;

function pick() {
  const name = (process.env.DB_DRIVER || 'sqlite').toLowerCase();
  if (name === 'postgres' || name === 'pg') return require('./postgres').create();
  if (name === 'sqlite') return require('./sqlite').create();
  throw new Error(`Unknown DB_DRIVER "${name}". Use sqlite or postgres.`);
}

/** Connect and create the schema. Safe to call repeatedly.
 *  A failure is not remembered: a warm instance whose first connection fell
 *  over would otherwise keep serving that same error for its whole life. */
function init() {
  if (!ready) {
    ready = (async () => {
      driver = pick();
      await driver.init();
      return driver;
    })().catch(e => { driver = null; ready = null; throw e; });
  }
  return ready;
}
async function db() { await init(); return driver; }
async function kind() { return (await db()).kind; }

/** Close and forget the connection — used between tests. */
async function reset() {
  if (driver) { try { await driver.close(); } catch { /* already gone */ } }
  driver = null; ready = null;
}

/* ---- content ---------------------------------------------------------- */
async function allContent() {
  const d = await db();
  const out = Object.create(null);
  for (const f of ALL_FIELDS) out[f.key] = f.def ?? '';      // defaults first
  for (const r of (await d.query('SELECT key, value FROM content')).rows) out[r.key] = r.value;
  return out;
}

async function setContent(pairs) {
  const d = await db();
  const at = nowIso();
  await d.transaction(async t => {
    for (const [k, v] of pairs) {
      await t.query(
        `INSERT INTO content (key, value, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [k, String(v ?? ''), at]);
    }
  });
}

/* ---- collections ------------------------------------------------------- */
async function listRows(table) {
  if (!isTable(table)) throw new Error('unknown collection: ' + table);
  const d = await db();
  return (await d.query(`SELECT * FROM ${table} ORDER BY position ASC, id ASC`)).rows;
}

async function replaceRows(table, rows) {
  if (!isTable(table)) throw new Error('unknown collection: ' + table);
  const d = await db();
  const cols = (await d.columnsOf(table)).filter(c => c !== 'position');
  await d.transaction(async t => {
    await t.query(`DELETE FROM ${table}`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const values = cols.map(c => {
        const v = row[c];
        if (v === undefined || v === null) return '';
        return typeof v === 'number' ? v : String(v);
      });
      const ph = cols.map((_, n) => `$${n + 2}`).join(', ');
      await t.query(
        `INSERT INTO ${table} (position, ${cols.join(', ')}) VALUES ($1, ${ph})`,
        [i, ...values]);
    }
  });
}

async function count(table) {
  if (!isTable(table)) throw new Error('unknown collection: ' + table);
  const d = await db();
  return Number((await d.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
}

/* ---- sessions ---------------------------------------------------------- */
/** Drop every stored session for one user, after a password reset. */
async function destroyUserSessions(userId) {
  const d = await db();
  const rows = (await d.query('SELECT sid, data FROM sessions')).rows;
  let n = 0;
  for (const r of rows) {
    try {
      if (JSON.parse(r.data).userId === userId) {
        await d.query('DELETE FROM sessions WHERE sid = $1', [r.sid]); n++;
      }
    } catch { /* unreadable row: the sweeper will take it */ }
  }
  return n;
}

module.exports = {
  init, db, kind, reset, nowIso,
  TABLES, isTable,
  allContent, setContent,
  listRows, replaceRows, count, destroyUserSessions,
  columnsOf: async table => {
    if (!isTable(table)) throw new Error('unknown collection: ' + table);
    return (await db()).columnsOf(table);
  },
};
