import { CONFIG } from './config.js';
import { buildPlayUrl, buildGamePageUrl, isAllowedEmbedUrl, readSessionGames, fetchGameCatalog } from './utils.js';
import { saveRecent, toggleFavorite, isFavorite } from './state.js';

const params = new URLSearchParams(window.location.search);

// Arrived via the SEO-friendly /play/{id}/{slug} route: src/index.js already
// src/index.js adds the resolved game as meta tags so the page stays within
// the site's strict CSP. Falls back to the older ?id=&url=&title=... format.
const ssrGameId = readMetaContent('gimboot-play-id');
const ssrGame = readServerGame();
const pathGameId = readPlayIdFromPathname(window.location.pathname);
const playRouteGameId = ssrGameId || pathGameId;

const gameId = playRouteGameId || params.get('id');
let embedUrl = params.get('url');
let title = params.get('title') || 'Game';
let category = params.get('category') || '';
let width = Number(params.get('w')) || null;
let height = Number(params.get('h')) || null;
let game = null;

const els = {
  frameWrap: document.getElementById('frame-wrap'),
  iframe: document.getElementById('game-frame'),
  placeholder: document.getElementById('frame-placeholder'),
  playBtn: document.getElementById('play-btn'),
  title: document.getElementById('game-title'),
  category: document.getElementById('game-category'),
  favoriteBtn: document.getElementById('favorite-btn'),
  favoriteLabel: document.getElementById('favorite-label'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  shareBtn: document.getElementById('share-btn'),
  shareFeedback: document.getElementById('share-feedback'),
  related: document.getElementById('related-grid'),
  relatedStatus: document.getElementById('related-status'),
  playerStatus: document.getElementById('player-status'),
  howToPlayGame: document.getElementById('how-to-play-game'),
  howToPlayGame2: document.getElementById('how-to-play-game-2'),
  featureGame: document.getElementById('feature-game'),
};

init();

async function init() {
  if (playRouteGameId) {
    game = ssrGame && String(ssrGame.id) === String(playRouteGameId) ? ssrGame : null;

    if (!game) {
      let games;
      try {
        // Direct links can point to games fetched by Load More, so the
        // fallback lookup must search the full catalog window.
        games = await fetchGameCatalog(CONFIG.GAMES_API_ENDPOINT, CONFIG.MAX_GAME_COUNT * 2, CONFIG.LOCAL_GAMES);
      } catch (err) {
        console.error('Failed to resolve game for /play/ route:', err);
        games = CONFIG.LOCAL_GAMES;
      }

      game = (games || []).find((g) => String(g.id) === String(playRouteGameId));
    }

    if (game) {
      embedUrl = game.url;
      title = game.title;
      category = game.category;
      width = Number(game.width) || null;
      height = Number(game.height) || null;
    }
  }

  if (!embedUrl || !isAllowedEmbedUrl(embedUrl, CONFIG.ALLOWED_EMBED_HOSTS)) {
    showPlayerError();
    return;
  }

  // Fallback: if game not resolved yet (e.g., accessed via ?id= query params),
  // look it up from LOCAL_GAMES so thumb/category/width/height are available.
  if (!game && gameId) {
    const local = CONFIG.LOCAL_GAMES.find((g) => String(g.id) === String(gameId));
    if (local) {
      game = local;
      if (!embedUrl) embedUrl = local.url;
      if (!title || title === 'Game') title = local.title;
      if (!category) category = local.category;
      if (!width) width = Number(local.width) || null;
      if (!height) height = Number(local.height) || null;
    }
  }

  // /play/ and /game both get <title> from the Worker (and /game also from
  // the early head script). Don't clobber those SEO strings here.
  els.title.textContent = title;
  els.category.textContent = category;

  // Populate SEO content sections with the game title
  if (els.howToPlayGame) els.howToPlayGame.textContent = title;
  if (els.howToPlayGame2) els.howToPlayGame2.textContent = title;
  if (els.featureGame) els.featureGame.textContent = title;

  const gameWidth = Number(width);
  const gameHeight = Number(height);
  if (Number.isFinite(gameWidth) && gameWidth > 0 && Number.isFinite(gameHeight) && gameHeight > 0) {
    els.frameWrap.dataset.gameWidth = String(gameWidth);
    els.frameWrap.dataset.gameHeight = String(gameHeight);
  } else {
    delete els.frameWrap.dataset.gameWidth;
    delete els.frameWrap.dataset.gameHeight;
  }
  if (width && height && height > width) {
    els.frameWrap.classList.add('frame-wrap--portrait');
  }

  els.iframe.allow = allowAttributeFor(gameId);
  els.iframe.title = title;
  setupFavorite();

  // Lazy load: don't set iframe src until the user clicks "Play Now".
  // This keeps the page fast and avoids loading the game script before
  // the user actually wants to play.
  els.playBtn.addEventListener('click', () => {
    saveRecent({ id: gameId, title, category, url: embedUrl, thumb: game?.thumb || readMetaContent('gimboot-play-image') || '' });
    loadGame();
  });

  bindActions();
  loadRelatedGames();
}

function loadGame() {
  if (els.iframe.dataset.loaded === 'true') return; // already loaded
  els.iframe.dataset.loaded = 'true';
  els.iframe.src = embedUrl;
  els.iframe.hidden = false;
  els.placeholder.hidden = true;
}

function readPlayIdFromPathname(pathname) {
  const segments = String(pathname || '').split('/').filter(Boolean);
  if (segments[0] !== 'play' || !segments[1]) return null;
  try {
    return decodeURIComponent(segments[1]);
  } catch {
    return null;
  }
}

function readMetaContent(name) {
  const meta = document.querySelector(`meta[name="${name}"]`);
  return meta ? meta.getAttribute('content') || null : null;
}

function readMetaNumber(name) {
  const value = Number(readMetaContent(name));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readServerGame() {
  const id = readMetaContent('gimboot-play-id');
  const url = readMetaContent('gimboot-play-url');
  if (!id || !url) return null;

  return {
    id,
    url,
    title: readMetaContent('gimboot-play-title') || 'Game',
    category: readMetaContent('gimboot-play-category') || '',
    width: readMetaNumber('gimboot-play-width'),
    height: readMetaNumber('gimboot-play-height'),
  };
}

/**
 * GameMonetize's SDK specifically calls for `monetization` and
 * `focus-without-user-activation` in the iframe's `allow` attribute.
 * Neither GamePix nor our own local games use or expect those — leaving
 * them on unconditionally just produces "unrecognized feature" console
 * warnings for every non-GameMonetize game, so the permission set is
 * chosen per source instead of being one string for everything.
 */
function allowAttributeFor(id) {
  if (String(id).startsWith('gm-')) {
    return 'autoplay; fullscreen; focus-without-user-activation; monetization';
  }
  return 'autoplay; fullscreen';
}

function showPlayerError() {
  els.playerStatus.hidden = false;
  els.playerStatus.replaceChildren();

  const titleElement = document.createElement('p');
  titleElement.className = 'status-title';
  titleElement.textContent = 'This game link looks invalid';

  const subtitleElement = document.createElement('p');
  subtitleElement.className = 'status-subtitle';
  subtitleElement.textContent = 'Head back to the catalog and pick a game to play.';

  const backLink = document.createElement('a');
  backLink.className = 'btn btn--primary';
  backLink.href = '/';
  backLink.textContent = 'Back to Catalog';

  els.playerStatus.append(titleElement, subtitleElement, backLink);
  els.frameWrap.hidden = true;
}

function bindActions() {
  els.favoriteBtn.addEventListener('click', togglePageFavorite);
  els.fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenLabel);
  els.shareBtn.addEventListener('click', shareGame);
}

function setupFavorite() {
  if (!gameId) {
    els.favoriteBtn.hidden = true;
    return;
  }

  updateFavoriteButton(isFavorite(gameId));
}

function togglePageFavorite() {
  if (!gameId) return;

  const added = toggleFavorite({
    id: gameId,
    title,
    category,
    url: embedUrl,
    thumb: game?.thumb || readMetaContent('gimboot-play-image') || '',
  });

  updateFavoriteButton(added);
  flashShareFeedback(added ? 'Added to favorites!' : 'Removed from favorites');
}

function updateFavoriteButton(favorited) {
  els.favoriteBtn.classList.toggle('player-favorite--active', favorited);
  els.favoriteBtn.setAttribute('aria-pressed', String(favorited));
  const label = favorited ? 'Favorited' : 'Favorite';
  const ariaLabel = favorited ? 'Remove from favorites' : 'Add to favorites';
  els.favoriteLabel.textContent = label;
  els.favoriteBtn.setAttribute('aria-label', ariaLabel);
  els.favoriteBtn.title = ariaLabel;
  els.favoriteBtn.querySelector('.player-favorite__icon').textContent = favorited ? '\u2764' : '\u2661';
}

async function toggleFullscreen() {
  // Fullscreen the whole frame (placeholder + iframe) so Play Now remains
  // clickable even before the game is loaded. Requesting fullscreen on the
  // hidden iframe alone would show a blank/black screen and block input.
  const target = els.frameWrap;
  try {
    if (!document.fullscreenElement) {
      // If game not yet loaded, keep placeholder visible — do not auto-load,
      // the user can still press Play Now while in fullscreen.
      await target.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (_err) {
    // Fallback: try iframe directly (older browsers may require it)
    try {
      if (!document.fullscreenElement) {
        await els.iframe.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.error('Fullscreen request failed:', e);
    }
  }
}

function updateFullscreenLabel() {
  const isFullscreen = Boolean(document.fullscreenElement);
  els.fullscreenBtn.textContent = isFullscreen ? '\u2921 Exit Full Screen' : '\u2922 Full Screen';
}

async function shareGame() {
  const shareUrl = new URL(
    buildPlayUrl({ id: gameId, title }),
    window.location.origin
  ).toString();

  if (navigator.share) {
    try {
      await navigator.share({
        title: `${title} — Gimboot`,
        text: `Play ${title} on Gimboot`,
        url: shareUrl,
      });
    } catch {
      // Person cancelled the native share sheet — nothing to do.
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    flashShareFeedback('Link copied!');
  } catch {
    flashShareFeedback('Copy the link from your address bar');
  }
}

function flashShareFeedback(message) {
  els.shareFeedback.textContent = message;
  els.shareFeedback.hidden = false;
  setTimeout(() => {
    els.shareFeedback.hidden = true;
  }, 2200);
}

async function loadRelatedGames() {
  let games = readSessionGames(CONFIG.SESSION_CACHE_KEY);

  if (!games) {
    try {
      games = await fetchGameCatalog(CONFIG.GAMES_API_ENDPOINT, CONFIG.DEFAULT_GAME_COUNT, CONFIG.LOCAL_GAMES);
    } catch (err) {
      console.error('Failed to load related games:', err);
      els.relatedStatus.hidden = false;
      els.relatedStatus.textContent = "Couldn't load related games.";
      return;
    }
  }

  const related = games
    .filter((g) => String(g.id) !== String(gameId) && g.category === category)
    .slice(0, CONFIG.RELATED_GAMES_LIMIT);

  if (related.length === 0) {
    els.relatedStatus.hidden = false;
    els.relatedStatus.textContent = 'No related games in this category yet.';
    return;
  }

  els.relatedStatus.hidden = true;
  els.related.replaceChildren(...related.map(createRelatedCardElement));
}

function createRelatedCardElement(relatedGame) {
  const link = document.createElement('a');
  link.href = buildGamePageUrl(relatedGame);
  link.className = 'game-card game-card--compact';

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'game-card__thumb-wrap';
  const image = document.createElement('img');
  image.className = 'game-card__thumb';
  image.src = String(relatedGame.thumb ?? '');
  image.alt = `Main Game ${String(relatedGame.title ?? '')} Gratis Tanpa Install`;
  image.loading = 'lazy';
  image.width = 512;
  image.height = 384;
  const playLabel = document.createElement('span');
  playLabel.className = 'game-card__play';
  playLabel.textContent = '\u25b6 Play';
  thumbWrap.append(image, playLabel);

  const body = document.createElement('div');
  body.className = 'game-card__body';
  const titleElement = document.createElement('p');
  titleElement.className = 'game-card__title';
  titleElement.textContent = String(relatedGame.title ?? '');
  body.appendChild(titleElement);

  link.append(thumbWrap, body);
  return link;
}
