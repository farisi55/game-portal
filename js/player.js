import { CONFIG } from './config.js';
import { escapeHtml, buildPlayUrl, isAllowedEmbedUrl, readSessionGames, fetchGameCatalog } from './utils.js';

const params = new URLSearchParams(window.location.search);

// Arrived via the SEO-friendly /play/{id}/{slug} route: src/index.js already
// server-injected the <title>/meta tags for this exact game and left the id
// here so the client can resolve the rest (embed url, dimensions, etc.) from
// the catalog. Falls back to the older ?id=&url=&title=... query-string
// format for any links still using it.
const ssrGameId = typeof window.__GIMBOOT_PLAY_ID__ !== 'undefined' ? window.__GIMBOOT_PLAY_ID__ : null;

const gameId = ssrGameId || params.get('id');
let embedUrl = params.get('url');
let title = params.get('title') || 'Game';
let category = params.get('category') || '';
let width = Number(params.get('w')) || null;
let height = Number(params.get('h')) || null;

const els = {
  frameWrap: document.getElementById('frame-wrap'),
  iframe: document.getElementById('game-frame'),
  title: document.getElementById('game-title'),
  category: document.getElementById('game-category'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  shareBtn: document.getElementById('share-btn'),
  shareFeedback: document.getElementById('share-feedback'),
  related: document.getElementById('related-grid'),
  relatedStatus: document.getElementById('related-status'),
  playerStatus: document.getElementById('player-status'),
};

init();

async function init() {
  if (ssrGameId) {
    let games;
    try {
      games = await fetchGameCatalog(CONFIG.GAMES_API_ENDPOINT, CONFIG.DEFAULT_GAME_COUNT, CONFIG.LOCAL_GAMES);
    } catch (err) {
      console.error('Failed to resolve game for /play/ route:', err);
      games = CONFIG.LOCAL_GAMES;
    }

    const game = (games || []).find((g) => String(g.id) === String(ssrGameId));
    if (game) {
      embedUrl = game.url;
      title = game.title;
      category = game.category;
      width = game.width;
      height = game.height;
    }
  }

  if (!embedUrl || !isAllowedEmbedUrl(embedUrl, CONFIG.ALLOWED_EMBED_HOSTS)) {
    showPlayerError();
    return;
  }

  // When arriving via /play/, the <title> was already set server-side with
  // an SEO-optimized string — don't clobber it with a plainer client-side one.
  if (!ssrGameId) {
    document.title = `${title} — Gimboot`;
  }
  els.title.textContent = title;
  els.category.textContent = category;

  const ratio = width && height ? `${width} / ${height}` : CONFIG.FALLBACK_ASPECT_RATIO;
  els.frameWrap.style.setProperty('--game-ratio', ratio);
  if (width && height && height > width) {
    els.frameWrap.classList.add('frame-wrap--portrait');
  }

  els.iframe.allow = allowAttributeFor(gameId);
  els.iframe.src = embedUrl;
  els.iframe.title = title;

  bindActions();
  loadRelatedGames();
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
  els.playerStatus.innerHTML = `
    <p class="status-title">This game link looks invalid</p>
    <p class="status-subtitle">Head back to the catalog and pick a game to play.</p>
    <a class="btn btn--primary" href="/">Back to Catalog</a>
  `;
  els.frameWrap.hidden = true;
}

function bindActions() {
  els.fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenLabel);
  els.shareBtn.addEventListener('click', shareGame);
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await els.iframe.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (err) {
    console.error('Fullscreen request failed:', err);
  }
}

function updateFullscreenLabel() {
  const isFullscreen = Boolean(document.fullscreenElement);
  els.fullscreenBtn.textContent = isFullscreen ? '\u2921 Exit Full Screen' : '\u2922 Full Screen';
}

async function shareGame() {
  const shareData = {
    title: `${title} — Gimboot`,
    text: `Play ${title} on Gimboot`,
    url: window.location.href,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch {
      // Person cancelled the native share sheet — nothing to do.
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(window.location.href);
    flashShareFeedback('Link copied');
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
  els.related.innerHTML = related.map(relatedCardTemplate).join('');
}

function relatedCardTemplate(game) {
  return `
    <a href="${buildPlayUrl(game)}" class="game-card game-card--compact">
      <div class="game-card__thumb-wrap">
        <img class="game-card__thumb" src="${escapeHtml(game.thumb)}" alt="${escapeHtml(game.title)}" loading="lazy" width="512" height="384">
        <span class="game-card__play">&#9654; Play</span>
      </div>
      <div class="game-card__body">
        <p class="game-card__title">${escapeHtml(game.title)}</p>
      </div>
    </a>
  `;
}
