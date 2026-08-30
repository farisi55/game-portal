# Gimboot — Multi-Source Game Portal

**No install, just play, have fun.** A static, no-build-tool HTML5 game portal in the vein of CrazyGames — installable as a PWA, with programmatically generated SEO landing pages for every game in the catalog.

The catalog is a live merge of three sources:

- **GameMonetize** — fetched server-side from their game feed
- **GamePix** — fetched server-side from their JSON feed
- **First-party** — games built and hosted directly in this repo: Ayo Kopdes, Kejar Koruptor, Mobil MBG, and Kicau Mania, all confirmed active. `src/index.js` (the Worker) currently only recognizes Kicau Mania in its own `LOCAL_GAMES`, so the other three don't yet get working `/share/` links or sitemap entries — syncing that is a pending cleanup item, see [Known issues & roadmap](#known-issues--roadmap)

> **Related docs:** this README covers setup and architecture for someone working in the repo. Product scope and open decisions live in [`prd.md`](./prd.md), the full technical reference is [`knowledge.md`](./knowledge.md), and current task status/backlog is [`changelog.md`](./changelog.md). All three were reconciled against this codebase on 2026-08-28.

## Status

Live in production. Foundation hardening — automated tests, `/api/health`, a clean-code pass on unused files — is in progress. See `changelog.md` for the task list and `prd.md` §10 for the open technical decisions referenced throughout this file.

## Features

- **Aggregated catalog** — hundreds of games from GameMonetize + GamePix, merged with first-party titles server-side and cached at the edge (30 min)
- **Programmatic SEO** — every game gets a real, crawlable `/play/{id}/{slug}` URL with a server-injected title, meta description, Open Graph/Twitter tags, and canonical link — no page is hand-written
- **Dynamic sitemap** — `/sitemap.xml` lists every game's `/play/` URL, generated live from the same merged catalog
- **PWA** — installable to the home screen via standard manifest/service-worker installability, with an offline app shell
- **Viral sharing** — confetti + Web Share API when a player beats their high score, with a clipboard-copy fallback, plus an OG-tagged `/share/{id}` page for the link itself
- **Zero backend state** — no database, no accounts; scores and preferences live in `localStorage` on the player's device

## How it's wired together

```
Browser
  ├─ GET /                         → index.html   (catalog: grid, search, category filter)
  ├─ GET /play/{id}/{slug}         → src/index.js  (SEO landing page, see below)
  ├─ GET /game?...                 → src/index.js  (clean query-param player + per-game meta)
  ├─ GET /game.html?...            → 301 → /game?...  (legacy extension stripped, query kept)
  ├─ GET /share/{id}               → src/index.js  (OG-tagged share page for a specific score)
  ├─ GET /api/games, /api/search   → src/index.js  (Cloudflare Worker)
  ├─ GET /sitemap.xml              → src/index.js  (every /play/ URL, for crawlers)
  │                                       │
  │                                       ├─ fetch → gamemonetize.com/feed.php  (server-side, parsed from RSS/XML)
  │                                       ├─ fetch → feeds.gamepix.com/v2/json  (server-side, already JSON)
  │                                       ├─ normalize both into one common shape, merge with LOCAL_GAMES
  │                                       └─ cache the merged result at the edge (Cache API, 30 min)
  │
  ├─ <iframe src="https://html5.gamemonetize.co/...">   (a GameMonetize game)
  ├─ <iframe src="https://play.gamepix.com/.../embed">   (a GamePix game)
  └─ <iframe src="/games/kicau-mania/index.html">         (a game hosted directly)
```

Every response — static or dynamic — passes through the Worker first (`run_worker_first = ["/*"]` in `wrangler.toml`), so one nonce-based Content-Security-Policy can be applied consistently to everything, rather than relying on the static `_headers` file (kept only as a fallback for the rare case the Worker doesn't run).

## Programmatic SEO: `/play/{id}/{slug}`

Every game gets its own real, crawlable URL — e.g. `gimboot.com/play/gp-O6650/moto-x3m` — without hand-writing a single page.

`src/index.js` fetches the existing `game.html` asset as-is, then transforms it in place with Cloudflare's native **HTMLRewriter** (a streaming HTML parser, not string splicing) before the response reaches a browser or crawler: `<title>`, `<meta name="description">`, Open Graph/Twitter Card tags, and a `<link rel="canonical">` are all set per-game, plus a small set of escaped `meta` tags carrying the resolved game data so `js/player.js` can load the right game without another lookup.

Only the `{id}` segment is ever read — `{slug}` exists purely so the URL reads well for search engines and people sharing links. `js/utils.js`'s `buildPlayUrl()`/`slugify()` generate these URLs client-side; `src/index.js` keeps an intentionally-duplicated `slugify()` that produces byte-identical output, so a game's canonical URL is consistent everywhere it's linked from.

`/sitemap.xml` lists every current game's `/play/` URL plus the homepage, generated live from the same merged catalog — worth submitting to Google Search Console / Bing Webmaster Tools so pages get discovered without waiting on the client-rendered grid to be crawled.

One thing to know if you touch routing: because `/play/{id}/{slug}` sits two path segments deep and `/` sits at zero, a relative asset path like `href="css/style.css"` resolves differently at each depth. Every asset reference in `index.html`, `game.html`, `js/config.js`, and `js/pwa.js`'s service-worker registration uses a root-relative path (`/css/style.css`) instead, so the same markup works identically regardless of URL depth.

## Design & branding

The current identity: "GIMBOOT" wordmark in Press Start 2P, "No Install, Just Play, Have Fun" underneath in Space Mono, body text in Plus Jakarta Sans. A pixel-art joystick icon (cyan-to-magenta gradient, gold button) was designed as part of this rebrand to serve as the favicon and PWA icon set (`icon-192.png` / `icon-512.png`, including a maskable variant). `favicon.svg` is the confirmed official favicon file, though its current content doesn't yet match that description and it isn't wired into `index.html`/`game.html`/`manifest.json` — see [Known issues](#known-issues--roadmap). The footer credits both GameMonetize and GamePix.

## Getting started

```bash
npm install -g wrangler          # if you don't already have it

npx wrangler dev                 # local dev — runs src/index.js AND serves static assets
npx wrangler deploy              # deploy to production
```

There's no build step and no `package.json` yet (tracked in `changelog.md` Task #004) — the frontend is plain ES modules and Tailwind loads from a CDN, so `wrangler dev` is the only tool needed to run the whole thing locally.

**Rolling back a bad deploy:**

```bash
wrangler deployments list        # find the version to roll back to
wrangler rollback <version-id>   # or omit the id to roll back to the previous version
```

## Deployment model: Worker with static assets, not Pages

This project deploys as a single **Cloudflare Worker with static assets** — not Cloudflare Pages. `wrangler.toml`:

```toml
main = "./src/index.js"
[assets]
directory = "."
run_worker_first = ["/*"]
```

`npx wrangler deploy` is the correct command; `wrangler pages deploy` does not apply to this configuration.

`functions/api/games.js`, `functions/api/search.js`, and `functions/share/[id].js` follow the Cloudflare **Pages** Functions convention, which this deployment model doesn't use — they are not invoked in production. They've been kept as a manually-synced reference copy of part of `src/index.js`'s logic, but are now confirmed for removal; `changelog.md` Task #002 tracks the deletion.

## Project structure

```
gimboot/
├── index.html                   Catalog landing page — grid, search, category filter
├── game.html                    Legacy query-param player; requests to it 301 to /game
├── manifest.json                PWA manifest — name "Gimboot", pixel icons
├── sw.js                        Service worker — offline app shell + stale-while-revalidate
├── favicon.svg                   Official favicon — content/wiring still needs verification, see Known issues
├── .avicon.svg                   Unreferenced; candidate for removal now that favicon.svg is confirmed, see Known issues
├── icon-192.png / icon-512.png  Raster icons for home-screen install (in active use)
├── screenshot-desktop.png       PWA install-UI screenshots — currently identical to each other
├── screenshot-mobile.png        (see Known issues)
├── ads.txt                      GameMonetize / GamePix ad-network verification
├── robots.txt                   Points crawlers at /sitemap.xml
├── _headers                     Fallback security headers (the Worker applies the real CSP per-response)
├── .gitignore                   Currently only excludes AI-tool folders — no secret patterns yet
├── .assetsignore                Excludes src/, functions/, and repo metadata from static-asset serving
├── wrangler.toml                Worker + static-assets config
├── css/
│   └── style.css                Design tokens (Plus Jakarta Sans / Press Start 2P / Space Mono) + components
├── js/
│   ├── config.js                 Tunable constants, LOCAL_GAMES (client), embed allowlist
│   ├── utils.js                   escapeHtml, debounce, slugify, buildPlayUrl, fetchGameCatalog, isAllowedEmbedUrl
│   ├── tailwind-config.js         Tailwind theme extension
│   ├── catalog.js                 Fetch, render grid, filter, search
│   ├── player.js                  Resolves game data, favorites, recently-played, fullscreen, native share
│   ├── pwa.js                     Service worker registration + cross-game high score via postMessage
│   └── state.js                   localStorage wrapper — favorites & recently-played only (not scores)
├── games/
│   ├── kicau-mania/               First-party game, active
│   ├── ayo-kopdes/                First-party game, active — pending sync in src/index.js, see Known issues
│   ├── kejar-koruptor/            First-party game, active — pending sync in src/index.js, see Known issues
│   ├── mobil-mbg/                 First-party game, active — pending sync in src/index.js, see Known issues
│   └── shared/                    ui-share.js/css — confetti + share-prompt module
├── src/
│   └── index.js                  Worker: /api/games, /api/search, /share/:id, /play/{id}/{slug}, /game, /sitemap.xml
└── functions/
    ├── api/games.js, search.js    Not invoked under this deploy model — see above
    └── share/[id].js               Not invoked under this deploy model — see above
```

Per-game high scores live inside each `games/{slug}/game.js`, not in `js/state.js`. A separate, cross-game high score also exists in `js/pwa.js`, updated via `window.postMessage` from both first-party games and embedded GamePix games (GamePix sends this natively; GameMonetize embeds have no equivalent hook).

## Configuration

No secrets are currently required. When one is needed (e.g. a GameMonetize site ID), add it as a Cloudflare environment variable — never commit it to source.

- **Turning on GameMonetize monetization** — paste your real snippet from the GameMonetize dashboard into `ads.txt`, replacing the placeholder line, then redeploy. GameMonetize checks `https://<your-domain>/ads.txt` at the root.
- **SEO title/description template** — `handlePlayRoute()` in `src/index.js` (`seoTitle` / `seoDescription`).
- **GameMonetize catalog size** — `js/config.js` → `DEFAULT_GAME_COUNT`.
- **GamePix page size / site ID** — `GAMEPIX_PAGINATION` / `GAMEPIX_DEFAULT_SID` at the top of `src/index.js`. Worth double-checking against your GamePix dashboard — `ads.txt` currently has two different GamePix property IDs in its comments.
- **Adding another first-party game** — drop it under `games/<name>/`, then add an entry to **both** `LOCAL_GAMES` in `js/config.js` (client) and `LOCAL_GAMES` in `src/index.js` (server — needed for its `/play/`, `/share/`, and sitemap entries to work). The two lists are intentionally duplicated rather than shared, since the Worker and the browser's ES modules don't go through a build step together — keep them in sync by hand.
- **Colors & typography** — CSS custom properties at the top of `css/style.css`.

## Security notes

- `isAllowedEmbedUrl()` in `js/utils.js` only allows (a) absolute `https://` URLs on the GameMonetize/GamePix allowlist, or (b) a same-origin path under `/games/`.
- Every value injected into `/share/:id`, `/play/:id/:slug`, and `/game`'s HTML/meta output is escaped (`escapeHtmlAttr`/`escapeJsonLd` in `src/index.js`) before it reaches the response.
- `/api/games` and `/api/search` return `Access-Control-Allow-Origin: *`. This is an intentional, accepted policy for these two endpoints since they're public, read-only, and carry no sensitive or authenticated data — the project's CORS policy was revised to allow this rather than narrowing the header. Wildcard CORS should still be avoided on any future endpoint that requires authentication or writes state.
- **Known gap:** `.gitignore` doesn't yet exclude `.env`, `*.pem`, `*.key`, `*.p12`, or `secrets/` — add these before any real secret is introduced (`changelog.md` Task #001).

## Testing

No automated tests exist yet, and there's no `package.json`, linter, or test runner in the repo (`changelog.md` Task #004). Manual smoke-testing is the only current QA step for the Canvas games. See `changelog.md` for the planned first test targets — `js/state.js`, `js/utils.js`, and `src/index.js`'s route handlers.

## Known issues & roadmap

- **`src/index.js` `LOCAL_GAMES` needs syncing** — all four first-party games are confirmed active, but `src/index.js` (server) currently only recognizes Kicau Mania. Add Ayo Kopdes, Kejar Koruptor, and Mobil MBG so their `/share/` links and sitemap entries work correctly too (`changelog.md` Task #002).
- **Delete `functions/api/*`, `functions/share/[id].js`** — confirmed not invoked under the current deploy model; decided to remove them for clean code (`changelog.md` Task #002).
- **Verify and wire up `favicon.svg`** — confirmed as the official favicon, but its current content doesn't match the intended pixel-art joystick design and it isn't referenced from `index.html`/`game.html`/`manifest.json` yet. Once wired in, `.avicon.svg` can be removed (`changelog.md` Task #002).
- **`manifest.json` screenshots** — `screenshot-desktop.png` and `screenshot-mobile.png` are currently identical images, not distinct desktop/mobile previews. Still an open decision.
- **Ad-script for GameMonetize/GamePix monetization** — a separate client-side ad unit (with load-timeout fallback so it never blocks game rendering) hasn't been built yet; this is distinct from the catalog-feed integration, which already has its own resilience (`changelog.md` Task #011).
- Ping Google/Bing with the sitemap URL after a deploy so indexing starts sooner.
- A provider filter (All / GameMonetize / GamePix / Original) — the `source` field used for the "Original" badge already exists to build on.
