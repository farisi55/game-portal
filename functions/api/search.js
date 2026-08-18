// ============================================================================
// GET /api/search?q={query} — Hybrid search fallback proxy.
//
// Queries the GameMonetize feed with a search filter and normalizes the
// results into the same shape as /api/games. Used by the frontend when a
// local in-memory search returns zero matches ("Game not found. Search
// Online?").
// ============================================================================

const GM_FEED_BASE = 'https://gamemonetize.com/feed.php';
const GM_DEFAULT_NUM = 50;
const GM_MAX_NUM = 100;

const CACHE_TTL_SECONDS = 600;

export async function onRequestGet(context) {
  const { request } = context;
  const requestUrl = new URL(request.url);
  const q = (requestUrl.searchParams.get('q') || '').trim();

  if (!q) {
    return jsonResponse({ error: 'Missing required query param "q"' }, 400);
  }

  // Edge cache keyed by query so repeated identical searches hit the cache.
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/api/search?q=${encodeURIComponent(q)}`, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const games = await searchGameMonetize(q);

    if (games.length === 0) {
      return jsonResponse([]);
    }

    const response = jsonResponse(games, 200, CACHE_TTL_SECONDS);
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    console.error('Search API failed:', error);
    return jsonResponse({ error: 'Search failed' }, 502);
  }
}

function clampNum(rawNum, fallback, max) {
  const n = parseInt(rawNum, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

async function searchGameMonetize(query) {
  const num = clampNum(null, GM_DEFAULT_NUM, GM_MAX_NUM);
  const feedUrl = `${GM_FEED_BASE}?format=json&num=${num}`;
  const upstream = await fetch(feedUrl, {
    headers: { Accept: 'application/xml,text/xml,*/*' },
  });

  if (!upstream.ok) throw new Error(`GameMonetize feed responded with ${upstream.status}`);

  const rawText = await upstream.text();
  const allGames = parseGameMonetizeFeed(rawText);
  const lowerQuery = query.toLowerCase();

  return allGames.filter((g) => {
    const haystack = `${g.title} ${g.category}`.toLowerCase();
    return haystack.includes(lowerQuery);
  });
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