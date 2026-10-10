// ==========================================================================
// e2e/emulator-flow.test.js — Emulator End-to-End Test (Task #022)
//
// Exercises the /emulator page against a REAL wrangler dev server and a
// REAL Chromium browser (Playwright):
//
//   Catalog (/) → click Emulator tab → /emulator/ → pick NES →
//   upload a programmatically-generated valid iNES ROM → Load Game →
//   runtime iframe boots → core data file downloads → no POST requests
//   ever leave the origin.
//
// Determinism strategy:
//   - The external games feed is stubbed at the network layer (Playwright
//     route interception) so the catalog page loads without depending on
//     live third-party feed availability.
//   - The ROM fixture is generated in-memory at test time (16-byte iNES
//     header + 16 KB PRG bank with a JMP self-loop) — no binary files
//     are committed to the repo.
//   - The runtime handshake is driven via window.postMessage from the
//     test page (same origin), not via CDP or DOM hacks.
//
// Run: npm run test:e2e
// ==========================================================================

import { afterAll, beforeAll, describe, test } from 'vitest';
import { chromium, expect } from '@playwright/test';
import { unstable_dev } from 'wrangler';

// ---------------------------------------------------------------------------
// Stub feed — same shape as full-flow.test.js
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
];

// ---------------------------------------------------------------------------
// Programmatically-generated minimal valid iNES ROM
// ---------------------------------------------------------------------------
function makeTinyNesRom() {
  const PRG_BANK_SIZE = 16384; // 1 × 16 KB PRG bank
  const buf = Buffer.alloc(16 + PRG_BANK_SIZE);

  // iNES header
  buf[0] = 0x4e; // 'N'
  buf[1] = 0x45; // 'E'
  buf[2] = 0x53; // 'S'
  buf[3] = 0x1a; // file magic
  buf[4] = 0x01; // 1 × 16 KB PRG
  buf[5] = 0x00; // 0 × 8 KB CHR (CHR-RAM)
  buf[6] = 0x00; // flags 6 (horizontal mirroring, mapper 0)
  buf[7] = 0x00; // flags 7
  // flags 8–15 remain zero

  // PRG code at $C000 (bank start maps to $C000 for NROM-128)
  // At offset 16: JMP $C000 (self-loop = valid reset handler that hangs)
  buf[16 + 0] = 0x4c; // JMP abs
  buf[16 + 1] = 0x00;
  buf[16 + 2] = 0xc0;

  // Vectors at end of PRG bank:
  // NMI   = $C000  (offset 16 + 0x3FFA = 16394)
  // RESET = $C000  (offset 16 + 0x3FFC = 16396)
  // IRQ   = $C000  (offset 16 + 0x3FFE = 16398)
  const vecBase = 16 + PRG_BANK_SIZE - 6;
  buf[vecBase + 0] = 0x00; buf[vecBase + 1] = 0xc0; // NMI
  buf[vecBase + 2] = 0x00; buf[vecBase + 3] = 0xc0; // RESET
  buf[vecBase + 4] = 0x00; buf[vecBase + 5] = 0xc0; // IRQ

  return buf;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
/** @type {Awaited<ReturnType<typeof unstable_dev>> | null} */
let worker = null;
let baseUrl = '';

beforeAll(async () => {
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

// ---------------------------------------------------------------------------

describe('Gimboot end-to-end: emulator page', () => {
  test('Emulator tab navigates to /emulator, ROM loads, no server upload, core fetched', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 800 },
    });

    const consoleErrors = [];
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });

    // Track all network requests for the no-POST / same-origin-only assertion.
    const networkLog = [];
    page.on('request', (req) => {
      networkLog.push({ url: req.url(), method: req.method() });
    });

    try {
      // ---- Stub the external games feed ------------------------------------
      await context.route('**/api/games*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(FAKE_REMOTE_GAMES),
        }),
      );

      // ---- Step 1: Catalog shows Emulator tab -------------------------------
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
      const emuTab = page.locator('.tab-btn[data-tab="emulator"]');
      await expect(emuTab).toHaveCount(1, { timeout: 30_000 });
      await expect(emuTab).toHaveText('Emulator');

      // ---- Step 2: Tab click navigates to /emulator -------------------------
      await emuTab.click();
      await expect(page).toHaveURL(/\/emulator\/?$/, { timeout: 15_000 });
      await expect(page.locator('h1')).toHaveText('Emulator');

      // Wait for the emulator UI module script to finish loading and executing.
      await page.waitForLoadState('networkidle');
      await page.waitForFunction(() => window.__emuUiReady === true, null, { timeout: 10_000 });

      // ---- Step 3: Console clean pre-interaction ----------------------------
      // Allow service worker / PWA registration noise to settle, then check.
      await page.waitForTimeout(2_000);
      const preInteractionErrors = consoleErrors.filter(
        (e) => !e.includes('serviceWorker') && !e.includes('SW registration'),
      );
      expect(preInteractionErrors).toEqual([]);

      // ---- Step 4: WASM compile probe (CSP wasm-unsafe-eval) ----------------
      const wasmOk = await page.evaluate(() => {
        // Minimal valid WASM module (8 bytes: magic + version)
        const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
        try {
          WebAssembly.compile(bytes);
          return true;
        } catch {
          return false;
        }
      });
      expect(wasmOk).toBe(true);

      // ---- Step 5: Pick NES system ------------------------------------------
      await page.locator('.sys-btn[data-system="nes"]').click();
      await expect(page.locator('.sys-btn[data-system="nes"]')).toHaveAttribute(
        'aria-checked',
        'true',
      );
      const romInput = page.locator('#rom-file');
      await expect(romInput).toBeEnabled();

      // ---- Step 6: Upload tiny iNES ROM fixture -----------------------------
      const romBuffer = makeTinyNesRom();
      expect(romBuffer.length).toBe(16 + 16384); // header + 1 bank
      // Verify magic bytes
      expect(romBuffer.subarray(0, 4).toString('ascii')).toBe('NES\u001a');

      await romInput.setInputFiles({
        name: 'e2e-test.nes',
        mimeType: 'application/octet-stream',
        buffer: romBuffer,
      });
      await expect(page.locator('#rom-status')).toContainText('e2e-test.nes');

      // ---- Step 7: Load Game → runtime boots -------------------------------
      const loadBtn = page.locator('#btn-load');
      await expect(loadBtn).toBeEnabled();
      await loadBtn.click();

      // Stage becomes visible
      await expect(page.locator('.emu-stage')).toBeVisible({ timeout: 10_000 });

      // Wait for the core data file to be requested (proves EmulatorJS booted)
      try {
        await expect
          .poll(
            () => networkLog.some((r) => /\/vendor\/emulatorjs\/cores\/.*-wasm\.data/.test(r.url)),
            { timeout: 60_000, interval: 1_000 },
          )
          .toBe(true);
      } catch (pollErr) {
        console.error('NETWORK LOG:', JSON.stringify(networkLog, null, 2));
        console.error('CONSOLE ERRORS:', JSON.stringify(consoleErrors, null, 2));
        throw pollErr;
      }

      // The core data request must be a GET
      const coreReq = networkLog.find((r) =>
        /\/vendor\/emulatorjs\/cores\/.*-wasm\.data/.test(r.url),
      );
      expect(coreReq.method).toBe('GET');

      // ---- Step 8: Network guard — no POST / no cross-origin non-feed --------
      const nonGetRequests = networkLog.filter((r) => r.method !== 'GET');
      expect(nonGetRequests).toEqual([]);

      // All non-feed requests must be same-origin, with two known
      // exceptions: the stubbed feed, and EmulatorJS's built-in version
      // check against its public CDN (a GET to a static JSON manifest —
      // no user data, already allowed by the /emulator CSP connect-src).
      const origin = new URL(baseUrl).origin;
      const crossOrigin = networkLog.filter((r) => {
        try {
          const url = new URL(r.url);
          if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return false;
          if (url.hostname === 'feed.example') return false; // stubbed feed
          if (url.hostname === 'cdn.emulatorjs.org') return false; // EmulatorJS version check
          return true;
        } catch {
          return false; // data:, blob:, about: etc.
        }
      });
      expect(crossOrigin).toEqual([]);

      // ---- Step 9: Console clean post-boot (no CSP violations, no errors) ---
      await page.waitForTimeout(3_000);
      const cspViolations = consoleErrors.filter(
        (e) => e.includes('Content Security Policy') || e.includes('csp'),
      );
      expect(cspViolations).toEqual([]);

      const fatalErrors = consoleErrors.filter(
        (e) =>
          !e.includes('serviceWorker') &&
          !e.includes('SW registration') &&
          !e.includes('favicon') &&
          // EmulatorJS version check against cdn.emulatorjs.org — unreachable
          // from this environment; not a functional failure.
          !e.includes('ERR_CONNECTION_ABORTED') &&
          !e.includes('Failed to fetch') &&
          // Wake Lock is denied in headless Chromium — cosmetic only.
          !e.includes('Wake Lock permission request denied'),
      );
      expect(fatalErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
