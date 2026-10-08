'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

/* Each run gets a throwaway database. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.SESSION_SECRET = 'test-secret-not-used-in-production';

const app = require('./app');
const { createUser } = require('./auth');
const { replaceRows } = require('./db');

let server, base, SESSION;
const PW = 'quiet-lantern-9471';

before(async () => {
  replaceRows('nav', [{ label: 'Music', href: '/#room' }]);
  replaceRows('tracks', [
    { title: 'Through My Soul', artist: 'Adrian Younge', album: 'x', category: 'Features', role: 'Featured vocals', source: 'https://example.com', embed: '' },
    { title: 'Is There a Way', artist: 'Loren Oden', album: 'y', category: 'Solo', role: 'Lead vocals', source: 'https://example.com', embed: '' },
  ]);
  replaceRows('shows', [{ kind: 'past', date_label: 'May 2019', venue: 'Norwich Arts Centre', location: 'Norwich', note: '', url: 'https://example.com' }]);
  replaceRows('shots', [{ src: 'assets/img/norwich-1', alt: 'a', caption_bold: 'Norwich', caption: '2019', width: 1, height: 1, shape: 'a' }]);
  createUser('tester', PW);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  SESSION = await signIn();   // reused by the write tests below
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

/** Sign in and return { cookie, csrf }. */
async function signIn(username = 'tester', password = PW) {
  const page = await fetch(`${base}/admin/login`);
  let cookie = (page.headers.get('set-cookie') || '').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
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
  const { status } = await signIn('tester', 'definitely-wrong-password');
  assert.equal(status, 401);
});

test('a correct password signs in and the session cookie is HttpOnly', async () => {
  const page = await fetch(`${base}/admin/login`);
  const cookie = (page.headers.get('set-cookie') || '').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const r = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, username: 'tester', password: PW }),
  });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('set-cookie') || '', /HttpOnly/i);
});

test('the session id is regenerated on login (no session fixation)', async () => {
  const page = await fetch(`${base}/admin/login`);
  const pre = (page.headers.get('set-cookie') || '').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const r = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual', headers: { cookie: pre, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, username: 'tester', password: PW }),
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
  for (let i = 0; i < 14 && !saw429; i++) {
    const page = await fetch(`${base}/admin/login`);
    const cookie = (page.headers.get('set-cookie') || '').split(';')[0];
    const m = (await page.text()).match(/name="_csrf" value="([^"]+)"/);
    const r = await fetch(`${base}/admin/login`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: m ? m[1] : '', username: 'tester', password: 'wrong-every-time' }),
    });
    if (r.status === 429) saw429 = true;
  }
  assert.ok(saw429, 'the login route must start refusing after repeated failures');
});
