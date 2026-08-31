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
const CATALOG_DEFAULT_NUM = 50;
const CATALOG_MAX_NUM = 200;

const GAMEPIX_FEED_BASE = 'https://feeds.gamepix.com/v2/json';
const GAMEPIX_DEFAULT_SID = '985I2';
const GAMEPIX_PAGINATION_OPTIONS = [12, 24, 48, 96];

const CACHE_TTL_SECONDS = 1800; // 30 menit
const SITE_NAME = 'Gimboot';
const ALLOWED_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Minimal env-var validation helper — fails fast with a clear error if a
// required var is missing. Intended for the first real vars added later;
// currently serves as a scaffold that can be expanded without changing
// the rest of the worker code.
function requireEnvVar(name, val) {
  if (!val) {
    throw new Error('Missing required environment variable: ' + name);
  }
}

// `_headers` is useful for static hosting, but Worker-with-assets deployments
// do not consistently apply it to every response. Enforce the same policy at
// the Worker boundary so HTML, JavaScript, API, and game routes all share it.
const SECURITY_HEADERS = {
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

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
  {
    id: 'local-ayo-kopdes',
    title: 'Ayo ke Kopdes',
    category: 'Arcade',
    url: '/games/ayo-kopdes/index.html',
    thumb: '/games/ayo-kopdes/thumb.svg',
    width: 960,
    height: 540,
    source: 'Original',
  },
  {
    id: 'local-mobil-mbg',
    title: 'Mobil MBG',
    category: 'Arcade',
    url: '/games/mobil-mbg/index.html',
    thumb: '/games/mobil-mbg/thumb.svg',
    width: 360,
    height: 640,
    source: 'Original',
  },
  {
    id: 'local-kejar-koruptor',
    title: 'Kejar Koruptor',
    category: 'Arcade',
    url: '/games/kejar-koruptor/index.html',
    thumb: '/games/kejar-koruptor/thumb.svg',
    width: 360,
    height: 640,
    source: 'Original',
  },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let response;

    if (!ALLOWED_HTTP_METHODS.has(request.method)) {
      response = new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD, OPTIONS' },
      });
    } else if (request.method === 'OPTIONS') {
      response = new Response(null, {
        status: 204,
        headers: { Allow: 'GET, HEAD, OPTIONS' },
      });
    } else if (url.pathname.toLowerCase() === '/game.html') {
      response = redirectGameHtml(url);
    } else if (url.protocol === 'http:') {
      const httpsUrl = new URL(url);
      httpsUrl.protocol = 'https:';
      response = Response.redirect(httpsUrl.toString(), 301);
    } else if (url.pathname === '/api/games') {
      response = await handleApiGames(url, env, ctx);
    } else if (url.pathname === '/api/search') {
      response = await handleApiSearch(url, env, ctx);
    } else if (url.pathname.startsWith('/share/')) {
      response = await handleShareRoute(request, url, env, ctx);
    } else if (url.pathname.startsWith('/play/')) {
      response = await handlePlayRoute(request, url, env, ctx);
    } else if (url.pathname === '/game') {
      response = await handleGameRoute(request, url, env);
    } else if (url.pathname === '/sitemap.xml') {
      response = await handleSitemap(url, env, ctx);
    } else {
      response = await env.ASSETS.fetch(request);
    }

    return withSecurityHeaders(response);
  },
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  const nonce = isHtmlResponse(response) ? createNonce() : null;
  let body = response.body;

  if (nonce) {
    body = new HTMLRewriter()
      .on('script', new SetAttribute('nonce', nonce))
      .transform(response)
      .body;
    headers.delete('Content-Length');
    headers.delete('Content-Encoding');
    headers.delete('ETag');
  }

  headers.set('Content-Security-Policy', buildContentSecurityPolicy(nonce));
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isHtmlResponse(response) {
  return (response.headers.get('content-type') || '').toLowerCase().includes('text/html');
}

function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildContentSecurityPolicy(nonce) {
  const scriptSource = nonce ? `'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https: http:` : "'none'";
  const scriptElementSource = nonce ? `'nonce-${nonce}'` : "'none'";

  return `default-src 'self'; script-src ${scriptSource}; script-src-elem ${scriptElementSource}; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; worker-src 'self'; font-src 'self' data:; img-src 'self' https: data:; connect-src 'self'; frame-src 'self' https://html5.gamemonetize.co https://*.gamemonetize.co https://gamemonetize.com https://*.gamemonetize.com https://play.gamepix.com https://*.gamepix.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'; upgrade-insecure-requests`;
}

/**
 * Fetches + merges both catalogs (GameMonetize + GamePix), cached at the
 * edge under one shared key so /api/games and /play/* never issue redundant
 * upstream requests for the same `num`. Returns the raw array — callers
 * decide how to present it (JSON response vs. HTML meta lookup).
 */
async function getCombinedGames(num, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/api/games-balanced-v2?num=${num}`, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return { games: await cached.clone().json(), response: cached };
  }

  // Each source is fetched independently — if one feed is down or errors,
  // the other's games still make it to the player instead of the whole
  // catalog going blank.
  // `num` is the total catalog window. Each source supplies half so the
  // browser receives a balanced catalog instead of a GameMonetize-first list.
  const sourceCount = Math.min(CATALOG_MAX_NUM, Math.ceil(num / 2));
  const [gmResult, gpResult] = await Promise.allSettled([
    fetchGameMonetize(sourceCount),
    fetchGamePix(env, sourceCount),
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

async function handleApiGames(url, env, ctx) {
  const num = clampNum(url.searchParams.get('num'), CATALOG_DEFAULT_NUM, CATALOG_MAX_NUM);
  const { games, response, error } = await getCombinedGames(num, env, ctx);

  if (!games) {
    return jsonResponse({ error: 'Both game feeds failed', ...error }, 502);
  }
  return response;
}

// ----------------------------------------------------------------------------
// /api/search?q={query} — Hybrid search fallback proxy.
//
// Queries the publisher feed for games matching the query string. Used by
// the frontend when a local in-memory search returns zero matches.
// ----------------------------------------------------------------------------

async function handleApiSearch(url, env, ctx) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) {
    return jsonResponse({ error: 'Missing required query param "q"' }, 400);
  }

  // Edge cache keyed by query so repeated identical searches hit the cache.
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/api/search?q=${encodeURIComponent(q)}`, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const num = clampNum(url.searchParams.get('num'), CATALOG_DEFAULT_NUM, CATALOG_MAX_NUM);
    const { games } = await getCombinedGames(num, env, ctx);
    const lowerQuery = q.toLowerCase();

    const matches = (games || []).filter((g) =>
      `${g.title} ${g.category}`.toLowerCase().includes(lowerQuery)
    );

    if (matches.length === 0) {
      return jsonResponse([]);
    }

    const response = jsonResponse(matches, 200, 600);
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  } catch (error) {
    console.error('Search API failed:', error);
    return jsonResponse({ error: 'Search failed' }, 502);
  }
}

// ----------------------------------------------------------------------------
// /share/{gameId} — Stateless Open Graph injection for social media bots.
//
// Completely stateless (no KV). Fetches the game catalog, finds the game by
// ID, and returns raw HTML with OG/Twitter meta tags. Human users are
// redirected to the canonical /play/{gameId}/{slug} URL.
// ----------------------------------------------------------------------------

async function handleShareRoute(request, url, env, ctx) {
  const segments = url.pathname.split('/').filter(Boolean); // ['share', '<id>']
  const gameId = segments[1] ? decodeURIComponent(segments[1]) : null;
  if (!gameId) return Response.redirect(new URL('/', url), 302);

  try {
    const num = CATALOG_MAX_NUM * 2;
    const { games } = await getCombinedGames(num, env, ctx);
    const allGames = [...LOCAL_GAMES, ...(games || [])];
    const game = allGames.find((g) => String(g.id) === gameId);

    if (!game) {
      return Response.redirect(new URL('/', url), 302);
    }

    const targetUrl = `${url.origin}/play/${encodeURIComponent(game.id)}/${slugify(game.title)}`;

    const imageUrl = absoluteUrl(game.thumb, url.origin);
    const description = `Play ${game.title} free online at ${SITE_NAME}. ${game.category} game, no install — just play, have fun, right in your browser.`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Play ${escapeHtmlAttr(game.title)} on ${SITE_NAME}!</title>

  <!-- Open Graph / Facebook / Threads -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtmlAttr(SITE_NAME)}">
  <meta property="og:url" content="${escapeHtmlAttr(targetUrl)}">
  <meta property="og:title" content="Play ${escapeHtmlAttr(game.title)} Instantly!">
  <meta property="og:description" content="${escapeHtmlAttr(description)}">
  <meta property="og:image" content="${escapeHtmlAttr(imageUrl)}">

  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtmlAttr(game.title)}">
  <meta name="twitter:description" content="Play ${escapeHtmlAttr(game.title)} free online at ${escapeHtmlAttr(SITE_NAME)}.">
  <meta name="twitter:image" content="${escapeHtmlAttr(imageUrl)}">

  <!-- Redirect for human users (bots typically stop processing here) -->
  <meta http-equiv="refresh" content="0; url=${escapeHtmlAttr(targetUrl)}">
</head>
<body>
  <p>Loading game... <a href="${escapeHtmlAttr(targetUrl)}">Click here</a> if not automatically redirected.</p>
</body>
</html>`;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('Error fetching game data:', error);
    return Response.redirect(new URL('/', url), 302);
  }
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

function redirectGameHtml(url) {
  const clean = new URL(url);
  clean.protocol = 'https:';
  clean.pathname = '/game';
  return Response.redirect(clean.toString(), 301);
}

function canonicalGameUrl(url) {
  const canonical = new URL(url);
  canonical.protocol = 'https:';
  canonical.pathname = '/game';
  canonical.hash = '';
  return canonical;
}

function safeImageUrl(maybeRelative, origin) {
  const abs = absoluteUrl(maybeRelative, origin);
  try {
    const parsed = new URL(abs);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
  } catch {
    // fall through
  }
  return `${origin}/icon-512.png`;
}

async function handleGameRoute(request, url, env) {
  const assetResponse = await env.ASSETS.fetch(new Request('https://assets.local/game', request));
  const title = (url.searchParams.get('title') || 'Game').trim() || 'Game';
  const category = (url.searchParams.get('category') || '').trim();
  const thumb = url.searchParams.get('thumb') || '';
  const canonical = canonicalGameUrl(url);
  const seoTitle = `${title} - Main Gratis di ${SITE_NAME}`;
  const seoDescription = category
    ? `Mainkan ${title}, game ${category} seru secara gratis di ${SITE_NAME}.`
    : `Mainkan ${title} seru secara gratis di ${SITE_NAME}.`;
  const imageUrl = safeImageUrl(thumb, canonical.origin);

  const headExtra = `
<link rel="canonical" href="${escapeHtmlAttr(canonical.toString())}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtmlAttr(SITE_NAME)}">
<meta property="og:title" content="${escapeHtmlAttr(seoTitle)}">
<meta property="og:description" content="${escapeHtmlAttr(seoDescription)}">
<meta property="og:image" content="${escapeHtmlAttr(imageUrl)}">
<meta property="og:url" content="${escapeHtmlAttr(canonical.toString())}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtmlAttr(seoTitle)}">
<meta name="twitter:description" content="${escapeHtmlAttr(seoDescription)}">
<meta name="twitter:image" content="${escapeHtmlAttr(imageUrl)}">
`;

  return new HTMLRewriter()
    .on('title', new SetTextContent(seoTitle))
    .on('meta[name="description"]', new SetAttribute('content', seoDescription))
    .on('head', new AppendHtml(headExtra))
    .transform(assetResponse);
}

async function handlePlayRoute(request, url, env, ctx) {
  const segments = url.pathname.split('/').filter(Boolean); // ['play', '<id>', '<slug>']
  const gameId = segments[1] ? decodeURIComponent(segments[1]) : null;

  // Cloudflare Workers Assets' default html_handling canonicalizes
  // /game.html to /game with a 307. Fetch the canonical path directly so
  // HTMLRewriter receives the actual shell HTML instead of a redirect.
  const assetResponse = await env.ASSETS.fetch(new Request('https://assets.local/game', request));

  if (!gameId) return assetResponse;

  // A shared /play URL must resolve games loaded after the home page's first
  // 50 items too. Use the full catalog window for server-side SEO metadata.
  const num = CATALOG_MAX_NUM * 2;
  const { games } = await getCombinedGames(num, env, ctx);
  const allGames = [...LOCAL_GAMES, ...(games || [])];
  const game = allGames.find((g) => String(g.id) === gameId);

  // Preserve the id even when the feed lookup misses. The client can retry
  // the catalog lookup from the URL, which lets a cached or temporarily
  // incomplete server-side catalog recover without losing the play identity.
  if (!game) {
    const playIdMeta = `<meta name="gimboot-play-id" content="${escapeHtmlAttr(gameId)}">`;
    return new HTMLRewriter()
      .on('head', new AppendHtml(playIdMeta))
      .transform(assetResponse);
  }

  const seoTitle = `Play ${game.title} Free, No Download - ${SITE_NAME}`;
  const seoDescription = `Play ${game.title} free online at ${SITE_NAME}. ${game.category} game, no install — just play, have fun, right in your browser.`;
  const canonicalUrl = `${url.origin}/play/${encodeURIComponent(game.id)}/${slugify(game.title)}`;
  const imageUrl = absoluteUrl(game.thumb, url.origin);

  // JSON-LD structured data — lets Google AI (Gemini/SGE) understand the
  // page content without guessing. Escaped for safe embedding in a <script>
  // tag: HTML entities are NOT parsed inside script data, so we escape the
  // three characters that could terminate the script element instead.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: game.title,
    description: seoDescription,
    genre: game.category,
    playMode: 'SinglePlayer',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Windows, Android, iOS, MacOS',
    gamePlatform: 'Web Browser',
    url: canonicalUrl,
    image: imageUrl,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'IDR',
      category: 'free',
    },
  };
  const jsonLdHtml = `<script type="application/ld+json">${escapeJsonLd(jsonLd)}</script>`;

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
<meta name="gimboot-play-id" content="${escapeHtmlAttr(game.id)}">
<meta name="gimboot-play-url" content="${escapeHtmlAttr(game.url)}">
<meta name="gimboot-play-title" content="${escapeHtmlAttr(game.title)}">
<meta name="gimboot-play-category" content="${escapeHtmlAttr(game.category)}">
<meta name="gimboot-play-image" content="${escapeHtmlAttr(imageUrl)}">
<meta name="gimboot-play-width" content="${escapeHtmlAttr(game.width ?? '')}">
<meta name="gimboot-play-height" content="${escapeHtmlAttr(game.height ?? '')}">
${jsonLdHtml}
`;

  return new HTMLRewriter()
    .on('title', new SetTextContent(seoTitle))
    .on('meta[name="description"]', new SetAttribute('content', seoDescription))
    .on('head', new AppendHtml(headExtra))
    .transform(assetResponse);
}

class SetTextContent {
  constructor(content) { this.content = content; }
  element(element) { element.setInnerContent(this.content); }
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
    .replace(/&/g, '\u0026amp;')
    .replace(/</g, '\u0026lt;')
    .replace(/>/g, '\u0026gt;')
    .replace(/"/g, '\u0026quot;')
    .replace(/'/g, '\u0026#039;');
}

/**
 * Escapes a JSON-LD object for safe embedding inside a <script type="application/ld+json">
 * tag. HTML entities are NOT decoded inside script data, so we must escape the
 * three character sequences that could prematurely terminate the script element:
 * `</script`, `<!--`, and `-->`. JSON.stringify already handles quotes/backslashes.
 */
function escapeJsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
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

async function handleSitemap(url, env, ctx) {
  const { games } = await getCombinedGames(CATALOG_MAX_NUM, env, ctx);
  const allGames = [...LOCAL_GAMES, ...(games || [])];

  const urlEntries = [
    `<url><loc>${escapeHtmlAttr(url.origin)}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...allGames.map((g) => {
      const loc = `${url.origin}/play/${encodeURIComponent(g.id)}/${slugify(g.title)}`;
      return `<url><loc>${escapeHtmlAttr(loc)}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
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

async function fetchGamePix(env, count) {
  // Exactly the URL pattern confirmed from your GamePix dashboard — no
  // extra query params guessed on top of it. An earlier version of this
  // file added `&order=quality`, inferred from the dashboard's "Games
  // Order By" label rather than confirmed documentation; removed since it
  // was never actually verified and could cause the request to be rejected.
  const requestedCount = Math.max(1, Math.floor(Number(count) || 1));
  const pagination = GAMEPIX_PAGINATION_OPTIONS.find((size) => size >= requestedCount) || 96;
  const pageCount = Math.ceil(requestedCount / pagination);
  const feedSid = String(env.GAMEPIX_SID || GAMEPIX_DEFAULT_SID).trim();
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, index) => fetchGamePixPage(feedSid, pagination, index + 1))
  );

  const games = pages
    .flatMap((items) => items)
    .filter((item) => item && item.id && item.title && item.url)
    .map((item) => ({
      id: `gp-${item.id}`,
      title: item.title,
      category: capitalize(item.category) || 'Arcade',
      url: item.url,
      thumb: item.banner_image || item.image || '',
      width: item.width || null,
      height: item.height || null,
    }))
    .filter((game, index, list) => list.findIndex((item) => item.id === game.id) === index)
    .slice(0, requestedCount);

  if (games.length === 0) {
    throw new Error('GamePix feed produced zero usable items');
  }
  return games;
}

async function fetchGamePixPage(feedSid, pagination, page) {
  const feedUrl = `${GAMEPIX_FEED_BASE}?sid=${encodeURIComponent(feedSid)}&pagination=${pagination}&page=${page}`;
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
  } catch {
    console.error('GamePix feed returned non-JSON body:', rawText.slice(0, 300));
    throw new Error('GamePix feed response was not valid JSON');
  }

  if (!data || !Array.isArray(data.items)) {
    console.error('GamePix feed JSON missing items array:', JSON.stringify(data).slice(0, 300));
    throw new Error('GamePix feed response missing an items array');
  }

  return data.items;
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
