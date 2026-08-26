// ============================================================================
// GET /share/{gameId} — Stateless Open Graph injection for social media bots.
//
// Completely stateless (no KV). Fetches the game catalog from the publisher
// API, finds the game by ID, and returns a raw HTML page with Open Graph /
// Twitter Card meta tags. Real human users are redirected to the canonical
// /play/{gameId}/{slug} URL.
// ============================================================================

const GM_FEED_BASE = 'https://gamemonetize.com/feed.php';
const GM_DEFAULT_NUM = 200;
const GM_MAX_NUM = 200;

const GAMEPIX_FEED_BASE = 'https://feeds.gamepix.com/v2/json';
const GAMEPIX_DEFAULT_SID = '985I2';
const GAMEPIX_PAGINATION = 12;

const SITE_NAME = 'Gimboot';

export async function onRequestGet(context) {
  const { request, params } = context;
  const gameId = params.id;
  const requestUrl = new URL(request.url);
  try {
    const games = await getCombinedGames(context.env);
    const allGames = [...LOCAL_GAMES, ...games];
    const game = allGames.find((g) => String(g.id) === String(gameId));

    if (!game) {
      return Response.redirect(new URL('/', requestUrl), 302);
    }

    const targetUrl = `${requestUrl.origin}/play/${encodeURIComponent(game.id)}/${slugify(game.title)}`;

    const imageUrl = absoluteUrl(game.thumb, requestUrl.origin);
    const description = game.description || `Play ${game.title} free online at ${SITE_NAME}. ${game.category} game, no install — just play, have fun, right in your browser.`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Play ${escapeHtml(game.title)} on ${SITE_NAME}!</title>

  <!-- Open Graph / Facebook / Threads -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
  <meta property="og:url" content="${escapeHtml(targetUrl)}">
  <meta property="og:title" content="Play ${escapeHtml(game.title)} Instantly!">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">

  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(game.title)}">
  <meta name="twitter:description" content="Play ${escapeHtml(game.title)} free online at ${escapeHtml(SITE_NAME)}.">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">

  <!-- Redirect for human users (bots typically stop processing here) -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(targetUrl)}">
</head>
<body>
  <p>Loading game... <a href="${escapeHtml(targetUrl)}">Click here</a> if not automatically redirected.</p>
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
    return Response.redirect(new URL('/', requestUrl), 302);
  }
}

// ----------------------------------------------------------------------------
// Local games — mirrors js/config.js's LOCAL_GAMES exactly.
// ----------------------------------------------------------------------------

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
];

// ----------------------------------------------------------------------------
// Catalog fetching (same logic as src/index.js)
// ----------------------------------------------------------------------------

async function getCombinedGames(env) {
  const [gmResult, gpResult] = await Promise.allSettled([
    fetchGameMonetize(GM_DEFAULT_NUM),
    fetchGamePix(env),
  ]);

  const gmGames = gmResult.status === 'fulfilled' ? gmResult.value : [];
  const gpGames = gpResult.status === 'fulfilled' ? gpResult.value : [];

  if (gmResult.status === 'rejected') console.error('GameMonetize feed failed:', gmResult.reason);
  if (gpResult.status === 'rejected') console.error('GamePix feed failed:', gpResult.reason);

  return [...gmGames, ...gpGames];
}

async function fetchGameMonetize(num) {
  const feedUrl = `${GM_FEED_BASE}?format=json&num=${num}`;
  const upstream = await fetch(feedUrl, {
    headers: { Accept: 'application/xml,text/xml,*/*' },
  });

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

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function absoluteUrl(maybeRelative, origin) {
  if (!maybeRelative) return '';
  try {
    return new URL(maybeRelative, origin).toString();
  } catch {
    return maybeRelative;
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '\u0026amp;')
    .replace(/</g, '\u0026lt;')
    .replace(/>/g, '\u0026gt;')
    .replace(/"/g, '\u0026quot;')
    .replace(/'/g, '\u0026#039;');
}

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
