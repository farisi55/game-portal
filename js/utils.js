// ============================================================================
// Shared, dependency-free helpers used across catalog.js and player.js.
// ============================================================================

/**
 * Escapes a string for safe insertion into innerHTML. Every piece of text
 * that comes from the GameMonetize feed (title, category, tags) MUST pass
 * through this before it touches the DOM — the feed is third-party content
 * and is treated as untrusted input, not as trusted markup.
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Debounces a function so it only runs after `wait` ms of silence. */
export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Builds the game.html query string used to identify and embed a game. */
/** Turns a game title into a URL-friendly slug, e.g. "Moto X3M!" -> "moto-x3m". */
export function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'game';
}

/**
 * Builds the canonical, SEO-friendly URL for a game: /play/{id}/{slug}.
 * Only the {id} segment is actually read on the way back in (see player.js
 * and src/index.js) — the slug exists purely so the URL itself is
 * descriptive for search engines and people sharing links; it's never
 * parsed for lookup, so it can never go stale in a way that breaks anything.
 */
export function buildPlayUrl(game) {
  const id = encodeURIComponent(game.id ?? '');
  const slug = encodeURIComponent(slugify(game.title));
  return `/play/${id}/${slug}`;
}

export function buildGamePageUrl(game) {
  const params = new URLSearchParams({
    id: String(game.id ?? ''),
    title: String(game.title ?? ''),
    category: String(game.category ?? ''),
    url: String(game.url ?? ''),
  });
  return `/game.html?${params.toString()}`;
}

/**
 * True for a same-origin path under games/ (our own locally-hosted games,
 * e.g. /games/kicau-mania/index.html), with or without a leading slash.
 * Rejects protocol-relative ("//host/...") and anything with a scheme
 * ("https:", "javascript:", "data:" etc.) before treating a string as a
 * safe local path — such a path can never resolve to a different origin,
 * so it can't be used to frame an arbitrary external site the way an
 * absolute URL could.
 */
function isLocalGamePath(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.startsWith('//')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl)) return false;
  return rawUrl.startsWith('games/') || rawUrl.startsWith('/games/');
}

/**
 * Confirms an embed URL is safe to assign to an <iframe src>: either one of
 * our own local games (same-origin, always allowed) or an absolute https URL
 * whose hostname is on the allowed list.
 */
export function isAllowedEmbedUrl(rawUrl, allowedHosts) {
  if (isLocalGamePath(rawUrl)) return true;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return allowedHosts.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

/** Reads the cached game list from sessionStorage, if present and valid. */
export function readSessionGames(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Writes the game list to sessionStorage so game.html can reuse it. */
export function writeSessionGames(key, games) {
  try {
    sessionStorage.setItem(key, JSON.stringify(games));
  } catch {
    // Storage can fail (quota, private browsing) — non-fatal. player.js
    // simply falls back to re-fetching from the API in that case.
  }
}

/**
 * Fetches the merged catalog from the API (GameMonetize + GamePix, combined
 * server-side) and prepends any locally-hosted games. Used by both
 * catalog.js and player.js so there's exactly one place that knows how to
 * read the API response defensively and exactly one place local games get
 * added — the two can never drift out of sync with each other.
 */
export async function fetchGameCatalog(endpoint, num, localGames = []) {
  const res = await fetch(`${endpoint}?num=${num}`);
  if (!res.ok) throw new Error(`API responded with ${res.status}`);

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  let games;

  if (contentType.includes('application/json')) {
    games = await res.json();
  } else {
    // Server returned something other than JSON (likely an HTML error page).
    const body = await res.text();
    try {
      games = JSON.parse(body);
    } catch {
      console.error('Non-JSON response from games API:', {
        status: res.status,
        contentType,
        bodySnippet: body.slice(0, 200),
      });
      throw new Error(`Expected JSON but received ${contentType || 'unknown'} (status ${res.status})`);
    }
  }

  if (!Array.isArray(games)) throw new Error('Catalog response was not an array');

  const requestedCount = Number(num);
  if (!Number.isFinite(requestedCount) || requestedCount <= 0) {
    return shuffleGames([...localGames, ...games]);
  }

  // Keep every requested window balanced: local games are kept separately,
  // then the remote catalog is split by source before the final order is
  // randomized. The source order remains cumulative for Load More requests.
  const local = localGames.slice(0, requestedCount);
  const remoteCount = Math.max(0, requestedCount - local.length);
  const gameMonetize = games.filter((game) => String(game.id).startsWith('gm-'));
  const gamePix = games.filter((game) => String(game.id).startsWith('gp-'));
  const other = games.filter(
    (game) => !String(game.id).startsWith('gm-') && !String(game.id).startsWith('gp-')
  );
  const gameMonetizeCount = Math.ceil(remoteCount / 2);
  const gamePixCount = Math.floor(remoteCount / 2);
  const selected = [
    ...local,
    ...gameMonetize.slice(0, gameMonetizeCount),
    ...gamePix.slice(0, gamePixCount),
    ...other.slice(0, Math.max(0, remoteCount - gameMonetizeCount - gamePixCount)),
  ];

  return shuffleGames(selected).slice(0, requestedCount);
}

function shuffleGames(games) {
  const shuffled = [...games];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}
