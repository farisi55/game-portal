// Vitest configuration for Gimboot.
//
// Two inline project definitions:
// 1. "unit" — jsdom environment for js/ portal tests (state.js, utils.js)
// 2. "worker" — Cloudflare Workers runtime for src/index.js integration tests
//
// The @cloudflare/vitest-plugin runs worker tests inside workerd via Miniflare,
// providing real Cloudflare globals (HTMLRewriter, caches.default, env.ASSETS).

import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'node:inspector/promises': 'unenv/dist/runtime/node/inspector/promises.mjs',
    },
  },
  test: {
    // Global excludes shared by both projects
    exclude: [
      'node_modules/**',
      '.wrangler/**',
      '.wrangler-dry-run/**',
      '.kilo/**',
      '.serena/**',
      '.claude/**',
      'games/ayo-kopdes/**',
      'games/kejar-koruptor/**',
      'games/kicau-mania/**',
      'games/mobil-mbg/**',
    ],

    passWithNoTests: true,

    dangerouslyIgnoreUnhandledErrors: false,

    projects: [
      {
        test: {
          name: 'unit',
          include: ['js/**/*.test.js', 'games/shared/**/*.test.js'],
          environment: 'jsdom',
          coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json'],
            reportsDirectory: './coverage',
            include: ['js/**/*.js'],
            exclude: ['js/**/*.test.js', 'games/**/*.test.js'],
          },
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.toml' },
          }),
        ],
        test: {
          name: 'worker',
          include: ['src/**/*.test.js'],
        },
      },
    ],
  },
});
