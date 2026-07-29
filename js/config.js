// ============================================================================
// Central configuration. Change values here — not inline in other files.
// ============================================================================

export const CONFIG = {
  // Internal API route (a Cloudflare Pages Function) that proxies, caches,
  // and normalizes the GameMonetize feed into clean JSON. The frontend never
  // talks to gamemonetize.com directly — see functions/api/games.js.
  GAMES_API_ENDPOINT: '/api/games',

  // Number of games requested from the upstream feed. GameMonetize's public
  // feed is called with `&num=<DEFAULT_GAME_COUNT>`. Raise this (up to 200 —
  // see the clamp in functions/api/games.js) once you want a bigger catalog.
  DEFAULT_GAME_COUNT: 36,

  // Hostnames allowed as an <iframe src>. game.html reads `url` from the
  // query string, so without this allowlist the player page could be used
  // to frame arbitrary third-party URLs. Anything outside this list is
  // refused before it ever reaches the DOM.
  ALLOWED_EMBED_HOSTS: [
    'html5.gamemonetize.co',
    'gamemonetize.co',
    'html5.gamemonetize.com',
    'gamemonetize.com',
  ],

  // Aspect ratio used when a game doesn't report its own width/height.
  FALLBACK_ASPECT_RATIO: '16 / 9',

  // How many related games to show on the player page.
  RELATED_GAMES_LIMIT: 12,

  // sessionStorage key used to hand the already-fetched catalog from
  // index.html to game.html, avoiding a second network round-trip when the
  // person clicks from the grid into a game.
  SESSION_CACHE_KEY: 'gp_games_cache_v1',
};
