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
export function buildPlayUrl(game) {
  const params = new URLSearchParams({
    id: game.id ?? '',
    url: game.url ?? '',
    title: game.title ?? '',
    thumb: game.thumb ?? '',
    category: game.category ?? '',
    w: game.width ?? '',
    h: game.height ?? '',
  });
  return `game.html?${params.toString()}`;
}

/**
 * True for a same-origin relative path under games/ (our own locally-hosted
 * games, e.g. games/kicau-mania/index.html). Rejects protocol-relative
 * ("//host/...") and anything with a scheme ("https:", "javascript:", "data:"
 * etc.) before treating a string as a safe relative path — a relative path
 * can never resolve to a different origin, so it can't be used to frame an
 * arbitrary external site the way an absolute URL could.
 */
function isLocalGamePath(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.startsWith('//')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl)) return false;
  return rawUrl.startsWith('games/');
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
  return [...localGames, ...games];
}
