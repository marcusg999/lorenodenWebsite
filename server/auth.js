'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { db, destroyUserSessions } = require('./db');

const BCRYPT_ROUNDS = 12;

/* ---------------------------------------------------------------------
   A small SQLite session store — sessions survive restarts and are not
   held in memory, so the portal stays logged in across deploys.
   --------------------------------------------------------------------- */
class SqliteStore extends session.Store {
  constructor() {
    super();
    this.qGet = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
    this.qSet = db.prepare(`INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?)
                            ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, data = excluded.data`);
    this.qDel = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.qGc  = db.prepare('DELETE FROM sessions WHERE expires < ?');
    setInterval(() => { try { this.qGc.run(Date.now()); } catch { /* ignore */ } }, 60 * 60 * 1000).unref();
    try { this.qGc.run(Date.now()); } catch { /* ignore */ }
  }
  get(sid, cb) {
    try {
      const row = this.qGet.get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) { this.qDel.run(sid); return cb(null, null); }
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const ttl = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 86400000;
      this.qSet.run(sid, Date.now() + ttl, JSON.stringify(sess));
      cb(null);
    } catch (e) { cb(e); }
  }
  destroy(sid, cb) { try { this.qDel.run(sid); cb(null); } catch (e) { cb(e); } }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

/* ---------------------------------------------------------------------
   users — the sign-in identifier is an email address
   --------------------------------------------------------------------- */
const qUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const qUserById    = db.prepare('SELECT * FROM users WHERE id = ?');
const qUserCount   = db.prepare('SELECT COUNT(*) n FROM users WHERE email IS NOT NULL');
const qInsertUser  = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
const qSetHash     = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const qTouchLogin  = db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`);

/** Deliberately conservative: one @, a dot in the domain, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
function normaliseEmail(e) { return String(e || '').trim().toLowerCase(); }
function assertEmail(e) {
  const v = normaliseEmail(e);
  if (!v) throw new Error('An email address is required.');
  if (v.length > 254 || !EMAIL_RE.test(v)) throw new Error(`"${e}" is not a valid email address.`);
  return v;
}

function userCount() { return qUserCount.get().n; }
function findUser(email) { return qUserByEmail.get(normaliseEmail(email)); }
function findUserById(id) { return qUserById.get(id); }

function createUser(email, password) {
  const v = assertEmail(email);
  if (findUser(v)) throw new Error(`An account already exists for ${v}.`);
  assertPasswordStrength(password);
  qInsertUser.run(v, v, bcrypt.hashSync(password, BCRYPT_ROUNDS));
  return findUser(v);
}

function setPassword(email, password) {
  const user = findUser(email);
  if (!user) throw new Error(`No account for ${normaliseEmail(email)}`);
  assertPasswordStrength(password);
  qSetHash.run(bcrypt.hashSync(password, BCRYPT_ROUNDS), user.id);
}

/** Set a new password by user id, and turn out every other signed-in browser. */
function setPasswordById(userId, password) {
  assertPasswordStrength(password);
  qSetHash.run(bcrypt.hashSync(password, BCRYPT_ROUNDS), userId);
  return destroyUserSessions(userId);
}

/* ---------------------------------------------------------------------
   password reset — tokens are random, stored only as a hash, single use
   --------------------------------------------------------------------- */
const RESET_TTL_MS = 30 * 60 * 1000;
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

const qInsertToken = db.prepare(
  'INSERT INTO reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)');
const qTokenByHash = db.prepare('SELECT * FROM reset_tokens WHERE token_hash = ?');
const qUseToken    = db.prepare(`UPDATE reset_tokens SET used_at = datetime('now') WHERE id = ?`);
const qClearTokens = db.prepare('DELETE FROM reset_tokens WHERE user_id = ?');
const qSweepTokens = db.prepare('DELETE FROM reset_tokens WHERE expires_at < ?');

/** Issue a reset token. Returns the raw token — it is never stored. */
function createResetToken(userId) {
  qSweepTokens.run(Date.now());
  qClearTokens.run(userId);                   // one live token per account
  const raw = crypto.randomBytes(32).toString('base64url');
  qInsertToken.run(userId, hashToken(raw), Date.now() + RESET_TTL_MS);
  return raw;
}

/** The user a valid, unexpired, unused token belongs to — otherwise null. */
function consumeResetToken(raw, { peek = false } = {}) {
  if (!raw) return null;
  const row = qTokenByHash.get(hashToken(raw));
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  const user = findUserById(row.user_id);
  if (!user) return null;
  if (!peek) { qUseToken.run(row.id); qClearTokens.run(row.user_id); }
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
function verify(email, password) {
  const user = findUser(email);
  const ok = bcrypt.compareSync(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return null;
  qTouchLogin.run(user.id);
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
    store: new SqliteStore(),
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

/** Asking for a reset is cheap to abuse and sends mail, so it is tighter. */
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Try again in an hour.' },
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again shortly.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in fifteen minutes.' },
});

module.exports = {
  sessionMiddleware, requireAuth, csrfToken, checkCsrf,
  loginLimiter, forgotLimiter, resetLimiter,
  verify, createUser, setPassword, setPasswordById,
  findUser, findUserById, userCount,
  assertPasswordStrength, assertEmail, normaliseEmail,
  createResetToken, consumeResetToken, RESET_TTL_MS,
};
