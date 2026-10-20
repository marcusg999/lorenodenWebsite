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
 * Set DB_DRIVER=postgres, STORAGE=supabase and the keys in .env.example.
 * The public pages are not served from here; Netlify serves those from dist/.
 */
const serverless = require('serverless-http');
const app = require('../../server/app');

/* Netlify rewrites (status 200) usually hand the function the original path,
   but a direct call to the function URL does not. Strip the prefix either
   way so Express always sees the route the visitor asked for. */
const FN = /^\/\.netlify\/functions\/[^/?]+/;
const strip = p => (p && p.replace(FN, '')) || '/';

const handler = serverless(app, {
  request(req) {
    req.url = strip(req.url);
    if (req.originalUrl) req.originalUrl = strip(req.originalUrl);
  },
});

exports.handler = async (event, context) => {
  // Keep the pg pool alive between invocations on a warm instance.
  context.callbackWaitsForEmptyEventLoop = false;
  await app.ready;                               // schema created once per instance
  if (event.path) event.path = strip(event.path);
  if (event.rawPath) event.rawPath = strip(event.rawPath);
  return handler(event, context);
};
