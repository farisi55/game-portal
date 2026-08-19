import { CONFIG } from './config.js';
import { debounce, buildPlayUrl, buildGamePageUrl, writeSessionGames, fetchGameCatalog } from './utils.js';
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
  const fragment = document.createDocumentFragment();

  TABS.forEach((tab) => {
    if (tab.id === 'more') {
      fragment.appendChild(createGenreMenu());
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tab-btn ${tab.id === state.activeTab ? 'tab-btn--active' : ''}`;
    button.dataset.tab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.id === state.activeTab));
    button.textContent = tab.label;
    fragment.appendChild(button);
  });

  els.tabBar.replaceChildren(fragment);
}

function createGenreMenu() {
  const menu = document.createElement('div');
  menu.className = 'genre-menu';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tab-btn genre-menu__toggle';
  toggle.dataset.genreToggle = '';
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'genre-menu-panel');
  toggle.textContent = 'More';

  const panel = document.createElement('div');
  panel.id = 'genre-menu-panel';
  panel.className = 'genre-menu__panel';
  panel.dataset.genrePanel = '';
  panel.hidden = true;

  const label = document.createElement('label');
  label.className = 'genre-menu__label';
  label.htmlFor = 'genre-search';
  label.textContent = 'Search genre';

  const search = document.createElement('input');
  search.id = 'genre-search';
  search.className = 'genre-menu__search';
  search.type = 'search';
  search.placeholder = 'Search genre...';
  search.autocomplete = 'off';

  const list = document.createElement('div');
  list.className = 'genre-menu__list';
  list.dataset.genreList = '';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Game genres');
  renderGenreOptions(list);

  panel.append(label, search, list);
  menu.append(toggle, panel);
  return menu;
}

function renderGenreOptions(list, query = '') {
  const normalizedQuery = query.trim().toLowerCase();
  const categories = ['All', ...state.categories.filter((category) => category !== 'All')]
    .filter((category, index, list) => list.indexOf(category) === index)
    .filter((category) => !normalizedQuery || category.toLowerCase().includes(normalizedQuery));

  if (categories.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'genre-menu__empty';
    empty.textContent = 'No genres found';
    list.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  categories.forEach((category) => {
    const selected = category === state.activeCategory;
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `genre-menu__option ${selected ? 'genre-menu__option--active' : ''}`;
    option.dataset.genre = category;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(selected));
    option.textContent = category;
    fragment.appendChild(option);
  });
  list.replaceChildren(fragment);
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
    els.grid.replaceChildren();
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
  els.grid.append(...nextBatch.map(createCardElement));
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

function createCardElement(game) {
  const playUrl = buildGamePageUrl(game);
  const sourceBadge = game.source
    ? createTextElement('span', 'game-card__source', game.source)
    : null;
  const fav = isFavorite(game.id);
  const favClass = fav ? 'game-card__fav--active' : '';
  const favLabel = fav ? 'Remove from favorites' : 'Add to favorites';
  const favIcon = fav ? '\u2764' : '\u2661';

  const card = document.createElement('div');
  card.className = 'game-card';

  const link = document.createElement('a');
  link.href = playUrl;
  link.className = 'game-card__link';
  link.dataset.gameId = String(game.id ?? '');

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'game-card__thumb-wrap';
  const image = document.createElement('img');
  image.className = 'game-card__thumb';
  image.src = String(game.thumb ?? '');
  image.alt = `Main Game ${String(game.title ?? '')} Gratis Tanpa Install`;
  image.loading = 'lazy';
  image.width = 512;
  image.height = 384;
  thumbWrap.append(image, createTextElement('span', 'game-card__play', '\u25b6 Play'));
  if (sourceBadge) thumbWrap.appendChild(sourceBadge);

  const body = document.createElement('div');
  body.className = 'game-card__body';
  body.append(
    createTextElement('p', 'game-card__title', game.title),
    createTextElement('span', 'game-card__tag', game.category)
  );
  link.append(thumbWrap, body);

  const actions = document.createElement('div');
  actions.className = 'game-card__actions';
  const favoriteButton = document.createElement('button');
  favoriteButton.type = 'button';
  favoriteButton.className = `game-card__fav ${favClass}`;
  favoriteButton.dataset.favId = String(game.id ?? '');
  favoriteButton.setAttribute('aria-label', favLabel);
  favoriteButton.title = favLabel;
  favoriteButton.textContent = favIcon;
  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.className = 'game-card__share';
  shareButton.dataset.shareId = String(game.id ?? '');
  shareButton.setAttribute('aria-label', 'Share game');
  shareButton.title = 'Share';
  shareButton.textContent = '\u{1f517}';
  actions.append(favoriteButton, shareButton);

  card.append(link, actions);
  return card;
}

function createTextElement(tagName, className, value) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = String(value ?? '');
  return element;
}

function renderSkeleton(count) {
  els.status.hidden = true;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const skeleton = document.createElement('div');
    skeleton.className = 'game-card game-card--skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    fragment.appendChild(skeleton);
  }
  els.grid.replaceChildren(fragment);
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
    if (list) renderGenreOptions(list, e.target.value);
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
