# Loren Oden — official site & admin portal

A two-page site for Los Angeles singer, songwriter and arranger **Loren Oden**, plus a
password-protected portal where the owner edits every word, link and list without touching code.

```bash
npm install
npm run seed                                   # load the sourced content
npm run set-password -- loren '<a long password>'
npm start                                      # http://localhost:3000
```

The portal is at **`/admin`**.

---

## The pages

| Route | Contents |
|---|---|
| `/` | Hero · About · Current music · The Listening Room (62 selections) · Shows · Film & TV · Press · Upcoming |
| `/gallery` | From the road — performance photographs, and a placeholder for personal travel images |
| `/admin` | The editor (sign-in required) |

## The design — "Lantern"

Direction and constraints were fixed up front in [`CONTRACT.md`](CONTRACT.md) and the render was
audited against them over five screenshot-critique passes.

- **Acid neon on near-black.** `#06060A` ground, `#C8FF1E` citron, `#3FE8FF` cyan, `#F2EFE6` cream.
- **Nothing is lit until you look at it.** The pointer is a real light source: a masked
  `backdrop-filter` layer brightens whatever sits beneath it while a companion veil darkens
  everything else. It drifts on its own when idle or on touch.
- **Three techniques, woven in:** a scroll-scrubbed 96-frame camera orbit behind the hero;
  variable typography whose width and weight axes respond to the light and to a slow breath;
  and a flow-field particle layer that reads as dust in the beam.
- **Broken, asymmetric grid** — the portrait breaks the margin, nothing is centred.

`prefers-reduced-motion` disables the light, the scrub and the dust. Text contrast never depends
on the lantern.

---

## The admin portal

Everything the owner can change, grouped the way the site reads:

- **Copy & links** — 72 fields across Search & sharing, Hero, About, Current music, The Listening
  Room, Shows, Film & TV, Press, Upcoming music, From the Road and Footer. Every headline,
  paragraph, button label, kicker, caption, credit and URL.
- **Lists** — navigation, current releases, the 62-selection catalog, show dates, film & TV
  credits, press articles, gallery photographs and footer links. Add, edit, reorder, remove.
- **Account** — change the portal password.

Edits appear on the site immediately; there is no rebuild or redeploy.

### Two conveniences worth knowing

- **Shows.** Add a date with *When* set to `upcoming` and the "no dates are currently listed"
  panel steps aside on its own. Remove the last upcoming date and it comes back.
- **Formatting.** In longer fields, `**double asterisks**` make text bold and `*single*` makes it
  italic. Nothing else is interpreted, so no markup from the editor can reach the page as HTML.

### Adding or changing an editable field

Add it to `server/schema.js`. It appears in the portal and in the database on next start — the
admin form is generated from that file, so there is no second place to update.

---

## Security

| | |
|---|---|
| Passwords | bcrypt, cost 12. Minimum twelve characters; obvious ones refused. |
| Sessions | Server-side in SQLite, `HttpOnly`, `SameSite=Lax`, `Secure` in production, 12-hour rolling expiry. Session id is regenerated on sign-in. |
| CSRF | Per-session synchroniser token required on every write. |
| Brute force | Ten sign-in attempts per IP per fifteen minutes. |
| Injection | Content is escaped before the two formatting marks are applied; `javascript:` and other unexpected URL schemes collapse to `#`. |
| Writes | Only keys declared in `server/schema.js` and tables on an allow-list are accepted. |
| Headers | CSP with `script-src 'self'` and no inline scripts; `frame-src` admits only Bandcamp and Apple Music. HSTS in production. |
| Crawlers | `robots.txt` disallows `/admin`. |

`npm test` covers all of the above — 20 tests, including that a wrong password fails, that the
pre-login cookie does not survive sign-in, that HTML in a field is escaped, and that the rate
limiter engages.

> **Serve this over HTTPS.** Session cookies are only marked `Secure` when `NODE_ENV=production`,
> and a password sent over plain HTTP is readable in transit.

---

## Deploying

Any host that runs Node 20+ and gives you a persistent disk. On Render, Railway or Fly:

1. Build command `npm install`, start command `npm start`.
2. Set `SESSION_SECRET` (`openssl rand -hex 32`) and `NODE_ENV=production`.
3. Attach a persistent disk and point `DB_PATH` at it — for example `/var/data/site.db`.
   **Without a persistent disk the database is wiped on every deploy.**
4. Run once, from a shell on the host:
   ```bash
   npm run seed
   npm run set-password -- loren '<a long password>'
   ```

See `.env.example`. Back up by copying the single `data/site.db` file.

### Static export

`npm run export` renders the current content to `dist/` as plain HTML, for putting the public
pages on a CDN while the portal runs elsewhere. The exported site has no admin.

## Scripts

| | |
|---|---|
| `npm start` | Run the site and portal |
| `npm run dev` | Same, restarting on file changes |
| `npm run seed` | Load the sourced content into empty collections (`--force` to overwrite) |
| `npm run set-password -- <user> <pw>` | Create the portal account, or change its password |
| `npm run export` | Render the public pages to `dist/` |
| `npm test` | Run the test suite |

## Layout

```
server/   app.js · auth.js · db.js · schema.js · seed.js · render.js · export-static.js
views/    index.ejs · gallery.ejs · admin.ejs · admin-login.ejs · partials
public/   css/ · js/ · assets/ (fonts, images, the 96 orbit frames)
data/     catalog.json (seed source) · site.db (created at runtime, not in git)
```

## The Listening Room

Audio plays **only** through official Bandcamp and Apple Music players — nothing is rehosted.
Selections without an embeddable player link out to their source. Players do not auto-advance;
streaming availability, sign-in and territory restrictions apply as normal.

## Assets

| Path | Source |
|---|---|
| `public/assets/img/portrait.jpg` | Via Linear Labs; photographer not specified |
| `public/assets/img/norwich-1.jpg`, `norwich-2.jpg` | Matt Neville / Wordplay |
| `public/assets/img/los-angeles.jpg` | Via The Artform Studio; photographer not specified |
| `public/assets/frames/*.webp` | Generated hero orbit (a microphone — no likeness), 96 frames |
| `public/assets/fonts/*.woff2` | Anybody, Inter, Instrument Serif — self-hosted, latin subset, SIL OFL |

---

## Before launch

1. **Photograph permissions.** No open reuse licence was stated on the pages the four photographs
   came from. A visible credit is not permission. Confirm with the artist and photographers, or
   swap in images the artist controls.
2. **Shows.** The "no dates" state reflects one Bandsintown listing checked on 3 October 2026.
   Re-check and add any confirmed dates in the portal.
3. **Upcoming music.** Deliberately empty — no unreleased title, artwork, date or pre-save URL
   has been verified.
4. **Personal travel photographs.** The gallery holds accurately captioned performance images
   only. Add the artist's own travel images rather than substituting stock.
5. **Catalog completeness.** 62 confirmed selections. Album-level credits (Roy Ayers JID002;
   Souls of Mischief, Ghostface Killah and Bilal projects) still need song-level confirmation
   before the list is described as complete.

## Not built

**Image upload.** The portal edits image *paths*, alt text, captions and credits, but does not
accept file uploads — replacing a photograph means putting the new `.jpg` and `.webp` into
`public/assets/img/` and pointing the path at it. Adding upload (with automatic webp resizing)
is a contained piece of work if it is wanted.
