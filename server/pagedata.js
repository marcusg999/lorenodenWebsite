'use strict';
const { allContent, listRows } = require('./db');
const helpers = require('./render');

/** Everything a template needs, in one read. */
function pageData() {
  const c = allContent();
  const tracks = listRows('tracks');
  const shows = listRows('shows');
  const counts = tracks.reduce((a, t) => (a[t.category] = (a[t.category] || 0) + 1, a), {});
  return {
    c,
    nav: listRows('nav'),
    releases: listRows('releases'),
    tracks,
    upcoming: shows.filter(s => s.kind === 'upcoming'),
    past: shows.filter(s => s.kind !== 'upcoming'),
    credits: listRows('credits'),
    press: listRows('press'),
    shots: listRows('shots'),
    links: listRows('links'),
    counts: {
      all: tracks.length,
      Solo: counts.Solo || 0, Features: counts.Features || 0,
      Screen: counts.Screen || 0, Live: counts.Live || 0,
    },
    year: new Date().getFullYear(),
    ...helpers,
  };
}
module.exports = { pageData };
