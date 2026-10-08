# Loren Oden — official site & admin portal

A two-page site for Los Angeles singer, songwriter and arranger **Loren Oden**, plus a
password-protected portal where the owner edits every word, link, image and list without
touching code.

It runs two ways:

| | |
|---|---|
| **Static** | `npm run build` → `dist/`, plain HTML with **no database and no Node at runtime**. This is what GitHub Pages serves — see [Preview on GitHub Pages](#preview-on-github-pages). |
| **Full** | `npm start` → the same site plus the `/admin` portal, backed by SQLite. |

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
- **Images** — upload a replacement portrait or gallery photograph straight from the portal,
  or pick one already uploaded from the image library. Each upload is decoded, stripped of
  metadata (including any GPS coordinates), scaled to fit 2200px and written as a matching
  `.webp` + `.jpg` pair, so the page's `<picture>` markup keeps working unchanged.
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
| Uploads | Held in memory and re-encoded before anything touches disk — the original bytes are never written. Format is taken from the decoded image, not the filename or `Content-Type`; SVG is refused outright because it can carry script. 12 MB and 50-megapixel ceilings. Names are sanitised and suffixed, and deletes are confined to the upload folder. |
| Headers | CSP with `script-src 'self'` and no inline scripts; `frame-src` admits only Bandcamp and Apple Music. HSTS in production. |
| Crawlers | `robots.txt` disallows `/admin`. |

`npm test` covers all of the above — 29 tests, including that a wrong password fails, that the
pre-login cookie does not survive sign-in, that HTML in a field is escaped, that a shell script
renamed `.jpg` is refused, that `../../package.json` survives a delete attempt, and that the rate
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

### Where uploads live

By default `public/assets/uploads/`. **On a host with an ephemeral filesystem, set `UPLOAD_DIR`
to a path on the persistent disk** — otherwise uploaded images disappear on the next deploy,
exactly like the database.

---

## Preview on GitHub Pages

The public site builds to static HTML with no database, so Loren can review it before any
backend exists.

**One-time:** Settings → Pages → Build and deployment → Source → **GitHub Actions**.

After that, every push to `main` that touches content or templates rebuilds and publishes to
`https://<owner>.github.io/<repo>/`. The workflow is `.github/workflows/pages.yml`; it installs
only `ejs` — no database, no image libraries, nothing to compile.

### How content reaches the static build

`data/content.json` holds every field and list, and **it is committed to the repo**. The static
build reads that file; the database is never opened.

```bash
npm run content:export     # database  → data/content.json   (commit this)
npm run content:import     # data/content.json → database
```

So the loop is: edit in the portal → `npm run content:export` → commit → Pages republishes.
Without a running portal you can also edit `data/content.json` by hand.

### Building it yourself

```bash
npm run build                                 # → dist/, from data/content.json
npm run build -- --base /lorenodenWebsite     # for a project page at /<repo>
npm run build -- --from-db                    # read the live database instead
npm run build -- --out public_html            # somewhere other than dist/
```

`--base` matters: a project page is served from a subdirectory, so every asset and link needs
that prefix. The build also rewrites `/gallery` to `gallery.html` and writes `.nojekyll` and a
`404.html`. `dist/` carries no admin page, stylesheet or script.

### When Supabase arrives

`data/content.json` is the handover format — a flat `content` object plus one array per list,
with no SQLite specifics in it. Point a new adapter at the same shape and
`server/pagedata.js` keeps working; `build(src, opts)` already takes a plain data object, which
is how both the database and the JSON file feed the same templates today.

## Scripts

| | |
|---|---|
| `npm start` | Run the site and portal |
| `npm run dev` | Same, restarting on file changes |
| `npm run build` | Render the public pages to `dist/` with no database |
| `npm run content:export` | Database → `data/content.json` (commit it) |
| `npm run content:import` | `data/content.json` → database |
| `npm run seed` | Load the sourced content into empty collections (`--force` to overwrite) |
| `npm run set-password -- <user> <pw>` | Create the portal account, or change its password |
| `npm test` | Run the test suite |

## Layout

```
server/   app.js · auth.js · db.js · schema.js · seed.js · uploads.js
          render.js · pagedata.js · content-file.js · export-static.js
views/    index.ejs · gallery.ejs · admin.ejs · admin-login.ejs · partials
public/   css/ · js/ · assets/ (fonts, images, 96 orbit frames, uploads/)
data/     content.json (committed — what the static build reads)
          catalog.json (original seed source)
          site.db (created at runtime, not in git)
.github/  workflows/pages.yml
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

## Notes

- **Uploaded images are not in git.** `public/assets/uploads/` is ignored, so a Pages build
  publishes only the photographs committed under `public/assets/img/`. If an uploaded image
  should appear in the static preview, commit it or move it into `assets/img/`.
- **The static preview has no portal.** `dist/` is public HTML only; there is nothing to sign
  in to and nothing to attack.
