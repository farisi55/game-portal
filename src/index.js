// ============================================================================
// GET /api/games
//
// Fetches BOTH game catalogs server-side (GameMonetize + GamePix), normalizes
// each into one common shape, merges them, and caches the merged result at
// Cloudflare's edge. The frontend (js/catalog.js, js/player.js) only ever
// talks to this one endpoint and never has to know there are two upstream
// providers with two completely different response formats.
//
// - GameMonetize replies with RSS 2.0 / XML even when called with
//   `&format=json` — verified directly against the live feed. Parsed with a
//   small tailored parser below (no external XML library needed).
// - GamePix replies with real JSON (the JSON Feed spec, jsonfeed.org).
//
// Every other path falls through to the static asset handler (env.ASSETS),
// which is how index.html, game.html, css/js, and games/kicau-mania/ are
// served under the Worker-with-assets deployment model this repo now uses
// (see wrangler.toml — `npx wrangler deploy`, not `wrangler pages deploy`).
// ============================================================================

const GM_FEED_BASE = 'https://gamemonetize.com/feed.php';
const GM_DEFAULT_NUM = 36;
const GM_MAX_NUM = 200;

const GAMEPIX_FEED_BASE = 'https://feeds.gamepix.com/v2/json';
// Situs ID dari dashboard GamePix Anda. JANGAN diubah atau dihapus — dipakai
// GamePix untuk melacak statistik tayangan/klik ke akun Anda.
const GAMEPIX_SID = '30W77';
const GAMEPIX_PAGINATION = 12;

const CACHE_TTL_SECONDS = 1800; // 30 menit

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/games') {
      return handleApiGames(url, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleApiGames(url, ctx) {
  const num = clampNum(url.searchParams.get('num'), GM_DEFAULT_NUM, GM_MAX_NUM);

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/api/games?num=${num}`, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Each source is fetched independently — if one feed is down or errors,
  // the other's games still make it to the player instead of the whole
  // catalog going blank.
  const [gmResult, gpResult] = await Promise.allSettled([
    fetchGameMonetize(num),
    fetchGamePix(),
  ]);

  const gmGames = gmResult.status === 'fulfilled' ? gmResult.value : [];
  const gpGames = gpResult.status === 'fulfilled' ? gpResult.value : [];

  if (gmResult.status === 'rejected') {
    console.error('GameMonetize feed failed:', gmResult.reason);
  }
  if (gpResult.status === 'rejected') {
    console.error('GamePix feed failed:', gpResult.reason);
  }

  const combined = [...gmGames, ...gpGames];

  if (combined.length === 0) {
    return jsonResponse(
      {
        error: 'Both game feeds failed',
        gameMonetize: gmResult.status,
        gamePix: gpResult.status,
      },
      502
    );
  }

  const response = jsonResponse(combined, 200, CACHE_TTL_SECONDS);
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

function clampNum(rawNum, fallback, max) {
  const n = parseInt(rawNum, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

// ----------------------------------------------------------------------------
// GameMonetize
// ----------------------------------------------------------------------------

async function fetchGameMonetize(num) {
  const feedUrl = `${GM_FEED_BASE}?format=json&num=${num}`;
  const upstream = await fetch(feedUrl, {
    headers: { Accept: 'application/xml,text/xml,*/*' },
  });

  if (!upstream.ok) {
    throw new Error(`GameMonetize feed responded with ${upstream.status}`);
  }

  const rawText = await upstream.text();
  const games = parseGameMonetizeFeed(rawText);
  if (games.length === 0) {
    throw new Error('GameMonetize feed produced zero items');
  }
  return games;
}

function parseGameMonetizeFeed(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const tag = (name) => {
      const re = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`);
      const m = re.exec(block);
      return m ? decodeEntities(m[1].trim()) : '';
    };

    const width = parseInt(tag('width'), 10) || null;
    const height = parseInt(tag('height'), 10) || null;
    const id = tag('id');
    const title = tag('title');
    const url = tag('url');
    if (!id || !title || !url) continue;

    items.push({
      id: `gm-${id}`,
      title,
      category: tag('category') || 'Arcade',
      url,
      thumb: tag('thumb'),
      width,
      height,
    });
  }

  return items;
}

const ENTITY_MAP = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c',
  rarr: '\u2192', larr: '\u2190', uarr: '\u2191', darr: '\u2193',
  middot: '\u00b7', bull: '\u2022', zwj: '',
};

function decodeEntities(str) {
  let out = str;
  for (let pass = 0; pass < 2; pass++) {
    out = out
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&([a-zA-Z]+);/g, (m, name) => (name in ENTITY_MAP ? ENTITY_MAP[name] : m));
  }
  return out;
}

// ----------------------------------------------------------------------------
// GamePix
// ----------------------------------------------------------------------------

async function fetchGamePix() {
  const feedUrl = `${GAMEPIX_FEED_BASE}?sid=${GAMEPIX_SID}&pagination=${GAMEPIX_PAGINATION}&page=1&order=quality`;
  const upstream = await fetch(feedUrl, {
    headers: { Accept: 'application/json' },
  });

  if (!upstream.ok) {
    throw new Error(`GamePix feed responded with ${upstream.status}`);
  }

  const data = await upstream.json();
  if (!data || !Array.isArray(data.items)) {
    throw new Error('GamePix feed response missing an items array');
  }

  const games = data.items
    .filter((item) => item && item.id && item.title && item.url)
    .map((item) => ({
      id: `gp-${item.id}`,
      title: item.title,
      category: capitalize(item.category) || 'Arcade',
      url: item.url,
      thumb: item.banner_image || item.image || '',
      width: item.width || null,
      height: item.height || null,
    }));

  if (games.length === 0) {
    throw new Error('GamePix feed produced zero usable items');
  }
  return games;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ----------------------------------------------------------------------------
// Shared response helper
// ----------------------------------------------------------------------------

function jsonResponse(payload, status = 200, cacheSeconds = 0) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  };
  if (cacheSeconds > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheSeconds}`;
  }
  return new Response(JSON.stringify(payload), { status, headers });
}
