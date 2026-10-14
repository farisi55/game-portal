# Manual Smoke-Test Checklist — First-Party Canvas Games

- **Task:** #014 — Manual Smoke-Test Checklist for First-Party Canvas Games
- **Execution date:** 2026-09-23
- **Environment:** Microsoft Edge headless Chromium on Windows x64
- **Scope:** Standalone Canvas game pages, loaded from a temporary local HTTP server
- **Result:** PASS — all four active first-party games loaded, started, scored, and reached game over

## Execution method

This run used a temporary, isolated browser profile and a local HTTP server rooted at the repository. Each game page was opened directly at its route below. The runner sent real browser keyboard events through the Chrome DevTools Protocol, waited for the game's live state to reach `playing`, observed the score increase, and then waited for the visible game-over screen. JavaScript exceptions and console errors were captured for each page.

Audio preferences were set to muted and high scores were seeded in the temporary browser profile so the run exercised core Canvas flow without opening the new-record sharing modal. No repository files or production data were changed. The temporary server and browser profile were removed after execution.

## Results

| Game | Route | Load | Start | Score progressed | Game over | Final score | JavaScript/console errors |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| Ayo ke Kopdes | `/games/ayo-kopdes/index.html` | PASS | PASS | PASS | PASS | 59 | 0 |
| Kejar Koruptor | `/games/kejar-koruptor/index.html` | PASS | PASS | PASS | PASS | 139 | 0 |
| Kicau Mania | `/games/kicau-mania/index.html` | PASS | PASS | PASS | PASS | 1 | 0 |
| Mobil MBG | `/games/mobil-mbg/index.html` | PASS | PASS | PASS | PASS | 230 | 0 |
| Solitaire | `/games/solitaire/index.html` | PENDING | PENDING | PENDING | PENDING | — | — |

> **Note (Task #027, 2026-10-13):** Solitaire was added to the first-party roster after the 2026-09-23 run above. Its row is PENDING until the next manual smoke run; the repeatable checklist below now includes its steps. Automated coverage (E2E catalog count, unit tests, lint) passed at integration time.

### Resource log observation

Ayo ke Kopdes produced one browser resource-log entry for the temporary server's automatic `/favicon.ico` request returning 404. It was not a JavaScript exception or application console error. The other three games produced no resource-log entries. The game pages themselves rendered and completed their smoke flow.

## repeatable checklist

Use a fresh browser profile for each game when repeating this checklist.

- [x] Open `/games/ayo-kopdes/index.html` and wait for the loading screen to clear.
- [x] Start Ayo ke Kopdes with Space and confirm the game enters `playing` state.
- [x] Confirm the score increases from zero.
- [x] Let the runner play until the game-over screen is visible and confirm the final score is displayed.
- [x] Confirm no JavaScript exception or console error is emitted.
- [x] Open `/games/kejar-koruptor/index.html` and wait for the loading screen to clear.
- [x] Start Kejar Koruptor with Space and confirm the game enters `playing` state.
- [x] Confirm the score increases from zero.
- [x] Let the runner play until the game-over screen is visible and confirm the final score is displayed.
- [x] Confirm no JavaScript exception or console error is emitted.
- [x] Open `/games/kicau-mania/index.html` and wait for the loading screen to clear.
- [x] Start Kicau Mania with Space and confirm the game enters `playing` state.
- [x] Send repeated Space events while following the upcoming pipe gap until the score increases from zero.
- [x] Stop input and confirm the bird reaches the visible game-over screen and the final score is displayed.
- [x] Confirm no JavaScript exception or console error is emitted.
- [x] Open `/games/mobil-mbg/index.html` and wait for the loading screen to clear.
- [x] Start Mobil MBG with Space and confirm the game enters `playing` state.
- [x] Confirm the score increases from zero.
- [x] Let the runner play until the game-over screen is visible and confirm the final score is displayed.
- [x] Confirm no JavaScript exception or console error is emitted.
- [ ] Open `/games/solitaire/index.html` and wait for the board to render (7 tableau piles, stock + waste, 4 foundations).
- [ ] Confirm the game deals 52 cards with no JavaScript exception or console error.
- [ ] Draw from the stock, move a card to a tableau/foundation pile, and confirm the score and move counters update.
- [ ] Trigger a hint (H) and undo (Ctrl+Z) and confirm both work without errors.
- [ ] Confirm the Content Security Policy console shows zero violations (no inline style/script/font/connect requests).
- [ ] Play through to a win (or use Auto finish) and confirm the win modal, high-score persistence, and share prompt appear.
- [ ] Confirm no requests to cdn.tailwindcss.com, cdn.jsdelivr.net, fonts.googleapis.com, or builder.puter.com in the Network tab.

## Boundary

This checklist covers the five first-party Canvas games only. Catalog-to-player navigation, iframe integration, high-score sharing, and social-preview metadata are covered by Task #015 and were not exercised here.

## Infrastructure fixes applied alongside this task

The following gate-required fixes were applied to `src/index.js`, `eslint.config.js`, `vitest.config.js`, `.husky/`, and `.gitignore`:

- [x] HSTS header added to `SECURITY_HEADERS`
- [x] `unsafe-inline` removed from all CSP directives
- [x] Pre-commit hook restored (`.husky/pre-commit` runs lint + test + build; `.husky/` removed from `.gitignore`)
- [x] `@vitest/coverage-v8@4.1.11` installed and coverage configured in `vitest.config.js`
- [x] `fetchWithTimeout` + `AbortController` adds 5s timeout to upstream fetches
- [x] `fetchLimitedText` enforces 5MB response body limit
- [x] `structuredLog()` provides JSON-formatted structured logging
- [x] `x-request-id` correlation ID generated at entry via `crypto.randomUUID()`
- [x] Cache-based rate limiter limits to 100 requests/minute per IP
- [x] Optional `page`/`limit` pagination added to `/api/games`
- [x] `npm test` — 162 passed, 0 failed; lint clean; build passes; 0 vulnerabilities

---

## Task #015 — End-to-End Smoke Test: Catalog → Play → Record → Share

- **Execution date:** 2026-09-24
- **Scope:** The full player journey through the live `src/index.js` routes, driven against a real `wrangler dev` server and a real Chromium browser (Playwright, via `npm run test:e2e`).
- **Result:** PASS — 3/3 tests, zero console errors.

### What the suite exercises

`e2e/full-flow.test.js` (3 tests, ~52s):

1. **Full player journey** — catalog card → `/game?id=` → 301 to `/play/{id}/{slug}` → Play Now → lazy iframe → deterministic new record via the game's classic-script globals → ViralShare modal (confetti + score) → score bridged to the PWA global high-score (`arcade-high-score-v1`) → Share button copies the canonical deep link → close. Asserts zero `console.error`/`pageerror` across every frame.
2. **Share/SEO surface** — `GET /share/local-kicau-mania` serves `og:title`/`og:image` carrying the real game name and thumb.
3. **Legacy redirect** — `GET /game?id=local-kicau-mania` (maxRedirects: 0) returns exactly one 301 to `/play/local-kicau-mania/...`.

### Determinism strategy

- The external games feed is stubbed at the network layer (Playwright `context.route`), so the suite never depends on GameMonetize/GamePix availability. The stub IDs use the `gm-` prefix so `fetchGameCatalog`'s balanced split keeps them in the catalog (5 LOCAL_GAMES + 3 stubbed remote = 8 cards since Task #027; previously 4 + 3 = 7).
- The server is booted with `localProtocol: 'http'`, not HTTPS. wrangler dev serves a self-signed cert over HTTPS and every script fetch from the game iframe then trips a hard `console.error` ("An SSL certificate error occurred when fetching the script"). Over plain HTTP the journey is completely clean. The Worker's http→https 301 is gated on `isLoopbackHost()` so it still fires for real production traffic — the suite just doesn't exercise it here.
- The game is driven through its classic-script globals (`startPlaying()` / `state.score = 5` / `gameOver()`) rather than physics flapping, so the "new record" path is deterministic.

### Files

- `e2e/full-flow.test.js` — the suite.
- `vitest.e2e.config.js` — separate Vitest config; `npm test` / the pre-commit hook never run it.
- `src/index.js` — `isLoopbackHost()` added; the http→https 301 now skips loopback hosts.
- `src/index.test.js` — 6 unit tests for `isLoopbackHost`.
- `games/shared/ui-share.js` — share text now targets `/play/<canonical-id>/<slug>` (was `/game?id=<slug>`, which missed the server's LOCAL_GAMES lookup); inline `<style>` fallback removed (blocked by the strict CSP, only produced console errors).
