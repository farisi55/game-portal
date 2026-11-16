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

import {
  SITE_NAME,
  SITE_ORIGIN,
  SITE_ROOT,
  absoluteUrl,
  decodeEntities,
  escapeHtmlAttr,
  escapeJsonLd,
  gameCanonicalPath,
  gameCanonicalUrl,
  renderGamePage,
  slugify,
  AppendHtml,
  RemoveElement,
  SetAttribute,
} from '../functions/game.js';

export {
  decodeEntities,
  escapeHtmlAttr,
  escapeJsonLd,
  gameCanonicalPath,
  gameCanonicalUrl,
  slugify,
};

const WORKER_VERSION = '1.0.6';

const GM_FEED_BASE = 'https://gamemonetize.com/feed.php';
const CATALOG_DEFAULT_NUM = 50;
const CATALOG_MAX_NUM = 200;

const GAMEPIX_FEED_BASE = 'https://feeds.gamepix.com/v2/json';
const GAMEPIX_DEFAULT_SID = '985I2';
const GAMEPIX_PAGINATION_OPTIONS = [12, 24, 48, 96];

const CACHE_TTL_SECONDS = 1800; // 30 menit
// SITE_ORIGIN / SITE_ROOT are imported from functions/game.js. Canonical host
// is always the production custom domain — never the request host. Preview /
// workers.dev deployments must not compete with gimboot.com in search.
const ALLOWED_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * True for localhost addresses. Production hardening (upgrade-insecure-requests
 * in the CSP + the unconditional http→https 301) must NOT fire on loopback
 * hosts — wrangler dev binds to 127.0.0.1 and serves a self-signed cert, so
 * forcing HTTPS there would break local development and the E2E suite.
 */
export function isLoopbackHost(hostname) {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '[::1]' ||
    lower === '0.0.0.0'
  );
}

// Minimal env-var validation helper — fails fast with a clear error if a
// required var is missing. Intended for the first real vars added later;
// currently serves as a scaffold that can be expanded without changing
// the rest of the worker code.
// eslint-disable-next-line no-unused-vars
function requireEnvVar(name, val) {
  if (!val) {
    throw new Error('Missing required environment variable: ' + name);
  }
}

function structuredLog(level, message, extra = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...extra };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.warn(JSON.stringify(entry));
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLimitedText(response, maxBytes = MAX_BODY_BYTES) {
  const rawText = await response.text();
  if (rawText.length > maxBytes) {
    throw new Error('Response body exceeds ' + maxBytes + ' bytes');
  }
  return rawText;
}

async function isRateLimited(ip) {
  try {
    const cache = caches.default;
    const key = new Request('https://rate-limit/internal/' + ip);
    const cached = await cache.match(key);
    const now = Date.now();
    let count = 1;
    let expires = now + RATE_LIMIT_WINDOW_MS;
    if (cached) {
      const data = await cached.json();
      if (now < data.expires) {
        count = data.count + 1;
        expires = data.expires;
      }
    }
    if (count > RATE_LIMIT_MAX) return true;
    const resp = new Response(JSON.stringify({ count, expires }), {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
    await cache.put(key, resp);
    return false;
  } catch {
    return false;
  }
}

// `_headers` is useful for static hosting, but Worker-with-assets deployments
// do not consistently apply it to every response. Enforce the same policy at
// the Worker boundary so HTML, JavaScript, API, and game routes all share it.
 const SECURITY_HEADERS = {
   'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
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
    description:
      'Kicau Mania adalah game arcade santai tentang melatih burung kicau. Ketuk pada momen yang tepat untuk menjaga irama kicau, kumpulkan skor sebanyak mungkin, dan kalahkan rekor pemain lain. Cocok dimainkan sebentar-sebentar di ponsel maupun desktop.',
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
    description:
      'Ayo ke Kopdes mengajak Anda berbelanja di minimarket desa. Ambil barang yang ada di daftar belanja, hindari keranjang yang salah, dan selesaikan pesanan sebelum waktu habis. Game arcade ringan yang mudah dipahami dan seru untuk semua usia.',
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
    description:
      'Mobil MBG adalah game menyetir santai bertema pengantaran makanan. Kemudikan mobil retro, hindari rintangan, dan antar pesanan tepat waktu. Kontrol sederhana, tempo cepat, dan tantangan yang cocok untuk permainan singkat di browser.',
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
    description:
      'Kejar Koruptor adalah game arcade kejar-kejaran yang seru. Bergerak cepat, hindari polisi, dan tangkap koruptor yang kabur. Setiap ronde menghadirkan tantangan baru dengan kontrol keyboard atau layar sentuh yang responsif.',
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
    description:
      'Mainkan Solitaire Klondike klasik langsung di browser. Susun kartu ke foundation, buka kartu tertutup, dan pindahkan kartu antar-tumpukan dengan klik atau ketuk. Tidak perlu instal, tidak perlu akun, dan bisa dimainkan di desktop maupun ponsel.',
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
    description:
      'Moba DOTA adalah game MOBA 3D yang dimainkan langsung di browser. Pilih karakter, kendalikan hero dengan WASD dan mouse, lalu bertarung untuk menguasai medan. Grafis tiga dimensi dan kontrol responsif tanpa perlu download atau instal.',
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
    description:
      'Bantu Miko si kucing menemukan ikan di dalam labirin. Jelajahi lima tingkat kesulitan dengan kontrol mouse, keyboard, tombol arah, atau layar sentuh. Selesaikan labirin, catat waktu terbaik, dan lanjutkan ke tantangan berikutnya.',
    url: '/games/pawzle-maze/index.html?embed=1&parentOrigin=https%3A%2F%2Fgimboot.com',
    thumb: '/games/pawzle-maze/thumb.svg',
    width: 960,
    height: 720,
    source: 'No Ads',
  },
];

// Maps a first-party game shell folder (/games/<slug>) to the public SEO
// landing page that should be indexed instead of the raw iframe document.
// Derived from LOCAL_GAMES so the two can never drift apart.
const LOCAL_GAME_CANONICALS = Object.fromEntries(
  LOCAL_GAMES.map((game) => {
    const folder = new URL(game.url, SITE_ORIGIN).pathname.replace(/\/index\.html$/i, '');
    return [folder, `/play/${encodeURIComponent(game.id)}/${slugify(game.title)}`];
  }),
);

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (await isRateLimited(clientIp)) {
      return withSecurityHeaders(
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
        }),
        requestId,
        url.hostname,
        url.pathname,
      );
    }

    let response;
    let canonicalUrl = '';

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
    } else if (/^\/index\.html?$/i.test(url.pathname)) {
      // /index.html and /index.htm are duplicates of the root document.
      // Tracking/query params are irrelevant on the root page, so drop them.
      response = redirectSingleHop(url, '/', false);
    } else if (/^\/game\.html(\/.*)?$/i.test(url.pathname)) {
      // Legacy shell (including trailing/wildcard paths): exactly one 301 hop
      // to the canonical /play URL (query string dropped). No
      // /game.html -> /game -> /play chain. A shell with no ?id= goes back to
      // the catalog instead of becoming an indexable thin page.
      response = await handleLegacyGameHtmlRoute(request, url, env, ctx);
    } else if (/^\/game\/?$/.test(url.pathname)) {
      // Legacy query-param player. Validate the id against the live catalog,
      // then 301 to the canonical /play URL. Missing/unknown ids are 404s so
      // Google never indexes an empty shell or an error page.
      // `/game/` is included so the asset layer's trailing-slash
      // normalization cannot insert an extra 307 ahead of the 301.
      response = await handleGameRoute(request, url, env, ctx);
    } else if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
      const httpsUrl = new URL(url);
      httpsUrl.protocol = 'https:';
      response = Response.redirect(httpsUrl.toString(), 301);
    } else if (url.pathname === '/api/health') {
      response = handleApiHealth();
    } else if (url.pathname === '/api/games') {
      response = await handleApiGames(url, env, ctx, requestId);
    } else if (url.pathname === '/api/search') {
      response = await handleApiSearch(url, env, ctx, requestId);
    } else if (url.pathname.startsWith('/share/')) {
      response = await handleShareRoute(request, url, env, ctx, requestId);
    } else if (url.pathname.startsWith('/play/')) {
      response = await handlePlayRoute(request, url, env, ctx, requestId);
    } else if (url.pathname === '/play' || url.pathname === '/play/') {
      // /play without a game id is not a page. 404 rather than serving the
      // generic shell (soft-404 / "duplicate without canonical" in GSC).
      response = await notFoundResponse(request, env);
    } else if (/^\/404(?:\.html)?$/i.test(url.pathname)) {
      // The error document itself is not a public page. Cloudflare can serve
      // /404.html at /404 with a 200, so make both spellings a real 404 and
      // never let a canonical be injected into them.
      response = await notFoundResponse(request, env);
    } else if (url.pathname === '/sitemap.xml') {
      response = await handleSitemap(url, env, ctx, requestId);
    } else {
      response = await env.ASSETS.fetch(request);

      // Unknown extensionless paths must be a real, branded 404 — never a
      // 200 shell. Asset requests (missing .js/.css/images) keep the asset
      // server's bare 404 so callers still see the correct content type.
      if (response.status === 404 && wantsHtml(request, url)) {
        response = await notFoundResponse(request, env);
      } else if (response.status === 200 && isHtmlResponse(response)) {
        canonicalUrl = canonicalUrlForStaticPage(url);
      }
    }

    return withSecurityHeaders(response, requestId, url.hostname, url.pathname, canonicalUrl);
  },
};

// ----------------------------------------------------------------------------
// GET /api/health — Lightweight liveness check.
//
// Returns immediately with no external I/O (no upstream fetch, no cache
// lookup) so the response is always <100ms regardless of feed availability.
// Suitable for uptime monitors and the Phase 7 load-test smoke probe.
//
// Response shape:
//   { status: "ok", version: "<semver>", timestamp: "<ISO 8601>" }
//
// Note on "uptime": Cloudflare Workers are per-request — there is no
// persistent process whose start time could be measured. `timestamp` (the
// current request time) is the closest meaningful equivalent for an edge
// deployment and avoids surfacing a misleading 0 or near-0 value.
// ----------------------------------------------------------------------------
function handleApiHealth() {
  return jsonResponse(
    {
      status: 'ok',
      version: WORKER_VERSION,
      timestamp: new Date().toISOString(),
    },
    200,
    0, // no-cache: health checks must reflect current state, not a stale snapshot
  );
}

function withSecurityHeaders(response, requestId = '', hostname = '', pathname = '', canonicalUrl = '') {
  const headers = new Headers(response.headers);
  const nonce = isHtmlResponse(response) ? createNonce() : null;
  let body = response.body;

  if (nonce) {
    let rewriter = new HTMLRewriter().on('script', new SetAttribute('nonce', nonce));

    // Server-rendered canonical for static HTML. Remove any hand-written
    // canonical first so a page can never emit two conflicting tags.
    if (canonicalUrl) {
      rewriter = rewriter
        .on('link[rel="canonical"]', new RemoveElement())
        .on('head', new AppendHtml(`<link rel="canonical" href="${escapeHtmlAttr(canonicalUrl)}">`));
    }

    body = rewriter.transform(response).body;
    headers.delete('Content-Length');
    headers.delete('Content-Encoding');
    headers.delete('ETag');
  }

  headers.set('Content-Security-Policy', buildContentSecurityPolicy(nonce, hostname, pathname));

  // Task #024: cross-origin isolate /emulator/* so SharedArrayBuffer is
  // exposed and thread-required cores (PPSSPP, DOSBox Pure) can boot.
  // Scoped strictly to emulator paths — the catalog / play / game pages
  // stay non-isolated, so third-party game iframes are unaffected.
  // COOP/COEP are only meaningful on documents; harmless on assets.
  if (pathname.startsWith('/emulator')) {
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  if (requestId) {
    headers.set('x-request-id', requestId);
  }
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

/**
 * True when a 404 should be rendered as an HTML page rather than returned as
 * a bare asset miss. Browser navigations declare text/html; extensionless
 * paths are also treated as pages. A request for `/missing.js` keeps the
 * asset server's plain 404 so script loaders and monitors still get a
 * non-HTML body.
 */
function wantsHtml(request, url) {
  const accept = (request.headers.get('accept') || '').toLowerCase();
  const destination = (request.headers.get('sec-fetch-dest') || '').toLowerCase();
  if (accept.includes('text/html') || destination === 'document' || destination === 'iframe') {
    return true;
  }
  const lastSegment = url.pathname.split('/').pop() || '';
  return !/\.[a-z0-9]{2,8}$/i.test(lastSegment);
}

function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildContentSecurityPolicy(nonce, hostname = '', pathname = '') {
  const isEmulatorPath = pathname.startsWith('/emulator/');

  // EmulatorJS's runtime uses eval() for dynamic code (game-specific logic).
  // 'unsafe-eval' is added to script-src only on /emulator/* paths.
  const scriptSource = nonce
    ? `'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isEmulatorPath ? " 'unsafe-eval'" : ''}`
    : "'none'";
  const scriptElementSource = nonce ? `'nonce-${nonce}' 'strict-dynamic'` : "'none'";

  // upgrade-insecure-requests rewrites same-origin http:// URLs (including
  // iframe src) to https:// in the browser. On loopback (wrangler dev /
  // the E2E suite) the Worker serves plain HTTP, so the directive would
  // upgrade the /emulator iframe src to https://127.0.0.1:PORT — which the
  // browser then blocks as a frame-src 'self' violation. Skip it on loopback,
  // mirroring the loopback-gated http→https 301 below.
  const upgradeDirective = isLoopbackHost(hostname) ? '' : ' upgrade-insecure-requests';

  // EmulatorJS applies inline styles programmatically (element.style.x),
  // creates blob: workers, and fetches a version-check from the CDN.
  // The /emulator/* path gets a relaxed CSP; all other paths keep the
  // strict policy.
  const styleSrcAttr = isEmulatorPath ? "'unsafe-inline'" : "'none'";
  const workerSrc = isEmulatorPath ? "'self' blob:" : "'self'";
  const connectSrc = isEmulatorPath
    ? "'self' blob: https://cdn.emulatorjs.org"
    : "'self'";

  return `default-src 'self'; script-src ${scriptSource}; script-src-elem ${scriptElementSource}; script-src-attr 'none'; style-src 'self'; style-src-elem 'self'; style-src-attr ${styleSrcAttr}; worker-src ${workerSrc}; font-src 'self' data:; img-src 'self' https: data:; connect-src ${connectSrc}; frame-src 'self' https://html5.gamemonetize.co https://*.gamemonetize.co https://gamemonetize.com https://*.gamemonetize.com https://play.gamepix.com https://*.gamepix.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self';${upgradeDirective}`;
}

/**
 * Fetches + merges both catalogs (GameMonetize + GamePix), cached at the
 * edge under one shared key so /api/games and /play/* never issue redundant
 * upstream requests for the same `num`. Returns the raw array — callers
 * decide how to present it (JSON response vs. HTML meta lookup).
 */
export async function getCombinedGames(num, env, ctx) {
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
    structuredLog('error', 'GameMonetize feed failed', { reason: String(gmResult.reason) });
  }
  if (gpResult.status === 'rejected') {
    structuredLog('error', 'GamePix feed failed', { reason: String(gpResult.reason) });
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

/** Handles GET /api/games — returns merged catalog from all sources. */
export async function handleApiGames(url, env, ctx, _requestId = '') {
  const num = clampNum(url.searchParams.get('num'), CATALOG_DEFAULT_NUM, CATALOG_MAX_NUM);
  const { games, response, error } = await getCombinedGames(num, env, ctx);

  if (!games) {
    return jsonResponse({ error: 'Both game feeds failed', ...error }, 502);
  }
  const hasPagination = url.searchParams.has('page');
  if (hasPagination) {
    const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
    const limit = clampNum(url.searchParams.get('limit') || num, 1, CATALOG_MAX_NUM);
    const start = (page - 1) * limit;
    const paged = games.slice(start, start + limit);
    return jsonResponse({ games: paged, pagination: { page, limit, total: games.length } }, 200, CACHE_TTL_SECONDS);
  }
  return response;
}

// ----------------------------------------------------------------------------
// /api/search?q={query} — Hybrid search fallback proxy.
//
// Queries the publisher feed for games matching the query string. Used by
// the frontend when a local in-memory search returns zero matches.
// ----------------------------------------------------------------------------

/** Handles GET /api/search?q={query} — filters the merged catalog by query. */
export async function handleApiSearch(url, env, ctx) {
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
    structuredLog('error', 'Search API failed', { error: String(error) });
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

export async function handleShareRoute(request, url, env, ctx) {
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

    const targetUrl = `${SITE_ORIGIN}/play/${encodeURIComponent(game.id)}/${slugify(game.title)}`;

    const imageUrl = absoluteUrl(game.thumb, SITE_ORIGIN);
    const description = `Play ${game.title} free online at ${SITE_NAME}. ${game.category} game, no install — just play, have fun, right in your browser.`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Play ${escapeHtmlAttr(game.title)} on ${SITE_NAME}!</title>
  <meta name="robots" content="noindex, follow">

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
        // /share/{id} is a social-card endpoint with a meta refresh, not a
        // search landing page. Keep it out of the index and pass authority to
        // the canonical /play URL it points at.
        'X-Robots-Tag': 'noindex, follow',
      },
    });
  } catch (error) {
    console.error('Error fetching game data:', error);
    return Response.redirect(new URL('/', url), 302);
  }
}

/** Parses a raw numeric query-param, clamps it to [1, max], or returns fallback. */
export function clampNum(rawNum, fallback, max) {
  const n = parseInt(rawNum, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

// ----------------------------------------------------------------------------
// Programmatic SEO: /play/{id}/{slug}
//
// Only the {id} segment is used for the catalog lookup. The {slug} is
// validated against the title-derived slug so exactly one URL can return 200;
// a missing/stale slug, trailing slash, or any query string gets a single 301
// to the canonical form. The game.html asset is fetched as-is and transformed
// in place with Cloudflare's native HTMLRewriter (a streaming parser, not
// fragile string splicing) to set a per-game <title>, meta description,
// canonical, Open Graph/Twitter tags, JSON-LD, and visible body copy before it
// ever reaches the browser or a crawler — so each of these thousands of URLs
// is a genuinely distinct, indexable page from one shared codebase.
// ----------------------------------------------------------------------------

/** Single-hop redirect: HTTPS + pathname normalization in one 301. */
export function redirectSingleHop(url, pathname, preserveSearch = true) {
  const canonical = new URL(url);
  canonical.protocol = 'https:';
  canonical.pathname = pathname;
  if (!preserveSearch) canonical.search = '';
  canonical.hash = '';
  return Response.redirect(canonical.toString(), 301);
}

/**
 * Canonical for static HTML assets that are not handled by /play or /share.
 * Kept in sync with the server-side canonical injection in withSecurityHeaders.
 * Legacy /game and /game.html return '' — those URLs are either a
 * catalog-validated 301 or a hard 404, never an indexable page.
 */
export function canonicalUrlForStaticPage(url) {
  const path = url.pathname || '/';

  if (path === '/' || /^\/index\.html?$/i.test(path)) return SITE_ROOT;

  if (/^\/game(?:\.html)?(?:\/.*)?$/i.test(path)) return '';

  const directoryKey = path.replace(/\/index\.html?$/i, '').replace(/\/+$/, '');
  if (LOCAL_GAME_CANONICALS[directoryKey]) {
    return SITE_ORIGIN + LOCAL_GAME_CANONICALS[directoryKey];
  }

  if (/\/index\.html?$/i.test(path)) {
    // Directory-style URL: keep the trailing slash so relative assets and
    // Cloudflare's auto-trailing-slash routing both stay correct.
    return SITE_ORIGIN + path.replace(/index\.html?$/i, '');
  }

  const noSlash = path.replace(/\/+$/, '') || '/';
  if (/^\/games\/[^/]+$/i.test(noSlash) || noSlash === '/emulator') {
    return `${SITE_ORIGIN}${noSlash}/`;
  }

  return `${SITE_ORIGIN}${noSlash.replace(/\.html?$/i, '')}`;
}

/**
 * Legacy game shell route. /game.html and /game.html/* never render HTML:
 * they resolve the id to a real catalog game and 301 straight to /play in a
 * single hop. A shell with no id has no canonical destination, so it goes
 * back to the catalog. Unknown ids are 404s, not soft-404 shells.
 */
export async function handleLegacyGameHtmlRoute(request, url, env, ctx) {
  const gameId = (url.searchParams.get('id') || '').trim();
  if (!gameId) return redirectSingleHop(url, '/', false);
  return handleGameRoute(request, url, env, ctx);
}

/**
 * Legacy /game?id= route. The id is the ONLY parameter that is read; every
 * other query parameter is deliberately ignored and dropped by the redirect.
 * The response is never a 200 HTML shell:
 *   - valid id      -> 301 /play/{id}/{slug}
 *   - unknown id    -> 404 (noindex)
 *   - catalog down  -> 503 (temporary; do not deindex the game)
 *   - missing id    -> 404
 */
export async function handleGameRoute(request, url, env, ctx) {
  const gameId = (url.searchParams.get('id') || '').trim();
  if (!gameId) return notFoundResponse(request, env);

  const resolution = await resolveGameById(gameId, env, ctx);
  if (resolution.status === 'unavailable') return serviceUnavailableResponse(request);
  if (!resolution.game) return notFoundResponse(request, env);

  return redirectSingleHop(url, gameCanonicalPath(resolution.game), false);
}

/**
 * Canonical game page: /play/{id}/{slug}. Resolves the id against LOCAL_GAMES
 * first, then the live merged catalog. Renders the shell server-side so
 * Googlebot gets unique title/meta/OG/JSON-LD and visible body text without
 * executing JavaScript.
 */
export async function handlePlayRoute(request, url, env, ctx) {
  const segments = url.pathname.split('/').filter(Boolean); // ['play', '<id>', '<slug>']
  let gameId;
  try {
    gameId = segments[1] ? decodeURIComponent(segments[1]) : null;
  } catch {
    gameId = null;
  }
  if (!gameId) return notFoundResponse(request, env);

  const resolution = await resolveGameById(gameId, env, ctx);
  if (resolution.status === 'unavailable') return serviceUnavailableResponse(request);
  if (!resolution.game) return notFoundResponse(request, env);

  const game = resolution.game;
  const canonicalPath = gameCanonicalPath(game);

  // Enforce exactly one canonical game URL: correct slug, no trailing slash,
  // no extra path segments, and no query parameters. This prevents the
  // parameter-bloat / duplicate-URL patterns that caused the GSC report:
  //   /play/{id}                    (missing slug)
  //   /play/{id}/{wrong-slug}       (title changed)
  //   /play/{id}/{slug}/            (trailing slash)
  //   /play/{id}/{slug}?utm=...     (tracking parameters)
  if (url.pathname !== canonicalPath || url.search) {
    return redirectSingleHop(url, canonicalPath, false);
  }

  // Cloudflare Workers Assets' default html_handling canonicalizes
  // /game.html to /game with a 307. Fetch the canonical shell path directly so
  // HTMLRewriter receives actual HTML instead of a redirect.
  //
  // IMPORTANT: `_redirects` is also applied to env.ASSETS.fetch(). Do NOT add
  // `/game` or `/game.html` rules there — an internal 301 would make this
  // fetch non-OK and every /play page would return 503. The legacy redirects
  // live in this Worker, which runs first for public requests.
  const assetResponse = await env.ASSETS.fetch(new Request('https://assets.local/game', request));
  if (!assetResponse.ok || !isHtmlResponse(assetResponse)) {
    return serviceUnavailableResponse(request);
  }

  return renderGamePage(assetResponse, game, {
    origin: SITE_ORIGIN,
    siteName: SITE_NAME,
  });
}

/** Resolves a game id against first-party games, then the merged catalog. */
export async function resolveGameById(gameId, env, ctx) {
  if (!gameId) return { game: null, status: 'missing' };

  const localGame = LOCAL_GAMES.find((game) => String(game.id) === gameId);
  if (localGame) return { game: localGame, status: 'ok' };

  try {
    const { games } = await getCombinedGames(CATALOG_MAX_NUM * 2, env, ctx);
    if (!games) return { game: null, status: 'unavailable' };

    const game = games.find((item) => String(item.id) === gameId);
    return { game: game || null, status: game ? 'ok' : 'notfound' };
  } catch (error) {
    structuredLog('error', 'Game catalog lookup failed', { reason: String(error) });
    return { game: null, status: 'unavailable' };
  }
}

const FALLBACK_404_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Game Tidak Ditemukan — Gimboot</title>
<meta name="robots" content="noindex, follow">
<link rel="stylesheet" href="/css/style.css">
</head>
<body>
<header class="site-header">
  <div class="header-inner">
    <a href="/" class="brand-lockup"><span class="brand-text"><span class="wordmark">GIMBOOT</span><span class="tagline">No Install, Just Play, Have Fun</span></span></a>
  </div>
</header>
<main>
  <div class="status-block">
    <p class="status-title">Game tidak ditemukan</p>
    <p class="status-subtitle">Game yang Anda cari tidak ada di katalog atau sudah tidak tersedia.</p>
    <a class="btn btn--primary" href="/">Kembali ke Katalog</a>
  </div>
</main>
<footer class="site-footer"><p>Gimboot — no install, just play, have fun.</p></footer>
</body>
</html>`;

/**
 * Branded 404 with a hard 404 status and noindex. Prefers the static
 * /404.html asset when available, so Cloudflare's not_found_handling and this
 * route share the same page. Never gets a canonical tag injected.
 */
export async function notFoundResponse(request, env) {
  let html = FALLBACK_404_HTML;
  try {
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      // Fetch the extensionless path: html_handling ("auto-trailing-slash")
      // serves 404.html there, whereas /404.html itself can answer with a 307.
      const asset = await env.ASSETS.fetch(
        new Request('https://assets.local/404', {
          method: 'GET',
          headers: { Accept: 'text/html' },
        })
      );
      if (asset.ok && isHtmlResponse(asset)) {
        const text = await asset.text();
        if (text.trim()) html = text;
      }
    }
  } catch {
    // fall back to the inline 404 page
  }

  return new Response(request.method === 'HEAD' ? null : html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, follow',
    },
  });
}

/**
 * 503 for the case where the upstream catalog cannot be reached and the id is
 * not a first-party game. Returning 503 instead of 404 tells Google the URL
 * is temporarily unverifiable, so a feed outage can never deindex a valid
 * game page.
 */
export function serviceUnavailableResponse(request) {
  const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sementara Tidak Tersedia — Gimboot</title>
<link rel="stylesheet" href="/css/style.css">
</head>
<body>
<header class="site-header"><div class="header-inner"><a href="/" class="brand-lockup"><span class="brand-text"><span class="wordmark">GIMBOOT</span><span class="tagline">No Install, Just Play, Have Fun</span></span></a></div></header>
<main><div class="status-block"><p class="status-title">Katalog sedang dimuat ulang</p><p class="status-subtitle">Coba muat ulang halaman ini beberapa saat lagi.</p><a class="btn btn--primary" href="/">Kembali ke Katalog</a></div></main>
<footer class="site-footer"><p>Gimboot — no install, just play, have fun.</p></footer>
</body>
</html>`;

  return new Response(request.method === 'HEAD' ? null : html, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '3600',
    },
  });
}

// ----------------------------------------------------------------------------
// Sitemap — lets search engines discover every /play/ URL without needing
// to first crawl the catalog grid's client-rendered links.
// ----------------------------------------------------------------------------

async function handleSitemap(_url, env, ctx) {
  const { games } = await getCombinedGames(CATALOG_MAX_NUM, env, ctx);
  const allGames = [...LOCAL_GAMES, ...(games || [])];

  // Always emit the production custom-domain origin, regardless of the
  // incoming request host/protocol. This keeps workers.dev previews from
  // leaking into the production sitemap. Every game entry is the canonical
  // /play/{id}/{slug} form — never /game?id=, never a .html URL.
  const seenIds = new Set();
  const gameEntries = allGames
    .filter((game) => {
      const id = String(game?.id ?? '');
      if (!id || !game.title || seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    })
    .map((game) => {
      const loc = gameCanonicalUrl(game, SITE_ORIGIN);
      return `<url><loc>${escapeHtmlAttr(loc)}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
    });

  const urlEntries = [
    `<url><loc>${escapeHtmlAttr(SITE_ROOT)}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...gameEntries,
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
  const upstream = await fetchWithTimeout(feedUrl, {
    headers: { Accept: 'application/xml,text/xml,*/*' },
  });

  if (!upstream.ok) {
    throw new Error(`GameMonetize feed responded with ${upstream.status}`);
  }

  const rawText = await fetchLimitedText(upstream);
  const games = parseGameMonetizeFeed(rawText);
  if (games.length === 0) {
    throw new Error('GameMonetize feed produced zero items');
  }
  return games;
}

/** Parses the GameMonetize RSS/XML feed into a normalized game array. */
export function parseGameMonetizeFeed(xml) {
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
      description: tag('description') || tag('instructions') || '',
      url,
      thumb: tag('thumb'),
      width,
      height,
    });
  }

  return items;
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
      description: item.description || item.short_description || item.instructions || '',
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
  const upstream = await fetchWithTimeout(feedUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; GimbootPortal/1.0)',
    },
  });

  if (!upstream.ok) {
    const _bodySnippet = await fetchLimitedText(upstream).catch(() => '');
    structuredLog('error', 'GamePix feed non-OK response', { status: upstream.status });
    throw new Error(`GamePix feed responded with ${upstream.status}`);
  }

  const rawText = await fetchLimitedText(upstream);
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    structuredLog('error', 'GamePix feed returned non-JSON body');
    throw new Error('GamePix feed response was not valid JSON');
  }

  if (!data || !Array.isArray(data.items)) {
    structuredLog('error', 'GamePix feed JSON missing items array');
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
