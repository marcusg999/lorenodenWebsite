'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
/* Uploads live under public/assets/uploads by default. Point UPLOAD_DIR at a
   persistent disk in production, or they vanish on the next deploy. */
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'public', 'assets', 'uploads');
/** Web path the templates reference, minus the extension. */
const WEB_PREFIX = 'assets/uploads';

const MAX_BYTES = 12 * 1024 * 1024;     // 12 MB in, before re-encoding
const MAX_EDGE = 2200;                  // longest edge kept
const ACCEPT = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'avif']);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* Held in memory, never written until it has been decoded and re-encoded —
   nothing the browser sent ever lands on disk in its original form. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 4, parts: 8 },
  fileFilter(req, file, cb) {
    if (!/^image\//i.test(file.mimetype)) return cb(new Error('That is not an image file.'));
    cb(null, true);
  },
});

/** A safe, collision-proof basename derived from what the owner uploaded. */
function makeName(original) {
  const stem = path.basename(String(original || 'image'), path.extname(String(original || '')))
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'image';
  return `${stem}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Decode, strip metadata, resize and write a .webp + .jpg pair.
 * Returns { src, width, height } where src is the extension-less web path.
 */
async function processImage(buffer, originalName) {
  let meta;
  try {
    meta = await sharp(buffer, { animated: false }).metadata();
  } catch {
    throw new Error('That file could not be read as an image.');
  }
  // Trust the decoded format, not the filename or the browser's Content-Type.
  if (!meta.format || !ACCEPT.has(meta.format)) {
    throw new Error(`Unsupported image format${meta.format ? ` (${meta.format})` : ''}. Use JPEG, PNG or WebP.`);
  }
  if (!meta.width || !meta.height) throw new Error('That image has no readable dimensions.');
  if (meta.width * meta.height > 50e6) throw new Error('That image is too large (over 50 megapixels).');

  const name = makeName(originalName);
  // rotate() applies the EXIF orientation, then all metadata is dropped —
  // which also removes any GPS coordinates in the original.
  const base = sharp(buffer, { animated: false }).rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });

  const [webp, jpg] = await Promise.all([
    base.clone().webp({ quality: 78 }).toBuffer({ resolveWithObject: true }),
    base.clone().jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
  ]);

  await fs.promises.writeFile(path.join(UPLOAD_DIR, name + '.webp'), webp.data);
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name + '.jpg'), jpg);

  return { src: `${WEB_PREFIX}/${name}`, width: webp.info.width, height: webp.info.height };
}

/** Everything in the upload folder, newest first. */
function listMedia() {
  const seen = new Map();
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    const m = /^(.+)\.(webp|jpg)$/i.exec(f);
    if (!m) continue;
    const stem = m[1];
    if (seen.has(stem)) continue;
    const stat = fs.statSync(path.join(UPLOAD_DIR, f));
    seen.set(stem, { src: `${WEB_PREFIX}/${stem}`, name: stem, mtime: stat.mtimeMs });
  }
  return [...seen.values()].sort((a, b) => b.mtime - a.mtime);
}

/** Delete an upload. Only ever touches files inside UPLOAD_DIR. */
function deleteMedia(name) {
  const stem = path.basename(String(name || ''));
  if (!stem || stem !== name || /[/\\]/.test(stem)) throw new Error('Bad file name.');
  let gone = 0;
  for (const ext of ['.webp', '.jpg']) {
    const p = path.resolve(UPLOAD_DIR, stem + ext);
    if (!p.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) throw new Error('Bad file name.');
    if (fs.existsSync(p)) { fs.unlinkSync(p); gone++; }
  }
  if (!gone) throw new Error('No such image.');
  return gone;
}

module.exports = { upload, processImage, listMedia, deleteMedia, UPLOAD_DIR, WEB_PREFIX, MAX_BYTES };
