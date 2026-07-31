# Arcade — Multi-Source Game Portal (MVP)

A static, no-build-tool game portal in the vein of CrazyGames. Vanilla
HTML5 + Tailwind (CDN) + modern vanilla JS (ES modules) on the frontend.
Games come from three places: GameMonetize's catalog, GamePix's catalog,
and games we host ourselves (currently: Kicau Mania). Installable as a
PWA with offline support for the shell.

## How it's wired together

```
Browser
  ├─ GET /                → index.html   (catalog: grid, search, category filter)
  ├─ GET /game.html?...   → game.html    (player: iframe, fullscreen, share, related)
  ├─ GET /api/games       → src/index.js (Cloudflare Worker — see below)
  │                             │
  │                             ├─ fetch → gamemonetize.com/feed.php  (server-side, parsed from RSS/XML)
  │                             ├─ fetch → feeds.gamepix.com/v2/json  (server-side, already JSON)
  │                             ├─ normalize both into one common shape, merge
  │                             └─ cache the merged result at the edge (Cache API, 30 min)
  │
  ├─ <iframe src="https://html5.gamemonetize.co/...">   (a GameMonetize game)
  ├─ <iframe src="https://play.gamepix.com/.../embed">   (a GamePix game)
  └─ <iframe src="games/kicau-mania/index.html">         (a game we host ourselves)
```

`js/config.js` → `LOCAL_GAMES` is prepended to whatever `/api/games`
returns (in both `catalog.js` and `player.js`, via the shared
`fetchGameCatalog()` helper in `js/utils.js`) — so first-party games
never touch the network fetch at all, and can't drift out of sync between
the catalog grid and the "related games" list on the player page.

**Why merge server-side instead of two client-side fetches?**

1. GameMonetize's feed replies with **RSS/XML even when called with
   `&format=json`** — confirmed by fetching it directly. `src/index.js`
   parses that once, server-side, and always hands the frontend clean,
   flat JSON regardless of what either upstream actually returns.
2. GamePix's feed is genuine JSON (the [JSON Feed](https://jsonfeed.org)
   spec) but has a completely different field layout (`banner_image`,
   `namespace`, `orientation`, …). Normalizing both to the same shape
   server-side means the frontend never has two code paths.
3. Server-to-server fetches are never subject to browser CORS.
4. If GameMonetize or GamePix goes down independently, `Promise.allSettled`
   means the OTHER source's games still reach the player — the catalog
   degrades gracefully instead of going blank.

IDs from each source are prefixed (`gm-…`, `gp-…`) so they can never
collide with each other or with `local-…` first-party IDs.

## Deployment model: Worker with static assets (not Pages)

This repo deploys as a **Cloudflare Worker with static assets**, not
Cloudflare Pages:

```bash
npx wrangler deploy          # deploy
npx wrangler dev              # local dev — runs src/index.js AND serves assets
```

`wrangler.toml` → `main = "./src/index.js"`, and the `[assets]` block
points at `.` (the whole project root) with `run_worker_first = ["/api/*"]`,
meaning every path EXCEPT `/api/*` is served directly as a static file
without invoking the Worker script at all, and `/api/*` always runs
`src/index.js` first.

`functions/api/games.js` is kept in the repo and kept logically in sync
with `src/index.js`, but as far as we can tell it is **not actually used**
by this deployment model — the `functions/` directory convention is
Pages-specific, and this project deploys as a Worker. Safe to delete if
you'd rather maintain one copy; kept for now in case you ever switch back
to a Pages deployment instead.

### Two fixes made to wrangler.toml while integrating this update

- Added `binding = "ASSETS"` — `src/index.js` calls `env.ASSETS.fetch(request)`
  for every non-API path, and without an explicit binding name that's
  `undefined`, which would have made every single page on the site fail.
- Removed a `header = "Content-Type: text/html; charset=utf-8"` line —
  this isn't a documented `[assets]` key in Cloudflare's config schema.
  Custom headers belong in `_headers` (see below), which this project
  already has and which IS correctly picked up for static-asset responses
  under the Worker-with-assets model (confirmed against current Cloudflare
  docs) — it just doesn't apply to `/api/games`'s own response, which sets
  its headers directly in code instead, which is the documented pattern
  for Worker-generated responses.

## Project structure

```
game-portal/
├── index.html                Catalog page
├── game.html                  Player page
├── manifest.json               PWA manifest
├── sw.js                        Service worker — offline app shell + runtime cache
├── ads.txt                     GameMonetize verification — paste your snippet in
├── _headers                    Security headers + CSP (applies to static asset responses)
├── wrangler.toml                 Worker + static-assets config — `npx wrangler deploy`
├── favicon.svg
├── README.md
├── css/
│   └── style.css               Design tokens + all component styles
├── js/
│   ├── config.js                 Tunable constants + LOCAL_GAMES + embed allowlist
│   ├── utils.js                   escapeHtml, debounce, URL validation, fetchGameCatalog
│   ├── tailwind-config.js         Tailwind theme extension (external, keeps CSP clean)
│   ├── catalog.js                 Fetch, render grid, filter, search
│   ├── player.js                   Parse params, validate embed host, iframe, related
│   └── pwa.js                      Service worker registration + cross-game high-score sync
├── games/
│   └── kicau-mania/               First-party game (own index.html/style.css/game.js)
├── src/
│   └── index.js                  Worker: fetch+normalize+merge both feeds, serve /api/games
└── functions/
    └── api/
        └── games.js              Same logic, kept in sync — see deployment note above
```

## Cross-game high score

`js/pwa.js` listens for `postMessage` from ANY embedded iframe and keeps a
single high score in `localStorage` (`arcade-high-score-v1`), shown on
both `index.html` and `game.html`:

- Our own games post `{ type: 'arcade-score', score }` — see
  `reportScoreToParent()` in `games/kicau-mania/game.js`. Any future
  first-party game should do the same.
- GamePix's embedded games post this natively as
  `{ type: 'update_score', score }` — no extra work needed on our side,
  `js/pwa.js` already listens for both shapes.
- GameMonetize's games don't post scores out of the iframe in the same
  way, so they don't feed this counter.

This is a portal-wide number, not a per-game one — that was already the
existing design before this change, so it's preserved as-is rather than
redesigned into per-game high scores.

## Turning on GameMonetize monetization: ads.txt

`ads.txt` is a template with instructions inside it. Ads won't serve
correctly until you paste your real snippet from your GameMonetize
dashboard (Site/Ad Zone settings) in, replacing the example line, then
redeploy. GameMonetize checks `https://<your-domain>/ads.txt` at the
root specifically.

GamePix's tracking is handled entirely through the `sid` parameter baked
into the feed URL in `src/index.js` — nothing else to configure there.

## Customization

- **GameMonetize catalog size** — `js/config.js` → `DEFAULT_GAME_COUNT`.
  `src/index.js` clamps requests at 200.
- **GamePix page size / sid** — `GAMEPIX_PAGINATION` / `GAMEPIX_SID` at the
  top of `src/index.js` (and `functions/api/games.js` if you keep it in
  sync). **Don't change or remove `GAMEPIX_SID`** — GamePix uses it to
  attribute stats to your account.
- **Adding another first-party game** — drop it under `games/<name>/`,
  add an entry to `LOCAL_GAMES` in `js/config.js` (id prefixed `local-`,
  `url` pointing at the game's relative path), and have its own game.js
  post `{ type: 'arcade-score', score }` to `window.parent` on game over
  if you want it to feed the shared high score.
- **Colors / type** — CSS custom properties at the top of `css/style.css`.
- **Cache duration** — `CACHE_TTL_SECONDS` in `src/index.js`.

## Security notes

- **Embed allowlist** — `game.html` takes `url` as a query parameter.
  `isAllowedEmbedUrl()` in `js/utils.js` allows two things and refuses
  everything else before it's ever assigned to the iframe's `src`: (a)
  absolute `https://` URLs whose hostname is on the GameMonetize/GamePix
  allowlist, or (b) a same-origin relative path under `games/` — which,
  by how relative URL resolution works, can never point at a different
  origin no matter how it's crafted, so it's safe to allow without a
  hostname check.
- **XSS from feed content** — every string from either feed goes through
  `escapeHtml()` before touching `innerHTML`. Both feeds are third-party
  content and treated as untrusted input.
- **CSP** — see `_headers`. `frame-src` includes `'self'` (for our own
  games) plus the exact GameMonetize and GamePix domains, nothing broader.

## Design system, briefly

Dark violet base (`#0e0b1a`) with three accents pulled from arcade-cabinet
vocabulary: cyan and magenta (dual-player color coding) plus gold (marquee
bulb color, used for primary actions and first-party-game badges). The
header's animated dot strip references marquee chase lighting; the game
player's frame is styled as a bolted cabinet bezel. `prefers-reduced-motion`
disables the chase animation and card transitions.

## A business note, since ad content isn't fully in your control

Both GameMonetize and GamePix are general-purpose ad/game networks — their
catalogs can include casual casino/gambling-style titles. If this portal
is going out under a halal-oriented brand, check each dashboard for
category/genre exclusion controls before launch.

## Possible next steps

- Pagination or infinite scroll for a bigger combined catalog.
- A provider filter (All / GameMonetize / GamePix / Our Games) alongside
  the existing category filter — the `source` field added for the badge
  is already there to build this on top of.
- More first-party games under `games/` as you build them.
