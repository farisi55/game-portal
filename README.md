# Gimboot — Multi-Source Game Portal

**No install, just play, have fun.** A static-HTML5, no-framework game portal in the vein of CrazyGames — installable as a PWA, with programmatically generated SEO landing pages for every game in the catalog, plus a self-hosted retro **Emulator Browser**.

The game catalog is a live server-side merge of three sources:

- **GameMonetize** — fetched from their game feed (parsed server-side)
- **GamePix** — fetched from their JSON feed
- **First-party** — five HTML5 Canvas games hosted directly in this repo: Ayo ke Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania, and Solitaire — all confirmed active and registered in `LOCAL_GAMES` in **both** `js/config.js` (client) and `src/index.js` (Worker), so `/play/`, `/share/`, and sitemap entries work for all five

> **Related docs:** this README is the getting-started/architecture guide for contributors. Product scope lives in [`prd.md`](./prd.md), the full technical reference in [`knowledge.md`](./knowledge.md), and task history in [`changelog.md`](./changelog.md) (27 tasks, all complete). Operational procedures are in [`docs/deployment-runbook.md`](./docs/deployment-runbook.md); the public API is specced in [`docs/api.yaml`](./docs/api.yaml) (OpenAPI 3.1).

## Status

Live in production at **https://gimboot.com** (Cloudflare Worker `games`, custom domain). All 27 tracked tasks are complete — including foundation hardening (tests, linting, security headers, rate limiting, health endpoint, load testing), SEO fixes from Google Search Console feedback, and the Emulator Browser feature. Remaining ideas (e.g. a provider filter on the catalog grid) are listed under [Roadmap](#roadmap).

## Features

- **Aggregated catalog** — hundreds of games from GameMonetize + GamePix, merged server-side with the five first-party titles and cached at the edge (~30 min); `/api/games` supports `page`/`limit` pagination, `/api/search` does hybrid server-side search
- **Programmatic SEO** — every game gets a real, crawlable `/play/{id}/{slug}` URL with a server-injected title, meta description, Open Graph/Twitter tags, and canonical link (stream-transformed via Cloudflare's HTMLRewriter — no hand-written pages)
- **Canonical URL hygiene** — legacy `/game.html?id=X` and `/game?id=X` 301 straight to `/play/{id}/{slug}` in a single hop; HTTP→HTTPS and `/index.html` normalization are also single-hop; `/sitemap.xml` emits only canonical HTTPS URLs (fixed per Google Search Console)
- **Dynamic sitemap** — `/sitemap.xml` lists every game's `/play/` URL, generated live from the merged catalog and pointed to by `robots.txt`
- **Emulator Browser** — self-hosted [EmulatorJS](https://github.com/EmulatorJS/emulatorjs) v4.2.3 at `/emulator`, supporting all 35 systems (NES through PS1/PSP), with ROM & BIOS 100% client-side (see below)
- **PWA** — installable to the home screen (manifest + service worker), with an offline app shell and stale-while-revalidate caching
- **Viral sharing** — confetti + Web Share API when a player beats their high score, clipboard-copy fallback, and an OG-tagged `/share/{id}` page for the link itself
- **Zero backend state** — no database, no accounts, no PII; scores and preferences live in `localStorage` on the player's device; Worker-side rate limiting (100 req/min/IP) on the API routes

## How it's wired together

```
Browser
  ├─ GET /                          → index.html   (catalog: grid, search, category tabs)
  ├─ GET /emulator                  → emulator/index.html  (EmulatorJS shell, 35 systems)
  ├─ GET /play/{id}/{slug}          → src/index.js  (SEO landing page, see below)
  ├─ GET /game.html?id=X | /game?id=X
  │                                 → src/index.js  (single 301 → /play/{id}/{slug}; /game
  │                                    without id still serves the query-param game shell)
  ├─ GET /share/{id}                → src/index.js  (OG-tagged share page)
  ├─ GET /api/games, /api/search, /api/health
  │                                 → src/index.js  (Cloudflare Worker, rate-limited)
  ├─ GET /sitemap.xml               → src/index.js  (every /play/ URL, for crawlers)
  │                                       │
  │                                       ├─ fetch → gamemonetize.com/feed.php  (parsed from RSS/XML)
  │                                       ├─ fetch → feeds.gamepix.com/v2/json  (already JSON)
  │                                       ├─ normalize → merge with LOCAL_GAMES → edge cache (~30 min)
  │                                       └─ 5s fetch timeout; feed failures degrade gracefully
  │
  ├─ <iframe src="https://html5.gamemonetize.co/...">   (GameMonetize game)
  ├─ <iframe src="https://play.gamepix.com/.../embed">  (GamePix game)
  ├─ <iframe src="/games/kicau-mania/index.html">       (first-party game)
  └─ <iframe src="/emulator/runtime.html">              (emulator runtime, postMessage handshake)
```

Every response — static or dynamic — passes through the Worker first (`run_worker_first = ["/*"]` in `wrangler.toml`), so one nonce-based Content-Security-Policy can be applied consistently to everything. The one scoped exception: `/emulator/*` paths get a path-specific CSP relaxation plus COOP/COEP headers (needed for `SharedArrayBuffer`), because EmulatorJS requires `blob:` and `unsafe-eval` — catalog/play/game pages keep the strict policy. The static `_headers` file is kept only as a fallback for the rare case the Worker doesn't run.

## Programmatic SEO: `/play/{id}/{slug}`

Every game gets its own real, crawlable URL — e.g. `gimboot.com/play/gp-O6650/moto-x3m` — without hand-writing a single page.

`src/index.js` fetches the existing `game.html` asset as-is, then transforms it in place with Cloudflare's native **HTMLRewriter** (a streaming HTML parser, not string splicing) before the response reaches a browser or crawler: `<title>`, `<meta name="description">`, Open Graph/Twitter Card tags, and a `<link rel="canonical">` are all set per-game, plus a small set of escaped `meta` tags carrying the resolved game data so `js/player.js` can load the right game without another lookup.

Only the `{id}` segment is ever read — `{slug}` exists purely so the URL reads well for search engines and people sharing links. `js/utils.js`'s `buildPlayUrl()`/`slugify()` generate these URLs client-side; `src/index.js` keeps an intentionally-duplicated `slugify()` that produces byte-identical output, so a game's canonical URL is consistent everywhere it's linked from.

`/sitemap.xml` lists every current game's `/play/` URL plus the homepage, generated live from the same merged catalog — worth submitting to Google Search Console / Bing Webmaster Tools so pages get discovered without waiting on the client-rendered grid to be crawled.

One thing to know if you touch routing: because `/play/{id}/{slug}` sits two path segments deep and `/` sits at zero, a relative asset path like `href="css/style.css"` resolves differently at each depth. Every asset reference in `index.html`, `game.html`, `js/config.js`, and `js/pwa.js`'s service-worker registration uses a root-relative path (`/css/style.css`) instead, so the same markup works identically regardless of URL depth.

Canonicalization is enforced single-hop (a past Google Search Console finding — no redirect chains): HTTP→HTTPS, `/index.html`→`/`, and legacy `/game.html?id=X`/`/game?id=X`→`/play/{id}/{slug}` each produce exactly one 301, and `/sitemap.xml` emits only canonical HTTPS URLs.

## Emulator Browser: `/emulator`

A retro-console page built on **EmulatorJS v4.2.3**, self-hosted in `vendor/emulatorjs/` (~102 MB of cores — deliberately no external CDN dependency, consistent with the rest of the portal):

- **All 35 supported systems** (NES, SNES, GB/GBC, GBA, N64, DS, PS1, PSP, the Sega and Atari families, arcade, DOS, Amiga, C64, …) in a grouped dropdown. BIOS-requiring systems (PS1, Saturn, PC-FX, 3DO) and recommended-BIOS systems (Amiga) are labeled in the UI.
- **ROM & BIOS are 100% client-side** — picked via file input and handed to the emulator through `URL.createObjectURL`/`postMessage`; they never touch the server or any storage. Per-system ROM size caps: 128 MB by default, 999 MB for PS1, 2 GB for PSP — enforced in both `emulator/emulator-ui.js` and `emulator/runtime.html`.
- **Legal stance (hard rule):** the page links to no ROM sources — only legal homebrew references (itch.io etc.) — and EmulatorJS is used unmodified (GPL-3.0) to avoid copyleft obligations. See `knowledge.md` §9.
- PSP and DOS cores require threads: `/emulator*` responses carry COOP/COEP headers for cross-origin isolation (`SharedArrayBuffer`), and get the only path-scoped CSP relaxation in the app.
- The runtime is an isolated iframe (`/emulator/runtime.html`) talking to the shell over `postMessage`, following the same isolation pattern as embedded games.

## Design & branding

The current identity: "GIMBOOT" wordmark in Press Start 2P, "No Install, Just Play, Have Fun" underneath in Space Mono, body text in Plus Jakarta Sans. `favicon.svg` is the official favicon, wired into `index.html`/`game.html` via `<link rel="icon">`; the PWA icon set (`icon-192.png` / `icon-512.png`, including a maskable variant) is derived from the same pixel-art branding. The footer credits both GameMonetize and GamePix.

## Getting started

Requires Node ≥ 20 and npm ≥ 10.

```bash
npm install                      # dev tooling only (wrangler, vitest, eslint, playwright)

npm run dev*                     # local dev — npx wrangler dev runs the Worker + serves assets
npm test                         # unit tests (Vitest + @cloudflare/vitest-plugin)
npm run test:e2e                 # Playwright E2E (run `npx playwright install` once)
npm run lint                     # ESLint, zero warnings allowed
npm run build                    # quality gate: lint + unit tests + npm audit --audit-level=high
npx wrangler deploy              # deploy to production
```

\* there's no `dev` script in `package.json` — use `npx wrangler dev` directly (the frontend is plain ES modules and Tailwind loads from a CDN, so there is **no bundler and no production build step**; `npm run build` is a gate, not a compile step).

**Rolling back a bad deploy:**

```bash
npx wrangler deployments list    # find the version to roll back to
npx wrangler rollback <version-id>  # or omit the id to roll back to the previous version
```

Staging/preview (`npx wrangler preview`), smoke-test checklists, and the canary procedure for high-traffic periods are documented in [`docs/deployment-runbook.md`](./docs/deployment-runbook.md).

## Deployment model: Worker with static assets, not Pages

This project deploys as a single **Cloudflare Worker with static assets** — not Cloudflare Pages. `wrangler.toml`:

```toml
main = "./src/index.js"
[assets]
directory = "."
run_worker_first = ["/*"]
```

`npx wrangler deploy` is the correct command; `wrangler pages deploy` does not apply to this configuration. CI/CD is **Cloudflare Workers Builds** (auto-deploy on push/merge to production; preview builds exist but are not enabled for branch pushes — the manual preview path is in the runbook). An old `functions/` directory (Pages-Functions-style copies of the Worker logic) was deleted in `changelog.md` Task #002 — it was never invoked under this deploy model; `src/index.js` is the single source of backend truth.

## Project structure

```
gimboot/
├── index.html                   Catalog landing page — grid, search, category tabs
├── game.html                    Query-param player shell (legacy; /game?id= & /game.html?id= 301 → /play)
├── manifest.json                PWA manifest — "Gimboot", pixel icons, wide screenshot
├── sw.js                        Service worker — offline app shell + stale-while-revalidate
├── favicon.svg                  Official favicon — wired into index.html/game.html
├── icon-192.png / icon-512.png  Raster icons for home-screen install (incl. maskable)
├── ads.txt                      GameMonetize / GamePix ad-network verification
├── robots.txt                   Points crawlers at /sitemap.xml
├── _headers                     Fallback security headers (the Worker applies the real CSP per-response)
├── wrangler.toml                Worker + static-assets + [previews] config
├── package.json                 Dev tooling only (test/lint/build scripts) — no bundler
├── eslint.config.js / .prettierrc / .husky/   Lint & pre-commit hook (Task #001, #005)
├── vitest.config.js / vitest.e2e.config.js    Test runner configs (unit / Playwright E2E)
├── css/
│   └── style.css                Design tokens (Plus Jakarta Sans / Press Start 2P / Space Mono)
├── js/
│   ├── config.js                 Tunable constants, LOCAL_GAMES (client), embed allowlist
│   ├── utils.js                   escapeHtml, debounce, slugify, buildPlayUrl, fetchGameCatalog, isAllowedEmbedUrl
│   ├── tailwind-config.js         Tailwind theme extension
│   ├── catalog.js                 Fetch, render grid, filter, search, category tabs (incl. Emulator tab)
│   ├── player.js                  Resolves game data, favorites, recently-played, fullscreen, native share
│   ├── pwa.js                     Service worker registration + cross-game high score via postMessage
│   ├── ad-loader.js               Ad-script loader with 3s timeout fallback (never blocks games)
│   └── state.js                   localStorage wrapper — favorites & recently-played (not scores)
├── games/
│   ├── kicau-mania/               First-party game
│   ├── ayo-kopdes/                First-party game
│   ├── kejar-koruptor/            First-party game
│   ├── mobil-mbg/                 First-party game
│   ├── solitaire/                 First-party game (Klondike; imported from farisi55/solitaire-puter)
│   └── shared/                    ui-share.js/css — confetti + share-prompt module
├── emulator/
│   ├── index.html                 Shell — 35-system dropdown (7 optgroups), ROM/BIOS pickers, how-to + legal disclaimer
│   ├── runtime.html               Iframed EmulatorJS runtime — core config, size caps, handshake
│   ├── emulator-ui.js             UI logic — validation, postMessage protocol, formatBytes
│   └── style.css
├── vendor/emulatorjs/             Self-hosted EmulatorJS v4.2.3 + cores (~102 MB)
├── src/
│   ├── index.js                   Worker — all routes, security headers, rate limiting, redirects
│   └── index.test.js              Worker unit tests (routes, escaping, redirects, handlers)
├── e2e/                           Playwright flows (catalog→play, emulator upload flow)
├── loadtest/                      k6 suites (smoke, capacity, cache-cold herd) + RESULTS.md
└── docs/                          api.yaml (OpenAPI 3.1), deployment-runbook.md, manual-qa-checklist.md
```

Per-game high scores live inside each `games/{slug}/game.js`, not in `js/state.js`. A separate, cross-game high score also exists in `js/pwa.js`, updated via `window.postMessage` from both first-party games and embedded GamePix games (GamePix sends this natively; GameMonetize embeds have no equivalent hook).

## Configuration

No secrets are currently required; `.gitignore` already excludes `.env`, `*.pem`, `*.key`, `*.p12`, and `secrets/` — add any future secret (e.g. a GameMonetize site ID) as a Cloudflare environment variable, never to source.

- **Turning on GameMonetize monetization** — paste your real snippet from the GameMonetize dashboard into `ads.txt`, replacing the placeholder line, then redeploy. GameMonetize checks `https://<your-domain>/ads.txt` at the root.
- **SEO title/description template** — `handlePlayRoute()` in `src/index.js` (`seoTitle` / `seoDescription`).
- **GameMonetize catalog size** — `js/config.js` → `DEFAULT_GAME_COUNT` (server-side clamp: `MAX_GAME_COUNT` = 200).
- **GamePix page size / site ID** — `GAMEPIX_PAGINATION` / `GAMEPIX_DEFAULT_SID` at the top of `src/index.js`. Worth double-checking against your GamePix dashboard — `ads.txt` currently has two different GamePix property IDs in its comments.
- **Ad script loading** — `js/ad-loader.js` wraps external ad scripts with a 3s timeout so they can never block game rendering; swap `DEFAULT_TIMEOUT_MS` there if needed.
- **Adding another first-party game** — drop it under `games/<name>/`, then add an entry to **both** `LOCAL_GAMES` in `js/config.js` (client) and `LOCAL_GAMES` in `src/index.js` (server — needed for its `/play/`, `/share/`, and sitemap entries to work). The two lists are intentionally duplicated rather than shared, since the Worker and the browser's ES modules don't go through a build step together — keep them in sync by hand.
- **Emulator ROM size caps** — per-system map in `emulator/emulator-ui.js` + `emulator/runtime.html` (default 128 MB; PS1 999 MB; PSP 2 GB).
- **Colors & typography** — CSS custom properties at the top of `css/style.css`.

## Security notes

- **Embed allowlist** — `isAllowedEmbedUrl()` in `js/utils.js` only allows (a) absolute `https://` URLs on the GameMonetize/GamePix allowlist, or (b) a same-origin path under `/games/`.
- **Output escaping** — every value injected into `/share/:id`, `/play/:id/:slug`, and `/game`'s HTML/meta output is escaped (`escapeHtmlAttr`/`escapeJsonLd` in `src/index.js`) before it reaches the response — covered by unit tests (`changelog.md` Task #010).
- **CSP** — nonce + `strict-dynamic`, no `unsafe-inline`/`unsafe-eval` on catalog/play pages. The only relaxation is path-scoped to `/emulator/*` (`blob:`, `unsafe-eval`, CDN version check) plus COOP/COEP for `SharedArrayBuffer` — required by EmulatorJS.
- **Rate limiting** — in-Worker, 100 requests/minute/IP on the API routes (`src/index.js`, `RATE_LIMIT_MAX`).
- **CORS** — `/api/games` and `/api/search` return `Access-Control-Allow-Origin: *`. This is an intentional, accepted policy for these two endpoints since they're public, read-only, and carry no sensitive or authenticated data — the project's CORS policy was revised to allow this rather than narrowing the header. Wildcard CORS should still be avoided on any future endpoint that requires authentication or writes state.
- **Security scanning** — periodic external scans (pentest-tools.com) with a documented per-item disposition policy; latest scan: 0 critical/high/medium, 2 accepted low (platform fingerprint). See `knowledge.md` §8.
- **Dependencies** — all npm dependencies are dev-only; production ships zero npm code. `npm audit --audit-level=high` is part of the build gate.

## Testing

- **Unit** — Vitest (`npm test`): Worker routes, redirects, and escaping in `src/index.test.js`, plus `js/` suites for utils, state, catalog, and the ad loader (~170 tests).
- **E2E** — Playwright (`npm run test:e2e`): catalog→play flow (`e2e/full-flow.test.js`) and the emulator upload flow (`e2e/emulator-flow.test.js`).
- **Load** — k6 suites under `loadtest/` (smoke, 1,000-VU capacity, cache-cold herd); latest results in `loadtest/RESULTS.md`.
- **Gates** — `npm run build` = lint + unit tests + high/critical CVE scan; a Husky pre-commit hook enforces checks locally. Manual QA for the Canvas games uses `docs/manual-qa-checklist.md`.

## Roadmap

All 27 tracked tasks are complete (see `changelog.md`); the items previously listed as known issues have been resolved. Open ideas:

- Ping Google/Bing with the sitemap URL after a deploy so indexing starts sooner.
- A provider filter (All / GameMonetize / GamePix / Original) — the `source` field used for the "Original" badge already exists to build on.
- Per-system SEO landing pages for the emulator (currently a single `/emulator` page by developer decision).
- Formal canary/staged rollout once concurrent traffic approaches ~7,000–8,000 users; procedure is already documented in `docs/deployment-runbook.md` §4–§5.
