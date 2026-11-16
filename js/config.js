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

  // Hostnames allowed as an <iframe src>. The canonical /play/{id}/{slug}
  // route resolves the embed URL server-side and exposes it as a meta tag, so
  // the player never accepts a URL from the query string. This allowlist is
  // the second line of defense for every resolved value. Anything outside
  // this list (and outside our own games/ folder — see isAllowedEmbedUrl in
  // utils.js) is refused before it ever reaches the DOM.
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
      source: 'No Ads',
    },
    {
      id: 'local-ayo-kopdes',
      title: 'Ayo ke Kopdes',
      category: 'Arcade',
      url: '/games/ayo-kopdes/index.html',
      thumb: '/games/ayo-kopdes/thumb.svg',
      width: 960,
      height: 540,
      source: 'No Ads',
    },
    {
      id: 'local-mobil-mbg',
      title: 'Mobil MBG',
      category: 'Arcade',
      url: '/games/mobil-mbg/index.html',
      thumb: '/games/mobil-mbg/thumb.svg',
      width: 360,
      height: 640,
      source: 'No Ads',
    },
    {
      id: 'local-kejar-koruptor',
      title: 'Kejar Koruptor',
      category: 'Arcade',
      url: '/games/kejar-koruptor/index.html',
      thumb: '/games/kejar-koruptor/thumb.svg',
      width: 360,
      height: 640,
      source: 'No Ads',
    },
    {
      id: 'local-solitaire',
      title: 'Solitaire',
      category: 'Cards',
      url: '/games/solitaire/index.html',
      thumb: '/games/solitaire/thumb.svg',
      width: 1024,
      height: 768,
      source: 'No Ads',
    },
    {
      id: 'local-moba',
      title: 'Moba DOTA',
      category: 'MOBA',
      url: '/games/moba/index.html',
      thumb: '/games/moba/thumb.svg',
      width: 1280,
      height: 720,
      source: 'No Ads',
    },
    {
      id: 'local-pawzle-maze',
      title: 'Pawzle Maze',
      category: 'Puzzle',
      url: '/games/pawzle-maze/index.html?embed=1&parentOrigin=https%3A%2F%2Fgimboot.com',
      thumb: '/games/pawzle-maze/thumb.svg',
      width: 960,
      height: 720,
      source: 'No Ads',
    },
  ],

  // Aspect ratio used when a game doesn't report its own width/height.
  FALLBACK_ASPECT_RATIO: '16 / 9',

  // Ad script URL from GameMonetize/GamePix dashboard.  Paste the <script src="…">
  // value provided by the ad network here.  When empty, no ad script is loaded
  // and the game page works normally without monetisation.
  AD_SCRIPT_URL: '',

  // How many related games to show on the player page.
  RELATED_GAMES_LIMIT: 12,

  // sessionStorage key used to hand the already-fetched catalog from
  // index.html to the player page, avoiding a second network round-trip when
  // the person clicks from the grid into a game.
  SESSION_CACHE_KEY: 'gp_games_cache_v1',
};
