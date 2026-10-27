'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');

const { allContent, setContent, listRows, replaceRows, columnsOf, isTable, TABLES } = require('./db');
const { GROUPS, COLLECTIONS, FIELD_BY_KEY } = require('./schema');
const { pageData } = require('./pagedata');
const auth = require('./auth');
const media = require('./uploads');
const mailer = require('./mailer');
const publisher = require('./publish');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ---- security headers -------------------------------------------------
   The site embeds official Bandcamp and Apple Music players, so frame-src
   is opened to exactly those two origins and nothing else.                */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],   // the templates use a few inline style attributes
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'"],
      mediaSrc: ["'self'", 'https:'],
      frameSrc: ['https://bandcamp.com', 'https://embed.music.apple.com'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: PROD ? { maxAge: 15552000, includeSubDomains: true } : false,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(auth.sessionMiddleware());

/* =======================================================================
   PUBLIC SITE
   ======================================================================= */
app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets'), {
  maxAge: PROD ? '30d' : 0, immutable: PROD,
}));
if ((process.env.STORAGE || 'local').toLowerCase() === 'local') {
  app.use('/assets/uploads', express.static(media.UPLOAD_DIR, {
    maxAge: PROD ? '30d' : 0, index: false, dotfiles: 'deny',
  }));
}
app.use('/css', express.static(path.join(__dirname, '..', 'public', 'css'), { maxAge: PROD ? '1d' : 0 }));
app.use('/js', express.static(path.join(__dirname, '..', 'public', 'js'), { maxAge: PROD ? '1d' : 0 }));

/* The listening room's catalog, generated from the database so the admin's
   edits appear without a rebuild. listening.js consumes it unchanged. */
app.get('/data/catalog.js', async (req, res) => {
  const rows = (await listRows('tracks')).map((t, i) => ({
    order: i + 1, title: t.title, artist: t.artist, album: t.album,
    category: t.category, role: t.role, source: t.source, embed: t.embed || '',
  }));
  res.type('application/javascript')
     .set('Cache-Control', 'no-cache')
     .send('window.LO_CATALOG = ' + JSON.stringify(rows) + ';\n');
});

app.get('/', async (req, res) => res.render('index', await pageData()));
app.get('/gallery', async (req, res) => res.render('gallery', await pageData()));
app.get('/gallery.html', (req, res) => res.redirect(301, '/gallery'));
app.get('/index.html', (req, res) => res.redirect(301, '/'));

app.get('/robots.txt', (req, res) =>
  res.type('text/plain').send('User-agent: *\nDisallow: /admin\n'));

/* =======================================================================
   ADMIN
   ======================================================================= */
app.get('/admin/login', async (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('admin-login', { csrf: auth.csrfToken(req), error: null, noUsers: (await auth.userCount()) === 0 });
});

app.post('/admin/login', auth.loginLimiter, auth.checkCsrf, async (req, res) => {
  const { username, password } = req.body || {};
  const user = await auth.verify(username, password);
  if (!user) {
    return res.status(401).render('admin-login', {
      csrf: auth.csrfToken(req), noUsers: (await auth.userCount()) === 0,
      error: 'That username and password did not match.',
    });
  }
  // New session id on login, so a pre-login cookie cannot be reused.
  req.session.regenerate(err => {
    if (err) return res.status(500).render('admin-login', {
      csrf: auth.csrfToken(req), noUsers: false, error: 'Could not start a session. Try again.' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect('/admin');
  });
});

/* ---- forgotten password ---------------------------------------------
   The response is identical whether or not an account exists, so this page
   cannot be used to discover which addresses are registered. */
app.get('/admin/forgot', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('admin-forgot', { csrf: auth.csrfToken(req), sent: false, error: null });
});

app.post('/admin/forgot', auth.forgotLimiter, auth.checkCsrf, async (req, res) => {
  const email = auth.normaliseEmail((req.body || {}).email);
  const done = () => res.render('admin-forgot', { csrf: auth.csrfToken(req), sent: true, error: null });

  const user = email ? await auth.findUser(email) : null;
  if (!user) return done();                       // same answer either way

  try {
    const token = await auth.createResetToken(user.id);
    const url = `${mailer.appUrl(req)}/admin/reset?token=${encodeURIComponent(token)}`;
    await mailer.sendResetEmail(user.email, url, Math.round(auth.RESET_TTL_MS / 60000));
  } catch (e) {
    console.error('[forgot] could not send reset email:', e.message);
    return res.status(500).render('admin-forgot', {
      csrf: auth.csrfToken(req), sent: false,
      error: 'The reset email could not be sent. Check the mail settings on the server.',
    });
  }
  done();
});

app.get('/admin/reset', async (req, res) => {
  const token = String(req.query.token || '');
  const user = await auth.consumeResetToken(token, { peek: true });
  res.render('admin-reset', {
    csrf: auth.csrfToken(req), token,
    valid: Boolean(user), error: null, done: false,
  });
});

app.post('/admin/reset', auth.resetLimiter, auth.checkCsrf, async (req, res) => {
  const { token = '', password = '', confirm = '' } = req.body || {};
  const fail = (msg, valid = true) => res.status(400).render('admin-reset', {
    csrf: auth.csrfToken(req), token, valid, error: msg, done: false,
  });

  if (!await auth.consumeResetToken(token, { peek: true })) {
    return fail('That reset link has expired or has already been used. Request a new one.', false);
  }
  if (password !== confirm) return fail('The two passwords do not match.');
  try { auth.assertPasswordStrength(password); } catch (e) { return fail(e.message); }

  const user = await auth.consumeResetToken(token);   // single use, spent here
  if (!user) return fail('That reset link has expired or has already been used. Request a new one.', false);

  await auth.setPasswordById(user.id, password);  // also turns out other sessions
  req.session.destroy(() => res.render('admin-reset', {
    csrf: '', token: '', valid: true, error: null, done: true,
  }));
});

app.post('/admin/logout', auth.requireAuth, auth.checkCsrf, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

app.get('/admin', auth.requireAuth, async (req, res) => {
  const [content, rows, columns] = await Promise.all([
    allContent(),
    Promise.all(TABLES.map(t => listRows(t))),
    Promise.all(TABLES.map(t => columnsOf(t))),
  ]);
  res.render('admin', {
    username: req.session.username,
    csrf: auth.csrfToken(req),
    groups: GROUPS,
    collections: COLLECTIONS,
    content,
    rows: Object.fromEntries(TABLES.map((t, i) => [t, rows[i]])),
    columns: Object.fromEntries(TABLES.map((t, i) => [t, columns[i]])),
    publish: publisher.status(),
  });
});

/* ---- admin API --------------------------------------------------------- */
const api = express.Router();
api.use(auth.requireAuth, auth.checkCsrf);

api.put('/content', async (req, res) => {
  const body = req.body || {};
  const pairs = [];
  for (const [k, v] of Object.entries(body)) {
    if (k === '_csrf') continue;
    if (!FIELD_BY_KEY.has(k)) return res.status(400).json({ error: `Unknown field: ${k}` });
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      return res.status(400).json({ error: `Bad value for ${k}` });
    }
    const s = String(v);
    if (s.length > 20000) return res.status(400).json({ error: `${k} is too long (20,000 characters max).` });
    pairs.push([k, s]);
  }
  if (!pairs.length) return res.status(400).json({ error: 'Nothing to save.' });
  await setContent(pairs);
  res.json({ ok: true, saved: pairs.length });
});

api.put('/collection/:table', async (req, res) => {
  const t = req.params.table;
  if (!isTable(t)) return res.status(404).json({ error: 'Unknown collection.' });
  const rows = req.body && req.body.rows;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Expected a rows array.' });
  if (rows.length > 500) return res.status(400).json({ error: 'That is more than 500 rows.' });

  const cols = (await columnsOf(t)).filter(c => c !== 'position');
  const clean = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return res.status(400).json({ error: 'Bad row.' });
    const out = {};
    for (const c of cols) {
      const v = row[c];
      const s = v === undefined || v === null ? '' : String(v);
      if (s.length > 20000) return res.status(400).json({ error: `A ${c} value is too long.` });
      out[c] = s;
    }
    clean.push(out);
  }
  if (t === 'shows') {
    for (const r of clean) if (!['upcoming', 'past'].includes(r.kind)) r.kind = 'past';
  }
  await replaceRows(t, clean);
  res.json({ ok: true, rows: clean.length });
});

api.get('/media', async (req, res) => res.json({ media: await media.listMedia() }));

api.post('/upload', (req, res) => {
  media.upload.single('image')(req, res, async err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `That image is larger than ${Math.round(media.MAX_BYTES / 1024 / 1024)} MB.`
        : err.message || 'Upload failed.';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No image was sent.' });
    try {
      res.json({ ok: true, ...(await media.processImage(req.file.buffer, req.file.originalname)) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
});

api.delete('/media/:name', async (req, res) => {
  try { await media.deleteMedia(req.params.name); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

api.get('/publish/status', (req, res) => res.json(publisher.status()));

api.post('/publish', async (req, res) => {
  if (!publisher.isConfigured()) {
    return res.status(409).json({
      error: 'Publishing is not set up. Add GITHUB_TOKEN and GITHUB_REPO on the server.',
      configured: false,
    });
  }
  try {
    const out = await publisher.publish({
      message: `Content update from the portal (${req.session.username})`,
      author: { name: 'Loren Oden portal', email: req.session.username },
    });
    res.json({ ok: true, ...out, status: publisher.status() });
  } catch (e) {
    res.status(502).json({ error: e.message, status: publisher.status() });
  }
});

api.post('/password', async (req, res) => {
  const { current, next } = req.body || {};
  if (!await auth.verify(req.session.username, current)) {
    return res.status(401).json({ error: 'Your current password is not correct.' });
  }
  try {
    await auth.setPassword(req.session.username, next);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.use('/api', api);

/* ---- errors ------------------------------------------------------------ */
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).render('error', { code: 404, message: 'That page does not exist.' });
  }
  res.status(404).json({ error: 'Not found.' });
});
app.use((err, req, res, _next) => {
  console.error(err);
  const code = err.status || 500;
  if (req.accepts('html') && !req.path.startsWith('/api')) {
    return res.status(code).render('error', { code, message: 'Something went wrong.' });
  }
  res.status(code).json({ error: PROD ? 'Something went wrong.' : String(err.message) });
});

/** Open the database and create the schema. Everything else waits on this. */
const ready = db.init().then(async () => {
  if (await auth.userCount() === 0) {
    console.warn('\n⚠  No portal account exists yet. Create one with:\n' +
                 "   npm run set-password -- <email> '<password>'\n");
  }
  return app;
});

if (require.main === module) {
  ready
    .then(() => app.listen(PORT, () =>
      console.log(`\n  Loren Oden — http://localhost:${PORT}\n  Admin      — http://localhost:${PORT}/admin\n` +
                  `  Database   — ${(process.env.DB_DRIVER || 'sqlite')}   Images — ${(process.env.STORAGE || 'local')}\n`)))
    .catch(e => { console.error('✗ Could not start:', e.message); process.exit(1); });
}

module.exports = app;
module.exports.ready = ready;
