'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { db } = require('./db');

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
   users
   --------------------------------------------------------------------- */
const qUserByName = db.prepare('SELECT * FROM users WHERE username = ?');
const qUserCount  = db.prepare('SELECT COUNT(*) n FROM users');
const qInsertUser = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
const qSetHash    = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const qTouchLogin = db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`);

function userCount() { return qUserCount.get().n; }
function findUser(username) { return qUserByName.get(String(username || '').trim()); }

function createUser(username, password) {
  const u = String(username || '').trim();
  if (!u) throw new Error('A username is required.');
  if (findUser(u)) throw new Error(`User "${u}" already exists.`);
  assertPasswordStrength(password);
  qInsertUser.run(u, bcrypt.hashSync(password, BCRYPT_ROUNDS));
  return findUser(u);
}

function setPassword(username, password) {
  const user = findUser(username);
  if (!user) throw new Error(`No such user: ${username}`);
  assertPasswordStrength(password);
  qSetHash.run(bcrypt.hashSync(password, BCRYPT_ROUNDS), user.id);
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
function verify(username, password) {
  const user = findUser(username);
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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in fifteen minutes.' },
});

module.exports = {
  sessionMiddleware, requireAuth, csrfToken, checkCsrf, loginLimiter,
  verify, createUser, setPassword, findUser, userCount, assertPasswordStrength,
};
