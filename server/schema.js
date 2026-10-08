/* ===========================================================================
   The single source of truth for editable content.
   Drives the database defaults, the admin form, and the page templates.
   Add a field here and it appears in the admin portal automatically.
   =========================================================================== */

/* type: text | textarea | url | bool | select  */
const GROUPS = [
  {
    id: 'seo', label: 'Search & sharing', blurb: 'Titles and descriptions search engines and social cards use.',
    fields: [
      { key: 'seo.home.title', label: 'Home — page title', type: 'text',
        def: 'Loren Oden | Soul Singer, Music & Live Dates' },
      { key: 'seo.home.description', label: 'Home — description', type: 'textarea',
        def: 'Explore the music of Los Angeles singer Loren Oden. Listen to solo recordings and collaborations, discover film and TV credits, and view live dates and photos.' },
      { key: 'seo.gallery.title', label: 'Gallery — page title', type: 'text',
        def: 'Loren Oden | Travel & Photo Gallery' },
      { key: 'seo.gallery.description', label: 'Gallery — description', type: 'textarea',
        def: 'Photographs of Loren Oden onstage and on the road, from Los Angeles to England, with more personal travel stories to come.' },
      { key: 'seo.og.description', label: 'Social card tagline', type: 'text',
        def: 'A voice rooted in soul. Music that reaches beyond it.' },
    ],
  },
  {
    id: 'hero', label: 'Hero', blurb: 'The opening screen.',
    fields: [
      { key: 'hero.eyebrow', label: 'Eyebrow line', type: 'text', def: 'A voice rooted in soul.' },
      { key: 'hero.name1', label: 'Name — first line', type: 'text', def: 'Loren',
        help: 'Shown in white. Letters animate individually.' },
      { key: 'hero.name2', label: 'Name — second line', type: 'text', def: 'Oden',
        help: 'Shown in citron.' },
      { key: 'hero.role', label: 'Role line', type: 'text', def: 'Singer · Songwriter · Los Angeles' },
      { key: 'hero.line', label: 'Tagline', type: 'text', def: 'Music that reaches beyond it.' },
      { key: 'hero.cta1.label', label: 'Primary button — label', type: 'text', def: 'Listen to the music' },
      { key: 'hero.cta1.href', label: 'Primary button — link', type: 'url', def: '#room' },
      { key: 'hero.cta2.label', label: 'Secondary button — label', type: 'text', def: 'Live & on tour' },
      { key: 'hero.cta2.href', label: 'Secondary button — link', type: 'url', def: '#shows' },
      { key: 'hero.strip', label: 'Side credits strip', type: 'text',
        def: '*Linear Labs|The Midnight Hour|Jazz Is Dead|Adrian Younge|*62 recordings',
        help: 'Separate items with |  —  prefix an item with * to show it in citron.' },
      { key: 'hero.ignite', label: 'Light hint', type: 'text', def: 'Move to light the room' },
      { key: 'hero.scroll', label: 'Scroll cue', type: 'text', def: 'Scroll' },
    ],
  },
  {
    id: 'about', label: 'About', blurb: 'The biography section.',
    fields: [
      { key: 'about.kicker', label: 'Kicker', type: 'text', def: 'About' },
      { key: 'about.head', label: 'Heading', type: 'text', def: 'Compton gospel,' },
      { key: 'about.head_em', label: 'Heading — italic part', type: 'text', def: 'cinematic soul' },
      { key: 'about.body', label: 'Biography', type: 'textarea',
        def: 'Loren Oden is a Los Angeles singer, songwriter, and arranger with roots in Compton’s gospel tradition. His warm, expressive voice connects classic soul with the cinematic music of Adrian Younge, The Midnight Hour, and Jazz Is Dead. His debut solo album, *My Heart, My Love*, brings that sound into a personal collection of songs about romance, vulnerability, and connection.',
        help: 'Wrap words in *asterisks* for italics.' },
      { key: 'about.pull', label: 'Pull quote', type: 'textarea',
        def: 'Sixty-two recordings, and the voice is the thread through all of them.' },
      { key: 'about.portrait.src', label: 'Portrait — file', type: 'text', def: 'assets/img/portrait',
        help: 'Path without extension; .webp and .jpg are both served.' },
      { key: 'about.portrait.alt', label: 'Portrait — alt text', type: 'text',
        def: 'Loren Oden wearing a fedora and a pink shirt.' },
      { key: 'about.portrait.credit', label: 'Portrait — credit', type: 'text',
        def: 'Portrait via Linear Labs · photographer not specified' },
    ],
  },
  {
    id: 'releases', label: 'Current music', blurb: 'The "Out now" list.',
    fields: [
      { key: 'releases.kicker', label: 'Kicker', type: 'text', def: 'Current music' },
      { key: 'releases.head', label: 'Heading', type: 'text', def: 'Out' },
      { key: 'releases.head_em', label: 'Heading — italic part', type: 'text', def: 'now' },
    ],
  },
  {
    id: 'room', label: 'The Listening Room', blurb: 'Wrapper copy for the catalog. Selections are edited on their own tab.',
    fields: [
      { key: 'room.kicker', label: 'Kicker', type: 'text', def: 'The listening room' },
      { key: 'room.head', label: 'Heading', type: 'text', def: 'Sixty-two' },
      { key: 'room.head_em', label: 'Heading — italic part', type: 'text', def: 'selections' },
      { key: 'room.lede', label: 'Intro', type: 'textarea',
        def: 'Solo recordings, featured performances and credited vocal contributions, ordered for discovery rather than chronology. Audio plays through the official Bandcamp and Apple Music players; selections without a player open at their source.' },
      { key: 'room.note', label: 'Player note', type: 'textarea',
        def: 'Players do not advance automatically. Streaming availability, sign-in and territory restrictions still apply.' },
    ],
  },
  {
    id: 'shows', label: 'Shows', blurb: 'Section copy and the empty state. Dates are edited on their own tab.',
    fields: [
      { key: 'shows.kicker', label: 'Kicker', type: 'text', def: 'Live' },
      { key: 'shows.head', label: 'Heading', type: 'text', def: 'On' },
      { key: 'shows.head_em', label: 'Heading — italic part', type: 'text', def: 'stage' },
      { key: 'shows.empty.show', label: 'Show the "no dates" panel', type: 'bool', def: '1',
        help: 'Turn this off once real upcoming dates are listed.' },
      { key: 'shows.empty.head', label: 'Empty state — headline', type: 'text',
        def: 'No dates are currently listed.' },
      { key: 'shows.empty.note', label: 'Empty state — note', type: 'textarea',
        def: 'Loren’s Bandsintown page carried no upcoming shows when it was checked on October 3, 2026. That describes one listing, not proof that nothing is scheduled elsewhere.' },
      { key: 'shows.empty.cta.label', label: 'Empty state — button', type: 'text', def: 'Follow announcements' },
      { key: 'shows.empty.cta.href', label: 'Empty state — button link', type: 'url',
        def: 'https://www.bandsintown.com/a/12308882-loren-oden' },
      { key: 'shows.upcoming.kicker', label: 'Upcoming list — heading', type: 'text', def: 'Upcoming' },
      { key: 'shows.archive.kicker', label: 'Past list — heading', type: 'text', def: 'Archive' },
    ],
  },
  {
    id: 'screen', label: 'Film & TV', blurb: 'Section copy. Credits are edited on their own tab.',
    fields: [
      { key: 'screen.kicker', label: 'Kicker', type: 'text', def: 'Film, television and soundtrack' },
      { key: 'screen.head', label: 'Heading', type: 'text', def: 'On' },
      { key: 'screen.head_em', label: 'Heading — italic part', type: 'text', def: 'screen' },
      { key: 'screen.note', label: 'Footnote', type: 'textarea',
        def: 'A sourced selection of credits, not a complete filmography. Composer credits belonging to collaborators are not claimed here.' },
    ],
  },
  {
    id: 'press', label: 'Press', blurb: 'Section copy. Articles are edited on their own tab.',
    fields: [
      { key: 'press.kicker', label: 'Kicker', type: 'text', def: 'Press' },
      { key: 'press.head', label: 'Heading', type: 'text', def: 'In' },
      { key: 'press.head_em', label: 'Heading — italic part', type: 'text', def: 'print' },
    ],
  },
  {
    id: 'next', label: 'Upcoming music', blurb: 'The closing "next chapter" panel.',
    fields: [
      { key: 'next.kicker', label: 'Kicker', type: 'text', def: 'Upcoming music' },
      { key: 'next.head', label: 'Heading — line one', type: 'text', def: 'The next' },
      { key: 'next.head_hi', label: 'Heading — line two', type: 'text', def: 'chapter' },
      { key: 'next.body', label: 'Body', type: 'textarea', def: 'New release announcements will appear here.' },
    ],
  },
  {
    id: 'gallery', label: 'From the Road', blurb: 'The photo gallery page.',
    fields: [
      { key: 'gallery.kicker', label: 'Kicker', type: 'text', def: 'Travel & photographs' },
      { key: 'gallery.head', label: 'Heading', type: 'text', def: 'From the' },
      { key: 'gallery.head_em', label: 'Heading — italic part', type: 'text', def: 'road' },
      { key: 'gallery.lede', label: 'Intro', type: 'textarea',
        def: 'Moments onstage in Los Angeles and England, with more stories from our travels to come.' },
      { key: 'gallery.personal.kicker', label: 'Personal travel — kicker', type: 'text', def: 'Personal travel' },
      { key: 'gallery.personal.head', label: 'Personal travel — line one', type: 'text', def: 'More moments' },
      { key: 'gallery.personal.head_hi', label: 'Personal travel — line two', type: 'text', def: 'to come' },
      { key: 'gallery.personal.lede', label: 'Personal travel — body', type: 'textarea',
        def: 'Our personal travel photographs will join this gallery soon.' },
      { key: 'gallery.personal.note', label: 'Personal travel — note', type: 'textarea',
        def: 'The gallery above holds accurately captioned performance and touring photographs only. Destination images will be added from the artist’s own archive rather than substituted from stock.' },
      { key: 'gallery.footer.mark', label: 'Footer wordmark — line one', type: 'text', def: 'From' },
      { key: 'gallery.footer.mark2', label: 'Footer wordmark — line two', type: 'text', def: 'the road' },
      { key: 'gallery.footer.credits', label: 'Footer — photo credits', type: 'text',
        def: 'Photographs: Matt Neville / Wordplay · The Artform Studio' },
      { key: 'gallery.footer.note', label: 'Footer — note', type: 'text',
        def: 'Permission to be confirmed before launch' },
    ],
  },
  {
    id: 'footer', label: 'Footer', blurb: 'The bottom of the home page.',
    fields: [
      { key: 'footer.mark', label: 'Wordmark — line one', type: 'text', def: 'Loren' },
      { key: 'footer.mark2', label: 'Wordmark — line two', type: 'text', def: 'Oden' },
      { key: 'footer.base1', label: 'Base line — left', type: 'text', def: 'Los Angeles, California' },
      { key: 'footer.base2', label: 'Base line — middle', type: 'text',
        def: 'Photographs credited to their sources · permission to be confirmed before launch' },
      { key: 'footer.copyright', label: 'Copyright name', type: 'text', def: 'Loren Oden' },
    ],
  },
];

/* ---- repeatable collections -------------------------------------------- */
const COLLECTIONS = {
  nav:      { label: 'Navigation', cols: ['label', 'href'], singularLabel: 'link' },
  releases: { label: 'Current music', cols: ['tag', 'title', 'body', 'link_label', 'url'], singularLabel: 'release' },
  tracks:   { label: 'Listening Room', cols: ['title', 'artist', 'album', 'category', 'role', 'source', 'embed'], singularLabel: 'selection' },
  shows:    { label: 'Shows', cols: ['kind', 'date_label', 'venue', 'location', 'note', 'url'], singularLabel: 'date' },
  credits:  { label: 'Film & TV', cols: ['meta', 'title', 'body', 'url'], singularLabel: 'credit' },
  press:    { label: 'Press', cols: ['meta', 'title', 'url'], singularLabel: 'article' },
  shots:    { label: 'Gallery photographs', cols: ['src', 'alt', 'caption_bold', 'caption', 'width', 'height', 'shape'], singularLabel: 'photograph' },
  links:    { label: 'Footer links', cols: ['label', 'href'], singularLabel: 'link' },
};

const ALL_FIELDS = GROUPS.flatMap(g => g.fields.map(f => ({ ...f, group: g.id })));
const FIELD_BY_KEY = new Map(ALL_FIELDS.map(f => [f.key, f]));

module.exports = { GROUPS, COLLECTIONS, ALL_FIELDS, FIELD_BY_KEY };
