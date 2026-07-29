# Arcade — GameMonetize Game Portal (MVP)

A static, no-build-tool game portal in the vein of CrazyGames, powered
entirely by GameMonetize's game catalog. Vanilla HTML5 + Tailwind (CDN) +
modern vanilla JS (ES modules) on the frontend, one Cloudflare Pages
Function on the backend. Deploys to Cloudflare Pages as-is — no npm
install, no bundler, no build step.

## How it's wired together

```
Browser
  ├─ GET /                → index.html  (catalog: grid, search, category filter)
  ├─ GET /game.html?...   → game.html   (player: iframe, fullscreen, share, related)
  ├─ GET /api/games       → functions/api/games.js   (Cloudflare Pages Function)
  │                             │
  │                             ├─ fetch → gamemonetize.com/feed.php (server-side)
  │                             ├─ parse RSS/XML → flat JSON
  │                             └─ cache at the edge (Cache API, 30 min)
  │
  └─ <iframe src="https://html5.gamemonetize.co/...">   (the actual game)
```

**Why a Function instead of fetching the feed straight from the browser?**
Two reasons, both load-bearing:

1. GameMonetize's feed replies with **RSS/XML even when called with
   `&format=json`** — confirmed by fetching it directly while building this.
   The Function parses that XML once, server-side, and always hands the
   frontend clean, flat JSON. If GameMonetize's feed format ever changes,
   you fix it in one file, not two.
2. A server-to-server fetch inside the Function is never subject to browser
   CORS. Doing this in `catalog.js` directly would be, and would depend on
   GameMonetize's CORS headers being cooperative.

The Function also caches its JSON response at Cloudflare's edge for 30
minutes (`Cache-Control` + the Cache API), so repeat visits don't re-hit
GameMonetize or re-parse XML.

## Project structure

```
game-portal/
├── index.html              Catalog page
├── game.html                Player page
├── ads.txt                  GameMonetize verification — paste your snippet in
├── _headers                 Cloudflare Pages security headers + CSP
├── wrangler.toml             Optional, for CLI deploy/local dev only
├── favicon.svg
├── README.md
├── css/
│   └── style.css            Design tokens + all component styles
├── js/
│   ├── config.js             Single place for tunable constants
│   ├── utils.js               escapeHtml, debounce, URL build/validate, session cache
│   ├── tailwind-config.js     Tailwind theme extension (external, keeps CSP clean)
│   ├── catalog.js             Fetch, render grid, filter, search
│   └── player.js               Parse params, validate embed host, iframe, fullscreen, share, related
└── functions/
    └── api/
        └── games.js          Pages Function: fetch feed → parse XML → cache → JSON
```

## Deploy it (2 minutes, no CLI)

1. Go to the Cloudflare dashboard → **Workers & Pages** → **Create** →
   **Pages** → **Upload assets**.
2. Drag the whole `game-portal` folder (or a zip of it) in.
3. Deploy. Cloudflare auto-detects `functions/api/games.js` — no extra
   configuration needed, no build command, no output directory setting.
4. Open the assigned `*.pages.dev` URL. The catalog should populate within
   a second or two.

### Alternative: CLI deploy

```bash
npx wrangler pages deploy .
```

`wrangler.toml` is only relevant for this path (or for local dev below) —
the dashboard upload method doesn't read it at all.

### Local development

A plain static server (e.g. `npx serve`) will **not** run
`functions/api/games.js` — Pages Functions need the Workers runtime. Use:

```bash
npx wrangler pages dev .
```

This serves the site AND runs the Function locally, so `/api/games` behaves
exactly like it will in production.

## Turning on monetization: ads.txt

`ads.txt` in this project is a template with instructions inside it. Ads
will not serve correctly (and GameMonetize's dashboard will flag "Missing
Ads.txt Snippet") until you:

1. Open your GameMonetize dashboard → your Site/Ad Zone for this domain.
2. Copy the exact ads.txt line(s) it gives you (standard IAB format:
   `<SSP domain>, <Publisher ID>, <DIRECT|RESELLER>`).
3. Paste them into `ads.txt`, replacing the example line.
4. Redeploy. GameMonetize checks `https://<your-domain>/ads.txt` directly —
   it must be at the root, not a subdirectory.

## Customization

- **Catalog size** — `js/config.js` → `DEFAULT_GAME_COUNT` (default 36, the
  value from your original spec). The Function clamps requests at 200
  (`MAX_NUM` in `functions/api/games.js`) since that's a sane upper bound
  for a single feed call; raise both together if you want more.
- **Colors / type** — CSS custom properties at the top of `css/style.css`
  (`--ink`, `--cyan`, `--magenta`, `--gold`, the three `--font-*` stacks).
  `js/tailwind-config.js` mirrors the same colors as Tailwind utilities
  (`bg-ink`, `text-gold`, etc.) if you want to use them directly in markup.
- **Related games count** — `RELATED_GAMES_LIMIT` in `js/config.js`.
- **Cache duration** — `CACHE_TTL_SECONDS` in `functions/api/games.js`.

## Security notes

- **Embed allowlist** — `game.html` takes `url` as a query parameter, so
  without a check, the page could be used to iframe arbitrary third-party
  URLs. `isAllowedEmbedUrl()` in `js/utils.js` refuses anything whose
  hostname isn't `gamemonetize.com`/`.co` (or a subdomain) before it's ever
  assigned to the iframe's `src`.
- **XSS from feed content** — every string from the feed (title, category,
  tags) goes through `escapeHtml()` before touching `innerHTML`. Treat any
  third-party feed as untrusted input, even one you trust operationally.
- **CSP** — see `_headers`. `frame-src` is scoped to the exact GameMonetize
  domains rather than left open.

## Design system, briefly

Dark violet base (`#0e0b1a`, not a flat neutral black) with three accents
pulled from real arcade-cabinet vocabulary rather than a single generic
neon: cyan and magenta (classic dual-player cabinet color coding) plus gold
(marquee bulb color, used for the active state / primary actions). The
header's animated dot strip references marquee chase lighting; the game
player's frame is styled as a bolted cabinet bezel. `Monoton` (a genuine
neon-tube display face) is used once, for the wordmark only — everything
else uses `Space Grotesk` (headings) and `Inter` (body) so the signature
moment doesn't turn into pastiche. `prefers-reduced-motion` disables the
chase animation and card transitions for anyone who's asked for that.

## A business note, since ad content isn't fully in your control

GameMonetize is a general-purpose ad network — its fill can include
casual casino/gambling-style titles alongside everything else. If this
portal is going out under a halal-oriented brand, it's worth checking
GameMonetize's dashboard for any category/genre exclusion controls before
launch, since that's the one piece of the stack that isn't governed by
this codebase.

## Possible next steps

- Pagination or infinite scroll once you raise `DEFAULT_GAME_COUNT` well
  past 36.
- A "Favorites" list using `localStorage` (safe to add once this is
  actually deployed — it won't work inside an in-chat preview, only on a
  real deployed origin).
- A `manifest.json` + service worker for installability.
- Multi-language UI copy if you're targeting the Indonesian market
  directly rather than a global audience.
