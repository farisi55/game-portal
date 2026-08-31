// Vitest configuration for Gimboot.
//
// This baseline config runs plain Node.js-environment tests for js/ portal
// files (state.js, utils.js) and games/shared/ using vitest's built-in pool.
//
// Cloudflare Workers-pool integration (@cloudflare/vitest-pool-workers) will
// be added in Task #009 when src/index.js route-handler tests are introduced —
// Worker-specific APIs (HTMLRewriter, caches, env.ASSETS, workerd globals)
// require the Workers pool to be meaningful. Adding it before those test files
// exist would only introduce unnecessary startup overhead and configuration
// surface area to maintain.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file naming convention: collocated *.test.js next to the source file
    include: ['**/*.test.js'],

    // Exclude node_modules, generated output, and tool folders
    exclude: [
      'node_modules/**',
      '.wrangler/**',
      '.wrangler-dry-run/**',
      '.kilo/**',
      '.serena/**',
      '.claude/**',
      // Per-game Canvas files are standalone HTML5 apps; they are smoke-tested
      // manually (Task #014) rather than through the shared vitest run.
      'games/ayo-kopdes/**',
      'games/kejar-koruptor/**',
      'games/kicau-mania/**',
      'games/mobil-mbg/**',
    ],

    // Browser globals (localStorage, sessionStorage, window, document) are
    // needed by js/state.js and js/utils.js tests. jsdom provides them in the
    // Node.js test environment without requiring a real browser.
    environment: 'jsdom',

    // Fail the run on any unhandled promise rejection rather than silently
    // marking the test as passed with an async warning.
    dangerouslyIgnoreUnhandledErrors: false,

    // Exit 0 when no test files are found — valid during bootstrap (Task #004)
    // before test files are written in Tasks #007–#010.
    passWithNoTests: true,
  },
});
