'use strict';
/* Seeds the collections from the sourced content package. Idempotent:
   only fills a collection that is currently empty, so it never clobbers edits.
   Force a reset of one or more collections:  node server/seed.js --force tracks shows  */
const fs = require('fs');
const path = require('path');
const { replaceRows, count, TABLES } = require('./db');

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter(a => !a.startsWith('--'));

const NAV = [
  { label: 'Music', href: '/#room' },
  { label: 'About', href: '/#about' },
  { label: 'Shows', href: '/#shows' },
  { label: 'Film & TV', href: '/#screen' },
  { label: 'Press', href: '/#press' },
  { label: 'From the Road', href: '/gallery' },
];

const RELEASES = [
  { tag: 'New single', title: 'Through My Soul',
    body: '**Adrian Younge & Ali Shaheed Muhammad** featuring Loren Oden.\nReleased April 17, 2026. Linear Labs Crew / Sony Music Publishing (GMR).',
    link_label: 'Apple Music', url: 'https://music.apple.com/us/album/through-my-soul-feat-loren-oden-single/1894301597' },
  { tag: 'Debut album', title: 'My Heart, My Love',
    body: '**Produced by Adrian Younge.** Released September 11, 2020 through Linear Labs. Fourteen songs about romance, vulnerability and connection. Some platforms list it as *Adrian Younge Presents: Loren Oden*.',
    link_label: 'Bandcamp', url: 'https://lorenoden.bandcamp.com/album/adrian-younge-presents-loren-oden-my-heart-my-love' },
  { tag: '', title: 'Fealhá',
    body: '**Pupillo** featuring Céu & Loren Oden, on *Pupillo*.\nMarch 6, 2026.',
    link_label: 'Bandcamp', url: 'https://amorinsound.bandcamp.com/track/fealh-feat-c-u-loren-oden' },
  { tag: '', title: 'Nunca Mais / Loca Pasión',
    body: '**Antônio Carlos & Jocafi JID026**, featuring Loren Oden.\nApril 3, 2026.',
    link_label: 'Bandcamp', url: 'https://jazzisdead.bandcamp.com/album/antonio-carlos-jocafi-jid026' },
];

const SHOWS = [
  { kind: 'past', date_label: '28 Aug 2022', venue: 'Lodge Room · Jazz Is Dead', location: 'Los Angeles, California',
    note: 'Artform Studio recap names Loren in its photo caption.',
    url: 'https://www.theartformstudio.com/news-1/2022/8/29/jazz-is-dead-2022-tour-la-show-recap' },
  { kind: 'past', date_label: 'May 2019', venue: 'Norwich Arts Centre · The Midnight Hour', location: 'Norwich, England',
    note: 'The Wordplay review does not establish the exact day, so the month is used.',
    url: 'https://www.wordplaymagazine.com/blog-1/2019/5/3/the-midnight-hour-nac' },
  { kind: 'past', date_label: 'Fall 2019', venue: 'The Midnight Hour · North American tour', location: 'United States & Canada',
    note: 'An announced itinerary including Loren, not verification that every date occurred.',
    url: 'https://www.theartformstudio.com/news-1/2019/9/17/the-midnight-hour-us-tour-2019' },
  { kind: 'past', date_label: '18 Jul 2018', venue: 'The Midnight Hour · NPR Tiny Desk', location: 'NPR session',
    note: 'Publication date of the session, not a ticketed date. Watch the performance ↗',
    url: 'https://www.youtube.com/watch?v=1PYNStp9jY0' },
];

const CREDITS = [
  { meta: 'Film · 2009', title: 'Black Dynamite',
    body: 'Featured and lead vocals on Adrian Younge’s soundtrack, including Black Dynamite Theme, Shot Me in the Heart and Gloria (Zodiac Lovers).',
    url: 'https://www.linearlabsmusic.com/lorenoden' },
  { meta: 'TV · 2016–2018', title: 'Marvel’s Luke Cage',
    body: 'Vocal contributions documented in the official label bio. Feel Alive is also listed as a series song placement.',
    url: 'https://www.linearlabsmusic.com/lorenoden' },
  { meta: 'Series · 2019', title: 'When They See Us',
    body: 'Feel Alive by The Midnight Hour, featuring Karolina & Loren Oden, in Part 3. A song placement, not a series-composer credit.',
    url: 'https://www.whatsong.org/tvshow/when-they-see-us/episode/74980' },
  { meta: 'TV · 2022', title: 'Reasonable Doubt',
    body: 'Background vocals on It’s All Us, with Nayanna Holley, Adrian Younge & Ali Shaheed Muhammad.',
    url: 'https://music.apple.com/us/song/1645128118' },
  { meta: 'TV · 2024', title: 'Reasonable Doubt, Season 2',
    body: 'Vocals on It’s All Us (Extended Version).', url: 'https://music.apple.com/us/song/1767492784' },
];

const PRESS = [
  { meta: 'SoulBounce · Sep 2020', title: 'Loren Oden Drops Debut Album *My Heart, My Love* Presented By Adrian Younge',
    url: 'https://soulbounce.com/2020/09/loren-oden-drops-debut-project-my-heart-my-love-presented-by-adrian-younge/' },
  { meta: 'Buzz Bands LA · 14 Feb 2020', title: 'Ears Wide Open: Loren Oden',
    url: 'https://buzzbands.la/2020/02/14/ears-wide-open-loren-oden/' },
  { meta: 'KCRW · 19 Nov 2019', title: 'The Midnight Hour: *Harmony* featuring Loren Oden — Today’s Top Tune',
    url: 'https://www.kcrw.com/shows/todays-top-tune/stories/the-midnight-hour-harmony-featuring-loren-oden' },
  { meta: 'Wordplay · 3 May 2019', title: 'The Midnight Hour — NAC · Norwich live review and photographs',
    url: 'https://www.wordplaymagazine.com/blog-1/2019/5/3/the-midnight-hour-nac' },
  { meta: 'BroadwayWorld · 12 Mar 2020', title: 'Loren Oden Shares New Song *Queen*',
    url: 'https://www.broadwayworld.com/bwwmusic/article/Loren-Oden-Shares-New-Song-Queen-20200312' },
  { meta: 'NPR via WUNC · 18 Jul 2018', title: 'The Midnight Hour: Tiny Desk Concert',
    url: 'https://www.wunc.org/npr-music/2018-07-18/the-midnight-hour-tiny-desk-concert' },
  { meta: 'AllMusic', title: 'Loren Oden — artist profile, biography and session credits',
    url: 'https://www.allmusic.com/artist/loren-oden-mn0003077996' },
];

const SHOTS = [
  { src: 'assets/img/norwich-1', alt: 'Loren Oden performing at a keyboard on stage in Norwich, England.',
    caption_bold: 'Norwich, England', caption: '2019 · Photo: Matt Neville / Wordplay', width: 1313, height: 876, shape: 'a' },
  { src: 'assets/img/norwich-2', alt: 'Loren Oden singing into a microphone on stage in Norwich.',
    caption_bold: 'The Midnight Hour', caption: 'UK tour · Photo: Matt Neville / Wordplay', width: 801, height: 1201, shape: 'b' },
  { src: 'assets/img/los-angeles', alt: 'Brian Jackson, Adrian Younge, Loren Oden and Katalyst on stage at the Lodge Room, Los Angeles.',
    caption_bold: 'Lodge Room, Los Angeles', caption: '28 August 2022 · Via The Artform Studio', width: 2500, height: 1667, shape: 'c' },
];

const LINKS = [
  { label: 'Bandcamp ↗', href: 'https://lorenoden.bandcamp.com/' },
  { label: 'Apple Music ↗', href: 'https://music.apple.com/us/artist/loren-oden/890306506' },
  { label: 'Bandsintown ↗', href: 'https://www.bandsintown.com/a/12308882-loren-oden' },
  { label: 'Linear Labs ↗', href: 'https://www.linearlabsmusic.com/lorenoden' },
  { label: 'From the Road →', href: '/gallery' },
];

const TRACKS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), 'utf8'))
  .map(t => ({ title: t.title, artist: t.artist, album: t.album, category: t.category,
               role: t.role, source: t.source, embed: t.embed || '' }));

const SEEDS = { nav: NAV, releases: RELEASES, tracks: TRACKS, shows: SHOWS,
                credits: CREDITS, press: PRESS, shots: SHOTS, links: LINKS };

let wrote = 0;
for (const t of TABLES) {
  if (only.length && !only.includes(t)) continue;
  const have = count(t);
  if (have > 0 && !force) { console.log(`· ${t.padEnd(9)} ${have} rows already — left alone`); continue; }
  replaceRows(t, SEEDS[t]);
  console.log(`✓ ${t.padEnd(9)} seeded ${SEEDS[t].length} rows`);
  wrote++;
}
console.log(wrote ? `\nSeeded ${wrote} collection(s).` : '\nNothing to seed. Use --force to overwrite.');
