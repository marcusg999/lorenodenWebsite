'use strict';
/* The Netlify Function wrapper.
 *
 * Two things matter here and neither shows up in the Express tests:
 *
 *   1. A function has no writable disk, so the app's laptop defaults — SQLite
 *      in a file, images in a folder — cannot work. The wrapper must say so
 *      in words the person deploying can act on, rather than die on whichever
 *      write happened first.
 *   2. Configured properly, it must serve the portal and keep a session
 *      across separate invocations, since consecutive requests may land on
 *      different instances.
 *
 * The wrapper reads its configuration once at load, so each scenario runs in
 * its own process through server/serverless.probe.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const PROBE = path.join(__dirname, 'serverless.probe.js');

/** Run the function in a fresh process with exactly this environment. */
function invoke(env, requests) {
  const out = execFileSync(process.execPath, [PROBE, JSON.stringify(requests)], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out);
}

/* A full, working configuration. Postgres is the only part that has to be
   real; the Supabase Storage values are only checked for presence here, and
   storage itself has its own tests. */
const CONFIGURED = process.env.DATABASE_URL ? {
  DB_DRIVER: 'postgres',
  DATABASE_URL: process.env.DATABASE_URL,
  PGSCHEMA: 'test_fn',
  STORAGE: 'supabase',
  SUPABASE_URL: 'https://abcdefg.supabase.co',
  SUPABASE_SERVICE_KEY: 'sb_secret_not_a_real_key',
  SESSION_SECRET: '0'.repeat(64),
} : null;

/* Needs a Postgres to talk to. `npm test` has none by design — it must run on
   a clone with nothing installed — so these run under `npm run test:pg`. */
const needsDb = CONFIGURED ? {} : { skip: 'set DATABASE_URL (npm run test:pg)' };

/* ---------------- the misconfigured case ---------------- */
test('an unconfigured deploy says which variables are missing', () => {
  const [res] = invoke({}, [{ path: '/admin/login' }]);

  assert.equal(res.statusCode, 503, 'a clear refusal, not a crash');
  for (const name of ['DB_DRIVER', 'DATABASE_URL', 'STORAGE', 'SUPABASE_URL',
                      'SUPABASE_SERVICE_KEY', 'SESSION_SECRET']) {
    assert.match(res.body, new RegExp(name), `${name} is named`);
  }
  assert.match(res.body, /scope includes Functions/,
    'the Builds-only scope trap is the one that looks like nothing being set');
  assert.ok(!/ENOENT|mkdir|\/var\/task/.test(res.body),
    'no filesystem error should reach the person deploying');
});

test('leaving DB_DRIVER on its SQLite default is refused by name', () => {
  const [res] = invoke({
    DATABASE_URL: 'postgresql://postgres.ref:pw@host:6543/postgres',
    STORAGE: 'supabase', SUPABASE_URL: 'https://a.supabase.co',
    SUPABASE_SERVICE_KEY: 'k', SESSION_SECRET: '0'.repeat(64),
  }, [{ path: '/admin/login' }]);

  assert.equal(res.statusCode, 503);
  assert.match(res.body, /DB_DRIVER/);
  assert.match(res.body, /no disk/, 'it should say why, not just that it is wrong');
  assert.ok(!/DATABASE_URL\s+—/.test(res.body), 'variables that are set are not listed');
});

test('a database that cannot be reached is reported as that, not as a crash', () => {
  const [res] = invoke({
    DB_DRIVER: 'postgres',
    DATABASE_URL: 'postgresql://postgres.ref:pw@127.0.0.1:65400/postgres',
    STORAGE: 'supabase', SUPABASE_URL: 'https://a.supabase.co',
    SUPABASE_SERVICE_KEY: 'k', SESSION_SECRET: '0'.repeat(64),
  }, [{ path: '/admin/login' }]);

  assert.equal(res.statusCode, 503);
  assert.match(res.body, /cannot reach its database/);
  assert.match(res.body, /ECONNREFUSED/, 'the underlying error is quoted, so it can be acted on');
  assert.match(res.body, /6543/, 'and the pooler port is the usual cause');
});

/* ---------------- the working case ---------------- */
test('the login page is served through the function', needsDb, () => {
  const [res] = invoke(CONFIGURED, [{ path: '/admin/login' }]);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /name="_csrf"/);
  assert.match(res.body, /type="email"/);
});

test('the function-URL prefix is stripped, so a direct call works too', needsDb, () => {
  const [res] = invoke(CONFIGURED, [{ path: '/.netlify/functions/portal/admin/login' }]);
  assert.equal(res.statusCode, 200, 'the prefix must not reach the router as part of the route');
  assert.match(res.body, /name="_csrf"/);
});

test('the portal still refuses anonymous visitors', needsDb, () => {
  const [res] = invoke(CONFIGURED, [{ path: '/admin' }]);
  assert.equal(res.statusCode, 302);
  assert.equal(res.location, '/admin/login');
});

test('the API refuses an anonymous write', needsDb, () => {
  const [res] = invoke(CONFIGURED, [{
    path: '/api/content', method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ 'hero.eyebrow': 'nope' }),
  }]);
  assert.equal(res.statusCode, 401);
});

test('a session survives into a separate invocation', needsDb, () => {
  const [first, second] = invoke(CONFIGURED, [
    { path: '/admin/login' },
    { path: '/admin/login', useCookie: true },
  ]);
  assert.ok(first.setCookie.length, 'a session is started');
  const a = first.body.match(/name="_csrf" value="([^"]+)"/)[1];
  const b = second.body.match(/name="_csrf" value="([^"]+)"/)[1];
  assert.equal(b, a, 'the CSRF token comes back from the stored session, not from memory');
});

test('the portal’s own stylesheet is served by the function', needsDb, () => {
  const [res] = invoke(CONFIGURED, [{ path: '/css/admin.css' }]);
  assert.equal(res.statusCode, 200);
  assert.match(res.contentType, /text\/css/);
});
