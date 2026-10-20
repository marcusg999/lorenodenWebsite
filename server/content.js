#!/usr/bin/env node
'use strict';
/*  npm run content:export   database → data/content.json  (commit this)
    npm run content:import   data/content.json → database                 */
const cf = require('./content-file');
const { init, reset } = require('./db');
const cmd = process.argv[2];

const summary = d => `  ${Object.keys(d.content).length} fields · ` +
  cf.TABLES.map(t => `${d[t].length} ${t}`).join(' · ');

(async () => {
  if (cmd !== 'export' && cmd !== 'import') {
    console.error('Usage: node server/content.js <export|import>');
    process.exit(1);
  }
  await init();
  if (cmd === 'export') {
    console.log(`✓ Wrote ${cf.FILE}`);
    console.log(summary(await cf.exportFromDb()));
  } else {
    const d = await cf.importToDb();
    console.log(`✓ Loaded ${cf.FILE} into the database`);
    console.log(summary(d));
  }
  await reset();
})().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
