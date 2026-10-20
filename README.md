# Loren Oden — official site & admin portal

A two-page site for Los Angeles singer, songwriter and arranger **Loren Oden**, plus a
password-protected portal where the owner edits every word, link, image and list without
touching code.

It runs two ways:

| | |
|---|---|
| **Static** | `npm run build` → `dist/`, plain HTML with **no database and no Node at runtime**. This is what GitHub Pages serves — see [Preview on GitHub Pages](#preview-on-github-pages). |
| **Full** | `npm start` → the same site plus the `/admin` portal, backed by SQLite locally or Supabase in production. |

```bash
npm install
npm run seed                                   # load the sourced content
npm run set-password -- loren@example.com '<a long password>'
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

### Signing in

The portal signs in with an **email address** and a password. There is no public
sign-up: accounts are created on the server.

```bash
npm run set-password -- loren@example.com '<a long password>'   # creates, or changes the password
```

**Forgotten password** is self-service. `/admin/forgot` takes the address, emails a
single-use link that expires in 30 minutes, and `/admin/reset` sets the new one. Resetting
also signs out every other browser that was logged in.

A few details that matter:

- The forgot page answers **identically** whether or not an account exists, so it cannot be
  used to find out which addresses are registered.
- Only a **SHA-256 hash** of each reset token is stored, so a leaked database cannot be used
  to reset anyone's password. One live token per account; issuing a new one voids the old.
- Reset links are built from `APP_URL`, never the `Host` header — otherwise an attacker who
  can set that header could make the link point at their own server. In production the app
  refuses to start a reset without `APP_URL`.
- Requests are rate limited: five reset emails per IP per hour.

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
| Sign-in | Email address and password. No public sign-up; accounts are made on the server. |
| Passwords | bcrypt, cost 12. Minimum twelve characters; obvious ones refused. |
| Reset tokens | 32 random bytes, stored only as a SHA-256 hash, single use, 30-minute expiry, one live token per account. Resetting signs out every other session. |
| Reset links | Built from `APP_URL`, never the `Host` header. No account enumeration: the forgot page answers the same either way. Five requests per IP per hour. |
| Sessions | Server-side in the database, `HttpOnly`, `SameSite=Lax`, `Secure` in production, 12-hour rolling expiry. Session id is regenerated on sign-in. |
| CSRF | Per-session synchroniser token required on every write. |
| Brute force | Ten sign-in attempts per IP per fifteen minutes. |
| Injection | Content is escaped before the two formatting marks are applied; `javascript:` and other unexpected URL schemes collapse to `#`. |
| Writes | Only keys declared in `server/schema.js` and tables on an allow-list are accepted. |
| Uploads | Held in memory and re-encoded before anything touches disk — the original bytes are never written. Format is taken from the decoded image, not the filename or `Content-Type`; SVG is refused outright because it can carry script. 12 MB and 50-megapixel ceilings. Names are sanitised and suffixed, and deletes are confined to the upload folder. |
| Headers | CSP with `script-src 'self'` and no inline scripts; `frame-src` admits only Bandcamp and Apple Music. HSTS in production. |
| Crawlers | `robots.txt` disallows `/admin`. |

`npm test` covers all of the above — 41 tests, including that a wrong password fails, that the
pre-login cookie does not survive sign-in, that HTML in a field is escaped, that a shell script
renamed `.jpg` is refused, that `../../package.json` survives a delete attempt, that the two
forgot-password responses are byte-identical, that a reset token is spent after one use, that an
expired or forged token sets nothing, that a reset turns out other sessions, and that the rate
limiter engages.

> **Serve this over HTTPS.** Session cookies are only marked `Secure` when `NODE_ENV=production`,
> and a password sent over plain HTTP is readable in transit.

---

## Deploying

The site is two halves, and they can live on one platform or two:

| | Where | Needs |
|---|---|---|
| Public site | Netlify or GitHub Pages — static files | nothing |
| Admin portal | a Netlify Function, or any Node host | Supabase, or a persistent disk |

They are linked by the repository: the portal commits content to it, and the
public site rebuilds from that commit.

### Everything on Netlify, with Supabase

This is the recommended setup, and the only one where both halves live on the
same platform. The portal runs as a Netlify Function; Supabase holds what a
function cannot keep for itself.

A Netlify Function has no writable disk and is recycled between requests, so
anything the portal remembers has to live outside it. Three things did, and
all three now sit in Supabase:

| | Was | Is now |
|---|---|---|
| Content | SQLite file | Postgres tables |
| Sessions | SQLite file | `sessions` table — the owner stays signed in whichever instance answers |
| Rate limits | one instance's memory | `rate_hits` table — a limit that cannot be dodged by landing elsewhere |
| Uploaded images | local folder | Supabase Storage, served from its own URL |

**1. Create the Supabase project** (the free tier is enough).

**2. Copy two things from it.**
 - *Project Settings → Database → Connection string → **Transaction pooler*** —
   the one on port **6543**, not 5432. A function opens and drops connections
   constantly; the direct port runs out. Put your database password into it.
 - *Project Settings → API → `service_role` key.* This key bypasses row-level
   security, so it belongs only in Netlify's environment variables — never in
   the repository and never in anything the browser loads.

**3. Make a Storage bucket** called `uploads`, and mark it **public**. The
images are meant to be seen; only writing needs the key.

**4. Set these in Netlify → Site settings → Environment variables:**

```
DB_DRIVER=postgres
DATABASE_URL=postgresql://postgres.<ref>:<password>@<host>:6543/postgres
STORAGE=supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_KEY=<the service_role key>
SUPABASE_BUCKET=uploads
SESSION_SECRET=<openssl rand -hex 32>
NODE_ENV=production
APP_URL=https://<your-site>.netlify.app
```

Add the `SMTP_*` values for password reset and `GITHUB_TOKEN` / `GITHUB_REPO`
for publishing — both optional, both described below.

**5. Deploy.** `netlify.toml` already routes `/admin` and `/api` to the
function and builds the public pages into `dist/`. The tables are created on
the function's first run; nothing has to be run by hand.

**6. Create the account.** The one step that needs a terminal — from a clone,
with the same `DATABASE_URL` and `DB_DRIVER=postgres` in your environment:

```bash
npm run set-password -- loren@example.com '<a long password>'
```

Then sign in at `<APP_URL>/admin/login`.

### Moving an existing SQLite portal to Supabase

`data/content.json` is the format both backends read and write, so the move is
an export and an import:

```bash
npm run content:export                       # SQLite → data/content.json
DB_DRIVER=postgres DATABASE_URL=<pooler url> npm run content:import
DB_DRIVER=postgres DATABASE_URL=<pooler url> npm run set-password -- <email> '<pw>'
```

Accounts and sessions are deliberately not carried over: password hashes are
worth re-making, and everyone signing in again is the right outcome of a move.
Images already uploaded are in `public/assets/uploads/`; upload them to the
`uploads` bucket and re-pick them in the portal, or leave them — the content
file keeps pointing at the committed copies, which the static build still ships.

### A Node host instead

Any host that runs Node 20+ works without Supabase, as long as it gives you a
persistent disk:

1. Build command `npm ci`, start command `npm start`.
2. Set `SESSION_SECRET` (`openssl rand -hex 32`), `NODE_ENV=production` and `APP_URL`.
3. Attach a disk and point `DB_PATH` **and** `UPLOAD_DIR` at it — for example
   `/var/data/site.db` and `/var/data/uploads`.
   **Without a persistent disk the database and every uploaded image are wiped on each deploy.**
4. Run once, from a shell on the host:
   ```bash
   npm run seed
   npm run set-password -- loren@example.com '<a long password>'
   ```

Nothing stops you mixing the two either — `DB_DRIVER=postgres` with
`STORAGE=local`, or the reverse — but on a platform with no disk both have to
move together.

### Email

Password reset needs to send mail. The app speaks plain **SMTP**, so any provider works —
Resend, Postmark, SES, Mailgun, Fastmail, Gmail — by setting env vars rather than changing
code:

```
SMTP_HOST   smtp.resend.com
SMTP_PORT   587
SMTP_USER   resend
SMTP_PASS   <api key>
MAIL_FROM   "Loren Oden" <no-reply@lorenoden.com>
```

STARTTLS is required and the connection times out in ten seconds, so an unreachable mail
host surfaces an error instead of hanging the page. **With no SMTP configured, production
refuses to send** rather than silently doing nothing; outside production the link is printed
to the server log so the flow stays testable. For a local catcher such as Mailpit or Mailhog,
`SMTP_ALLOW_INSECURE=true` drops the TLS requirement — it is ignored when `NODE_ENV=production`.

### Where uploads live

`STORAGE` decides, and the portal behaves the same either way:

| `STORAGE` | Images go to | Stored as |
|---|---|---|
| `local` (default) | `UPLOAD_DIR`, default `public/assets/uploads/` | `assets/uploads/<name>` |
| `supabase` | the `SUPABASE_BUCKET` bucket | the bucket's public URL |

Each upload is re-encoded into a `.webp` and a `.jpg` with the metadata
stripped, and recorded without its extension; the templates ask for whichever
the browser can take. **On a host with an ephemeral filesystem, `local` loses
every image on the next deploy** — use `supabase`, or point `UPLOAD_DIR` at a
persistent disk.

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

### Hosting the static site on Netlify

`netlify.toml` at the repo root is ready to use: build `npm run build`, publish `dist`.
Netlify serves from the domain root, so it runs **without** the `--base` prefix the GitHub
Pages workflow needs. Point Netlify at the repo and it reads the file itself.

The portal rides along as a Netlify Function — see **Everything on Netlify, with
Supabase** above for the variables it needs. Without them the public site still
builds and serves perfectly; only `/admin` is unavailable.

With no portal at all, editing goes: change `data/content.json` by hand, or run the
portal locally, `npm run content:export`, commit, push — Netlify rebuilds either way.

### Publishing automatically

With a hosted portal, set three more variables and **saving publishes**:

```
GITHUB_TOKEN   fine-grained token, Contents: read and write on this repo only
GITHUB_REPO    owner/repo that Netlify builds from
GITHUB_BRANCH  main
```

On save the portal commits `data/content.json`, plus any uploaded images the content
still points at, as a **single commit** through GitHub's Git Data API. Netlify's ordinary
git deploy takes it from there — usually live in a minute or two.

Why commit rather than have the build read from the portal: the published site stays
self-contained, so it does not matter whether the portal is awake when Netlify builds, and
every edit leaves a commit you can read or revert.

Details worth knowing:

- **Nothing changed, nothing committed.** The published file carries no timestamp, so an
  identical save is detected and skipped rather than producing an empty commit and a
  pointless build.
- **Only referenced uploads travel.** An image no longer pointed at by any content is left
  behind rather than accumulating in the repo.
- **Saving and publishing are separate steps.** Edits land in the portal's database first,
  so a GitHub problem shows as "saved, but publishing failed" with a retry — never as a
  lost edit.
- The header shows the state at a glance; without the three variables it reads
  *Publishing off* and the portal works exactly as before.

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

### Two databases, one set of queries

`DB_DRIVER` picks a backend at startup and nothing above it knows which one it
got:

| | |
|---|---|
| `sqlite` (default) | a file, no setup — what local development uses |
| `postgres` | `DATABASE_URL`; Supabase, or any Postgres |

`server/data/` holds the two drivers behind one small async interface, and
`server/db.js` is the only thing the rest of the app talks to. Queries are
written once with `$1` placeholders; the SQLite driver rewrites them to `?`.
The schemas are kept deliberately parallel, down to `columnsOf()` returning
the same column list from either side — the collection editor builds its
columns from that, so a drift between the two would show up immediately.

`data/content.json` remains the format both backends read and write, which is
what makes moving between them an export and an import rather than a migration.

The test suite runs against both:

```bash
npm test          # SQLite
npm run test:pg   # Postgres, with DATABASE_URL set
npm run test:all  # both in turn
```

## Scripts

| | |
|---|---|
| `npm start` | Run the site and portal |
| `npm run dev` | Same, restarting on file changes |
| `npm run build` | Render the public pages to `dist/` with no database |
| `npm run content:export` | Database → `data/content.json` (commit it) |
| `npm run content:import` | `data/content.json` → database |
| `npm run seed` | Load the sourced content into empty collections (`--force` to overwrite) |
| `npm run set-password -- <email> <pw>` | Create the portal account, or change its password |
| `npm test` | Run the test suite against SQLite |
| `npm run test:pg` | The same suite against Postgres (`DATABASE_URL` required) |
| `npm run test:all` | Both in turn |

## Layout

```
server/   app.js · auth.js · db.js · schema.js · seed.js · uploads.js · mailer.js
          render.js · pagedata.js · content-file.js · export-static.js · storage.js
server/data/   index.js · sqlite.js · postgres.js   — the two backends
netlify/functions/portal.js                         — the portal, as a function
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
