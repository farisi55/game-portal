// ==========================================================================
// e2e/full-flow.test.js — End-to-End Smoke Test (Task #015)
//
// Exercises the full player journey against a REAL wrangler dev server and
// a REAL Chromium browser (Playwright):
//
//   Catalog (/) → click game card → /play/{id}/{slug} → Play Now →
//   iframe game → score a new record → ViralShare modal (confetti +
//   share text) → score bridged to PWA high-score → share → close.
//
// Also guards the share/SEO surface at the HTTP level:
//   - /play/{id}/{slug} serves OG tags for the local game (hermetic —
//     does not depend on the upstream feed, see Task #012's handler).
//   - /share/{id} serves OG tags.
//   - /game?id={id} still 301s to /play/{id}/{slug} in a single hop.
//
// Determinism strategy:
//   - The external games feed is stubbed at the network layer (Playwright
//     route interception). The real /api/games handler is already covered
//     by src/index.test.js in the worker runtime; this suite must not
//     depend on live third-party feed availability.
//   - The server is booted with localProtocol: 'https' so the worker's
//     unconditional http→https 301 (production hardening) never fires and
//     the self-signed dev cert is accepted via ignoreHTTPSErrors.
//   - The game is driven through its classic-script globals
//     (state / startPlaying / gameOver) rather than physics flapping,
//     so the "new record" path is deterministic.
//   - --autoplay-policy=no-user-gesture-required so AudioContext.resume()
//     cannot produce a floating-promise rejection in headless runs.
//
// Run: npm run test:e2e
// ==========================================================================

import { afterAll, beforeAll, describe, test } from 'vitest';
import { chromium, expect } from '@playwright/test';
import { unstable_dev } from 'wrangler';

// ---------------------------------------------------------------------------
// Feed stub: 3 fake remote games. Real local games are added client-side from
// js/config.js CONFIG.LOCAL_GAMES, so the stub only supplies remote entries.
// Thumbs point at a real local asset to avoid any network noise.
// ---------------------------------------------------------------------------
const FAKE_REMOTE_GAMES = [
  {
    id: 'gm-e2e-fake-racer',
    title: 'E2E Fake Racer 3D',
    category: 'Racing',
    url: 'https://feed.example/e2e-fake-racer',
    thumb: '/games/kicau-mania/thumb.svg',
    width: 640,
    height: 480,
    source: 'E2EFeed',
  },
  {
    id: 'gm-e2e-fake-puzzle',
    title: 'E2E Fake Puzzle Blast',
    category: 'Puzzle',
    url: 'https://feed.example/e2e-fake-puzzle',
    thumb: '/games/kicau-mania/thumb.svg',
    width: 640,
    height: 480,
    source: 'E2EFeed',
  },
  {
    id: 'gm-e2e-fake-runner',
    title: 'E2E Fake Runner',
    category: 'Arcade',
    url: 'https://feed.example/e2e-fake-runner',
    thumb: '/games/kicau-mania/thumb.svg',
    width: 640,
    height: 480,
    source: 'E2EFeed',
  },
];

const GAME_URL_PATTERN = /\/game\?id=local-kicau-mania/;
// Catalog cards link to /game?id=<id> (buildGamePageUrl in js/utils.js), which
// the Worker 301s to /play/<id>/<slug> in a single hop. Match the pre-redirect
// href rather than the canonical /play/ path.
const KICAU_CARD_SELECTOR = '#game-grid .game-card__link[href*="id=local-kicau-mania"]';
const GAME_FRAME_URL_FRAGMENT = '/games/kicau-mania/index.html';

// One wrangler dev server for the whole suite.
/** @type {Awaited<ReturnType<typeof unstable_dev>> | null} */
let worker = null;
let baseUrl = '';

beforeAll(async () => {
  // HTTP, not HTTPS: wrangler dev serves a self-signed cert over HTTPS, and
  // every script fetch from the game iframe then trips a hard console.error
  // ("An SSL certificate error occurred when fetching the script"). Over plain
  // HTTP there are zero console errors across the whole journey. The Worker's
  // http→https 301 is gated on isLoopbackHost() so it still fires for real
  // production traffic — the suite just doesn't exercise it here.
  worker = await unstable_dev('./src/index.js', {
    config: './wrangler.toml',
    localProtocol: 'http',
    persist: false,
    logLevel: 'error',
  });
  baseUrl = `http://127.0.0.1:${worker.port}`;
});

afterAll(async () => {
  if (worker) await worker.stop();
});

/**
 * Resolves the game's content Frame once the lazy-loaded iframe has
 * navigated. FrameLocator can locate DOM inside the frame but cannot run
 * evaluate(), so journeys that drive the game's globals need the Frame.
 * @param {import('@playwright/test').Page} page
 */
async function waitForGameFrame(page) {
  let frame = null;
  await expect
    .poll(
      () => {
        // The lazy iframe's src resolves to /games/kicau-mania/ (the Worker's
        // SPA fallback serves index.html at the folder path). Match either
        // form so the assertion is robust to how the asset server canonicalizes.
        frame = page.frames().find((f) => {
          const u = f.url();
          return u.includes('/games/kicau-mania') && !u.includes('/play/');
        }) || null;
        return Boolean(frame);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return frame;
}

describe('Gimboot end-to-end smoke: catalog → play → record → share', () => {
  test('full player journey: catalog card → player → iframe game → record → share modal', async () => {
    const browser = await chromium.launch({
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true, // wrangler dev serves a self-signed cert
      viewport: { width: 1280, height: 800 },
    });
    // Clipboard permissions so the share button's copy fallback can be
    // verified (desktop Chromium has no navigator.share → copy path runs).
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Collect console errors + uncaught exceptions across ALL frames
    // (catalog page, player page, and the game iframe).
    const consoleErrors = [];
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });

    try {
      // ---- Stub the external games feed before any navigation -------------
      await context.route('**/api/games*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(FAKE_REMOTE_GAMES),
        }),
      );

      // ---- Step 1: Catalog ------------------------------------------------
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

      const kicauCard = page.locator(KICAU_CARD_SELECTOR);
      await expect(kicauCard).toHaveCount(1, { timeout: 30_000 });
      await expect(kicauCard).toHaveAttribute('href', GAME_URL_PATTERN);
      await expect(page.locator('#game-grid .game-card')).toHaveCount(
        // 4 LOCAL_GAMES (client config) + 3 stubbed remote games
        7,
      );

      // ---- Step 2: Player page (/play/{id}/{slug}) -------------------------
      await kicauCard.click();
      // The Worker redirects /game?id=X → /play/<id>/<slug> in one hop, and
      // preserves the original query string on the destination. Match the
      // canonical path prefix; the trailing query is incidental.
      await expect(page).toHaveURL(/\/play\/local-kicau-mania\/kicau-mania(\?|$)/, { timeout: 30_000 });

      // Title resolves to the game's real name (not the generic "Game").
      await expect(page.locator('#game-title')).toHaveText('Kicau Mania');

      // Server-rendered OG tags carry the game name (share-preview surface).
      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
      expect(String(ogTitle)).toContain('Kicau Mania');

      // ---- Step 3: Play Now → lazy-loaded iframe ---------------------------
      const frameEl = page.locator('#game-frame');
      await expect(frameEl).toBeHidden(); // lazy: hidden until Play Now
      await page.locator('#play-btn').click();
      await expect(frameEl).toBeVisible();
      await expect(frameEl).toHaveAttribute(
        'src',
        new RegExp(`${GAME_FRAME_URL_FRAGMENT.replace(/\//g, '\\/')}$`),
      );

      // ---- Step 4: Game boots to its start screen ---------------------------
      const frame = page.frameLocator('#game-frame');
      await expect(frame.locator('#start-screen')).toBeVisible({ timeout: 30_000 });

      // ---- Step 5: Deterministic new record --------------------------------
      // Drive the classic-script globals directly (see header comment):
      // startPlaying() → mode 'playing', then a fresh score and gameOver()
      // synchronously — before any rAF tick can kill the bird.
      const gameFrame = await waitForGameFrame(page);
      await gameFrame.evaluate(() => {
        startPlaying(); // global function declaration in classic script
        state.score = 5; // global lexical binding — fresh run, high score 0
        gameOver(); // → new record → saveHighScore + ViralShare.show
      });

      // ViralShare modal appears with confetti + the recorded score.
      await expect(frame.locator('.viral-overlay')).toHaveClass(/viral-show/, {
        timeout: 10_000,
      });
      await expect(frame.locator('#viral-score')).toHaveText('5');
      await expect(frame.locator('#viral-confetti-canvas')).toHaveCount(1);

      // ---- Step 6: Score bridge → PWA high score ---------------------------
      // The iframe posts { type: 'arcade-score', score } to the parent page;
      // js/pwa.js persists it under 'arcade-high-score-v1'. (iframe and the
      // player page share an origin here, so one localStorage covers both.)
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('arcade-high-score-v1')), {
          timeout: 10_000,
        })
        .toBe('5');

      // ---- Step 7: Share ---------------------------------------------------
      // Desktop Chromium has no navigator.share → ui-share.js copies the
      // built share text to the clipboard and flips the button label.
      await frame.locator('#viral-share-btn').click();
      await expect(frame.locator('#viral-share-btn')).toContainText('Teks Disalin!', {
        timeout: 10_000,
      });

      const shareText = await gameFrame.evaluate(() => navigator.clipboard.readText());
      expect(shareText).toContain('skor 5'); // score interpolated into copy
      expect(shareText).toContain('/play/local-kicau-mania/kicau-mania'); // canonical deep link

      // ---- Step 8: Close modal → back to the game --------------------------
      await frame.locator('#viral-close-btn').click();
      await expect(frame.locator('.viral-overlay')).not.toHaveClass(/viral-show/);

      // ---- Zero console errors across the whole journey --------------------
      expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test('share/SEO surface: /share/{id} serves OG tags for a local game', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    try {
      await page.goto(`${baseUrl}/share/local-kicau-mania`, { waitUntil: 'domcontentloaded' });

      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
      expect(String(ogTitle)).toContain('Kicau Mania');

      const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
      expect(String(ogImage)).toContain('/games/kicau-mania/thumb.svg');
    } finally {
      await browser.close();
    }
  });

  test('legacy /game?id= route still 301s to /play/{id}/{slug} in one hop', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });

    try {
      const res = await context.request.get(`${baseUrl}/game?id=local-kicau-mania`, {
        maxRedirects: 0,
      });
      expect(res.status()).toBe(301);
      expect(res.headers()['location']).toContain('/play/local-kicau-mania/');
    } finally {
      await browser.close();
    }
  });
});
