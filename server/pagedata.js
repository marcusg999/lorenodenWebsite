'use strict';
const helpers = require('./render');

/**
 * Everything a template needs.
 * @param {object} src   data source: { content, nav, releases, tracks, ... }
 * @param {object} opts  { base: '' , staticMode: false }
 *   base       — path prefix, e.g. '/lorenodenWebsite' for a project GitHub Page
 *   staticMode — rewrite routes to .html files for a server-less build
 */
function build(src, opts) {
  opts = opts || {};
  const base = (opts.base || '').replace(/\/$/, '');
  const staticMode = !!opts.staticMode;
  const c = src.content;
  const tracks = src.tracks || [];
  const shows = src.shows || [];
  const counts = tracks.reduce((a, t) => (a[t.category] = (a[t.category] || 0) + 1, a), {});

  /** Asset URLs: always rooted, always prefixed with the base. */
  const u = p => base + (String(p).startsWith('/') ? p : '/' + p);

  /** Navigation and content links, aware of the static build's file names. */
  const link = href => {
    const v = helpers.safeHref(href);
    if (!v.startsWith('/')) return v;                 // #anchor, https://, mailto:
    let out = v;
    if (staticMode) {
      if (out === '/') out = '/index.html';
      else if (out === '/gallery') out = '/gallery.html';
      else if (out.startsWith('/#')) out = '/index.html' + out.slice(1);
      else if (out.startsWith('/gallery#')) out = '/gallery.html' + out.slice(8);
    }
    return base + out;
  };

  return {
    c,
    nav: src.nav || [], releases: src.releases || [], tracks,
    upcoming: shows.filter(s => s.kind === 'upcoming'),
    past: shows.filter(s => s.kind !== 'upcoming'),
    credits: src.credits || [], press: src.press || [],
    shots: src.shots || [], links: src.links || [],
    counts: {
      all: tracks.length,
      Solo: counts.Solo || 0, Features: counts.Features || 0,
      Screen: counts.Screen || 0, Live: counts.Live || 0,
    },
    year: new Date().getFullYear(),
    base, staticMode, u, link,
    ...helpers,
  };
}

/** Live data, straight from the database. */
function pageData(opts) {
  const { allContent, listRows } = require('./db');
  return build({
    content: allContent(),
    nav: listRows('nav'), releases: listRows('releases'), tracks: listRows('tracks'),
    shows: listRows('shows'), credits: listRows('credits'), press: listRows('press'),
    shots: listRows('shots'), links: listRows('links'),
  }, opts);
}

/** Data from the committed JSON file — no database involved. */
function fileData(file, opts) {
  return build(require('./content-file').readFile(file), opts);
}

module.exports = { build, pageData, fileData };
