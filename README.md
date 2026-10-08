# Loren Oden — official site

A two-page static site for Los Angeles singer, songwriter and arranger **Loren Oden**.
No build step, no framework, no CMS: open `index.html` from any static server.

```
python3 -m http.server 8000     # then visit http://localhost:8000
```

## Pages

| Page | Contents |
|---|---|
| `index.html` | Hero · About · Current music · The Listening Room (62 selections) · Shows · Film & TV · Press · Upcoming |
| `gallery.html` | From the road — performance photographs, and a placeholder for personal travel images |

## The design — "Lantern"

Direction and constraints were fixed up front in [`CONTRACT.md`](CONTRACT.md) and the render
was audited against them over five screenshot-critique passes. In short:

- **Acid neon on near-black.** `#06060A` ground, `#C8FF1E` citron, `#3FE8FF` cyan, `#F2EFE6` cream.
- **Nothing is lit until you look at it.** The pointer is a real light source: a masked
  `backdrop-filter` layer brightens whatever sits beneath it while a companion veil darkens
  everything else. On touch devices and when idle, the light drifts on its own.
- **Three techniques, woven in:** a scroll-scrubbed 96-frame camera orbit behind the hero;
  variable typography whose width and weight axes respond to the light and to a slow breath;
  and a flow-field particle layer that reads as dust in the beam.
- **Broken, asymmetric grid** throughout — the portrait breaks the margin, nothing is centred.

Everything degrades safely: `prefers-reduced-motion` disables the light, the scrub and the
dust, and raises base brightness. Text contrast does not depend on the lantern.

## The Listening Room

`data/catalog.json` holds the 62 sourced selections in curated (not chronological) order;
`data/catalog.js` is the generated browser copy that `js/listening.js` reads, so the page
works from `file://` as well as over HTTP. Each entry carries `title`, `artist`, `album`,
`category` (Solo / Features / Screen / Live), `role`, `source` and, for 59 of them, an
official provider `embed`.

Audio is played **only** through official Bandcamp and Apple Music players — nothing is
rehosted. The three selections without an embeddable player link out to their source.
Players do not auto-advance; streaming availability, sign-in and territory restrictions
apply as normal.

To regenerate `catalog.js` after editing the JSON:

```bash
python3 -c "import json;d=json.load(open('data/catalog.json'));open('data/catalog.js','w').write('window.LO_CATALOG = '+json.dumps(d,ensure_ascii=False,separators=(',',':'))+';')"
```

## Assets

| Path | Source |
|---|---|
| `assets/img/portrait.jpg` | Via Linear Labs; photographer not specified |
| `assets/img/norwich-1.jpg`, `norwich-2.jpg` | Matt Neville / Wordplay |
| `assets/img/los-angeles.jpg` | Via The Artform Studio; photographer not specified |
| `assets/frames/*.webp` | Generated hero orbit (vintage microphone, no likeness), 96 frames |
| `assets/fonts/*.woff2` | Anybody, Inter, Instrument Serif — self-hosted, latin subset, SIL OFL |

## Before launch — outstanding items

These come from the source content package and are **not** resolved by this build:

1. **Photograph permissions.** No open reuse licence was stated on the pages the four
   photographs came from. A visible credit is not permission. Confirm with the artist and
   photographers, or swap in images the artist controls.
2. **Shows.** The "no upcoming dates" state reflects one Bandsintown listing checked on
   3 October 2026. Re-check and add any artist-confirmed dates before publishing.
3. **Upcoming music.** The "next chapter" section is deliberately empty — no unreleased
   title, artwork, date or pre-save URL has been verified.
4. **Personal travel photographs.** The gallery holds accurately captioned performance
   images only. Add the artist's own travel images rather than substituting stock.
5. **Catalog completeness.** 62 confirmed selections. Album-level credits (Roy Ayers JID002;
   Souls of Mischief, Ghostface Killah and Bilal projects) still need song-level
   confirmation before the list is described as complete.
6. **Optional:** replace the per-selection players with a single continuous playlist by
   creating "Loren Oden — The Listening Room" in an artist-controlled Spotify or Apple
   Music account using the catalog order, then embedding that playlist.
