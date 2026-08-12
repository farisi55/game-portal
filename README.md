# Gimboot — Multi-Source Game Portal

**No install, just play, have fun.** A static, no-build-tool game portal in
the vein of CrazyGames. Vanilla HTML5 + Tailwind (CDN) + modern vanilla JS
(ES modules) on the frontend. Games come from three places: GameMonetize's
catalog, GamePix's catalog, and games hosted directly (currently: Kicau
Mania). Installable as a PWA, with per-game SEO landing pages generated
programmatically from the live catalog.

## How it's wired together

```
Browser
  ├─ GET /                         → index.html   (catalog: grid, search, category filter)
  ├─ GET /play/{id}/{slug}         → src/index.js  (SEO landing page — see below)
  ├─ GET /game.html?...            → game.html     (legacy query-param player, kept for old links)
  ├─ GET /api/games                → src/index.js  (Cloudflare Worker)
  ├─ GET /sitemap.xml              → src/index.js  (every /play/ URL, for crawlers)
  │                                       │
  │                                       ├─ fetch → gamemonetize.com/feed.php  (server-side, parsed from RSS/XML)
  │                                       ├─ fetch → feeds.gamepix.com/v2/json  (server-side, already JSON)
  │                                       ├─ normalize both into one common shape, merge
  │                                       └─ cache the merged result at the edge (Cache API, 30 min)
  │
  ├─ <iframe src="https://html5.gamemonetize.co/...">   (a GameMonetize game)
  ├─ <iframe src="https://play.gamepix.com/.../embed">   (a GamePix game)
  └─ <iframe src="/games/kicau-mania/index.html">         (a game hosted directly)
```

## Programmatic SEO: `/play/{id}/{slug}`

Every game gets its own real, crawlable URL — e.g.
`gimboot.com/play/gp-O6650/moto-x3m` — without hand-writing a single page.

**How it works:** `src/index.js` fetches the existing `game.html` asset
as-is, then transforms it in place with Cloudflare's native
**HTMLRewriter** (a streaming HTML parser, not string splicing) before the
response ever reaches a browser or crawler:

- `<title>` → `Play {game title} Free, No Download - Gimboot`
- `<meta name="description">` → a per-game description mentioning its category
- Open Graph + Twitter Card tags appended (`og:title`, `og:image` from the
  game's thumbnail, `og:url`, etc.) — so links shared on social/chat apps
  show a real preview, not a generic one
- A `<link rel="canonical">` pointing at the same URL
- A tiny inline `<script>window.__GIMBOOT_PLAY_ID__ = "...";</script>` —
  the one bit of state the page needs to tell `js/player.js` which game to
  actually load

**Only the `{id}` segment is ever read.** `{slug}` exists purely so the URL
is descriptive for search engines and people sharing links — it's never
parsed for lookup, so a stale or mismatched slug can never break anything.
`js/utils.js` → `buildPlayUrl()` and `slugify()` generate these URLs
client-side (used by every card in the catalog and every "related game"
link); `src/index.js` has an intentionally-duplicated `slugify()` that
produces byte-identical output (verified with matching test cases across
punctuation, accents, and empty titles) so a game's canonical URL is
consistent everywhere it's linked from.

**`/sitemap.xml`** lists every current game's `/play/` URL plus the
homepage, generated live from the same merged catalog — submit it in
Google Search Console / Bing Webmaster Tools so the ~50 (and growing)
game pages get discovered without needing to be crawled through the
client-rendered grid first.

**Old links still work.** `game.html?id=...&url=...` (the original
query-param format) is still fully supported by `js/player.js` as a
fallback — new links just don't use it anymore.

### Why this needed absolute paths everywhere

`/play/gp-O6650/moto-x3m` is two path segments deep, `/` is zero. A
relative asset reference like `href="css/style.css"` resolves differently
at each depth — it would have 404'd for every `/play/` page. Every asset
reference in `index.html`, `game.html`, `js/config.js` (the local game's
`url`/`thumb`), and `js/pwa.js`'s service-worker registration now uses a
root-relative path (`/css/style.css`) instead, so the exact same markup
works identically no matter how deep the URL is. `games/kicau-mania/`'s
own internal references are untouched — it's always loaded via iframe at
its own path, unaffected by the parent page's URL depth.

## The Gimboot rebrand

- **Wordmark & tagline** — "GIMBOOT" in Press Start 2P (a genuine pixel
  game font), "No Install, Just Play, Have Fun" underneath in Space Mono.
  Both replace fonts (Space Grotesk, Inter, Monoton) that, on inspection,
  **were never actually loading** — there was no Google Fonts `<link>` in
  either HTML file, so the whole site had been silently rendering in
  system-default fonts. Fixed as part of this change; verified by
  rendering the page in an actual headless browser before and after.
- **Icon** — a pixel-art joystick (cyan-to-magenta gradient, gold button),
  hand-built as a 24×24 SVG grid and rendered to a PNG during development
  to check it before shipping. Used as `favicon.svg`, plus generated
  `icon-192.png` / `icon-512.png` (including a `maskable` variant) so
  "Add to Home Screen" has a real icon on platforms that don't render SVG
  manifest icons.
- **Footer** — credits both GameMonetize and GamePix, matches the tagline.

## Deployment model: Worker with static assets (not Pages)

```bash
npx wrangler deploy    # deploy
npx wrangler dev        # local dev — runs src/index.js AND serves assets
```

`wrangler.toml` → `main = "./src/index.js"`, `[assets] directory = "."`,
`run_worker_first = ["/api/*", "/play/*", "/sitemap.xml"]` — every other
path is served directly as a static file without invoking the Worker.

`functions/api/games.js` is kept logically in sync for `/api/games` but,
as before, doesn't appear to be used by this deployment model (the
`functions/` convention is Pages-specific) — and does **not** include the
new `/play/` or sitemap logic, which wasn't worth duplicating into a file
that likely never runs.

## Project structure

```
gimboot/
├── index.html                Catalog page
├── game.html                  Legacy query-param player (still supported)
├── manifest.json               PWA manifest — name "Gimboot", pixel icons
├── sw.js                        Service worker — offline app shell + stale-while-revalidate
├── favicon.svg                 Pixel-art joystick icon
├── icon-192.png / icon-512.png  Raster icons for home-screen install
├── ads.txt                     GameMonetize verification
├── _headers                    Security headers + CSP
├── wrangler.toml                 Worker + static-assets config, routes /play/ + /api/ to the Worker
├── README.md
├── css/
│   └── style.css               Design tokens (now Plus Jakarta Sans / Press Start 2P / Space Mono) + components
├── js/
│   ├── config.js                 Tunable constants, LOCAL_GAMES (absolute paths), embed allowlist
│   ├── utils.js                   escapeHtml, debounce, slugify, buildPlayUrl (/play/ URLs), fetchGameCatalog
│   ├── tailwind-config.js         Tailwind theme extension, matches the new font tokens
│   ├── catalog.js                 Fetch, render grid, filter, search
│   ├── player.js                   Resolves game data from /play/'s injected id OR legacy query params
│   └── pwa.js                      Service worker registration (now root-relative) + cross-game high score
├── games/
│   └── kicau-mania/               First-party game — all in-game text now in English
├── src/
│   └── index.js                  Worker: /api/games, /play/{id}/{slug} (HTMLRewriter SEO injection), /sitemap.xml
└── functions/
    └── api/
        └── games.js              Kept in sync for /api/games only — see note above
```

## Turning on GameMonetize monetization: ads.txt

Unchanged from before — paste your real snippet from the GameMonetize
dashboard into `ads.txt`, replacing the example line, then redeploy.
GameMonetize checks `https://<your-domain>/ads.txt` at the root.

## Customization

- **SEO title/description template** — `handlePlayRoute()` in
  `src/index.js` (the `seoTitle` / `seoDescription` strings).
- **GameMonetize catalog size** — `js/config.js` → `DEFAULT_GAME_COUNT`.
- **GamePix page size / sid** — `GAMEPIX_PAGINATION` / `GAMEPIX_SID` at
  the top of `src/index.js`. **Don't change or remove `GAMEPIX_SID`.**
- **Adding another first-party game** — drop it under `games/<name>/`,
  add an entry to **both** `LOCAL_GAMES` in `js/config.js` (client) and
  `src/index.js` (server — needed so its `/play/` page gets real meta
  tags too; the two are intentionally duplicated, not imported from one
  file, since the Worker and the browser ES modules don't share a build
  step). Use an absolute `/games/<name>/...` path for `url`/`thumb`.
- **Colors** — CSS custom properties at the top of `css/style.css`.
  Typography — the three `--font-*` tokens just below them.

## Security notes

Unchanged from before: `isAllowedEmbedUrl()` in `js/utils.js` allows only
(a) absolute `https://` URLs on the GameMonetize/GamePix allowlist, or (b)
a same-origin path under `/games/` — every feed string is escaped before
touching `innerHTML`, and the `/play/` route's injected `<script>` value
is both `JSON.stringify`-escaped and has `<` neutralized so a pathological
feed value can't break out of the tag.

## Possible next steps

- Ping Google/Bing with the sitemap URL after your first deploy so
  indexing starts sooner rather than waiting for organic discovery.
- A provider filter (All / GameMonetize / GamePix / Original) — the
  `source` field used for the "Original" badge is already there to build
  on top of.
- More first-party games under `games/` — remember the two-place
  `LOCAL_GAMES` update above.
