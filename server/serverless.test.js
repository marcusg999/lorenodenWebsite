'use strict';
/* The Netlify Function wrapper, driven with the event shape Netlify sends.
   It proves the portal answers without a listening server, and that the
   function-URL prefix is stripped before Express sees the path. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-fn-'));
process.env.DB_PATH = path.join(tmp, 'fn.db');
process.env.SESSION_SECRET = 'test-secret-not-used-in-production';
// Test files run as parallel processes; on Postgres they would otherwise
// share one set of tables. Each gets its own schema instead.
process.env.PGSCHEMA = process.env.PGSCHEMA || 'test_fn';

const fn = require('../netlify/functions/portal');

/** Netlify hands a function an API-Gateway-shaped event. */
const invoke = (p, extra = {}) => fn.handler({
  path: p,
  httpMethod: 'GET',
  headers: { host: 'example.netlify.app', 'x-forwarded-for': '203.0.113.9' },
  queryStringParameters: null,
  body: null,
  isBase64Encoded: false,
  ...extra,
}, { callbackWaitsForEmptyEventLoop: true });

before(async () => {
  await require('../server/db').init();
  await require('../server/db').replaceRows('nav', [{ label: 'Music', href: '/#room' }]);
});
after(async () => {
  await require('../server/db').reset();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the login page is served through the function', async () => {
  const res = await invoke('/admin/login');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /name="_csrf"/);
  assert.match(res.body, /type="email"/);
});

test('the function-URL prefix is stripped, so a direct call works too', async () => {
  const res = await invoke('/.netlify/functions/portal/admin/login');
  assert.equal(res.statusCode, 200, 'the prefix must not reach the router as part of the route');
  assert.match(res.body, /name="_csrf"/);
});

test('the portal still refuses anonymous visitors', async () => {
  const res = await invoke('/admin');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/admin/login');
});

test('the API refuses an anonymous write', async () => {
  const res = await invoke('/api/content', {
    httpMethod: 'PUT',
    headers: { host: 'example.netlify.app', 'content-type': 'application/json' },
    body: JSON.stringify({ 'hero.eyebrow': 'nope' }),
  });
  assert.equal(res.statusCode, 401);
});

test('the session cookie survives a request, which is what a lambda needs', async () => {
  const first = await invoke('/admin/login');
  const setCookie = (first.multiValueHeaders && first.multiValueHeaders['set-cookie']) ||
                    [first.headers['set-cookie']].filter(Boolean).flat();
  assert.ok(setCookie.length, 'a session is started');
  const cookie = String(setCookie[0]).split(';')[0];
  const csrf = first.body.match(/name="_csrf" value="([^"]+)"/)[1];

  // A second, separate invocation — a different lambda, as far as the app knows.
  const second = await invoke('/admin/login', { headers: { host: 'x', cookie } });
  assert.equal(second.body.match(/name="_csrf" value="([^"]+)"/)[1], csrf,
    'the CSRF token comes back from the stored session, not from memory');
});

test('the portal’s own stylesheet is served by the function', async () => {
  const res = await invoke('/css/admin.css');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/css/);
});
