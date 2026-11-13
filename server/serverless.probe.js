'use strict';
/* Test helper. Loads the Netlify function in a fresh process — the function
   reads its configuration once at load, so each scenario needs its own —
   invokes it for the requests given as a JSON argument, and prints the
   results as JSON. Not a test file itself; server/serverless.test.js drives it. */
const fn = require('../netlify/functions/portal');

const requests = JSON.parse(process.argv[2] || '[]');

(async () => {
  const out = [];
  let cookie = null;
  for (const r of requests) {
    const res = await fn.handler({
      path: r.path,
      httpMethod: r.method || 'GET',
      headers: {
        host: 'lorenodenwebsite.netlify.app',
        'x-forwarded-for': '203.0.113.9',
        ...(r.useCookie && cookie ? { cookie } : {}),
        ...(r.headers || {}),
      },
      queryStringParameters: null,
      body: r.body || null,
      isBase64Encoded: false,
    }, { callbackWaitsForEmptyEventLoop: true });

    // Carry the session on, so a later request can be a separate invocation
    // that still finds the session — the thing a lambda has to get right.
    const set = (res.multiValueHeaders && res.multiValueHeaders['set-cookie']) ||
                [res.headers && res.headers['set-cookie']].filter(Boolean).flat();
    if (set.length) cookie = String(set[0]).split(';')[0];

    out.push({
      statusCode: res.statusCode,
      body: String(res.body || ''),
      contentType: (res.headers || {})['content-type'] || '',
      location: (res.headers || {})['location'] || '',
      setCookie: set.map(String),
    });
  }
  process.stdout.write(JSON.stringify(out));
})().catch(e => {
  process.stdout.write(JSON.stringify([{ threw: e.message }]));
  process.exitCode = 1;
});
