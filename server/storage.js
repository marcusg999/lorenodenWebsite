'use strict';
/* Where uploaded images are kept.
 *
 *   STORAGE=local     (default)  public/assets/uploads on this machine
 *   STORAGE=supabase             a Supabase Storage bucket
 *
 * Netlify Functions have no persistent disk — anything written during a
 * request is gone when the instance is recycled — so a portal deployed there
 * must use Supabase Storage. Locally, the disk is simpler and needs no keys.
 *
 * Each image is stored as a .webp and a .jpg under one extension-less stem;
 * the templates append the extension they want. put/list/remove therefore all
 * work in stems, not file names.
 *
 *   SUPABASE_URL          https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role key — server side only, never shipped
 *   SUPABASE_BUCKET       defaults to "uploads"
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB_PREFIX = 'assets/uploads';
const EXTS = [['webp', 'image/webp'], ['jpg', 'image/jpeg']];

/* ---- local disk -------------------------------------------------------- */
function localStore() {
  const dir = process.env.UPLOAD_DIR || path.join(ROOT, 'public', 'assets', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const inside = p => {
    const abs = path.resolve(dir, p);
    if (!abs.startsWith(path.resolve(dir) + path.sep)) throw new Error('Bad file name.');
    return abs;
  };
  return {
    kind: 'local',
    dir,
    async put(stem, files) {
      for (const [ext] of EXTS) await fs.promises.writeFile(inside(stem + '.' + ext), files[ext]);
      return `${WEB_PREFIX}/${stem}`;
    },
    async list() {
      const seen = new Map();
      for (const f of await fs.promises.readdir(dir)) {
        const m = /^(.+)\.(webp|jpg)$/i.exec(f);
        if (!m || seen.has(m[1])) continue;
        const stat = await fs.promises.stat(path.join(dir, f));
        seen.set(m[1], { src: `${WEB_PREFIX}/${m[1]}`, name: m[1], mtime: stat.mtimeMs });
      }
      return [...seen.values()].sort((a, b) => b.mtime - a.mtime);
    },
    async remove(stem) {
      let gone = 0;
      for (const [ext] of EXTS) {
        const p = inside(stem + '.' + ext);
        if (fs.existsSync(p)) { await fs.promises.unlink(p); gone++; }
      }
      if (!gone) throw new Error('No such image.');
      return gone;
    },
  };
}

/* ---- Supabase Storage -------------------------------------------------- */
/* Spoken to over its REST API with plain fetch. The JS SDK would pull in an
   auth library this app has no use for, and size matters in a function. */
function supabaseStore() {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_BUCKET || 'uploads';
  if (!base || !key) {
    throw new Error('STORAGE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  }
  const publicBase = `${base}/storage/v1/object/public/${bucket}`;
  const headers = extra => ({ Authorization: `Bearer ${key}`, apikey: key, ...extra });

  async function call(method, url, { body, json, type } = {}) {
    const res = await fetch(url, {
      method,
      headers: headers({
        ...(type ? { 'Content-Type': type } : {}),
        ...(json ? { 'Content-Type': 'application/json' } : {}),
      }),
      body: json ? JSON.stringify(json) : body,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let msg = `Supabase Storage ${res.status}`;
      try { msg += `: ${JSON.parse(detail).message || JSON.parse(detail).error}`; }
      catch { if (detail) msg += `: ${detail.slice(0, 160)}`; }
      if (res.status === 404) msg += ` — does the bucket "${bucket}" exist?`;
      if (res.status === 400 && /row-level|policy/i.test(detail)) msg += ' — use the service_role key.';
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  const safe = stem => {
    const s = path.basename(String(stem || ''));
    if (!s || s !== stem || /[/\\]/.test(s)) throw new Error('Bad file name.');
    return s;
  };

  return {
    kind: 'supabase',
    bucket,
    async put(stem, files) {
      for (const [ext, type] of EXTS) {
        await call('POST', `${base}/storage/v1/object/${bucket}/${stem}.${ext}`,
          { body: files[ext], type });
      }
      return `${publicBase}/${stem}`;
    },
    async list() {
      const rows = await call('POST', `${base}/storage/v1/object/list/${bucket}`, {
        json: { prefix: '', limit: 500, offset: 0, sortBy: { column: 'created_at', order: 'desc' } },
      });
      const seen = new Map();
      for (const r of rows || []) {
        const m = /^(.+)\.(webp|jpg)$/i.exec(r.name);
        if (!m || seen.has(m[1])) continue;
        seen.set(m[1], {
          src: `${publicBase}/${m[1]}`,
          name: m[1],
          mtime: Date.parse(r.created_at || r.updated_at || 0) || 0,
        });
      }
      return [...seen.values()].sort((a, b) => b.mtime - a.mtime);
    },
    async remove(stem) {
      const s = safe(stem);
      await call('DELETE', `${base}/storage/v1/object/${bucket}`,
        { json: { prefixes: EXTS.map(([ext]) => `${s}.${ext}`) } });
      return EXTS.length;
    },
  };
}

let store = null;
/** The configured store, made once. */
function storage() {
  if (!store) {
    const name = (process.env.STORAGE || 'local').toLowerCase();
    if (name === 'supabase') store = supabaseStore();
    else if (name === 'local') store = localStore();
    else throw new Error(`Unknown STORAGE "${name}". Use local or supabase.`);
  }
  return store;
}
/** Forget the configured store — used by the tests. */
function resetStorage() { store = null; }

module.exports = { storage, resetStorage, WEB_PREFIX, EXTS };
