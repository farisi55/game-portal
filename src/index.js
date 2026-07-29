const FEED_BASE = 'https://gamemonetize.com/feed.php';
const CACHE_TTL_SECONDS = 1800;
const MAX_NUM = 200;
const DEFAULT_NUM = 36;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/games') {
      return handleApiGames(url);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleApiGames(url) {
  const num = clampNum(url.searchParams.get('num'));

  try {
    const feedUrl = `${FEED_BASE}?format=json&num=${num}`;
    const upstream = await fetch(feedUrl, {
      headers: { Accept: 'application/xml,text/xml,*/*' },
    });

    if (!upstream.ok) {
      throw new Error(`Upstream feed responded with ${upstream.status}`);
    }

    const rawText = await upstream.text();
    const games = parseFeed(rawText);
    if (games.length === 0) {
      throw new Error('Parsed feed produced zero items');
    }

    return jsonResponse(games, 200, CACHE_TTL_SECONDS);
  } catch (err) {
    return jsonResponse(
      { error: 'Failed to fetch game feed', detail: String(err && err.message ? err.message : err) },
      502
    );
  }
}

function clampNum(rawNum) {
  const n = parseInt(rawNum, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_NUM;
  return Math.min(n, MAX_NUM);
}

function parseFeed(xml) {
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
    const tagsRaw = tag('tags');

    items.push({
      id: tag('id'),
      title: tag('title'),
      type: tag('type'),
      description: tag('description'),
      instructions: tag('instructions'),
      category: tag('category'),
      tags: tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [],
      url: tag('url'),
      thumb: tag('thumb'),
      width,
      height,
    });
  }

  return items;
}

const ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  rarr: '\u2192',
  larr: '\u2190',
  uarr: '\u2191',
  darr: '\u2193',
  middot: '\u00b7',
  bull: '\u2022',
  zwj: '',
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
