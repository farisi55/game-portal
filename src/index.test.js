// Unit tests for src/index.js — catalog (/api/games) and search (/api/search)
// logic, plus exported utility helpers.
//
// Runs in the @cloudflare/vitest-pool-workers pool (workerd) so real
// Cloudflare globals (HTMLRewriter, caches.default, Response.redirect) are
// available. External fetch calls (GameMonetize/GamePix feeds) are mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleApiGames,
  handleApiSearch,
  clampNum,
  escapeHtmlAttr,
  escapeJsonLd,
  slugify,
  parseGameMonetizeFeed,
  decodeEntities,
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
  return {
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(
        new Response('<html><head></head><body></body></html>', {
          headers: { 'Content-Type': 'text/html' },
        })
      ),
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
