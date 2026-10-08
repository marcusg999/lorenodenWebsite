'use strict';
/* The portable form of the site's content: one JSON file holding every field
   and list. It is what the static build reads, so a GitHub Pages build needs
   no database at all — and it is the handover format for a later move to
   Supabase or anything else. */
const fs = require('fs');
const path = require('path');
const { ALL_FIELDS } = require('./schema');

const FILE = path.join(__dirname, '..', 'data', 'content.json');
const TABLES = ['nav', 'releases', 'tracks', 'shows', 'credits', 'press', 'shots', 'links'];

/** Read the committed content file. Throws a useful message if it is missing. */
function readFile(file = FILE) {
  if (!fs.existsSync(file)) {
    throw new Error(`No content file at ${file}.\nCreate one from the database with:  npm run content:export`);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const content = Object.create(null);
  for (const f of ALL_FIELDS) content[f.key] = f.def ?? '';
  Object.assign(content, data.content || {});
  const out = { content, version: data.version || 1, exportedAt: data.exportedAt || null };
  for (const t of TABLES) out[t] = Array.isArray(data[t]) ? data[t] : [];
  return out;
}

/** Dump the live database to the content file. */
function exportFromDb(file = FILE) {
  const { allContent, listRows } = require('./db');
  const out = { version: 1, exportedAt: new Date().toISOString(), content: allContent() };
  for (const t of TABLES) {
    out[t] = listRows(t).map(r => { const { id, position, ...rest } = r; return rest; });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  return out;
}

/** Load the content file into the database, replacing what is there. */
function importToDb(file = FILE) {
  const { setContent, replaceRows } = require('./db');
  const data = readFile(file);
  setContent(Object.entries(data.content));
  for (const t of TABLES) if (data[t].length) replaceRows(t, data[t]);
  return data;
}

module.exports = { FILE, TABLES, readFile, exportFromDb, importToDb };
