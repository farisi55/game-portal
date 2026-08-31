// ESLint v9+ flat config (eslint.config.js).
// The task spec lists ".eslintrc" but ESLint 9 dropped the legacy rc format;
// eslint.config.js is the canonical flat-config replacement.
// Decision: @eslint/js added as explicit devDependency to access the
// recommended ruleset in the flat-config style.

import js from '@eslint/js';

export default [
  // Base recommended rules for all JavaScript files
  {
    ...js.configs.recommended,
    files: ['js/**/*.js', 'src/**/*.js', 'games/shared/**/*.js'],
  },
  // Global ignores — don't lint generated output, tool folders, or game logic
  // files that are standalone Canvas apps (not ES modules sharing our tooling)
  {
    ignores: [
      'node_modules/**',
      '.wrangler/**',
      '.wrangler-dry-run/**',
      '.kilo/**',
      '.serena/**',
      '.claude/**',
      // Per-game Canvas files are standalone HTML5 apps with their own
      // conventions; they are tested via manual smoke-test (Task #014) rather
      // than the shared lint pass.
      'games/ayo-kopdes/**',
      'games/kejar-koruptor/**',
      'games/kicau-mania/**',
      'games/mobil-mbg/**',
    ],
  },
  // Linting rules for Worker + portal JS
  {
    files: ['js/**/*.js', 'src/**/*.js', 'games/shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // Cloudflare Workers globals (fetch, caches, crypto, etc.) are available
      // at the module level — mark them as read-only globals so ESLint doesn't
      // flag their use as undefined variables.
      globals: {
        fetch: 'readonly',
        caches: 'readonly',
        crypto: 'readonly',
        HTMLRewriter: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Headers: 'readonly',
        console: 'readonly',
        // Browser globals used by js/ portal files
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        Uint8Array: 'readonly',
        // Animation-frame globals used by games/shared/ui-share.js for
        // the confetti animation loop.
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        // Tailwind Play CDN attaches its config object to a global `tailwind`
        // variable; js/tailwind-config.js assigns to it.
        tailwind: 'writable',
      },
    },
    rules: {
      // Disallow unused variables but allow leading-underscore names that signal
      // intentional "unused" parameters, variables, or catch bindings.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // catch (e) { /* ignore */ } is a common idiom; allow bare _ and _*
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // No console in production code; use structured logging instead.
      // Worker uses console.error for upstream feed failures — allow those.
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      // Don't shadow outer-scope variables — catches subtle bugs in closures.
      'no-shadow': 'error',
      // Prefer const for variables that are never reassigned.
      'prefer-const': 'error',
      // Semicolons required — Prettier will enforce style, but ESLint catches
      // missing semis that slip through.
      'semi': ['error', 'always'],
    },
  },
];
