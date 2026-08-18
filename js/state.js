// ============================================================================
// Local state personalization — favorites + recent games stored in localStorage.
// No backend, no auth — everything lives in the browser.
// ============================================================================

const RECENT_KEY = 'gimboot_recent';
const FAV_KEY = 'gimboot_favs';
const RECENT_LIMIT = 20;

/**
 * Saves a game to the "recently played" list. FIFO — capped at 20 entries.
 * Duplicates are moved to the front rather than appended.
 */
export function saveRecent(gameObj) {
  if (!gameObj || !gameObj.id) return;
  let recent = readArray(RECENT_KEY);
  recent = recent.filter((g) => g.id !== gameObj.id);
  recent.unshift(gameObj);
  if (recent.length > RECENT_LIMIT) recent.pop();
  writeArray(RECENT_KEY, recent);
}

/** Returns the recently played games (most recent first). */
export function getRecentGames() {
  return readArray(RECENT_KEY);
}

/**
 * Toggles a game in the favorites list. Returns `true` if it was added,
 * `false` if it was removed.
 */
export function toggleFavorite(gameObj) {
  if (!gameObj || !gameObj.id) return false;
  let favs = readArray(FAV_KEY);
  const index = favs.findIndex((g) => g.id === gameObj.id);
  if (index > -1) {
    favs.splice(index, 1);
    writeArray(FAV_KEY, favs);
    return false;
  }
  favs.push(gameObj);
  writeArray(FAV_KEY, favs);
  return true;
}

/** Returns the favorite games. */
export function getFavorites() {
  return readArray(FAV_KEY);
}

/** Checks whether a game id is in the favorites list. */
export function isFavorite(gameId) {
  return readArray(FAV_KEY).some((g) => g.id === gameId);
}

/** Removes a game from favorites by id. */
export function removeFavorite(gameId) {
  const favs = readArray(FAV_KEY).filter((g) => g.id !== gameId);
  writeArray(FAV_KEY, favs);
}

function readArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArray(key, arr) {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {
    // Storage can fail (quota, private browsing) — non-fatal.
  }
}