import { CONFIG } from './config.js';
import { escapeHtml, debounce, buildPlayUrl, writeSessionGames, fetchGameCatalog } from './utils.js';
import { getFavorites, getRecentGames, toggleFavorite, isFavorite, saveRecent } from './state.js';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'recent', label: 'Recent' },
  { id: 'favorite', label: 'Favorite' },
  { id: 'popular', label: 'Popular' },
  { id: 'new', label: 'New' },
  { id: 'trending', label: 'Trending' },
  { id: 'more', label: 'More' },
];

const state = {
  games: [],
  categories: ['All'],
  activeCategory: 'All',
  activeTab: 'all',
  query: '',
  filteredGames: [],
  currentIndex: 0,
  requestedCount: CONFIG.DEFAULT_GAME_COUNT,
  hasMore: true,
  loadingMore: false,
  onlineSearching: false,
};

const els = {
  grid: document.getElementById('game-grid'),
  status: document.getElementById('grid-status'),
  search: document.getElementById('search-input'),
  gameCount: document.getElementById('game-count'),
  tabBar: document.getElementById('tab-bar'),
  loadMoreBtn: document.getElementById('btn-load-more'),
  loadMoreWrap: document.getElementById('load-more-wrap'),
};

init();

async function init() {
  renderSkeleton(12);

  try {
    const games = await fetchGameCatalog(CONFIG.GAMES_API_ENDPOINT, CONFIG.DEFAULT_GAME_COUNT, CONFIG.LOCAL_GAMES);
    if (games.length === 0) throw new Error('Catalog came back empty');

    state.games = games;
    state.categories = ['All', ...uniqueCategories(games)];
    writeSessionGames(CONFIG.SESSION_CACHE_KEY, games);

    renderTabs();
    applyTab();
    bindEvents();
  } catch (err) {
    console.error('Failed to load game catalog:', err);
    renderError();
  }
}

function uniqueCategories(games) {
  const set = new Set();
  games.forEach((g) => {
    if (g.category) set.add(g.category);
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ----------------------------------------------------------------------------
// Tab navigation
// ----------------------------------------------------------------------------

function renderTabs() {
  els.tabBar.innerHTML = TABS.map((tab) => {
    if (tab.id === 'more') return genreMenuTemplate();
    const isActive = tab.id === state.activeTab;
    return `<button type="button" class="tab-btn ${isActive ? 'tab-btn--active' : ''}" data-tab="${tab.id}" role="tab" aria-selected="${isActive}">${escapeHtml(tab.label)}</button>`;
  }).join('');
}

function genreMenuTemplate() {
  return `
    <div class="genre-menu">
      <button type="button" class="tab-btn genre-menu__toggle" data-genre-toggle aria-haspopup="true" aria-expanded="false" aria-controls="genre-menu-panel">
        More
      </button>
      <div id="genre-menu-panel" class="genre-menu__panel" data-genre-panel hidden>
        <label class="genre-menu__label" for="genre-search">Search genre</label>
        <input id="genre-search" class="genre-menu__search" type="search" placeholder="Search genre..." autocomplete="off">
        <div class="genre-menu__list" data-genre-list role="listbox" aria-label="Game genres">
          ${genreOptionsTemplate()}
        </div>
      </div>
    </div>
  `;
}

function genreOptionsTemplate(query = '') {
  const normalizedQuery = query.trim().toLowerCase();
  const categories = ['All', ...state.categories.filter((category) => category !== 'All')]
    .filter((category, index, list) => list.indexOf(category) === index)
    .filter((category) => !normalizedQuery || category.toLowerCase().includes(normalizedQuery));

  if (categories.length === 0) {
    return '<p class="genre-menu__empty">No genres found</p>';
  }

  return categories
    .map((category) => {
      const selected = category === state.activeCategory;
      return `<button type="button" class="genre-menu__option ${selected ? 'genre-menu__option--active' : ''}" data-genre="${escapeHtml(category)}" role="option" aria-selected="${selected}">${escapeHtml(category)}</button>`;
    })
    .join('');
}

function closeGenreMenu() {
  const panel = els.tabBar.querySelector('[data-genre-panel]');
  const toggle = els.tabBar.querySelector('[data-genre-toggle]');
  if (!panel || !toggle) return;
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
}

function toggleGenreMenu() {
  const panel = els.tabBar.querySelector('[data-genre-panel]');
  const toggle = els.tabBar.querySelector('[data-genre-toggle]');
  if (!panel || !toggle) return;

  panel.hidden = !panel.hidden;
  toggle.setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) panel.querySelector('.genre-menu__search')?.focus();
}

function applyTab() {
  state.currentIndex = 0;
  state.filteredGames = getTabGames();
  els.gameCount.textContent = String(state.filteredGames.length);
  renderGrid(true);
}

function getTabGames() {
  const q = state.query.trim().toLowerCase();

  switch (state.activeTab) {
    case 'favorite':
      return getFavorites().filter((g) => !q || (g.title || '').toLowerCase().includes(q));
    case 'recent':
      return getRecentGames().filter((g) => !q || (g.title || '').toLowerCase().includes(q));
    case 'popular':
      // Popular = games with the most plays (simulated by a stable hash of id).
      return [...state.games]
        .filter((g) => !q || (g.title || '').toLowerCase().includes(q))
        .sort((a, b) => popularityScore(b) - popularityScore(a));
    case 'new':
      // New = reverse of the catalog order (newest first).
      return [...state.games]
        .filter((g) => !q || (g.title || '').toLowerCase().includes(q))
        .reverse();
    case 'trending':
      // Trending = a deterministic pseudo-random shuffle that changes daily.
      return [...state.games]
        .filter((g) => !q || (g.title || '').toLowerCase().includes(q))
        .sort((a, b) => trendingScore(b) - trendingScore(a));
    default:
      return state.games.filter((g) => {
        const matchesCategory = state.activeCategory === 'All' || g.category === state.activeCategory;
        const matchesQuery = !q || (g.title || '').toLowerCase().includes(q);
        return matchesCategory && matchesQuery;
      });
  }
}

// Deterministic pseudo-random popularity score (0–1) from the game id.
function popularityScore(game) {
  let hash = 0;
  const str = String(game.id || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

// Trending: seeded by the current date so the order changes daily.
function trendingScore(game) {
  const daySeed = Math.floor(Date.now() / 86400000);
  let hash = daySeed;
  const str = String(game.id || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

// ----------------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------------

function renderGrid(reset = false) {
  if (reset) {
    els.grid.innerHTML = '';
    els.loadMoreWrap.hidden = true;
  }

  // Render the complete cumulative window. Load More expands it from 50 to
  // 60, 70, and so on instead of only revealing already-fetched cards.
  const nextBatch = state.filteredGames.slice(state.currentIndex);

  if (nextBatch.length === 0) {
    if (state.filteredGames.length === 0) {
      renderEmptyState();
    }
    els.loadMoreWrap.hidden = true;
    return;
  }

  els.status.hidden = true;
  els.grid.insertAdjacentHTML('beforeend', nextBatch.map(cardTemplate).join(''));
  state.currentIndex += nextBatch.length;

  // Show/hide Load More
  els.loadMoreWrap.hidden = !canLoadMore();
}

function canLoadMore() {
  return (
    state.hasMore &&
    !state.loadingMore &&
    state.requestedCount < CONFIG.MAX_GAME_COUNT &&
    state.activeTab !== 'favorite' &&
    state.activeTab !== 'recent'
  );
}

async function loadMoreGames() {
  if (!canLoadMore()) return;

  state.loadingMore = true;
  els.loadMoreBtn.disabled = true;
  els.loadMoreBtn.textContent = 'Loading...';

  const nextCount = Math.min(
    state.requestedCount + CONFIG.LOAD_MORE_COUNT,
    CONFIG.MAX_GAME_COUNT
  );

  try {
    const expandedGames = await fetchGameCatalog(
      CONFIG.GAMES_API_ENDPOINT,
      nextCount,
      CONFIG.LOCAL_GAMES
    );
    const existingIds = new Set(state.games.map((game) => String(game.id)));
    const freshGames = expandedGames.filter((game) => !existingIds.has(String(game.id)));

    state.requestedCount = nextCount;
    state.hasMore = freshGames.length > 0 && nextCount < CONFIG.MAX_GAME_COUNT;
    state.games = [...state.games, ...freshGames];
    state.categories = ['All', ...uniqueCategories(state.games)];
    writeSessionGames(CONFIG.SESSION_CACHE_KEY, state.games);

    renderTabs();
    state.filteredGames = getTabGames();
    state.currentIndex = 0;
    els.gameCount.textContent = String(state.filteredGames.length);
    renderGrid(true);
  } catch (err) {
    console.error('Failed to load more games:', err);
    flashToast('Could not load more games. Please try again.');
  } finally {
    state.loadingMore = false;
    els.loadMoreBtn.disabled = false;
    els.loadMoreBtn.textContent = 'Load More';
    els.loadMoreWrap.hidden = !canLoadMore();
  }
}

function renderEmptyState() {
  els.grid.replaceChildren();
  els.status.hidden = false;
  els.status.replaceChildren();

  if (state.query.trim()) {
    appendStatusParagraph('status-title', `No games match "${state.query}"`);
    appendStatusParagraph('status-subtitle', 'Try a different search term or pick another category.');
    appendSearchOnlineButton();
  } else if (state.activeTab === 'favorite') {
    appendStatusParagraph('status-title', 'No favorite games yet');
    appendStatusParagraph('status-subtitle', 'Tap the heart on any game to save it here.');
  } else if (state.activeTab === 'recent') {
    appendStatusParagraph('status-title', 'No recently played games');
    appendStatusParagraph('status-subtitle', 'Play a game and it will show up here.');
  } else {
    appendStatusParagraph('status-title', 'No games found');
    appendStatusParagraph('status-subtitle', 'Try a different filter.');
  }
}

function appendStatusParagraph(className, text) {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = text;
  els.status.appendChild(paragraph);
}

function appendSearchOnlineButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary';
  button.id = 'search-online-btn';
  button.textContent = 'Game not found. Search Online?';
  button.addEventListener('click', searchOnline);
  els.status.appendChild(button);
}

function cardTemplate(game, index) {
  const playUrl = buildPlayUrl(game);
  const sourceBadge = game.source
    ? `<span class="game-card__source">${escapeHtml(game.source)}</span>`
    : '';
  const fav = isFavorite(game.id);
  const favClass = fav ? 'game-card__fav--active' : '';
  const favLabel = fav ? 'Remove from favorites' : 'Add to favorites';
  const favIcon = fav ? '\u2764' : '\u2661';

  return `
    <div class="game-card">
      <a href="${playUrl}" class="game-card__link" data-game-id="${escapeHtml(game.id)}">
        <div class="game-card__thumb-wrap">
          <img class="game-card__thumb" src="${escapeHtml(game.thumb)}" alt="Main Game ${escapeHtml(game.title)} Gratis Tanpa Install" loading="lazy" width="512" height="384">
          <span class="game-card__play">&#9654; Play</span>
          ${sourceBadge}
        </div>
        <div class="game-card__body">
          <p class="game-card__title">${escapeHtml(game.title)}</p>
          <span class="game-card__tag">${escapeHtml(game.category)}</span>
        </div>
      </a>
      <div class="game-card__actions">
        <button type="button" class="game-card__fav ${favClass}" data-fav-id="${escapeHtml(game.id)}" aria-label="${favLabel}" title="${favLabel}">${favIcon}</button>
        <button type="button" class="game-card__share" data-share-id="${escapeHtml(game.id)}" aria-label="Share game" title="Share">&#128279;</button>
      </div>
    </div>
  `;
}

function renderSkeleton(count) {
  els.status.hidden = true;
  els.grid.innerHTML = Array.from({ length: count })
    .map(() => `<div class="game-card game-card--skeleton" aria-hidden="true"></div>`)
    .join('');
}

function renderError() {
  els.grid.replaceChildren();
  els.status.hidden = false;
  els.status.replaceChildren();
  appendStatusParagraph('status-title', "Couldn't load the game catalog");
  appendStatusParagraph('status-subtitle', 'Check your connection and try again.');
  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.className = 'btn btn--primary';
  retryButton.textContent = 'Retry';
  retryButton.addEventListener('click', () => {
    renderSkeleton(12);
    init();
  });
  els.status.appendChild(retryButton);
}

// ----------------------------------------------------------------------------
// Hybrid search — local first, then online fallback
// ----------------------------------------------------------------------------

async function searchOnline() {
  const q = state.query.trim();
  if (!q || state.onlineSearching) return;

  state.onlineSearching = true;
  els.status.hidden = false;
  els.status.replaceChildren();
  appendStatusParagraph('status-subtitle', `Searching online for "${q}"...`);

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`Search API responded with ${res.status}`);
    const results = await res.json();

    if (!Array.isArray(results) || results.length === 0) {
      els.status.replaceChildren();
      appendStatusParagraph('status-title', 'No results found online either');
      appendStatusParagraph('status-subtitle', 'Try a different search term.');
      return;
    }

    // Merge online results into the local catalog (dedupe by id).
    const existingIds = new Set(state.games.map((g) => g.id));
    const fresh = results.filter((g) => !existingIds.has(g.id));
    state.games = [...state.games, ...fresh];
    writeSessionGames(CONFIG.SESSION_CACHE_KEY, state.games);

    state.filteredGames = fresh;
    state.currentIndex = 0;
    els.gameCount.textContent = String(fresh.length);
    renderGrid(true);
  } catch (err) {
    console.error('Online search failed:', err);
    els.status.replaceChildren();
    appendStatusParagraph('status-title', 'Online search failed');
    appendStatusParagraph('status-subtitle', 'Check your connection and try again.');
  } finally {
    state.onlineSearching = false;
  }
}

// ----------------------------------------------------------------------------
// Share
// ----------------------------------------------------------------------------

async function shareGame(gameId) {
  const game = findGameById(gameId);
  if (!game) {
    flashToast('Game link is unavailable. Please refresh the catalog.');
    return;
  }

  const shareUrl = new URL(buildPlayUrl(game), window.location.origin).toString();

  try {
    await navigator.clipboard.writeText(shareUrl);
    flashToast('Link copied to clipboard! Share it with your friends.');
  } catch (err) {
    console.error('Failed to copy link: ', err);
    flashToast('Could not copy link. Copy it from the address bar.');
  }
}

function flashToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('toast--show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('toast--show'), 2400);
}

// ----------------------------------------------------------------------------
// Events
// ----------------------------------------------------------------------------

function bindEvents() {
  // Tab clicks
  els.tabBar.addEventListener('click', (e) => {
    const genreToggle = e.target.closest('[data-genre-toggle]');
    if (genreToggle) {
      toggleGenreMenu();
      return;
    }

    const genreOption = e.target.closest('[data-genre]');
    if (genreOption) {
      state.activeCategory = genreOption.dataset.genre;
      state.activeTab = 'all';
      closeGenreMenu();
      renderTabs();
      applyTab();
      return;
    }

    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    state.activeTab = btn.dataset.tab;
    if (state.activeTab === 'all') state.activeCategory = 'All';
    closeGenreMenu();
    renderTabs();
    applyTab();
  });

  // Search genres inside the More dropdown.
  els.tabBar.addEventListener('input', (e) => {
    if (!e.target.matches('#genre-search')) return;
    const list = els.tabBar.querySelector('[data-genre-list]');
    if (list) list.innerHTML = genreOptionsTemplate(e.target.value);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.genre-menu')) closeGenreMenu();
  });

  // Search
  els.search.addEventListener(
    'input',
    debounce((e) => {
      state.query = e.target.value;
      applyTab();
    }, 200)
  );

  // Load More
  els.loadMoreBtn.addEventListener('click', loadMoreGames);

  // Grid delegation: favorite, share, play
  els.grid.addEventListener('click', (e) => {
    const favBtn = e.target.closest('.game-card__fav');
    if (favBtn) {
      e.preventDefault();
      const game = findGameById(favBtn.dataset.favId);
      if (game) {
        const added = toggleFavorite(game);
        favBtn.classList.toggle('game-card__fav--active', added);
        favBtn.textContent = added ? '\u2764' : '\u2661';
        favBtn.setAttribute('aria-label', added ? 'Remove from favorites' : 'Add to favorites');
        favBtn.title = added ? 'Remove from favorites' : 'Add to favorites';
        if (state.activeTab === 'favorite' && !added) {
          applyTab(); // re-render to remove the card
        }
      }
      return;
    }

    const shareBtn = e.target.closest('.game-card__share');
    if (shareBtn) {
      e.preventDefault();
      shareGame(shareBtn.dataset.shareId);
      return;
    }

    const playLink = e.target.closest('.game-card__link');
    if (playLink) {
      const game = findGameById(playLink.dataset.gameId);
      if (game) saveRecent(game);
    }
  });
}

function findGameById(id) {
  return state.games.find((g) => String(g.id) === String(id));
}
