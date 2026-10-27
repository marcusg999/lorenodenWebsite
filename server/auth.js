'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { query, destroyUserSessions, nowIso } = require('./db');

const BCRYPT_ROUNDS = 12;

/* ---------------------------------------------------------------------
   Session store — rows in the database, so sessions survive a restart and
   are shared between every instance. On Netlify each request may land on a
   different lambda, so an in-memory store would sign the owner out at
   random.
   --------------------------------------------------------------------- */
class DbStore extends session.Store {
  constructor() {
    super();
    this.sweep().catch(() => { /* first sweep is best effort */ });
    // Long-running servers tidy up; a lambda is gone long before this fires.
    setInterval(() => this.sweep().catch(() => {}), 60 * 60 * 1000).unref();
  }
  async sweep() { await query('DELETE FROM sessions WHERE expires < $1', [Date.now()]); }

  get(sid, cb) {
    (async () => {
      const { rows } = await query('SELECT data, expires FROM sessions WHERE sid = $1', [sid]);
      if (!rows.length) return null;
      if (Number(rows[0].expires) < Date.now()) {
        await query('DELETE FROM sessions WHERE sid = $1', [sid]);
        return null;
      }
      return JSON.parse(rows[0].data);
    })().then(v => cb(null, v), e => cb(e));
  }
  set(sid, sess, cb) {
    const ttl = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 86400000;
    query(`INSERT INTO sessions (sid, expires, data) VALUES ($1, $2, $3)
             ON CONFLICT (sid) DO UPDATE SET expires = EXCLUDED.expires, data = EXCLUDED.data`,
    [sid, Date.now() + ttl, JSON.stringify(sess)]).then(() => cb(null), e => cb(e));
  }
  destroy(sid, cb) {
    query('DELETE FROM sessions WHERE sid = $1', [sid]).then(() => cb(null), e => cb(e));
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

/* ---------------------------------------------------------------------
   Rate-limit store — also in the database, for the same reason: a counter
   held in one lambda's memory would let an attacker simply keep landing on
   fresh instances. A fixed window per bucket, which is all this needs.
   --------------------------------------------------------------------- */
class DbRateStore {
  constructor(prefix) { this.prefix = prefix; this.windowMs = 60000; }
  init(opts) { this.windowMs = opts.windowMs; }
  bucket(key) { return `${this.prefix}:${key}`; }

  async increment(key) {
    const windowStart = Math.floor(Date.now() / this.windowMs) * this.windowMs;
    const { rows } = await query(
      `INSERT INTO rate_hits (bucket, window_start, hits) VALUES ($1, $2, 1)
         ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_hits.hits + 1
       RETURNING hits`, [this.bucket(key), windowStart]);
    // Expired windows are never read again; clear them now and then.
    if (Math.random() < 0.02) {
      await query('DELETE FROM rate_hits WHERE window_start < $1',
        [windowStart - this.windowMs * 2]).catch(() => {});
    }
    return { totalHits: Number(rows[0].hits), resetTime: new Date(windowStart + this.windowMs) };
  }
  async decrement(key) {
    const windowStart = Math.floor(Date.now() / this.windowMs) * this.windowMs;
    await query('UPDATE rate_hits SET hits = hits - 1 WHERE bucket = $1 AND window_start = $2 AND hits > 0',
      [this.bucket(key), windowStart]);
  }
  async resetKey(key) { await query('DELETE FROM rate_hits WHERE bucket = $1', [this.bucket(key)]); }
  async resetAll() { await query('DELETE FROM rate_hits'); }
}

/* ---------------------------------------------------------------------
   users — the sign-in identifier is an email address
   --------------------------------------------------------------------- */
/** Deliberately conservative: one @, a dot in the domain, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
function normaliseEmail(e) { return String(e || '').trim().toLowerCase(); }
function assertEmail(e) {
  const v = normaliseEmail(e);
  if (!v) throw new Error('An email address is required.');
  if (v.length > 254 || !EMAIL_RE.test(v)) throw new Error(`"${e}" is not a valid email address.`);
  return v;
}

async function userCount() {
  const { rows } = await query('SELECT COUNT(*) AS n FROM users WHERE email IS NOT NULL');
  return Number(rows[0].n);
}
async function findUser(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [normaliseEmail(email)]);
  return rows[0] || null;
}
async function findUserById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createUser(email, password) {
  const v = assertEmail(email);
  if (await findUser(v)) throw new Error(`An account already exists for ${v}.`);
  assertPasswordStrength(password);
  await query('INSERT INTO users (username, email, password_hash, created_at) VALUES ($1, $2, $3, $4)',
    [v, v, await bcrypt.hash(password, BCRYPT_ROUNDS), nowIso()]);
  return findUser(v);
}

async function setPassword(email, password) {
  const user = await findUser(email);
  if (!user) throw new Error(`No account for ${normaliseEmail(email)}`);
  assertPasswordStrength(password);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2',
    [await bcrypt.hash(password, BCRYPT_ROUNDS), user.id]);
}

/** Set a new password by user id, and turn out every other signed-in browser. */
async function setPasswordById(userId, password) {
  assertPasswordStrength(password);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2',
    [await bcrypt.hash(password, BCRYPT_ROUNDS), userId]);
  return destroyUserSessions(userId);
}

/* ---------------------------------------------------------------------
   password reset — tokens are random, stored only as a hash, single use
   --------------------------------------------------------------------- */
const RESET_TTL_MS = 30 * 60 * 1000;
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

/** Issue a reset token. Returns the raw token — it is never stored. */
async function createResetToken(userId) {
  await query('DELETE FROM reset_tokens WHERE expires_at < $1', [Date.now()]);
  await query('DELETE FROM reset_tokens WHERE user_id = $1', [userId]);   // one live token each
  const raw = crypto.randomBytes(32).toString('base64url');
  await query('INSERT INTO reset_tokens (user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4)',
    [userId, hashToken(raw), Date.now() + RESET_TTL_MS, nowIso()]);
  return raw;
}

/** The user a valid, unexpired, unused token belongs to — otherwise null. */
async function consumeResetToken(raw, { peek = false } = {}) {
  if (!raw) return null;
  const { rows } = await query('SELECT * FROM reset_tokens WHERE token_hash = $1', [hashToken(raw)]);
  const row = rows[0];
  if (!row || row.used_at || Number(row.expires_at) < Date.now()) return null;
  const user = await findUserById(row.user_id);
  if (!user) return null;
  if (!peek) {
    await query('UPDATE reset_tokens SET used_at = $1 WHERE id = $2', [nowIso(), row.id]);
    await query('DELETE FROM reset_tokens WHERE user_id = $1', [row.user_id]);
  }
  return user;
}

function assertPasswordStrength(password) {
  const p = String(password || '');
  if (p.length < 12) throw new Error('Password must be at least 12 characters.');
  if (/^[0-9]+$/.test(p)) throw new Error('Password must not be only digits.');
  const common = ['password', 'lorenoden', '123456789012', 'qwertyuiop'];
  if (common.some(c => p.toLowerCase().includes(c))) throw new Error('Password is too predictable.');
}

/** Constant-time-ish: always run a hash comparison so a missing user and a
 *  wrong password take the same time and cannot be told apart by timing. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-placeholder', BCRYPT_ROUNDS);
async function verify(email, password) {
  const user = await findUser(email);
  const ok = await bcrypt.compare(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return null;
  await query('UPDATE users SET last_login = $1 WHERE id = $2', [nowIso(), user.id]);
  return user;
}

/* ---------------------------------------------------------------------
   middleware
   --------------------------------------------------------------------- */
function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production. Generate one with: openssl rand -hex 32');
  }
  return session({
    name: 'lo.sid',
    secret: secret || crypto.randomBytes(32).toString('hex'),
    store: new DbStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12,          // 12 hours
    },
  });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.accepts('html') && req.method === 'GET') return res.redirect('/admin/login');
  return res.status(401).json({ error: 'Not signed in.' });
}

/* CSRF: a per-session synchroniser token, checked on every mutating request.
   Combined with SameSite=Lax cookies this closes cross-site form posts. */
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}
function checkCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.get('x-csrf-token') || (req.body && req.body._csrf);
  const want = req.session && req.session.csrf;
  const a = Buffer.from(String(sent || ''));
  const b = Buffer.from(String(want || ''));
  if (!want || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Your session expired. Reload the page and try again.' });
  }
  next();
}

const limiter = (prefix, windowMs, limit, message) => rateLimit({
  windowMs, limit,
  store: new DbRateStore(prefix),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: message },
});

/** Asking for a reset is cheap to abuse and sends mail, so it is tighter. */
const forgotLimiter = limiter('forgot', 60 * 60 * 1000, 5,
  'Too many reset requests. Try again in an hour.');
const resetLimiter = limiter('reset', 15 * 60 * 1000, 20,
  'Too many attempts. Try again shortly.');
const loginLimiter = limiter('login', 15 * 60 * 1000, 10,
  'Too many sign-in attempts. Try again in fifteen minutes.');

module.exports = {
  sessionMiddleware, requireAuth, csrfToken, checkCsrf,
  loginLimiter, forgotLimiter, resetLimiter,
  verify, createUser, setPassword, setPasswordById,
  findUser, findUserById, userCount,
  assertPasswordStrength, assertEmail, normaliseEmail,
  createResetToken, consumeResetToken, RESET_TTL_MS,
  DbStore, DbRateStore,
};
