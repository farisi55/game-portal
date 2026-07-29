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
 * Confirms an embed URL's hostname is on the allowed list before it's ever
 * assigned to an <iframe src>. Rejects anything that isn't https.
 */
export function isAllowedEmbedUrl(rawUrl, allowedHosts) {
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
