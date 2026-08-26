// ============================================================================
// Central configuration. Change values here — not inline in other files.
// ============================================================================

export const CONFIG = {
  // Internal API route (a Cloudflare Worker) that fetches, caches, and
  // normalizes BOTH the GameMonetize and GamePix feeds into one clean,
  // merged JSON array. The frontend never talks to either feed directly —
  // see src/index.js.
  GAMES_API_ENDPOINT: '/api/games',

  // Number of games requested from the upstream GameMonetize feed. Raise
  // this (up to 200 — see the clamp in src/index.js) for a bigger catalog.
  DEFAULT_GAME_COUNT: 50,
  LOAD_MORE_COUNT: 10,
  MAX_GAME_COUNT: 200,

  // Hostnames allowed as an <iframe src>. /game reads `url` from the
  // query string, so without this allowlist the player page could be used
  // to frame arbitrary third-party URLs. Anything outside this list (and
  // outside our own games/ folder — see isAllowedEmbedUrl in utils.js) is
  // refused before it ever reaches the DOM.
  ALLOWED_EMBED_HOSTS: [
    'html5.gamemonetize.co',
    'gamemonetize.co',
    'html5.gamemonetize.com',
    'gamemonetize.com',
    'play.gamepix.com',
    'gamepix.com',
  ],

  // Games we host ourselves, prepended to whatever the API returns. `url`
  // is a same-origin relative path under games/ rather than an external
  // https URL — see isAllowedEmbedUrl in utils.js for why that's still safe
  // to iframe without a hostname check.
  LOCAL_GAMES: [
    {
      id: 'local-kicau-mania',
      title: 'Kicau Mania',
      category: 'Arcade',
      url: '/games/kicau-mania/index.html',
      thumb: '/games/kicau-mania/thumb.svg',
      width: 360,
      height: 640,
      source: 'Buatan Sendiri',
    },
    {
      id: 'local-ayo-kopdes',
      title: 'Ayo ke Kopdes',
      category: 'Arcade',
      url: '/games/ayo-kopdes/index.html',
      thumb: '/games/ayo-kopdes/thumb.svg',
      width: 960,
      height: 540,
      source: 'Buatan Sendiri',
    },
    {
      id: 'local-mobil-mbg',
      title: 'Mobil MBG',
      category: 'Arcade',
      url: '/games/mobil-mbg/index.html',
      thumb: '/games/mobil-mbg/thumb.svg',
      width: 360,
      height: 640,
      source: 'Buatan Sendiri',
    },
  ],

  // Aspect ratio used when a game doesn't report its own width/height.
  FALLBACK_ASPECT_RATIO: '16 / 9',

  // How many related games to show on the player page.
  RELATED_GAMES_LIMIT: 12,

  // sessionStorage key used to hand the already-fetched catalog from
  // index.html to /game, avoiding a second network round-trip when the
  // person clicks from the grid into a game.
  SESSION_CACHE_KEY: 'gp_games_cache_v1',
};
