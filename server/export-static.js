#!/usr/bin/env node
'use strict';
/* Renders a complete static copy of the public site — no database, no Node at
   runtime. This is what GitHub Pages serves.

     npm run build                                  → dist/, from data/content.json
     npm run build -- --base /lorenodenWebsite      → for a project GitHub Page
     npm run build -- --from-db                     → read the live database instead
     npm run build -- --out public_html             → somewhere other than dist/   */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.join(__dirname, '..');
const VIEWS = path.join(ROOT, 'views');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = name => argv.includes('--' + name);

const base = (flag('base', process.env.BASE_PATH || '')).replace(/\/$/, '');
const OUT = path.resolve(ROOT, flag('out', 'dist'));
const fromDb = has('from-db');

const { pageData, fileData } = require('./pagedata');
const data = fromDb
  ? pageData({ base, staticMode: true })
  : fileData(undefined, { base, staticMode: true });

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const dir of ['assets', 'css', 'js']) copyDir(path.join(ROOT, 'public', dir), path.join(OUT, dir));
// uploads may live outside the repo
const uploadDir = process.env.UPLOAD_DIR || path.join(ROOT, 'public', 'assets', 'uploads');
copyDir(uploadDir, path.join(OUT, 'assets', 'uploads'));
// the admin's stylesheet and script have no business in a public build
for (const f of ['css/admin.css', 'js/admin.js']) fs.rmSync(path.join(OUT, f), { force: true });

const opts = { views: [VIEWS], filename: path.join(VIEWS, 'page.ejs') };
for (const [view, file] of [['index', 'index.html'], ['gallery', 'gallery.html']]) {
  const html = ejs.render(fs.readFileSync(path.join(VIEWS, view + '.ejs'), 'utf8'), data, opts);
  fs.writeFileSync(path.join(OUT, file), html);
  console.log(`✓ ${file.padEnd(13)} ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB`);
}

/* The listening room reads this exactly as it does on the server. */
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
const rows = data.tracks.map((t, i) => ({
  order: i + 1, title: t.title, artist: t.artist, album: t.album,
  category: t.category, role: t.role, source: t.source, embed: t.embed || '',
}));
fs.writeFileSync(path.join(OUT, 'data', 'catalog.js'),
  'window.LO_CATALOG = ' + JSON.stringify(rows) + ';\n');
console.log(`✓ ${'data/catalog.js'.padEnd(13)} ${rows.length} selections`);

/* GitHub Pages: skip Jekyll, and serve the gallery for an unknown path. */
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');
fs.copyFileSync(path.join(OUT, 'index.html'), path.join(OUT, '404.html'));

console.log(`\nStatic site → ${OUT}${base ? `   (base path ${base})` : ''}`);
console.log(fromDb ? 'Source: the live database' : 'Source: data/content.json — no database used');
