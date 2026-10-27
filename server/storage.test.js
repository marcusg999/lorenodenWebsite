'use strict';
/* The Supabase Storage backend, exercised against a stub that speaks the
   same REST API. It checks the requests this app actually sends — the paths,
   the auth header and the public URLs it hands back — without needing a
   Supabase project. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { storage, resetStorage } = require('./storage');

const objects = new Map();                    // name -> { body, created_at }
let seenAuth = null;
let server, origin;

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seenAuth = req.headers.authorization;
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (!/^Bearer /.test(req.headers.authorization || '')) return send(401, { message: 'no key' });

      let m;
      if (req.method === 'POST' && (m = /^\/storage\/v1\/object\/list\/([^/]+)$/.exec(req.url))) {
        if (m[1] !== 'uploads') return send(404, { message: 'Bucket not found' });
        return send(200, [...objects.entries()]
          .map(([name, o]) => ({ name, created_at: o.created_at })));
      }
      if (req.method === 'POST' && (m = /^\/storage\/v1\/object\/uploads\/(.+)$/.exec(req.url))) {
        objects.set(m[1], { body, created_at: new Date(Date.now() + objects.size * 1000).toISOString() });
        return send(200, { Key: `uploads/${m[1]}` });
      }
      if (req.method === 'DELETE' && /^\/storage\/v1\/object\/uploads$/.test(req.url)) {
        let n = 0;
        for (const p of JSON.parse(body.toString()).prefixes) if (objects.delete(p)) n++;
        return send(200, { message: `deleted ${n}` });
      }
      send(404, { message: 'no such route' });
    });
  });
  await new Promise(r => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;

  process.env.STORAGE = 'supabase';
  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_SERVICE_KEY = 'service-role-test-key';
  resetStorage();
});

after(() => {
  server.close();
  delete process.env.STORAGE;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  resetStorage();
});

test('an image is stored as a webp/jpg pair and addressed by a public URL', async () => {
  const src = await storage().put('portrait-aaaa1111',
    { webp: Buffer.from('fake-webp'), jpg: Buffer.from('fake-jpg') });

  assert.equal(src, `${origin}/storage/v1/object/public/uploads/portrait-aaaa1111`,
    'the stored src is extension-less, as the templates expect');
  assert.deepEqual([...objects.keys()].sort(),
    ['portrait-aaaa1111.jpg', 'portrait-aaaa1111.webp']);
  assert.equal(objects.get('portrait-aaaa1111.webp').body.toString(), 'fake-webp');
  assert.equal(seenAuth, 'Bearer service-role-test-key');
});

test('the library lists one entry per image, newest first', async () => {
  await storage().put('later-bbbb2222', { webp: Buffer.from('w'), jpg: Buffer.from('j') });
  const list = await storage().list();

  assert.deepEqual(list.map(m => m.name), ['later-bbbb2222', 'portrait-aaaa1111'],
    'the pair is collapsed to one entry, and the newest comes first');
  assert.equal(list[0].src, `${origin}/storage/v1/object/public/uploads/later-bbbb2222`);
});

test('deleting removes both encodings', async () => {
  await storage().remove('later-bbbb2222');
  assert.deepEqual([...objects.keys()].sort(), ['portrait-aaaa1111.jpg', 'portrait-aaaa1111.webp']);
});

test('a name that climbs out of the bucket is refused', async () => {
  await assert.rejects(() => storage().remove('../../etc/passwd'), /Bad file name/);
  await assert.rejects(() => storage().remove('nested/name'), /Bad file name/);
});

test('a Supabase error is reported in words the owner can act on', async () => {
  process.env.SUPABASE_BUCKET = 'does-not-exist';
  resetStorage();
  await assert.rejects(() => storage().list(), /Supabase Storage 404.*does the bucket "does-not-exist" exist/s);
  delete process.env.SUPABASE_BUCKET;
  resetStorage();
});

test('missing keys are caught at startup, not on the first upload', () => {
  const url = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  resetStorage();
  assert.throws(() => storage(), /SUPABASE_URL and SUPABASE_SERVICE_KEY/);
  process.env.SUPABASE_URL = url;
  resetStorage();
});
