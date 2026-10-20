'use strict';
/* Publishing: push the portal's content to GitHub so the live site rebuilds.
 *
 * The portal keeps its own SQLite database, but the public site is built from
 * data/content.json in the repository. Publishing writes that file — plus any
 * images the content points at — as a single commit through GitHub's Git Data
 * API. Netlify's ordinary git deploy does the rest.
 *
 * Doing it this way, rather than having the build read from the portal, keeps
 * the published site self-contained: it does not matter whether the portal is
 * awake when Netlify builds, and every edit leaves a commit you can read or
 * revert.
 *
 *   GITHUB_TOKEN   a fine-grained token with Contents: read and write
 *   GITHUB_REPO    owner/repo that Netlify builds from
 *   GITHUB_BRANCH  defaults to main
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = process.env.GITHUB_API || 'https://api.github.com';   // overridable for tests
const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = () => process.env.UPLOAD_DIR || path.join(ROOT, 'public', 'assets', 'uploads');

const cfg = () => ({
  token: process.env.GITHUB_TOKEN,
  repo: process.env.GITHUB_REPO,
  branch: process.env.GITHUB_BRANCH || 'main',
});
function isConfigured() {
  const c = cfg();
  return Boolean(c.token && /^[^/\s]+\/[^/\s]+$/.test(c.repo || ''));
}

/** Last attempt, so the portal can show what happened. */
let last = { state: 'idle', at: null, message: null, url: null };
const status = () => ({ ...last, configured: isConfigured(), repo: cfg().repo || null, branch: cfg().branch });

async function gh(method, url, body) {
  const c = cfg();
  const res = await fetch(url.startsWith('http') ? url : `${API}/repos/${c.repo}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'loren-oden-portal',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let msg = `GitHub ${res.status}`;
    try { msg += `: ${JSON.parse(detail).message}`; } catch { if (detail) msg += `: ${detail.slice(0, 160)}`; }
    if (res.status === 401 || res.status === 403) msg += ' — check GITHUB_TOKEN and its Contents permission.';
    if (res.status === 404) msg += ' — check GITHUB_REPO and that the token can see it.';
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

/** The content file, plus every uploaded image the content still refers to. */
async function collectFiles() {
  const { allContent, listRows } = require('./db');
  const cf = require('./content-file');

  const content = await allContent();
  // No timestamp: it would differ on every call, so nothing would ever look
  // unchanged and each save would commit. The commit itself records the time.
  const doc = { version: 1, content };
  for (const t of cf.TABLES) {
    doc[t] = (await listRows(t)).map(r => { const { id, position, ...rest } = r; return rest; });
  }
  const files = [{
    path: 'data/content.json',
    text: JSON.stringify(doc, null, 2) + '\n',
  }];

  // Images uploaded through the portal live on its disk, not in the repo, so
  // they have to travel with the content that points at them. With Supabase
  // Storage the src is an absolute URL instead, already public — those match
  // neither test below and are correctly left out of the commit.
  const refs = new Set();
  for (const v of Object.values(content)) {
    if (typeof v === 'string' && v.startsWith('assets/uploads/')) refs.add(v);
  }
  for (const s of doc.shots || []) {
    if (typeof s.src === 'string' && s.src.startsWith('assets/uploads/')) refs.add(s.src);
  }
  for (const ref of refs) {
    const stem = path.basename(ref);
    for (const ext of ['.webp', '.jpg']) {
      const disk = path.resolve(UPLOAD_DIR(), stem + ext);
      if (!disk.startsWith(path.resolve(UPLOAD_DIR()) + path.sep)) continue;   // no traversal
      if (fs.existsSync(disk)) files.push({ path: `public/assets/uploads/${stem}${ext}`, buffer: fs.readFileSync(disk) });
    }
  }
  return files;
}

const sha1 = buf =>
  crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

/**
 * Commit the current content to GitHub. One commit, whatever changed.
 * Returns { published, unchanged, sha, url, files }.
 */
async function publish({ message, author } = {}) {
  if (!isConfigured()) throw new Error('Publishing is not configured. Set GITHUB_TOKEN and GITHUB_REPO.');
  const c = cfg();
  last = { state: 'running', at: new Date().toISOString(), message: null, url: null };

  try {
    const files = await collectFiles();

    const ref = await gh('GET', `/git/ref/heads/${encodeURIComponent(c.branch)}`);
    const headSha = ref.object.sha;
    const headCommit = await gh('GET', `/git/commits/${headSha}`);

    // Skip the commit when nothing actually differs from what is already there.
    const existing = await gh('GET',
      `/git/trees/${headCommit.tree.sha}?recursive=1`).catch(() => ({ tree: [] }));
    const bySha = new Map((existing.tree || []).map(e => [e.path, e.sha]));
    const changed = files.filter(f => {
      const buf = f.buffer || Buffer.from(f.text, 'utf8');
      return bySha.get(f.path) !== sha1(buf);
    });
    if (!changed.length) {
      last = { state: 'unchanged', at: new Date().toISOString(),
               message: 'Already up to date — nothing to publish.', url: null };
      return { published: false, unchanged: true, files: [] };
    }

    const tree = [];
    for (const f of changed) {
      const blob = await gh('POST', '/git/blobs', f.buffer
        ? { content: f.buffer.toString('base64'), encoding: 'base64' }
        : { content: f.text, encoding: 'utf-8' });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const newTree = await gh('POST', '/git/trees', { base_tree: headCommit.tree.sha, tree });
    const commit = await gh('POST', '/git/commits', {
      message: message || `Content update from the portal\n\n${changed.map(f => `- ${f.path}`).join('\n')}`,
      tree: newTree.sha,
      parents: [headSha],
      ...(author ? { author: { name: author.name || 'Loren Oden portal', email: author.email, date: new Date().toISOString() } } : {}),
    });
    await gh('PATCH', `/git/refs/heads/${encodeURIComponent(c.branch)}`, { sha: commit.sha, force: false });

    const url = `https://github.com/${c.repo}/commit/${commit.sha}`;
    last = { state: 'published', at: new Date().toISOString(),
             message: `Published ${changed.length} file${changed.length === 1 ? '' : 's'}.`, url };
    return { published: true, unchanged: false, sha: commit.sha, url, files: changed.map(f => f.path) };
  } catch (e) {
    last = { state: 'failed', at: new Date().toISOString(), message: e.message, url: null };
    throw e;
  }
}

module.exports = { isConfigured, publish, status, collectFiles, _sha1: sha1 };
