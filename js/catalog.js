import { CONFIG } from './config.js';
import { escapeHtml, debounce, buildPlayUrl, writeSessionGames, fetchGameCatalog } from './utils.js';
import { getFavorites, getRecentGames, toggleFavorite, isFavorite, saveRecent } from './state.js';

const ITEMS_PER_PAGE = 30;

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'recent', label: 'Recent' },
  { id: 'favorite', label: 'Favorite' },
  { id: 'popular', label: 'Popular' },
  { id: 'new', label: 'New' },
  { id: 'trending', label: 'Trending' },
  { id: 'more', label: 'More >>' },
];

const state = {
  games: [],
  categories: ['All'],
  activeCategory: 'All',
  activeTab: 'all',
  query: '',
  filteredGames: [],
  currentIndex: 0,
  onlineSearching: false,
};

const els = {
  grid: document.getElementById('game-grid'),
  status: document.getElementById('grid-status'),
  search: document.getElementById('search-input'),
  categoryBar: document.getElementById('category-bar'),
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
    renderCategoryChips();
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
    const isActive = tab.id === state.activeTab;
    return `<button type="button" class="tab-btn ${isActive ? 'tab-btn--active' : ''}" data-tab="${tab.id}" role="tab" aria-selected="${isActive}">${escapeHtml(tab.label)}</button>`;
  }).join('');
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
    case 'more':
      // More = everything, grouped by category.
      return [...state.games]
        .filter((g) => !q || (g.title || '').toLowerCase().includes(q))
        .sort((a, b) => (a.category || '').localeCompare(b.category || ''));
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

  const nextBatch = state.filteredGames.slice(state.currentIndex, state.currentIndex + ITEMS_PER_PAGE);

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
  els.loadMoreWrap.hidden = state.currentIndex >= state.filteredGames.length;
}

function renderEmptyState() {
  els.grid.innerHTML = '';
  els.status.hidden = false;

  if (state.query.trim()) {
    els.status.innerHTML = `
      <p class="status-title">No games match "${escapeHtml(state.query)}"</p>
      <p class="status-subtitle">Try a different search term or pick another category.</p>
      <button type="button" class="btn btn--primary" id="search-online-btn">Game not found. Search Online?</button>
    `;
    document.getElementById('search-online-btn')?.addEventListener('click', searchOnline);
  } else if (state.activeTab === 'favorite') {
    els.status.innerHTML = `
      <p class="status-title">No favorite games yet</p>
      <p class="status-subtitle">Tap the heart on any game to save it here.</p>
    `;
  } else if (state.activeTab === 'recent') {
    els.status.innerHTML = `
      <p class="status-title">No recently played games</p>
      <p class="status-subtitle">Play a game and it will show up here.</p>
    `;
  } else {
    els.status.innerHTML = `
      <p class="status-title">No games found</p>
      <p class="status-subtitle">Try a different filter.</p>
    `;
  }
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
    <div class="game-card" style="--stagger:${index % 12}">
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
  els.grid.innerHTML = '';
  els.status.hidden = false;
  els.status.innerHTML = `
    <p class="status-title">Couldn't load the game catalog</p>
    <p class="status-subtitle">Check your connection and try again.</p>
    <button type="button" class="btn btn--primary" id="retry-btn">Retry</button>
  `;
  document.getElementById('retry-btn')?.addEventListener('click', () => {
    renderSkeleton(12);
    init();
  });
}

// ----------------------------------------------------------------------------
// Hybrid search — local first, then online fallback
// ----------------------------------------------------------------------------

async function searchOnline() {
  const q = state.query.trim();
  if (!q || state.onlineSearching) return;

  state.onlineSearching = true;
  els.status.hidden = false;
  els.status.innerHTML = `<p class="status-subtitle">Searching online for "${escapeHtml(q)}"…</p>`;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`Search API responded with ${res.status}`);
    const results = await res.json();

    if (!Array.isArray(results) || results.length === 0) {
      els.status.innerHTML = `
        <p class="status-title">No results found online either</p>
        <p class="status-subtitle">Try a different search term.</p>
      `;
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
    els.status.innerHTML = `
      <p class="status-title">Online search failed</p>
      <p class="status-subtitle">Check your connection and try again.</p>
    `;
  } finally {
    state.onlineSearching = false;
  }
}

// ----------------------------------------------------------------------------
// Share
// ----------------------------------------------------------------------------

async function shareGame(gameId) {
  const shareUrl = `${window.location.origin}/share/${encodeURIComponent(gameId)}`;

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
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    state.activeTab = btn.dataset.tab;
    renderTabs();
    applyTab();
  });

  // Category chips
  els.categoryBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.activeCategory = btn.dataset.category;
    renderCategoryChips();
    applyTab();
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
  els.loadMoreBtn.addEventListener('click', () => renderGrid(false));

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

function renderCategoryChips() {
  els.categoryBar.innerHTML = state.categories
    .map((cat) => {
      const isActive = cat === state.activeCategory;
      return `<button type="button" class="chip ${isActive ? 'chip--active' : ''}" data-category="${escapeHtml(cat)}" role="tab" aria-selected="${isActive}">${escapeHtml(cat)}</button>`;
    })
    .join('');
}