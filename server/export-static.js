#!/usr/bin/env node
'use strict';
/* Renders the current database content to a plain static site in dist/.
   Useful for putting the public pages on a CDN while the portal runs elsewhere.
     npm run export            → dist/
     npm run export -- out/    → out/                                        */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { pageData } = require('./pagedata');
const { listRows } = require('./db');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'dist');
const VIEWS = path.join(ROOT, 'views');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const dir of ['assets', 'css', 'js']) copyDir(path.join(ROOT, 'public', dir), path.join(OUT, dir));

const data = pageData();
const opts = { views: [VIEWS], filename: path.join(VIEWS, 'x.ejs') };

for (const [view, file] of [['index', 'index.html'], ['gallery', 'gallery.html']]) {
  let html = ejs.render(fs.readFileSync(path.join(VIEWS, view + '.ejs'), 'utf8'), data, opts);
  // static build has no /gallery route, so point at the file
  html = html.replace(/href="\/gallery"/g, 'href="gallery.html"').replace(/href="\/"/g, 'href="index.html"');
  fs.writeFileSync(path.join(OUT, file), html);
  console.log(`✓ ${file}  ${(html.length / 1024).toFixed(1)} kB`);
}

fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
const rows = listRows('tracks').map((t, i) => ({
  order: i + 1, title: t.title, artist: t.artist, album: t.album,
  category: t.category, role: t.role, source: t.source, embed: t.embed || '',
}));
fs.writeFileSync(path.join(OUT, 'data', 'catalog.js'), 'window.LO_CATALOG = ' + JSON.stringify(rows) + ';\n');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log(`✓ data/catalog.js  ${rows.length} selections`);
console.log(`\nStatic site written to ${OUT}`);
