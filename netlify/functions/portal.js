'use strict';
/* The admin portal, as a Netlify Function.
 *
 * The same Express app that `npm start` runs, wrapped so Netlify can invoke
 * it per request. Three things make that possible, and all three need
 * Supabase — which is why this file exists only now:
 *
 *   sessions      a row in the database, not memory (a lambda is recycled)
 *   rate limits   a row in the database, for the same reason
 *   uploads       Supabase Storage, because there is no writable disk
 *
 * The public pages are not served from here; Netlify serves those from dist/.
 */
const serverless = require('serverless-http');

/* ---------------------------------------------------------------------
   Configuration, checked before the app is loaded.

   The defaults — SQLite in a file, images in a folder — are right for a
   laptop and impossible here: the only writable path is /tmp, and nothing
   written to it outlives the instance. Loading the app without these set
   therefore dies on whichever write came first, with an ENOENT that says
   nothing about the real problem. So the check happens here, where it can
   name what is missing.
   --------------------------------------------------------------------- */
const REQUIRED = [
  ['DB_DRIVER', v => /^(postgres|pg)$/i.test(v || ''),
    "must be 'postgres'. A function has no disk, so the SQLite default cannot work here."],
  ['DATABASE_URL', v => Boolean(v),
    'the Supabase connection string. Use the transaction pooler on port 6543, and keep the ' +
    'postgres.<project-ref> username — the pooler identifies the project from it.'],
  ['STORAGE', v => /^supabase$/i.test(v || ''),
    "must be 'supabase'. Uploads cannot go to a local folder here."],
  ['SUPABASE_URL', v => Boolean(v), 'https://<project-ref>.supabase.co'],
  ['SUPABASE_SERVICE_KEY', (v, e) => Boolean(v || e.SUPABASE_SERVICE_ROLE_KEY),
    'the Supabase secret key (sb_secret_… or the legacy service_role key). Server-side only.'],
  ['SESSION_SECRET', v => Boolean(v), 'openssl rand -hex 32'],
];

const problems = REQUIRED
  .filter(([name, ok]) => !ok(process.env[name], process.env))
  .map(([name, , help]) => `  ${name}  —  ${help}`);

const EXPLAIN = [
  'The portal is not configured.',
  '',
  problems.join('\n'),
  '',
  'Set these in Netlify under Project configuration → Environment variables,',
  'and make sure each one\'s scope includes Functions: a variable scoped to',
  'Builds only is invisible here, which looks exactly like not setting it.',
  '',
  'The public pages are unaffected — they are static and need none of this.',
  '',
].join('\n');

/* Netlify rewrites (status 200) usually hand the function the original path,
   but a direct call to the function URL does not. Strip the prefix either
   way so Express always sees the route the visitor asked for. */
const FN = /^\/\.netlify\/functions\/[^/?]+/;
const strip = p => (p && p.replace(FN, '')) || '/';

const text = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  body,
});

let app = null;
let handler = null;
let bootError = null;

if (!problems.length) {
  app = require('../../server/app');
  handler = serverless(app, {
    request(req) {
      req.url = strip(req.url);
      if (req.originalUrl) req.originalUrl = strip(req.originalUrl);
    },
  });
  // The schema is created once per instance. Hold the failure rather than
  // let it surface as an unhandled rejection, which kills the instance
  // before any request can be answered — and so reports nothing useful.
  app.ready.catch(e => { bootError = e; });
}

exports.handler = async (event, context) => {
  // Keep the pg pool alive between invocations on a warm instance.
  context.callbackWaitsForEmptyEventLoop = false;
  if (problems.length) return text(503, EXPLAIN);

  try {
    await app.ready;
  } catch (e) {
    bootError = e;
  }
  if (bootError) {
    return text(503,
      'The portal cannot reach its database.\n\n  ' + bootError.message + '\n\n' +
      'Check DATABASE_URL: the Supabase transaction pooler on port 6543, with the\n' +
      'postgres.<project-ref> username and the project\'s database password.\n\n' +
      'The public pages are unaffected — they are static and need no database.\n');
  }

  if (event.path) event.path = strip(event.path);
  if (event.rawPath) event.rawPath = strip(event.rawPath);
  return handler(event, context);
};
