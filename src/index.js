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
const SITE_NAME = 'Gimboot';

// Game(s) we host ourselves. Mirrors js/config.js's LOCAL_GAMES exactly —
// duplicated here (rather than imported) because this Worker script and the
// browser-side ES modules don't share a build step to import from one
// source. Keep the two in sync if you add another first-party game.
const LOCAL_GAMES = [
  {
    id: 'local-kicau-mania',
    title: 'Kicau Mania',
    category: 'Arcade',
    url: '/games/kicau-mania/index.html',
    thumb: '/games/kicau-mania/thumb.svg',
    width: 360,
    height: 640,
    source: 'Original',
  },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/games') {
      return handleApiGames(url, ctx);
    }
    if (url.pathname.startsWith('/play/')) {
      return handlePlayRoute(request, url, env, ctx);
    }
    if (url.pathname === '/sitemap.xml') {
      return handleSitemap(url, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};

/**
 * Fetches + merges both catalogs (GameMonetize + GamePix), cached at the
 * edge under one shared key so /api/games and /play/* never issue redundant
 * upstream requests for the same `num`. Returns the raw array — callers
 * decide how to present it (JSON response vs. HTML meta lookup).
 */
async function getCombinedGames(num, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/api/games?num=${num}`, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return { games: await cached.clone().json(), response: cached };
  }

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
    return { games: null, error: { gameMonetize: gmResult.status, gamePix: gpResult.status } };
  }

  const response = jsonResponse(combined, 200, CACHE_TTL_SECONDS);
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return { games: combined, response };
}

async function handleApiGames(url, ctx) {
  const num = clampNum(url.searchParams.get('num'), GM_DEFAULT_NUM, GM_MAX_NUM);
  const { games, response, error } = await getCombinedGames(num, ctx);

  if (!games) {
    return jsonResponse({ error: 'Both game feeds failed', ...error }, 502);
  }
  return response;
}

function clampNum(rawNum, fallback, max) {
  const n = parseInt(rawNum, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

// ----------------------------------------------------------------------------
// Programmatic SEO: /play/{id}/{slug}
//
// Only the {id} segment is read — {slug} exists purely so the URL itself is
// descriptive (a ranking signal, and clearer when shared) and is otherwise
// ignored, so it can never go stale or cause a lookup to fail. The actual
// game.html asset is fetched as-is and then transformed in place with
// Cloudflare's native HTMLRewriter (a streaming parser, not fragile string
// splicing) to set a per-game <title>, meta description, and Open Graph /
// Twitter Card tags before it ever reaches the browser or a crawler — so
// each of these thousands of URLs is a genuinely distinct, indexable page
// from one shared codebase.
// ----------------------------------------------------------------------------

async function handlePlayRoute(request, url, env, ctx) {
  const segments = url.pathname.split('/').filter(Boolean); // ['play', '<id>', '<slug>']
  const gameId = segments[1] ? decodeURIComponent(segments[1]) : null;

  const assetRequest = new Request(new URL('/game.html', url.origin), request);
  const assetResponse = await env.ASSETS.fetch(assetRequest);

  if (!gameId) return assetResponse;

  const num = clampNum(url.searchParams.get('num'), GM_DEFAULT_NUM, GM_MAX_NUM);
  const { games } = await getCombinedGames(num, ctx);
  const allGames = [...LOCAL_GAMES, ...(games || [])];
  const game = allGames.find((g) => String(g.id) === gameId);

  // Unknown id (bad/old link, or upstream hiccup) — serve the page as-is;
  // the client-side player.js will show its own "invalid link" state.
  if (!game) return assetResponse;

  const seoTitle = `Play ${game.title} Free, No Download - ${SITE_NAME}`;
  const seoDescription = `Play ${game.title} free online at ${SITE_NAME}. ${game.category} game, no install — just play, have fun, right in your browser.`;
  const canonicalUrl = `${url.origin}/play/${encodeURIComponent(game.id)}/${slugify(game.title)}`;
  const imageUrl = absoluteUrl(game.thumb, url.origin);

  const headExtra = `
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtmlAttr(SITE_NAME)}">
<meta property="og:title" content="${escapeHtmlAttr(seoTitle)}">
<meta property="og:description" content="${escapeHtmlAttr(seoDescription)}">
<meta property="og:image" content="${escapeHtmlAttr(imageUrl)}">
<meta property="og:url" content="${escapeHtmlAttr(canonicalUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtmlAttr(seoTitle)}">
<meta name="twitter:description" content="${escapeHtmlAttr(seoDescription)}">
<meta name="twitter:image" content="${escapeHtmlAttr(imageUrl)}">
<link rel="canonical" href="${escapeHtmlAttr(canonicalUrl)}">
<script>window.__GIMBOOT_PLAY_ID__ = ${JSON.stringify(String(game.id)).replace(/</g, '\\u003c')};</script>
`;

  return new HTMLRewriter()
    .on('title', new SetTextContent(seoTitle))
    .on('meta[name="description"]', new SetAttribute('content', seoDescription))
    .on('head', new AppendHtml(headExtra))
    .transform(assetResponse);
}

class SetTextContent {
  constructor(text) { this.text = text; }
  element(element) { element.setInnerContent(this.text); }
}

class SetAttribute {
  constructor(name, value) { this.name = name; this.value = value; }
  element(element) { element.setAttribute(this.name, this.value); }
}

class AppendHtml {
  constructor(html) { this.html = html; }
  element(element) { element.append(this.html, { html: true }); }
}

function absoluteUrl(maybeRelative, origin) {
  if (!maybeRelative) return '';
  try {
    return new URL(maybeRelative, origin).toString();
  } catch {
    return maybeRelative;
  }
}

function escapeHtmlAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Mirrors js/utils.js's slugify exactly — keep the two in sync. */
function slugify(text) {
  return (
    String(text ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'game'
  );
}

// ----------------------------------------------------------------------------
// Sitemap — lets search engines discover every /play/ URL without needing
// to first crawl the catalog grid's client-rendered links.
// ----------------------------------------------------------------------------

async function handleSitemap(url, ctx) {
  const { games } = await getCombinedGames(GM_DEFAULT_NUM, ctx);
  const allGames = [...LOCAL_GAMES, ...(games || [])];

  const urlEntries = [
    `<url><loc>${escapeHtmlAttr(url.origin)}/</loc><changefreq>daily</changefreq></url>`,
    ...allGames.map((g) => {
      const loc = `${url.origin}/play/${encodeURIComponent(g.id)}/${slugify(g.title)}`;
      return `<url><loc>${escapeHtmlAttr(loc)}</loc><changefreq>weekly</changefreq></url>`;
    }),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries.join('\n')}\n</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
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
  // Exactly the URL pattern confirmed from your GamePix dashboard — no
  // extra query params guessed on top of it. An earlier version of this
  // file added `&order=quality`, inferred from the dashboard's "Games
  // Order By" label rather than confirmed documentation; removed since it
  // was never actually verified and could cause the request to be rejected.
  const feedUrl = `${GAMEPIX_FEED_BASE}?sid=${GAMEPIX_SID}&pagination=${GAMEPIX_PAGINATION}&page=1`;
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
