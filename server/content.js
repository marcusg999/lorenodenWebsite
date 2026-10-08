#!/usr/bin/env node
'use strict';
/*  npm run content:export   database → data/content.json  (commit this)
    npm run content:import   data/content.json → database                 */
const cf = require('./content-file');
const cmd = process.argv[2];

try {
  if (cmd === 'export') {
    const d = cf.exportFromDb();
    console.log(`✓ Wrote ${cf.FILE}`);
    console.log(`  ${Object.keys(d.content).length} fields · ` +
      cf.TABLES.map(t => `${d[t].length} ${t}`).join(' · '));
  } else if (cmd === 'import') {
    const d = cf.importToDb();
    console.log(`✓ Loaded ${cf.FILE} into the database`);
    console.log(`  ${Object.keys(d.content).length} fields · ` +
      cf.TABLES.map(t => `${d[t].length} ${t}`).join(' · '));
  } else {
    console.error('Usage: node server/content.js <export|import>');
    process.exit(1);
  }
} catch (e) { console.error('✗ ' + e.message); process.exit(1); }
