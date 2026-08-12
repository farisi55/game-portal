// ============================================================================
// GET /api/games — Cloudflare Pages Functions version.
//
// NOTE: this repo currently deploys as a Cloudflare Worker with static
// assets (see wrangler.toml: `main = "./src/index.js"`, `npx wrangler
// deploy`), and Worker deployments do NOT use the functions/ directory
// convention at all — that routing only applies to Cloudflare Pages
// deployments. src/index.js is the file that actually runs today; this one
// is kept in sync for reference in case you ever deploy via Pages instead,
// but as far as we can tell it isn't currently invoked. Safe to delete if
// you'd rather not maintain two copies — see the chat for details.
//
// Logic is otherwise identical to src/index.js: fetch GameMonetize + GamePix
// in parallel, normalize both into one shape, merge, cache at the edge.
//
// NOT mirrored here: the /play/{id}/{slug} SEO route and /sitemap.xml added
// to src/index.js — that's a meaningful amount of extra logic (HTMLRewriter-
// based meta injection) not worth duplicating into a file that, per the
// note above, doesn't appear to actually run under this deployment model.
// ============================================================================

const GM_FEED_BASE = 'https://gamemonetize.com/feed.php';
const GM_DEFAULT_NUM = 36;
const GM_MAX_NUM = 200;

const GAMEPIX_FEED_BASE = 'https://feeds.gamepix.com/v2/json';
const GAMEPIX_DEFAULT_SID = '985I2';
const GAMEPIX_PAGINATION = 12;

const CACHE_TTL_SECONDS = 1800;

export async function onRequestGet(context) {
  const { request } = context;
  const requestUrl = new URL(request.url);
  const num = clampNum(requestUrl.searchParams.get('num'), GM_DEFAULT_NUM, GM_MAX_NUM);

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/api/games?num=${num}`, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const [gmResult, gpResult] = await Promise.allSettled([
    fetchGameMonetize(num),
    fetchGamePix(context.env),
  ]);

  const gmGames = gmResult.status === 'fulfilled' ? gmResult.value : [];
  const gpGames = gpResult.status === 'fulfilled' ? gpResult.value : [];

  if (gmResult.status === 'rejected') console.error('GameMonetize feed failed:', gmResult.reason);
  if (gpResult.status === 'rejected') console.error('GamePix feed failed:', gpResult.reason);

  const combined = [...gmGames, ...gpGames];

  if (combined.length === 0) {
    return jsonResponse(
      { error: 'Both game feeds failed', gameMonetize: gmResult.status, gamePix: gpResult.status },
      502
    );
  }

  const response = jsonResponse(combined, 200, CACHE_TTL_SECONDS);
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function clampNum(rawNum, fallback, max) {
  const n = parseInt(rawNum, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

async function fetchGameMonetize(num) {
  const feedUrl = `${GM_FEED_BASE}?format=json&num=${num}`;
  const upstream = await fetch(feedUrl, { headers: { Accept: 'application/xml,text/xml,*/*' } });
  if (!upstream.ok) throw new Error(`GameMonetize feed responded with ${upstream.status}`);
  const rawText = await upstream.text();
  const games = parseGameMonetizeFeed(rawText);
  if (games.length === 0) throw new Error('GameMonetize feed produced zero items');
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

async function fetchGamePix(env) {
  const feedSid = String(env.GAMEPIX_SID || GAMEPIX_DEFAULT_SID).trim();
  const feedUrl = `${GAMEPIX_FEED_BASE}?sid=${encodeURIComponent(feedSid)}&pagination=${GAMEPIX_PAGINATION}&page=1`;
  const upstream = await fetch(feedUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; GimbootPortal/1.0)',
    },
  });

  if (!upstream.ok) {
    const bodySnippet = await upstream.text().catch(() => '');
    console.error('GamePix feed non-OK response:', upstream.status, bodySnippet.slice(0, 300));
    throw new Error(`GamePix feed responded with ${upstream.status}`);
  }

  const rawText = await upstream.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    console.error('GamePix feed returned non-JSON body:', rawText.slice(0, 300));
    throw new Error('GamePix feed response was not valid JSON');
  }

  if (!data || !Array.isArray(data.items)) {
    console.error('GamePix feed JSON missing items array:', JSON.stringify(data).slice(0, 300));
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

  if (games.length === 0) throw new Error('GamePix feed produced zero usable items');
  return games;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
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
