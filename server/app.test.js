'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

/* Each run gets a throwaway database. The whole file runs against whichever
   backend DB_DRIVER names, so the same assertions cover SQLite and Postgres:
     npm test            SQLite
     npm run test:pg     Postgres / Supabase, with DATABASE_URL set          */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.SESSION_SECRET = 'test-secret-not-used-in-production';
// Test files run as parallel processes; on Postgres they would otherwise
// share one set of tables. Each gets its own schema instead.
process.env.PGSCHEMA = process.env.PGSCHEMA || 'test_app';
const DRIVER = process.env.DB_DRIVER || 'sqlite';

const app = require('./app');
const { createUser } = require('./auth');
const { init, reset, replaceRows, query, TABLES } = require('./db');

/** Postgres keeps its tables between runs; start every run from empty. */
async function wipe() {
  if (DRIVER === 'sqlite') return;
  for (const t of ['rate_hits', 'sessions', 'reset_tokens', 'users', 'content', ...TABLES]) {
    await query(`DELETE FROM ${t}`);
  }
}

let server, base, SESSION;
const PW = 'quiet-lantern-9471';
const EMAIL = 'loren@example.com';

before(async () => {
  await init();
  await wipe();
  await replaceRows('nav', [{ label: 'Music', href: '/#room' }, { label: 'From the Road', href: '/gallery' }]);
  await replaceRows('tracks', [
    { title: 'Through My Soul', artist: 'Adrian Younge', album: 'x', category: 'Features', role: 'Featured vocals', source: 'https://example.com', embed: '' },
    { title: 'Is There a Way', artist: 'Loren Oden', album: 'y', category: 'Solo', role: 'Lead vocals', source: 'https://example.com', embed: '' },
  ]);
  await replaceRows('shows', [{ kind: 'past', date_label: 'May 2019', venue: 'Norwich Arts Centre', location: 'Norwich', note: '', url: 'https://example.com' }]);
  await replaceRows('shots', [{ src: 'assets/img/norwich-1', alt: 'a', caption_bold: 'Norwich', caption: '2019', width: 1, height: 1, shape: 'a' }]);
  await createUser(EMAIL, PW);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  SESSION = await signIn();   // reused by the write tests below
});
after(async () => {
  server.close();
  await wipe();
  await reset();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A fresh client IP per call: the app trusts one proxy hop, so this keys the
 *  rate limiter separately and keeps tests independent of each other's order. */
let ipSeq = 0;
const nextIp = () => `10.9.${Math.floor(++ipSeq / 250) % 250}.${ipSeq % 250}`;

/** Sign in and return { cookie, csrf }. */
async function signIn(username = EMAIL, password = PW, ip = nextIp()) {
  const page = await fetch(`${base}/admin/login`, { headers: { 'X-Forwarded-For': ip } });
  let cookie = (page.headers.get('set-cookie') || '').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie, 'X-Forwarded-For': ip, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, username, password }),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const admin = await fetch(`${base}/admin`, { headers: { cookie } });
  const body = await admin.text();
  const m = body.match(/"csrf":"([^"]+)"/);
  return { status: res.status, cookie, csrf: m && m[1] };
}

/* ---------------- public ---------------- */
test('home page renders content from the database', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /A voice rooted in soul\./);
  assert.match(html, /Norwich Arts Centre/);
});

test('gallery page renders', async () => {
  const r = await fetch(`${base}/gallery`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /From the/);
});

test('catalog endpoint reflects the database and numbers rows', async () => {
  const body = await (await fetch(`${base}/data/catalog.js`)).text();
  const rows = JSON.parse(body.replace(/^window\.LO_CATALOG = /, '').replace(/;\s*$/, ''));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].order, 1);
  assert.equal(rows[1].order, 2);
});

test('robots.txt keeps crawlers out of the portal', async () => {
  assert.match(await (await fetch(`${base}/robots.txt`)).text(), /Disallow: \/admin/);
});

/* ---------------- auth ---------------- */
test('the portal redirects anonymous visitors to the login page', async () => {
  const r = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/admin/login');
});

test('the API rejects anonymous writes', async () => {
  const r = await fetch(`${base}/api/content`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'hero.eyebrow': 'nope' }),
  });
  assert.equal(r.status, 401);
});

test('a wrong password does not sign anyone in', async () => {
  const { status } = await signIn(EMAIL, 'definitely-wrong-password');
  assert.equal(status, 401);
});

test('a correct password signs in and the session cookie is HttpOnly', async () => {
  const ip = nextIp();
  const page = await fetch(`${base}/admin/login`, { headers: { 'X-Forwarded-For': ip } });
  const cookie = (page.headers.get('set-cookie') || '').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const r = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie, 'X-Forwarded-For': ip, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, username: EMAIL, password: PW }),
  });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('set-cookie') || '', /HttpOnly/i);
});

test('the session id is regenerated on login (no session fixation)', async () => {
  const ip = nextIp();
  const page = await fetch(`${base}/admin/login`, { headers: { 'X-Forwarded-For': ip } });
  const pre = (page.headers.get('set-cookie') || '').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const r = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: pre, 'X-Forwarded-For': ip, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, username: EMAIL, password: PW }),
  });
  const post = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.notEqual(pre, post, 'the pre-login cookie must not survive sign-in');
});

/* ---------------- CSRF ---------------- */
test('a signed-in request without a CSRF token is refused', async () => {
  const { cookie } = await signIn();
  const r = await fetch(`${base}/api/content`, {
    method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'hero.eyebrow': 'nope' }),
  });
  assert.equal(r.status, 403);
});

/* ---------------- writes ---------------- */
test('an edit saves and appears on the public page', async () => {
  const { cookie, csrf } = SESSION;
  const r = await fetch(`${base}/api/content`, {
    method: 'PUT', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'hero.eyebrow': 'A voice under test.' }),
  });
  assert.equal(r.status, 200);
  assert.match(await (await fetch(`${base}/`)).text(), /A voice under test\./);
});

test('unknown content keys are rejected', async () => {
  const { cookie, csrf } = SESSION;
  const r = await fetch(`${base}/api/content`, {
    method: 'PUT', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'totally.made.up': 'x' }),
  });
  assert.equal(r.status, 400);
});

test('HTML in a content field is escaped, not executed', async () => {
  const { cookie, csrf } = SESSION;
  await fetch(`${base}/api/content`, {
    method: 'PUT', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'hero.eyebrow': '<script>alert(1)</script>' }),
  });
  const html = await (await fetch(`${base}/`)).text();
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not reach the page');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('a javascript: link is neutralised', async () => {
  const { cookie, csrf } = SESSION;
  await fetch(`${base}/api/content`, {
    method: 'PUT', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'hero.cta1.href': 'javascript:alert(1)' }),
  });
  const html = await (await fetch(`${base}/`)).text();
  assert.ok(!/href="javascript:/i.test(html), 'javascript: must never reach an href');
});

test('a collection round-trips and keeps the submitted order', async () => {
  const { cookie, csrf } = SESSION;
  const r = await fetch(`${base}/api/collection/tracks`, {
    method: 'PUT', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: [
      { title: 'Second', artist: 'b', album: '', category: 'Solo', role: '', source: '', embed: '' },
      { title: 'First', artist: 'a', album: '', category: 'Features', role: '', source: '', embed: '' },
    ] }),
  });
  assert.equal(r.status, 200);
  const body = await (await fetch(`${base}/data/catalog.js`)).text();
  const rows = JSON.parse(body.replace(/^window\.LO_CATALOG = /, '').replace(/;\s*$/, ''));
  assert.deepEqual(rows.map(t => t.title), ['Second', 'First']);
});

test('an unknown collection is a 404', async () => {
  const { cookie, csrf } = SESSION;
  const r = await fetch(`${base}/api/collection/users`, {
    method: 'PUT', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: [] }),
  });
  assert.equal(r.status, 404);
});

test('adding an upcoming show replaces the empty state', async () => {
  const { cookie, csrf } = SESSION;
  await fetch(`${base}/api/collection/shows`, {
    method: 'PUT', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: [
      { kind: 'upcoming', date_label: '14 Nov 2026', venue: 'Blue Note', location: 'Tokyo', note: '', url: 'https://example.com' },
    ] }),
  });
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /Blue Note/);
  assert.ok(!html.includes('No dates are currently listed'), 'the empty state must step aside for a real date');
});

/* ---------------- passwords ---------------- */
test('a weak password is refused', async () => {
  const { cookie, csrf } = SESSION;
  const r = await fetch(`${base}/api/password`, {
    method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ current: PW, next: 'short' }),
  });
  assert.equal(r.status, 400);
});

test('changing a password needs the current one', async () => {
  const { cookie, csrf } = SESSION;
  const r = await fetch(`${base}/api/password`, {
    method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ current: 'not-the-current-password', next: 'another-quiet-lantern-55' }),
  });
  assert.equal(r.status, 401);
});

/* ---------------- rate limiting ---------------- */
test('repeated failed sign-ins are rate limited', async () => {
  let saw429 = false;
  const ip = '10.200.0.1';                    // one bucket, used only here
  for (let i = 0; i < 14 && !saw429; i++) {
    const page = await fetch(`${base}/admin/login`, { headers: { 'X-Forwarded-For': ip } });
    const cookie = (page.headers.get('set-cookie') || '').split(';')[0];
    const m = (await page.text()).match(/name="_csrf" value="([^"]+)"/);
    const r = await fetch(`${base}/admin/login`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie, 'X-Forwarded-For': ip, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: m ? m[1] : '', username: EMAIL, password: 'wrong-every-time' }),
    });
    if (r.status === 429) saw429 = true;
  }
  assert.ok(saw429, 'the login route must start refusing after repeated failures');
});

/* ---------------- image upload ---------------- */
const sharpLib = require('sharp');
const makePng = (w = 1200, h = 800) =>
  sharpLib({ create: { width: w, height: h, channels: 3, background: '#C8FF1E' } }).png().toBuffer();

async function postImage(buf, filename, { cookie, csrf }, type = 'image/png') {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type }), filename);
  return fetch(`${base}/api/upload`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf }, body: fd });
}

test('upload rejects anonymous callers', async () => {
  const fd = new FormData();
  fd.append('image', new Blob([await makePng()], { type: 'image/png' }), 'a.png');
  const r = await fetch(`${base}/api/upload`, { method: 'POST', body: fd });
  assert.equal(r.status, 401);
});

test('upload rejects a request without a CSRF token', async () => {
  const fd = new FormData();
  fd.append('image', new Blob([await makePng()], { type: 'image/png' }), 'a.png');
  const r = await fetch(`${base}/api/upload`, { method: 'POST', headers: { cookie: SESSION.cookie }, body: fd });
  assert.equal(r.status, 403);
});

test('an uploaded image is re-encoded to a .webp/.jpg pair and served', async () => {
  const r = await postImage(await makePng(2600, 1700), 'Loren LIVE!! (final).PNG', SESSION);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.src, /^assets\/uploads\/loren-live-final-[0-9a-f]{8}$/, 'name is sanitised and unique');
  assert.ok(j.width <= 2200 && j.height <= 2200, 'oversized images are scaled down');
  for (const ext of ['.webp', '.jpg']) {
    const res = await fetch(`${base}/${j.src}${ext}`);
    assert.equal(res.status, 200, `${ext} should be served`);
  }
  UPLOADED = j.src.split('/').pop();
});
let UPLOADED;

test('a file that is not an image is refused', async () => {
  const r = await postImage(Buffer.from('#!/bin/sh\necho pwned\n'), 'evil.jpg', SESSION, 'image/jpeg');
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /could not be read as an image/);
});

test('an SVG is refused (it can carry script)', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const r = await postImage(svg, 'x.svg', SESSION, 'image/svg+xml');
  assert.equal(r.status, 400);
});

test('an oversized file is refused', async () => {
  const r = await postImage(Buffer.alloc(13 * 1024 * 1024, 1), 'big.jpg', SESSION, 'image/jpeg');
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /larger than/);
});

test('the media library lists the upload, and delete refuses traversal', async () => {
  const { cookie, csrf } = SESSION;
  const list = await (await fetch(`${base}/api/media`, { headers: { cookie } })).json();
  assert.ok(list.media.some(m => m.name === UPLOADED), 'the upload should be listed');

  const bad = await fetch(`${base}/api/media/${encodeURIComponent('../../package.json')}`, {
    method: 'DELETE', headers: { cookie, 'X-CSRF-Token': csrf },
  });
  assert.equal(bad.status, 400);
  assert.ok(require('fs').existsSync(require('path').join(__dirname, '..', 'package.json')), 'package.json must survive');

  const ok = await fetch(`${base}/api/media/${UPLOADED}`, {
    method: 'DELETE', headers: { cookie, 'X-CSRF-Token': csrf },
  });
  assert.equal(ok.status, 200);
});

/* ---------------- database-free static build ---------------- */
test('the content file round-trips through the database', async () => {
  const os2 = require('os'), fs2 = require('fs'), path2 = require('path');
  const cf = require('./content-file');
  const tmpFile = path2.join(fs2.mkdtempSync(path2.join(os2.tmpdir(), 'lo-cf-')), 'content.json');
  const written = await cf.exportFromDb(tmpFile);
  assert.ok(Object.keys(written.content).length >= 70);
  const read = cf.readFile(tmpFile);
  assert.equal(read.tracks.length, written.tracks.length);
  assert.equal(read.content['hero.name1'], written.content['hero.name1']);
});

test('the static build renders from JSON alone, with a base path and .html links', async () => {
  const os2 = require('os'), fs2 = require('fs'), path2 = require('path'), ejs = require('ejs');
  const cf = require('./content-file');
  const { fileData } = require('./pagedata');
  const tmpFile = path2.join(fs2.mkdtempSync(path2.join(os2.tmpdir(), 'lo-build-')), 'content.json');
  await cf.exportFromDb(tmpFile);

  const views = path2.join(__dirname, '..', 'views');
  const data = fileData(tmpFile, { base: '/lorenodenWebsite', staticMode: true });
  const html = ejs.render(fs2.readFileSync(path2.join(views, 'index.ejs'), 'utf8'), data,
    { views: [views], filename: path2.join(views, 'page.ejs') });

  assert.match(html, /href="\/lorenodenWebsite\/css\/lantern\.css"/, 'assets carry the base path');
  assert.match(html, /href="\/lorenodenWebsite\/gallery\.html"/, 'routes become .html files');
  assert.ok(!/(href|src)="\/(css|js|assets|data)\//.test(html), 'no un-prefixed absolute asset URLs');
  assert.ok(!/href="\/gallery"/.test(html), 'no server-only routes remain');
});

/* ---------------- email as the sign-in identifier ---------------- */
test('sign-in is by email, and the address is case-insensitive', async () => {
  const ip = nextIp();
  const page = await fetch(`${base}/admin/login`, { headers: { 'X-Forwarded-For': ip } });
  const cookie = (page.headers.get('set-cookie') || '').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const r = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie, 'X-Forwarded-For': ip, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, username: 'LoRen@Example.COM', password: PW }),
  });
  assert.equal(r.status, 302, 'a differently-cased address is the same account');
});

test('the old username no longer signs anyone in', async () => {
  const { status } = await signIn('loren', PW);
  assert.equal(status, 401);
});

test('the login page asks for an email and offers a reset link', async () => {
  const html = await (await fetch(`${base}/admin/login`)).text();
  assert.match(html, /type="email"/);
  assert.match(html, /href="\/admin\/forgot"/);
});

/* ---------------- password reset ---------------- */
const { createResetToken, findUser, consumeResetToken } = require('./auth');

/** Walk the reset form the way a browser would. */
async function postReset(token, password, confirm = password) {
  const ip = nextIp();
  // An invalid token renders the "link expired" page, which carries no form.
  // Take the CSRF token from a page that does, on the same session — this is
  // the real-world path: the form loaded while the token was still good.
  const page = await fetch(`${base}/admin/forgot`, { headers: { 'X-Forwarded-For': ip } });
  const cookie = (page.headers.get('set-cookie') || '').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)?.[1] || '';
  return fetch(`${base}/admin/reset`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie, 'X-Forwarded-For': ip, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, token, password, confirm }),
  });
}

test('forgot-password answers identically for a known and an unknown address', async () => {
  const ask = async email => {
    const ip = nextIp();
    const page = await fetch(`${base}/admin/forgot`, { headers: { 'X-Forwarded-For': ip } });
    const cookie = (page.headers.get('set-cookie') || '').split(';')[0];
    const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
    const r = await fetch(`${base}/admin/forgot`, {
      method: 'POST',
      headers: { cookie, 'X-Forwarded-For': ip, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, email }),
    });
    return { status: r.status, body: await r.text() };
  };
  const known = await ask(EMAIL);
  const unknown = await ask('nobody-here@example.com');
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(known.body, unknown.body, 'the two responses must be byte-identical');
  assert.match(known.body, /Check your inbox/);
});

test('a reset token sets a new password and is then spent', async () => {
  const NEW = 'a-brand-new-lantern-42';
  const token = await createResetToken((await findUser(EMAIL)).id);

  const ok = await postReset(token, NEW);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Password changed/);

  const after = await signIn(EMAIL, NEW);
  assert.equal(after.status, 302, 'the new password works');

  const reuse = await postReset(token, 'yet-another-lantern-9');
  assert.equal(reuse.status, 400);
  assert.match(await reuse.text(), /expired or has already been used/);

  // put it back for the tests that follow
  await require('./auth').setPassword(EMAIL, PW);
});

test('an expired token is refused', async () => {
  const token = await createResetToken((await findUser(EMAIL)).id);
  await query('UPDATE reset_tokens SET expires_at = $1 WHERE user_id = $2',
    [Date.now() - 1000, (await findUser(EMAIL)).id]);
  assert.equal(await consumeResetToken(token), null);
  const r = await postReset(token, 'should-not-be-set-111');
  assert.equal(r.status, 400);
  assert.equal(await require('./auth').verify(EMAIL, 'should-not-be-set-111'), null);
});

test('a forged token is refused', async () => {
  const r = await postReset('not-a-real-token-at-all', 'should-not-be-set-222');
  assert.equal(r.status, 400);
  assert.equal(await require('./auth').verify(EMAIL, 'should-not-be-set-222'), null);
});

test('the raw token is never stored — only its hash', async () => {
  const token = await createResetToken((await findUser(EMAIL)).id);
  const { rows } = await query('SELECT token_hash FROM reset_tokens');
  assert.ok(rows.length > 0);
  assert.ok(!rows.some(r => r.token_hash === token), 'the plain token must not be in the table');
  assert.ok(rows.every(r => /^[0-9a-f]{64}$/.test(r.token_hash)), 'stored values are sha-256 hashes');
});

test('mismatched or weak passwords are refused by the reset form', async () => {
  const token = await createResetToken((await findUser(EMAIL)).id);
  const mismatch = await postReset(token, 'one-good-password-1', 'a-different-one-22');
  assert.equal(mismatch.status, 400);
  assert.match(await mismatch.text(), /do not match/);

  const weak = await postReset(token, 'short', 'short');
  assert.equal(weak.status, 400);
  assert.match(await weak.text(), /at least 12 characters/);
});

test('resetting a password signs out every other browser', async () => {
  const other = await signIn();                       // a second signed-in session
  assert.equal((await fetch(`${base}/admin`, { headers: { cookie: other.cookie }, redirect: 'manual' })).status, 200);

  const NEW = 'turned-out-lantern-77';
  const token = await createResetToken((await findUser(EMAIL)).id);
  assert.equal((await postReset(token, NEW)).status, 200);

  const stillIn = await fetch(`${base}/admin`, { headers: { cookie: other.cookie }, redirect: 'manual' });
  assert.equal(stillIn.status, 302, 'the other session must be turned out');

  await require('./auth').setPassword(EMAIL, PW);
});

test('the reset link is built from APP_URL, not the Host header', async () => {
  const mailer = require('./mailer');
  const prevUrl = process.env.APP_URL, prevEnv = process.env.NODE_ENV;
  process.env.APP_URL = 'https://lorenoden.com';
  assert.equal(mailer.appUrl({ protocol: 'http', get: () => 'attacker.example' }), 'https://lorenoden.com');

  delete process.env.APP_URL;
  process.env.NODE_ENV = 'production';
  assert.throws(() => mailer.appUrl({ protocol: 'http', get: () => 'attacker.example' }), /APP_URL must be set/);

  if (prevUrl) process.env.APP_URL = prevUrl; else delete process.env.APP_URL;
  if (prevEnv) process.env.NODE_ENV = prevEnv; else delete process.env.NODE_ENV;
});

test('the reset email carries the link and escapes it', () => {
  const { subject, text, html } = require('./mailer')
    .resetEmail('https://lorenoden.com/admin/reset?token=abc"><script>x</script>', 30);
  assert.match(subject, /Reset your/);
  assert.match(text, /token=abc/);
  assert.ok(!html.includes('<script>x</script>'), 'the url must be escaped into the html');
});

/* ---------------- publishing to the live site ---------------- */
const publisher = require('./publish');

test('publishing is off until it is configured', async () => {
  const prev = { t: process.env.GITHUB_TOKEN, r: process.env.GITHUB_REPO };
  delete process.env.GITHUB_TOKEN; delete process.env.GITHUB_REPO;
  assert.equal(publisher.isConfigured(), false);

  // A fresh session: the reset tests above deliberately sign out every other one.
  const { cookie, csrf } = await signIn();
  const r = await fetch(`${base}/api/publish`, {
    method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(r.status, 409, 'an unconfigured publish is refused, not silently ignored');
  assert.match((await r.json()).error, /GITHUB_TOKEN/);

  if (prev.t) process.env.GITHUB_TOKEN = prev.t;
  if (prev.r) process.env.GITHUB_REPO = prev.r;
});

test('a malformed GITHUB_REPO is rejected', () => {
  const prev = process.env.GITHUB_REPO;
  process.env.GITHUB_TOKEN = 'tok';
  for (const bad of ['norepo', 'a/b/c', '', 'owner /repo']) {
    process.env.GITHUB_REPO = bad;
    assert.equal(publisher.isConfigured(), false, `"${bad}" must not count as configured`);
  }
  process.env.GITHUB_REPO = 'owner/repo';
  assert.equal(publisher.isConfigured(), true);
  if (prev) process.env.GITHUB_REPO = prev; else delete process.env.GITHUB_REPO;
});

test('publishing requires a signed-in session and a CSRF token', async () => {
  const anon = await fetch(`${base}/api/publish`, { method: 'POST' });
  assert.equal(anon.status, 401, 'no session at all');

  const live = await signIn();
  const noCsrf = await fetch(`${base}/api/publish`, {
    method: 'POST', headers: { cookie: live.cookie, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(noCsrf.status, 403, 'signed in, but no CSRF token');
});

test('the blob hash matches what git itself would compute', () => {
  // `printf 'hello\n' | git hash-object --stdin`
  assert.equal(publisher._sha1(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  assert.equal(publisher._sha1(Buffer.alloc(0)), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('the payload carries the content file and only referenced uploads', async () => {
  const fs2 = require('fs'), path2 = require('path'), os2 = require('os');
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'lo-up-'));
  const prev = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  for (const n of ['used-aaaa1111', 'orphan-bbbb2222']) {
    fs2.writeFileSync(path2.join(dir, n + '.webp'), 'webp');
    fs2.writeFileSync(path2.join(dir, n + '.jpg'), 'jpg');
  }
  const { setContent } = require('./db');
  await setContent([['about.portrait.src', 'assets/uploads/used-aaaa1111']]);

  const paths = (await publisher.collectFiles()).map(f => f.path);
  assert.ok(paths.includes('data/content.json'));
  assert.ok(paths.includes('public/assets/uploads/used-aaaa1111.webp'), 'a referenced upload travels with the content');
  assert.ok(paths.includes('public/assets/uploads/used-aaaa1111.jpg'));
  assert.ok(!paths.some(p => p.includes('orphan')), 'an unreferenced upload is left behind');

  await setContent([['about.portrait.src', 'assets/img/portrait']]);
  if (prev) process.env.UPLOAD_DIR = prev; else delete process.env.UPLOAD_DIR;
  fs2.rmSync(dir, { recursive: true, force: true });
});

test('a path-traversing image reference cannot reach outside the upload folder', async () => {
  const fs2 = require('fs'), path2 = require('path'), os2 = require('os');
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'lo-trav-'));
  const prev = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  const { setContent } = require('./db');
  await setContent([['about.portrait.src', 'assets/uploads/../../../../etc/passwd']]);
  const paths = (await publisher.collectFiles()).map(f => f.path);
  assert.ok(!paths.some(p => p.includes('passwd') || p.includes('..')), 'nothing outside the folder is collected');
  await setContent([['about.portrait.src', 'assets/img/portrait']]);
  if (prev) process.env.UPLOAD_DIR = prev; else delete process.env.UPLOAD_DIR;
  fs2.rmSync(dir, { recursive: true, force: true });
});

test('the published content file carries no timestamp, so an unchanged save commits nothing', async () => {
  const a = (await publisher.collectFiles()).find(f => f.path === 'data/content.json').text;
  const b = (await publisher.collectFiles()).find(f => f.path === 'data/content.json').text;
  assert.equal(a, b, 'two exports of the same content must be byte-identical');
  assert.ok(!/exportedAt/.test(a), 'a wall-clock stamp would make every save look like a change');

  const { setContent } = require('./db');
  await setContent([['hero.eyebrow', 'A different line entirely.']]);
  const c = (await publisher.collectFiles()).find(f => f.path === 'data/content.json').text;
  assert.notEqual(a, c, 'a real edit must change the file');
  await setContent([['hero.eyebrow', 'A voice rooted in soul.']]);
});

test('the content file round-trips without a timestamp field', async () => {
  const os2 = require('os'), fs2 = require('fs'), path2 = require('path');
  const cf = require('./content-file');
  const f = path2.join(fs2.mkdtempSync(path2.join(os2.tmpdir(), 'lo-ts-')), 'content.json');
  await cf.exportFromDb(f);
  assert.ok(!fs2.readFileSync(f, 'utf8').includes('exportedAt'));
  assert.ok(Object.keys(cf.readFile(f).content).length >= 70, 'it still reads back');
});
