// Vitest configuration for the Playwright end-to-end suite (e2e/).
//
// Deliberately separate from vitest.config.js: E2E tests boot a real
// `wrangler dev` server and a real Chromium browser, so they are slow and
// must never run as part of `npm test` / the pre-commit hook. Run them via
// `npm run test:e2e`.
//
// fileParallelism: false — one wrangler dev server + one browser at a time;
// parallel workers would fight over ports and shared localStorage state.
// singleFork is a Vitest 4 top-level option (test.poolOptions was removed).

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.test.js'],
    // E2E journeys are long: server boot + full browser flow.
    testTimeout: 120_000,
    hookTimeout: 240_000,
    fileParallelism: false,
    pool: 'forks',
    singleFork: true,
  },
});