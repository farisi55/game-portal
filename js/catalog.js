import { CONFIG } from './config.js';
import { escapeHtml, debounce, buildPlayUrl, writeSessionGames } from './utils.js';

const state = {
  games: [],
  categories: ['All'],
  activeCategory: 'All',
  query: '',
};

const els = {
  grid: document.getElementById('game-grid'),
  status: document.getElementById('grid-status'),
  search: document.getElementById('search-input'),
  categoryBar: document.getElementById('category-bar'),
  gameCount: document.getElementById('game-count'),
};

init();

async function init() {
  renderSkeleton(12);

  try {
    const res = await fetch(`${CONFIG.GAMES_API_ENDPOINT}?num=${CONFIG.DEFAULT_GAME_COUNT}`);
    if (!res.ok) throw new Error(`API responded with ${res.status}`);

    const games = await res.json();
    if (!Array.isArray(games) || games.length === 0) throw new Error('Catalog came back empty');

    state.games = games;
    state.categories = ['All', ...uniqueCategories(games)];
    writeSessionGames(CONFIG.SESSION_CACHE_KEY, games);

    renderCategoryChips();
    renderGrid();
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

function renderCategoryChips() {
  els.categoryBar.innerHTML = state.categories
    .map((cat) => {
      const isActive = cat === state.activeCategory;
      return `<button type="button" class="chip ${isActive ? 'chip--active' : ''}" data-category="${escapeHtml(cat)}" role="tab" aria-selected="${isActive}">${escapeHtml(cat)}</button>`;
    })
    .join('');
}

function getFilteredGames() {
  const q = state.query.trim().toLowerCase();
  return state.games.filter((g) => {
    const matchesCategory = state.activeCategory === 'All' || g.category === state.activeCategory;
    const matchesQuery = !q || (g.title || '').toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });
}

function renderGrid() {
  const filtered = getFilteredGames();
  els.gameCount.textContent = String(filtered.length);

  if (filtered.length === 0) {
    els.grid.innerHTML = '';
    els.status.hidden = false;
    els.status.innerHTML = `
      <p class="status-title">No games match "${escapeHtml(state.query)}"</p>
      <p class="status-subtitle">Try a different search term or pick another category.</p>
    `;
    return;
  }

  els.status.hidden = true;
  els.grid.innerHTML = filtered.map(cardTemplate).join('');
}

function cardTemplate(game, index) {
  const playUrl = buildPlayUrl(game);
  return `
    <a href="${playUrl}" class="game-card" style="--stagger:${index % 12}">
      <div class="game-card__thumb-wrap">
        <img class="game-card__thumb" src="${escapeHtml(game.thumb)}" alt="${escapeHtml(game.title)}" loading="lazy" width="512" height="384">
        <span class="game-card__play">&#9654; Play</span>
      </div>
      <div class="game-card__body">
        <p class="game-card__title">${escapeHtml(game.title)}</p>
        <span class="game-card__tag">${escapeHtml(game.category)}</span>
      </div>
    </a>
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

function bindEvents() {
  els.categoryBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.activeCategory = btn.dataset.category;
    renderCategoryChips();
    renderGrid();
  });

  els.search.addEventListener(
    'input',
    debounce((e) => {
      state.query = e.target.value;
      renderGrid();
    }, 200)
  );
}
