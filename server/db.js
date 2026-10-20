'use strict';
/* The database, as the rest of the app sees it.
 *
 * Everything here is async and backend-agnostic: the same calls run against
 * SQLite locally and Postgres (Supabase) in production. Pick one with
 * DB_DRIVER — see server/data/index.js. */
const data = require('./data');

module.exports = {
  init: data.init,
  kind: data.kind,
  reset: data.reset,
  nowIso: data.nowIso,
  TABLES: data.TABLES,
  isTable: data.isTable,
  allContent: data.allContent,
  setContent: data.setContent,
  listRows: data.listRows,
  replaceRows: data.replaceRows,
  columnsOf: data.columnsOf,
  count: data.count,
  destroyUserSessions: data.destroyUserSessions,
  /** Raw access, for the session store and the rate limiter. */
  query: async (sql, params) => (await data.db()).query(sql, params),
  transaction: async fn => (await data.db()).transaction(fn),
};
