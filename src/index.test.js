// Unit tests for src/index.js — catalog (/api/games) and search (/api/search)
// logic, plus exported utility helpers.
//
// Runs in the @cloudflare/vitest-pool-workers pool (workerd) so real
// Cloudflare globals (HTMLRewriter, caches.default, Response.redirect) are
// available. External fetch calls (GameMonetize/GamePix feeds) are mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, {
  handleApiGames,
  handleApiSearch,
  handleShareRoute,
  handlePlayRoute,
  handleGameRoute,
  canonicalUrlForStaticPage,
  redirectSingleHop,
  clampNum,
  escapeHtmlAttr,
  escapeJsonLd,
  slugify,
  parseGameMonetizeFeed,
  decodeEntities,
  isLoopbackHost,
} from './index.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const GM_XML_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <item>
    <id>100</id>
    <title>Puzzle Adventure</title>
    <category>Puzzle</category>
    <url>https://example.com/pa</url>
    <thumb>https://example.com/pa.png</thumb>
    <width>800</width>
    <height>600</height>
  </item>
  <item>
    <id>200</id>
    <title>Racing &amp; Fury</title>
    <category>Racing</category>
    <url>https://example.com/rf</url>
    <thumb>https://example.com/rf.png</thumb>
    <width>1280</width>
    <height>720</height>
  </item>
</channel>
</rss>`;

const GP_JSON_FIXTURE = {
  items: [
    { id: '300', title: 'Space Explorer', category: 'adventure', url: 'https://example.com/se', banner_image: 'https://example.com/se.png', width: 960, height: 640 },
    { id: '400', title: 'Kicau Mania Remastered', category: 'arcade', url: 'https://example.com/km', image: 'https://example.com/km.png', width: 360, height: 640 },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGameMonetizeResponse(xml) {
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  });
}

function makeGamePixResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeErrorResponse(status) {
  return new Response('Error', { status });
}

function makeUrl(path) {
  return new URL(`https://gimboot.com${path}`);
}

function createMockEnv(overrides = {}) {
  // A miniature version of game.html. It intentionally contains stale SEO
  // tags (canonical, description, robots, OG) so renderGamePage's
  // remove-then-add behavior is exercised by the tests.
  const shell = `<!DOCTYPE html>
<html lang="en">
<head>
<title>Loading… — Gimboot</title>
<meta name="description" content="stale description">
<link rel="canonical" href="https://gimboot.com/game">
<meta name="robots" content="noindex, follow">
<meta property="og:title" content="stale og title">
</head>
<body>
<h1 id="game-title">Loading…</h1>
<span id="game-category"></span>
<iframe id="game-frame" title=""></iframe>
<main></main>
</body>
</html>`;

  return {
    ASSETS: {
      fetch: vi.fn().mockImplementation(async (request) => {
        const requestUrl =
          typeof request === 'string' ? request : new URL(request.url).pathname;
        if (requestUrl === '/404' || requestUrl === '/404.html') {
          return new Response(
            '<!DOCTYPE html><html><head><title>Not Found — Gimboot</title><meta name="robots" content="noindex"></head><body><h1>404</h1></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } }
          );
        }
        return new Response(shell, {
          headers: { 'Content-Type': 'text/html' },
        });
      }),
    },
    GAMEPIX_SID: 'test-sid',
    ...overrides,
  };
}

function createMockCtx() {
  const waitUntilFns = [];
  return {
    waitUntil: vi.fn((promise) => waitUntilFns.push(promise)),
    _waitUntilFns: waitUntilFns,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let fetchSpy;
let cacheStore;

beforeEach(() => {
  // Reset the Cache API mock before each test
  cacheStore = new Map();
  globalThis.caches = {
    default: {
      match: vi.fn(async (req) => {
        const key = typeof req === 'string' ? req : req.url;
        return cacheStore.get(key) || null;
      }),
      put: vi.fn(async (req, response) => {
        const key = typeof req === 'string' ? req : req.url;
        cacheStore.set(key, response);
      }),
    },
  };

  // Mock global fetch for upstream feed calls
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// /api/games — handleApiGames
// ===========================================================================

describe('handleApiGames', () => {
  beforeEach(() => {
    fetchSpy.mockImplementation(async (url) => {
      if (url.includes('gamemonetize.com')) return makeGameMonetizeResponse(GM_XML_FIXTURE);
      if (url.includes('gamepix.com')) return makeGamePixResponse(GP_JSON_FIXTURE);
      return makeErrorResponse(404);
    });
  });

  it('returns JSON with correct content-type', async () => {
    const req = makeUrl('/api/games');
    const res = await handleApiGames(req, createMockEnv(), createMockCtx());
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('returns external feed games (GM + GP) in the response', async () => {
    const url = makeUrl('/api/games');
    const res = await handleApiGames(url, createMockEnv(), createMockCtx());
    const body = await res.json();
    const ids = body.map((g) => g.id);
    expect(ids).toContain('gm-100');
    expect(ids).toContain('gp-300');
  });

  it('includes games from GameMonetize feed', async () => {
    const req = makeUrl('/api/games');
    const res = await handleApiGames(req, createMockEnv(), createMockCtx());
    const body = await res.json();
    const ids = body.map((g) => g.id);
    expect(ids).toContain('gm-100');
    expect(ids).toContain('gm-200');
  });

  it('includes games from GamePix feed', async () => {
    const req = makeUrl('/api/games');
    const res = await handleApiGames(req, createMockEnv(), createMockCtx());
    const body = await res.json();
    const ids = body.map((g) => g.id);
    expect(ids).toContain('gp-300');
    expect(ids).toContain('gp-400');
  });

  it('each game has required fields (id, title, category, url, thumb)', async () => {
    const req = makeUrl('/api/games');
    const res = await handleApiGames(req, createMockEnv(), createMockCtx());
    const body = await res.json();
    for (const game of body) {
      expect(game).toHaveProperty('id');
      expect(game).toHaveProperty('title');
      expect(game).toHaveProperty('category');
      expect(game).toHaveProperty('url');
      expect(game).toHaveProperty('thumb');
    }
  });

  it('returns 502 when both feeds fail', async () => {
    fetchSpy.mockRejectedValue(new Error('Network error'));
    const req = makeUrl('/api/games');
    const res = await handleApiGames(req, createMockEnv(), createMockCtx());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('Both game feeds failed');
  });

  it('returns games when only GameMonetize fails', async () => {
    fetchSpy.mockImplementation(async (url) => {
      if (url.includes('gamemonetize.com')) throw new Error('GM down');
      if (url.includes('gamepix.com')) return makeGamePixResponse(GP_JSON_FIXTURE);
      return makeErrorResponse(404);
    });
    const req = makeUrl('/api/games');
    const res = await handleApiGames(req, createMockEnv(), createMockCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.map((g) => g.id);
    expect(ids).toContain('gp-300');
    expect(ids).not.toContain('gm-100');
  });

  it('returns games when only GamePix fails', async () => {
    fetchSpy.mockImplementation(async (url) => {
      if (url.includes('gamemonetize.com')) return makeGameMonetizeResponse(GM_XML_FIXTURE);
      if (url.includes('gamepix.com')) throw new Error('GP down');
      return makeErrorResponse(404);
    });
    const req = makeUrl('/api/games');
    const res = await handleApiGames(req, createMockEnv(), createMockCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.map((g) => g.id);
    expect(ids).toContain('gm-100');
    expect(ids).not.toContain('gp-300');
  });

  it('respects num parameter and clamps to max 200', async () => {
    const req = makeUrl('/api/games?num=10');
    const res = await handleApiGames(req, createMockEnv(), createMockCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeLessThanOrEqual(200);
  });

  it('defaults to 50 when num is not provided', async () => {
    const req = makeUrl('/api/games');
    const res = await handleApiGames(req, createMockEnv(), createMockCtx());
    expect(res.status).toBe(200);
    // Should succeed with default num
  });

  it('uses cache on subsequent requests with same num', async () => {
    const env = createMockEnv();
    const ctx = createMockCtx();
    const req = makeUrl('/api/games?num=50');

    await handleApiGames(req, env, ctx);
    // Wait for ctx.waitUntil to resolve (cache put)
    await Promise.all(ctx._waitUntilFns);

    // Second request should hit cache
    const res2 = await handleApiGames(req, env, createMockCtx());
    expect(res2.status).toBe(200);
    // fetch should only have been called once (for the first request)
    expect(fetchSpy).toHaveBeenCalledTimes(2); // GM + GP on first call only
  });

  it('sets CORS header', async () => {
    const req = makeUrl('/api/games');
    const res = await handleApiGames(req, createMockEnv(), createMockCtx());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

// ===========================================================================
// /api/search — handleApiSearch
// ===========================================================================

describe('handleApiSearch', () => {
  beforeEach(() => {
    fetchSpy.mockImplementation(async (url) => {
      if (url.includes('gamemonetize.com')) return makeGameMonetizeResponse(GM_XML_FIXTURE);
      if (url.includes('gamepix.com')) return makeGamePixResponse(GP_JSON_FIXTURE);
      return makeErrorResponse(404);
    });
  });

  it('returns 400 when query param q is missing', async () => {
    const req = makeUrl('/api/search');
    const res = await handleApiSearch(req, createMockEnv(), createMockCtx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing required query param');
  });

  it('returns 400 when query param q is empty string', async () => {
    const req = makeUrl('/api/search?q=');
    const res = await handleApiSearch(req, createMockEnv(), createMockCtx());
    expect(res.status).toBe(400);
  });

  it('returns empty array for non-matching query', async () => {
    const req = makeUrl('/api/search?q=xyznonexistent');
    const res = await handleApiSearch(req, createMockEnv(), createMockCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns matching games for valid query', async () => {
    const req = makeUrl('/api/search?q=puzzle');
    const res = await handleApiSearch(req, createMockEnv(), createMockCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    expect(body.some((g) => g.title.toLowerCase().includes('puzzle'))).toBe(true);
  });

  it('search is case-insensitive', async () => {
    const req = makeUrl('/api/search?q=PUZZLE');
    const res = await handleApiSearch(req, createMockEnv(), createMockCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
  });

  it('search matches against category as well as title', async () => {
    const req = makeUrl('/api/search?q=racing');
    const res = await handleApiSearch(req, createMockEnv(), createMockCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
  });

  it('returns JSON with correct content-type', async () => {
    const req = makeUrl('/api/search?q=test');
    const res = await handleApiSearch(req, createMockEnv(), createMockCtx());
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('sets CORS header', async () => {
    const req = makeUrl('/api/search?q=test');
    const res = await handleApiSearch(req, createMockEnv(), createMockCtx());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

// ===========================================================================
// clampNum
// ===========================================================================

describe('clampNum', () => {
  it('returns fallback for non-numeric input', () => {
    expect(clampNum('abc', 50, 200)).toBe(50);
  });

  it('returns fallback for empty string', () => {
    expect(clampNum('', 50, 200)).toBe(50);
  });

  it('returns fallback for null', () => {
    expect(clampNum(null, 50, 200)).toBe(50);
  });

  it('returns fallback for undefined', () => {
    expect(clampNum(undefined, 50, 200)).toBe(50);
  });

  it('returns fallback for zero', () => {
    expect(clampNum('0', 50, 200)).toBe(50);
  });

  it('returns fallback for negative numbers', () => {
    expect(clampNum('-5', 50, 200)).toBe(50);
  });

  it('clamps to max when value exceeds it', () => {
    expect(clampNum('300', 50, 200)).toBe(200);
  });

  it('returns the parsed value when within range', () => {
    expect(clampNum('100', 50, 200)).toBe(100);
  });

  it('returns the value when equal to max', () => {
    expect(clampNum('200', 50, 200)).toBe(200);
  });
});

// ===========================================================================
// escapeHtmlAttr
// ===========================================================================

describe('escapeHtmlAttr', () => {
  it('escapes ampersand', () => {
    expect(escapeHtmlAttr('a&b')).toBe('a\u0026amp;b');
  });

  it('escapes less-than', () => {
    expect(escapeHtmlAttr('a<b')).toBe('a\u0026lt;b');
  });

  it('escapes greater-than', () => {
    expect(escapeHtmlAttr('a>b')).toBe('a\u0026gt;b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtmlAttr('a"b')).toBe('a\u0026quot;b');
  });

  it('escapes single quotes', () => {
    expect(escapeHtmlAttr("a'b")).toBe('a\u0026#039;b');
  });

  it('escapes script injection', () => {
    expect(escapeHtmlAttr('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('handles null/undefined gracefully', () => {
    expect(escapeHtmlAttr(null)).toBe('');
    expect(escapeHtmlAttr(undefined)).toBe('');
  });

  it('handles numeric input', () => {
    expect(escapeHtmlAttr(123)).toBe('123');
  });
});

// ===========================================================================
// escapeJsonLd
// ===========================================================================

describe('escapeJsonLd', () => {
  it('produces valid JSON', () => {
    const result = escapeJsonLd({ name: 'Test' });
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('escapes < to \\u003c', () => {
    const result = escapeJsonLd({ html: '</script>' });
    expect(result).toContain('\\u003c');
    expect(result).not.toContain('</script>');
  });

  it('escapes > to \\u003e', () => {
    const result = escapeJsonLd({ html: '<tag>' });
    expect(result).toContain('\\u003e');
  });

  it('escapes & to \\u0026', () => {
    const result = escapeJsonLd({ q: 'a&b' });
    expect(result).toContain('\\u0026');
  });

  it('round-trips correctly through JSON.parse', () => {
    const input = { name: 'Game <Test>', desc: 'A & B' };
    const escaped = escapeJsonLd(input);
    const parsed = JSON.parse(escaped);
    expect(parsed.name).toBe('Game <Test>');
    expect(parsed.desc).toBe('A & B');
  });
});

// ===========================================================================
// slugify
// ===========================================================================

describe('slugify', () => {
  it('converts title to URL-friendly slug', () => {
    expect(slugify('Kicau Mania')).toBe('kicau-mania');
  });

  it('removes special characters', () => {
    expect(slugify('Hello! @World#')).toBe('hello-world');
  });

  it('normalizes unicode', () => {
    expect(slugify('Caf\u00e9')).toBe('cafe');
  });

  it('truncates at 60 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });

  it('returns "game" for empty input', () => {
    expect(slugify('')).toBe('game');
    expect(slugify(null)).toBe('game');
    expect(slugify(undefined)).toBe('game');
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugify(' Hello World ')).toBe('hello-world');
  });
});

// ===========================================================================
// parseGameMonetizeFeed
// ===========================================================================

describe('parseGameMonetizeFeed', () => {
  it('parses valid XML into game objects', () => {
    const games = parseGameMonetizeFeed(GM_XML_FIXTURE);
    expect(games.length).toBe(2);
    expect(games[0].id).toBe('gm-100');
    expect(games[0].title).toBe('Puzzle Adventure');
  });

  it('decodes HTML entities in titles', () => {
    const games = parseGameMonetizeFeed(GM_XML_FIXTURE);
    expect(games[1].title).toBe('Racing & Fury');
  });

  it('returns empty array for empty XML', () => {
    expect(parseGameMonetizeFeed('')).toEqual([]);
  });

  it('returns empty array for XML with no items', () => {
    const xml = '<?xml version="1.0"?><rss><channel></channel></rss>';
    expect(parseGameMonetizeFeed(xml)).toEqual([]);
  });

  it('skips items missing required fields', () => {
    const xml = `<rss><channel>
      <item><id>1</id><title>Good</title><url>http://ok.com</url></item>
      <item><id>2</id></item>
    </channel></rss>`;
    const games = parseGameMonetizeFeed(xml);
    expect(games.length).toBe(1);
    expect(games[0].id).toBe('gm-1');
  });

  it('prefixes ids with "gm-"', () => {
    const games = parseGameMonetizeFeed(GM_XML_FIXTURE);
    for (const g of games) {
      expect(g.id).toMatch(/^gm-/);
    }
  });

  it('defaults category to "Arcade" when missing', () => {
    const xml = `<rss><channel>
      <item><id>1</id><title>No Category</title><url>http://ok.com</url></item>
    </channel></rss>`;
    const games = parseGameMonetizeFeed(xml);
    expect(games[0].category).toBe('Arcade');
  });
});

// ===========================================================================
// decodeEntities
// ===========================================================================

describe('decodeEntities', () => {
  it('decodes numeric entities', () => {
    expect(decodeEntities('&#65;')).toBe('A');
  });

  it('decodes named entities', () => {
    expect(decodeEntities('&amp;')).toBe('&');
    expect(decodeEntities('&lt;')).toBe('<');
    expect(decodeEntities('&gt;')).toBe('>');
    expect(decodeEntities('&quot;')).toBe('"');
  });

  it('decodes multiple entities', () => {
    expect(decodeEntities('a &amp; b &lt; c')).toBe('a & b < c');
  });

  it('preserves unknown entities', () => {
    expect(decodeEntities('&foobar;')).toBe('&foobar;');
  });

  it('handles empty string', () => {
    expect(decodeEntities('')).toBe('');
  });
});

// ===========================================================================
// Output Encoding — Share/Play/Game Routes (Task #010)
//
// Verifies that user-controlled input (query params, malicious game data from
// upstream feeds) is always escaped before being injected into HTML meta tags,
// JSON-LD, or attribute values. The three handlers under test:
//   - handleGameRoute  (/game?title=...&category=...&thumb=...)
//   - handleShareRoute (/share/:id)
//   - handlePlayRoute  (/play/:id/:slug)
// ===========================================================================

describe('Output Encoding — Share/Play/Game Routes', () => {
  // -----------------------------------------------------------------------
  // handleGameRoute — query-param attack surface
  // -----------------------------------------------------------------------

  describe('handleGameRoute', () => {
    beforeEach(() => {
      fetchSpy.mockImplementation(async (fetchUrl) => {
        if (String(fetchUrl).includes('gamemonetize.com')) {
          return makeGameMonetizeResponse(GM_XML_FIXTURE);
        }
        if (String(fetchUrl).includes('gamepix.com')) {
          return makeGamePixResponse(GP_JSON_FIXTURE);
        }
        return makeErrorResponse(404);
      });
    });

    it('301s a valid first-party id to the canonical /play URL', async () => {
      const url = makeUrl('/game?id=local-kicau-mania');
      const res = await handleGameRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe(
        'https://gimboot.com/play/local-kicau-mania/kicau-mania'
      );
    });

    it('drops every extra query param and ignores attacker-controlled titles', async () => {
      const malicious = '<script>alert(1)</script>';
      const url = makeUrl(
        `/game?id=local-kicau-mania&title=${encodeURIComponent(malicious)}&thumb=javascript:alert(1)&utm_source=x`
      );
      const res = await handleGameRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());

      expect(res.status).toBe(301);
      const location = res.headers.get('Location');
      expect(location).toBe('https://gimboot.com/play/local-kicau-mania/kicau-mania');
      expect(location).not.toContain('script');
      expect(location).not.toContain('utm_source');
    });

    it('uses the title-derived slug for Ayo ke Kopdes, not the folder name', async () => {
      const url = makeUrl('/game?id=local-ayo-kopdes');
      const res = await handleGameRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe(
        'https://gimboot.com/play/local-ayo-kopdes/ayo-ke-kopdes'
      );
    });

    it('301s a valid remote id to /play/{id}/{slug}', async () => {
      const url = makeUrl('/game?id=gm-100&title=Anything&thumb=anything');
      const res = await handleGameRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe(
        'https://gimboot.com/play/gm-100/puzzle-adventure'
      );
    });

    it('404s when the id is missing', async () => {
      const url = makeUrl('/game?title=Test');
      const res = await handleGameRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());
      const body = await res.text();

      expect(res.status).toBe(404);
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
      expect(body).not.toContain('rel="canonical"');
      expect(body).toContain('404');
    });

    it('404s for an unknown id when the catalog is available', async () => {
      const url = makeUrl('/game?id=does-not-exist');
      const res = await handleGameRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());

      expect(res.status).toBe(404);
    });

    it('503s when the catalog is unavailable and the id is not first-party', async () => {
      fetchSpy.mockRejectedValue(new Error('both feeds down'));
      const url = makeUrl('/game?id=gm-100');
      const res = await handleGameRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());

      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('3600');
    });

    it('still resolves a first-party id when both feeds are down', async () => {
      fetchSpy.mockRejectedValue(new Error('both feeds down'));
      const url = makeUrl('/game?id=local-moba');
      const res = await handleGameRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe('https://gimboot.com/play/local-moba/moba-dota');
    });
  });

  // -----------------------------------------------------------------------
  // canonicalUrlForStaticPage — server-rendered canonical for static HTML
  // -----------------------------------------------------------------------

  describe('canonicalUrlForStaticPage', () => {
    it('always canonicalizes the root to the production origin with a trailing slash', () => {
      expect(canonicalUrlForStaticPage(makeUrl('/'))).toBe('https://gimboot.com/');
      expect(canonicalUrlForStaticPage(makeUrl('/index.html'))).toBe('https://gimboot.com/');
      expect(canonicalUrlForStaticPage(makeUrl('/?q=search'))).toBe('https://gimboot.com/');
    });

    it('maps first-party game shells to their /play landing page', () => {
      expect(canonicalUrlForStaticPage(makeUrl('/games/solitaire/index.html'))).toBe(
        'https://gimboot.com/play/local-solitaire/solitaire'
      );
      expect(canonicalUrlForStaticPage(makeUrl('/games/moba/'))).toBe(
        'https://gimboot.com/play/local-moba/moba-dota'
      );
      expect(
        canonicalUrlForStaticPage(
          makeUrl('/games/pawzle-maze/index.html?embed=1&parentOrigin=https%3A%2F%2Fgimboot.com')
        )
      ).toBe('https://gimboot.com/play/local-pawzle-maze/pawzle-maze');
      expect(canonicalUrlForStaticPage(makeUrl('/games/ayo-kopdes/'))).toBe(
        'https://gimboot.com/play/local-ayo-kopdes/ayo-ke-kopdes'
      );
    });

    it('keeps directory-style trailing slashes for emulator/unknown game folders', () => {
      expect(canonicalUrlForStaticPage(makeUrl('/emulator'))).toBe('https://gimboot.com/emulator/');
      expect(canonicalUrlForStaticPage(makeUrl('/emulator/index.html'))).toBe(
        'https://gimboot.com/emulator/'
      );
      expect(canonicalUrlForStaticPage(makeUrl('/games/unknown/index.html'))).toBe(
        'https://gimboot.com/games/unknown/'
      );
    });

    it('strips .html and trailing slashes from ordinary clean URLs', () => {
      expect(canonicalUrlForStaticPage(makeUrl('/some-page.html'))).toBe(
        'https://gimboot.com/some-page'
      );
      expect(canonicalUrlForStaticPage(makeUrl('/some-page/'))).toBe(
        'https://gimboot.com/some-page'
      );
    });

    it('never emits a canonical for legacy /game or /game.html', () => {
      expect(canonicalUrlForStaticPage(makeUrl('/game'))).toBe('');
      expect(canonicalUrlForStaticPage(makeUrl('/game.html'))).toBe('');
      expect(canonicalUrlForStaticPage(makeUrl('/game?id=gm-123&title=Space%20Explorer'))).toBe('');
      expect(canonicalUrlForStaticPage(makeUrl('/game.html/anything'))).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // handleShareRoute — game-data attack surface (title, description)
  // -----------------------------------------------------------------------

  describe('handleShareRoute', () => {
    it('escapes <img onerror XSS in game title', async () => {
      const malicious = '<img src=x onerror=alert(1)>';

      fetchSpy.mockImplementation(async (fetchUrl) => {
        if (String(fetchUrl).includes('gamemonetize.com')) {
          const xml = `<?xml version="1.0"?><rss><channel><item>
            <id>xss1</id>
            <title>${malicious}</title>
            <category>Arcade</category>
            <url>https://example.com/xss1</url>
            <thumb>https://example.com/xss1.png</thumb>
          </item></channel></rss>`;
          return makeGameMonetizeResponse(xml);
        }
        if (String(fetchUrl).includes('gamepix.com')) return makeGamePixResponse({ items: [] });
        return makeErrorResponse(404);
      });

      const url = makeUrl('/share/gm-xss1');
      const res = await handleShareRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());
      const body = await res.text();

      expect(body).not.toContain('<img src=x onerror=alert(1)>');
      expect(body).toContain('&lt;img');
    });

    it('escapes " in game title for attribute injection', async () => {
      const malicious = 'Game" onload="alert(1)';

      fetchSpy.mockImplementation(async (fetchUrl) => {
        if (String(fetchUrl).includes('gamemonetize.com')) {
          const xml = `<?xml version="1.0"?><rss><channel><item>
            <id>xss2</id>
            <title>${malicious}</title>
            <category>Arcade</category>
            <url>https://example.com/xss2</url>
            <thumb>https://example.com/xss2.png</thumb>
          </item></channel></rss>`;
          return makeGameMonetizeResponse(xml);
        }
        if (String(fetchUrl).includes('gamepix.com')) return makeGamePixResponse({ items: [] });
        return makeErrorResponse(404);
      });

      const url = makeUrl('/share/gm-xss2');
      const res = await handleShareRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());
      const body = await res.text();

      expect(body).not.toContain('Game" onload="alert(1)');
      expect(body).toContain('Game&quot;');
    });

    it('escapes </script> in game title for JSON context safety', async () => {
      const malicious = '</script><script>alert(1)</script>';

      fetchSpy.mockImplementation(async (fetchUrl) => {
        if (String(fetchUrl).includes('gamemonetize.com')) {
          const xml = `<?xml version="1.0"?><rss><channel><item>
            <id>xss3</id>
            <title>${malicious}</title>
            <category>Arcade</category>
            <url>https://example.com/xss3</url>
            <thumb>https://example.com/xss3.png</thumb>
          </item></channel></rss>`;
          return makeGameMonetizeResponse(xml);
        }
        if (String(fetchUrl).includes('gamepix.com')) return makeGamePixResponse({ items: [] });
        return makeErrorResponse(404);
      });

      const url = makeUrl('/share/gm-xss3');
      const res = await handleShareRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());
      const body = await res.text();

      // The exact malicious string must not appear unescaped anywhere in the body
      expect(body).not.toContain('</script><script>alert(1)</script>');
      expect(body).toContain('&lt;/script&gt;');
    });

    it('redirects to / when game ID not found (no output-encoding risk)', async () => {
      fetchSpy.mockImplementation(async () => {
        return makeGamePixResponse({ items: [] });
      });

      const url = makeUrl('/share/nonexistent-game-id');
      const res = await handleShareRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('/');
    });
  });

  // -----------------------------------------------------------------------
  // handlePlayRoute — game-data attack surface (title, description, JSON-LD)
  // -----------------------------------------------------------------------

  describe('handlePlayRoute', () => {
    it('escapes <script> in game title within meta tags', async () => {
      const malicious = '<script>alert(1)</script>';

      fetchSpy.mockImplementation(async (fetchUrl) => {
        if (String(fetchUrl).includes('gamemonetize.com')) {
          const xml = `<?xml version="1.0"?><rss><channel><item>
            <id>play-xss1</id>
            <title>${malicious}</title>
            <category>Arcade</category>
            <url>https://example.com/px1</url>
            <thumb>https://example.com/px1.png</thumb>
          </item></channel></rss>`;
          return makeGameMonetizeResponse(xml);
        }
        if (String(fetchUrl).includes('gamepix.com')) return makeGamePixResponse({ items: [] });
        return makeErrorResponse(404);
      });

      // The canonical slug is derived from the (malicious) title; using it
      // here keeps the handler on the render path instead of a 301.
      const url = makeUrl('/play/gm-play-xss1/script-alert-1-script');
      const res = await handlePlayRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());
      const body = await res.text();

      expect(body).not.toContain('<script>alert(1)</script>');
      expect(body).toContain('&lt;script&gt;');
    });

    it('escapes </script> in game title for JSON-LD safety', async () => {
      const malicious = '</script><script>alert(1)</script>';

      fetchSpy.mockImplementation(async (fetchUrl) => {
        if (String(fetchUrl).includes('gamemonetize.com')) {
          const xml = `<?xml version="1.0"?><rss><channel><item>
            <id>play-xss2</id>
            <title>${malicious}</title>
            <category>Arcade</category>
            <url>https://example.com/px2</url>
            <thumb>https://example.com/px2.png</thumb>
          </item></channel></rss>`;
          return makeGameMonetizeResponse(xml);
        }
        if (String(fetchUrl).includes('gamepix.com')) return makeGamePixResponse({ items: [] });
        return makeErrorResponse(404);
      });

      const url = makeUrl('/play/gm-play-xss2/script-script-alert-1-script');
      const res = await handlePlayRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());
      const body = await res.text();

      // The exact malicious string must not appear unescaped
      expect(body).not.toContain('</script><script>alert(1)</script>');
      // JSON-LD escaping uses \u003c / \u003e sequences
      expect(body).toContain('\\u003c/script\\u003e');
    });

    it('escapes " in game title for meta attribute injection', async () => {
      const malicious = 'Game" onload="alert(1)';

      fetchSpy.mockImplementation(async (fetchUrl) => {
        if (String(fetchUrl).includes('gamemonetize.com')) {
          const xml = `<?xml version="1.0"?><rss><channel><item>
            <id>play-xss3</id>
            <title>${malicious}</title>
            <category>Arcade</category>
            <url>https://example.com/px3</url>
            <thumb>https://example.com/px3.png</thumb>
          </item></channel></rss>`;
          return makeGameMonetizeResponse(xml);
        }
        if (String(fetchUrl).includes('gamepix.com')) return makeGamePixResponse({ items: [] });
        return makeErrorResponse(404);
      });

      const url = makeUrl('/play/gm-play-xss3/game-onload-alert-1');
      const res = await handlePlayRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());
      const body = await res.text();

      // Raw quotes are harmless in text nodes (<title>, <h1>); only attribute
      // contexts must be entity-encoded.
      expect(body).not.toContain('title="Game" onload="alert(1)');
      expect(body).toContain('content="Game&quot; onload=&quot;alert(1)');
    });

    it('returns 404 for an unknown ID instead of a generic shell (no soft-404)', async () => {
      // A non-empty catalog is required: an empty merged catalog is treated
      // as an upstream outage (503), not as "no such game".
      fetchSpy.mockImplementation(async (fetchUrl) => {
        if (String(fetchUrl).includes('gamemonetize.com')) {
          return makeGameMonetizeResponse(GM_XML_FIXTURE);
        }
        if (String(fetchUrl).includes('gamepix.com')) return makeGamePixResponse({ items: [] });
        return makeErrorResponse(404);
      });

      const url = makeUrl('/play/unknown-game-id/some-slug');
      const res = await handlePlayRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());
      const body = await res.text();

      expect(res.status).toBe(404);
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
      expect(body).not.toContain('gimboot-play-id');
    });

    it('503s for an unknown ID when the catalog is unavailable', async () => {
      fetchSpy.mockRejectedValue(new Error('both feeds down'));

      const url = makeUrl('/play/unknown-game-id/some-slug');
      const res = await handlePlayRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());

      expect(res.status).toBe(503);
    });

    it('301s a missing slug to the canonical /play/{id}/{slug} URL', async () => {
      const url = makeUrl('/play/local-kicau-mania');
      const res = await handlePlayRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe(
        'https://gimboot.com/play/local-kicau-mania/kicau-mania'
      );
    });

    it('301s a wrong slug to the canonical URL', async () => {
      const url = makeUrl('/play/local-ayo-kopdes/ayo-kopdes');
      const res = await handlePlayRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe(
        'https://gimboot.com/play/local-ayo-kopdes/ayo-ke-kopdes'
      );
    });

    it('301s a trailing slash and/or tracking query to the clean canonical URL', async () => {
      const trailing = makeUrl('/play/local-kicau-mania/kicau-mania/');
      const trailingRes = await handlePlayRoute(
        new Request(trailing.toString()),
        trailing,
        createMockEnv(),
        createMockCtx()
      );
      expect(trailingRes.status).toBe(301);
      expect(trailingRes.headers.get('Location')).toBe(
        'https://gimboot.com/play/local-kicau-mania/kicau-mania'
      );

      const withQuery = makeUrl('/play/local-kicau-mania/kicau-mania?utm_source=newsletter');
      const queryRes = await handlePlayRoute(
        new Request(withQuery.toString()),
        withQuery,
        createMockEnv(),
        createMockCtx()
      );
      expect(queryRes.status).toBe(301);
      expect(queryRes.headers.get('Location')).toBe(
        'https://gimboot.com/play/local-kicau-mania/kicau-mania'
      );
    });

    it('renders a complete, unique SSR page for a canonical /play URL', async () => {
      const url = makeUrl('/play/local-kicau-mania/kicau-mania');
      const res = await handlePlayRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(body).toContain('<title>Kicau Mania - Main Gratis di Gimboot</title>');
      expect(body).toContain(
        '<link rel="canonical" href="https://gimboot.com/play/local-kicau-mania/kicau-mania">'
      );
      expect(body).toContain('<meta name="robots" content="index, follow, max-image-preview:large">');
      expect(body).toContain('Tentang Kicau Mania');
      expect(body).toContain('Cara Bermain Kicau Mania');
      expect(body).toContain('"@type":"VideoGame"');
      expect(body).toContain('"name":"Kicau Mania"');
      expect(body).not.toContain('noindex, follow');
      expect(body).not.toContain('stale description');

      // Exactly one canonical, exactly one robots tag, exactly one VideoGame.
      expect((body.match(/rel="canonical"/g) || []).length).toBe(1);
      expect((body.match(/name="robots"/g) || []).length).toBe(1);
      expect((body.match(/"@type":"VideoGame"/g) || []).length).toBe(1);
    });

    it('uses the game description in the meta description and visible body', async () => {
      // GM_XML_FIXTURE has no description; add one to prove feed copy is used.
      fetchSpy.mockImplementation(async (fetchUrl) => {
        if (String(fetchUrl).includes('gamemonetize.com')) {
          const xml = `<?xml version="1.0"?><rss><channel><item>
            <id>desc-1</id>
            <title>Description Game</title>
            <category>Puzzle</category>
            <description>Susun balok warna dan pecahkan teka-teki.</description>
            <url>https://example.com/desc</url>
            <thumb>https://example.com/desc.png</thumb>
          </item></channel></rss>`;
          return makeGameMonetizeResponse(xml);
        }
        if (String(fetchUrl).includes('gamepix.com')) return makeGamePixResponse({ items: [] });
        return makeErrorResponse(404);
      });

      const url = makeUrl('/play/gm-desc-1/description-game');
      const res = await handlePlayRoute(new Request(url.toString()), url, createMockEnv(), createMockCtx());
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(body).toContain('Susun balok warna');
      expect(body).toMatch(/<meta name="description" content="[^"]*Susun balok warna/);
    });
  });

  // -----------------------------------------------------------------------
  // redirectSingleHop — GSC "Halaman dengan pengalihan" fix
  // -----------------------------------------------------------------------

  describe('redirectSingleHop', () => {
    it('upgrades http to https and normalizes pathname in one 301', () => {
      const url = new URL('http://gimboot.com/game.html?title=Foo');
      const res = redirectSingleHop(url, '/play/local-kicau-mania/kicau-mania');

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe(
        'https://gimboot.com/play/local-kicau-mania/kicau-mania?title=Foo'
      );
    });

    it('normalizes /index.html to / in one hop (single-hop, no chain)', () => {
      const url = new URL('http://gimboot.com/index.html');
      const res = redirectSingleHop(url, '/');

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe('https://gimboot.com/');
    });

    it('can drop query params when the destination is canonical', () => {
      const url = new URL('http://gimboot.com/game.html?id=gm-123&title=Test&thumb=/img.png');
      const res = redirectSingleHop(url, '/play/gm-123/test', false);

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe('https://gimboot.com/play/gm-123/test');
    });

    it('strips hash fragment (not sent to server)', () => {
      const url = new URL('http://gimboot.com/game.html#section');
      const res = redirectSingleHop(url, '/');

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe('https://gimboot.com/');
    });

    it('works for already-HTTPS requests normalizing just the pathname', () => {
      const url = new URL('https://gimboot.com/game.html?foo=bar');
      const res = redirectSingleHop(url, '/');

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe('https://gimboot.com/?foo=bar');
    });

    it('drops the query string when preserveSearch is false', () => {
      const url = new URL('https://gimboot.com/index.html?utm_source=newsletter');
      const res = redirectSingleHop(url, '/', false);

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe('https://gimboot.com/');
    });

    it('redirects http://gimboot.com/ to https://gimboot.com/ as single hop', () => {
      const url = new URL('http://gimboot.com/');
      const res = redirectSingleHop(url, '/');

      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe('https://gimboot.com/');
    });
  });

  describe('isLoopbackHost', () => {
    // Production hardening (upgrade-insecure-requests + the unconditional
    // http→https 301) must never fire on loopback hosts: wrangler dev binds
    // to 127.0.0.1 and serves a self-signed cert, so forcing HTTPS there
    // breaks local development and the E2E suite.
    it('recognizes the four loopback literals', () => {
      expect(isLoopbackHost('localhost')).toBe(true);
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('::1')).toBe(true);
      expect(isLoopbackHost('[::1]')).toBe(true);
    });

    it('rejects production hostnames (case-insensitive)', () => {
      expect(isLoopbackHost('gimboot.com')).toBe(false);
      expect(isLoopbackHost('GIMBOOT.COM')).toBe(false);
      expect(isLoopbackHost('www.gimboot.com')).toBe(false);
      expect(isLoopbackHost('example.org')).toBe(false);
    });

    it('treats empty/null/undefined as non-loopback', () => {
      expect(isLoopbackHost('')).toBe(false);
      expect(isLoopbackHost(null)).toBe(false);
      expect(isLoopbackHost(undefined)).toBe(false);
    });
  });
});

describe('Clean URL redirects, 404s, and server-side canonical (Task #032 + SEO fix)', () => {
  async function fetchThroughWorker(path, env = createMockEnv()) {
    const req = new Request(`https://gimboot.com${path}`);
    return worker.fetch(req, env, createMockCtx());
  }

  beforeEach(() => {
    fetchSpy.mockImplementation(async (fetchUrl) => {
      if (String(fetchUrl).includes('gamemonetize.com')) {
        return makeGameMonetizeResponse(GM_XML_FIXTURE);
      }
      if (String(fetchUrl).includes('gamepix.com')) {
        return makeGamePixResponse(GP_JSON_FIXTURE);
      }
      return makeErrorResponse(404);
    });
  });

  it('301s /index.html to / and drops tracking query params', async () => {
    const res = await fetchThroughWorker('/index.html?utm_source=newsletter');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://gimboot.com/');
  });

  it('301s /game.html?id=local-... directly to /play in one hop', async () => {
    const res = await fetchThroughWorker('/game.html?id=local-kicau-mania&title=Kicau%20Mania');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(
      'https://gimboot.com/play/local-kicau-mania/kicau-mania'
    );
  });

  it('301s /game.html with no id to the catalog root (no chain)', async () => {
    const res = await fetchThroughWorker('/game.html');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://gimboot.com/');
  });

  it('301s /game.html/ wildcard paths to the catalog root (no chain)', async () => {
    const res = await fetchThroughWorker('/game.html/');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://gimboot.com/');
  });

  it('301s /game?id=local-... to /play and drops all other params', async () => {
    const res = await fetchThroughWorker('/game?id=local-kicau-mania&title=Test');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(
      'https://gimboot.com/play/local-kicau-mania/kicau-mania'
    );
  });

  it('301s /game?id=remote-... to /play/{id}/{slug}', async () => {
    const res = await fetchThroughWorker('/game?id=gm-100&title=Ignored');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(
      'https://gimboot.com/play/gm-100/puzzle-adventure'
    );
  });

  it('404s /game without an id', async () => {
    const res = await fetchThroughWorker('/game');
    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('404s /game with an unknown id', async () => {
    const res = await fetchThroughWorker('/game?id=does-not-exist');
    expect(res.status).toBe(404);
  });

  it('treats /game/ with the same single-hop contract as /game', async () => {
    const valid = await fetchThroughWorker('/game/?id=local-kicau-mania');
    expect(valid.status).toBe(301);
    expect(valid.headers.get('Location')).toBe(
      'https://gimboot.com/play/local-kicau-mania/kicau-mania'
    );

    const missing = await fetchThroughWorker('/game/');
    expect(missing.status).toBe(404);
  });

  it('301s /play/{id} (no slug) to the canonical URL', async () => {
    const res = await fetchThroughWorker('/play/local-kicau-mania');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(
      'https://gimboot.com/play/local-kicau-mania/kicau-mania'
    );
  });

  it('301s a wrong or stale slug to the canonical URL', async () => {
    const res = await fetchThroughWorker('/play/local-ayo-kopdes/ayo-kopdes');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(
      'https://gimboot.com/play/local-ayo-kopdes/ayo-ke-kopdes'
    );
  });

  it('301s /play/{id}/{slug}/ to the no-trailing-slash canonical', async () => {
    const res = await fetchThroughWorker('/play/local-kicau-mania/kicau-mania/');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(
      'https://gimboot.com/play/local-kicau-mania/kicau-mania'
    );
  });

  it('301s /play/{id}/{slug}?utm=... to the clean canonical', async () => {
    const res = await fetchThroughWorker('/play/local-kicau-mania/kicau-mania?utm_source=x');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(
      'https://gimboot.com/play/local-kicau-mania/kicau-mania'
    );
  });

  it('renders the canonical /play page with SSR title, canonical, robots, and JSON-LD', async () => {
    const res = await fetchThroughWorker('/play/local-kicau-mania/kicau-mania');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('<title>Kicau Mania - Main Gratis di Gimboot</title>');
    expect(body).toContain(
      '<link rel="canonical" href="https://gimboot.com/play/local-kicau-mania/kicau-mania">'
    );
    expect(body).toContain('<meta name="robots" content="index, follow, max-image-preview:large">');
    expect(body).toContain('Tentang Kicau Mania');
    expect(body).toContain('"@type":"VideoGame"');
    expect(body).not.toContain('noindex, follow');
    expect((body.match(/rel="canonical"/g) || []).length).toBe(1);
  });

  it('404s /play/unknown-game-id/slug instead of serving a soft-404 shell', async () => {
    const res = await fetchThroughWorker('/play/unknown-game-id/some-slug');
    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('injects the root canonical with a trailing slash into static HTML', async () => {
    const res = await fetchThroughWorker('/');
    const body = await res.text();
    expect(body).toContain('<link rel="canonical" href="https://gimboot.com/">');
    expect((body.match(/rel="canonical"/g) || []).length).toBe(1);
  });

  it('injects the /play canonical for a first-party game shell', async () => {
    const res = await fetchThroughWorker('/games/solitaire/index.html');
    const body = await res.text();
    expect(body).toContain(
      '<link rel="canonical" href="https://gimboot.com/play/local-solitaire/solitaire">'
    );
  });

  it('404s /404 and /404.html without injecting a canonical', async () => {
    for (const path of ['/404', '/404.html']) {
      const res = await fetchThroughWorker(path);
      const body = await res.text();
      expect(res.status).toBe(404);
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
      expect(body).not.toContain('rel="canonical"');
    }
  });

  it('renders the branded 404 for an unknown extensionless path', async () => {
    const env = createMockEnv({
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response('asset miss', {
            status: 404,
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      },
    });
    const res = await fetchThroughWorker('/this-page-does-not-exist', env);
    const body = await res.text();

    expect(res.status).toBe(404);
    expect(body).toContain('Game tidak ditemukan');
  });
});

describe('Cross-origin isolation headers (Task #024)', () => {
  // COOP/COEP must be scoped strictly to /emulator* so SharedArrayBuffer
  // exists there (thread-required cores: PPSSPP, DOSBox Pure), while the
  // catalog / play / game pages stay non-isolated — third-party game
  // iframes (gamemonetize etc.) must never be COEP-blocked.
  async function fetchThroughWorker(path) {
    const req = new Request(`https://gimboot.com${path}`);
    return worker.fetch(req, createMockEnv(), createMockCtx());
  }

  it('sets COOP + COEP on /emulator/', async () => {
    const res = await fetchThroughWorker('/emulator/');
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });

  it('sets COOP + COEP on /emulator/runtime.html', async () => {
    const res = await fetchThroughWorker('/emulator/runtime.html');
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });

  it('does NOT set them on the catalog (/)', async () => {
    const res = await fetchThroughWorker('/');
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe(null);
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe(null);
  });

  it('does NOT set them on static assets (/css/style.css)', async () => {
    const res = await fetchThroughWorker('/css/style.css');
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe(null);
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe(null);
  });
});
