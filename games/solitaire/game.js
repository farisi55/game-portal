import { Sound } from './sound.js';
import { startCascade, stopCascade, SUIT_PATHS as SUITS } from './win.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const board = document.getElementById('board');
const toast = document.getElementById('toast');
const canvas = document.getElementById('winCanvas');
const winModal = document.getElementById('winModal');
const playAgainBtn = document.getElementById('playAgainBtn');
const autoBtn = document.getElementById('autoBtn');

const scoreEl = document.getElementById('score');
const movesEl = document.getElementById('moves');
const timeEl = document.getElementById('time');
const winTimeEl = document.getElementById('winTime');
const winMovesEl = document.getElementById('winMoves');
const winScoreEl = document.getElementById('winScore');
const winHighScoreEl = document.getElementById('winHighScore');

// Small selector helper used by the button wiring further down.
const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// Constants & integration pattern (mirrors games/kicau-mania/game.js §4)
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'solitaire_highScore';
const SOUND_PREF_KEY = 'solitaire_soundMuted';
const PARENT_MESSAGE_TYPE = 'arcade-score';
const CW = 90, CH = 126;

const SUIT_NAMES = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
const SUIT_COLOR = [false, true, true, false]; // black, red, red, black
const RANK_NAMES = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let tableau = [];
let foundation = [];
let stock = [];
let waste = [];
let moves = 0;
let score = 0;
let seconds = 0;
let drawCount = 3;
let history = [];
let gameActive = false;
let canUndo = false;
let highScore = 0;
let timerId = null;
let animationId = null;
let selectedCell = null;

// ---------------------------------------------------------------------------
// Storage helpers (with private-mode / cross-origin fallback)
// ---------------------------------------------------------------------------
function loadHighScore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}

function saveHighScore(value) {
  try { localStorage.setItem(STORAGE_KEY, String(value)); } catch {}
}

function loadSoundPreference() {
  try { return localStorage.getItem(SOUND_PREF_KEY) === 'true'; } catch { return false; }
}

function saveSoundPreference(muted) {
  try { localStorage.setItem(SOUND_PREF_KEY, String(muted)); } catch {}
}

function reportScoreToParent(score) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage({ type: PARENT_MESSAGE_TYPE, score }, '*');
  } catch {}
}

// ---------------------------------------------------------------------------
// Card engine
// ---------------------------------------------------------------------------
function newDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 1; r <= 13; r++) d.push({ suit: s, rank: r, faceUp: false });
  }
  return d;
}

function shuffle(d) {
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function canPlaceOnTableau(card, top) {
  if (!top) return card.rank === 13;
  if (SUIT_COLOR[card.suit] === SUIT_COLOR[top.suit]) return false;
  return card.rank === top.rank - 1;
}

function canPlaceOnFoundation(card, top) {
  if (!top) return card.rank === 1;
  if (card.suit !== top.suit) return false;
  return card.rank === top.rank + 1;
}

// ---------------------------------------------------------------------------
// SVG card rendering
// ---------------------------------------------------------------------------
const cardCache = new Map();

function getCardSvg(card) {
  const key = card.suit * 100 + card.rank;
  if (cardCache.has(key)) return cardCache.get(key);

  const color = SUIT_COLOR[card.suit] ? '#c8283a' : '#1b1f24';
  const colorClass = SUIT_COLOR[card.suit] ? 'pip-face--red' : 'pip-face--black';
  const label = RANK_NAMES[card.rank];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" width="${CW}" height="${CH}">
  <foreignObject x="0" y="0" width="${CW}" height="${CH}">
    <div xmlns="http://www.w3.org/1999/xhtml" class="pip-face ${colorClass}">
      <div class="pip-label pip-label--top">${label}</div>
      <div class="pip-label pip-label--bottom">${label}</div>
    </div>
  </foreignObject>
  <g transform="translate(${CW/2},${CH*0.55})">
    <path d="${SUITS[card.suit]}" fill="${color}" transform="translate(${-CW*0.21},0) scale(0.42)"/>
  </g>
</svg>`;
  cardCache.set(key, svg);
  return svg;
}

const BACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" width="${CW}" height="${CH}">
  <rect width="${CW}" height="${CH}" rx="12" fill="#1f4fa8" stroke="#fdfbfb" stroke-width="7"/>
  <circle cx="45" cy="63" r="20" fill="rgba(255,255,255,0.16)"/>
</svg>`;

const EMPTY_SLOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" width="${CW}" height="${CH}">
  <rect width="${CW}" height="${CH}" rx="12" fill="rgba(0,0,0,0.08)" stroke="rgba(255,255,255,0.13)" stroke-width="2" stroke-dasharray="6,4"/>
  <text x="${CW/2}" y="${CH*0.55}" text-anchor="middle" fill="rgba(255,255,255,0.25)" font-size="24" font-family="system-ui,sans-serif">🂠</text>
</svg>`;

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------
function renderBoard() {
  board.innerHTML = '';
  renderStockArea();
  renderWasteArea();
  renderFoundations();
  renderTableau();
}

function renderStockArea() {
  const x = 0;
  const y = 84;
  const s = document.createElement('div');
  s.className = 'slot stock-slot';
  s.style.left = `${x}px`;
  s.style.top = `${y}px`;
  s.dataset.area = 'stock';
  s.title = 'Click to draw cards';
  s.innerHTML = `<div class="suit-glyph stock-glyph ${stock.length > 0 ? 'stock-glyph--full' : 'stock-glyph--empty'}">🂠</div>`;
  s.addEventListener('click', onStockClick);
  board.appendChild(s);
}

function renderWasteArea() {
  const s = document.createElement('div');
  s.className = 'slot';
  s.style.left = '100px';
  s.style.top = '84px';
  s.dataset.area = 'waste';
  s.title = 'Waste pile';

  if (waste.length > 0) {
    s.innerHTML = getCardSvg(waste[waste.length - 1]);
  } else {
    s.innerHTML = EMPTY_SLOT_SVG;
  }
  board.appendChild(s);
}

function renderFoundations() {
  const startX = 260;
  for (let f = 0; f < 4; f++) {
    const s = document.createElement('div');
    s.className = 'slot';
    s.style.left = `${startX + f * 110}px`;
    s.style.top = '84px';
    s.dataset.area = 'foundation';
    s.dataset.pile = f;
    s.title = `Foundation: ${SUIT_NAMES[f]}`;

    if (foundation[f].length > 0) {
      s.innerHTML = getCardSvg(foundation[f][foundation[f].length - 1]);
    } else {
      s.innerHTML = EMPTY_SLOT_SVG;
    }
    board.appendChild(s);
  }
}

function renderTableau() {
  const colWidth = Math.floor((window.innerWidth - 40) / 7);
  const startY = 230;

  for (let c = 0; c < 7; c++) {
    const p = tableau[c];
    const x = 10 + c * colWidth + Math.floor((colWidth - CW) / 2);

    for (let i = 0; i < p.length; i++) {
      const card = p[i];
      const el = document.createElement('div');
      el.className = 'card' + (card.faceUp ? ' faceup' : '');
      el.style.left = `${x}px`;
      el.style.top = `${startY + i * 24}px`;
      el.dataset.area = 'tableau';
      el.dataset.pile = c;
      el.dataset.index = i;
      el.innerHTML = card.faceUp ? getCardSvg(card) : BACK_SVG;

      if (card.faceUp && i === p.length - 1) {
        el.addEventListener('click', () => onCardClick(c, i));
      }
      board.appendChild(el);
    }

    if (p.length === 0) {
      const s = document.createElement('div');
      s.className = 'slot empty-tableau';
      s.style.left = `${x}px`;
      s.style.top = `${startY}px`;
      s.dataset.area = 'tableau';
      s.dataset.pile = c;
      s.innerHTML = EMPTY_SLOT_SVG;
      s.addEventListener('click', () => onCardClick(c, -1));
      board.appendChild(s);
    }
  }
}

// ---------------------------------------------------------------------------
// Game setup
// ---------------------------------------------------------------------------
function setupGame() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'none';

  const d = shuffle(newDeck());
  tableau = Array.from({ length: 7 }, () => []);
  foundation = Array.from({ length: 4 }, () => []);

  let idx = 0;
  for (let c = 0; c < 7; c++) {
    for (let i = 0; i <= c; i++) {
      tableau[c].push(d[idx]);
      idx++;
    }
    tableau[c][tableau[c].length - 1].faceUp = true;
  }

  stock = d.slice(idx);
  waste = [];
  moves = 0;
  score = 0;
  seconds = 0;
  history = [];
  canUndo = false;
  selectedCell = null;

  Sound.setMuted(loadSoundPreference());
  updateSoundIcon();
  renderBoard();
  updateDisplay();
  updateUndoButton();
}

function startGame() {
  setupGame();
  gameActive = true;

  if (timerId) clearInterval(timerId);
  timerId = setInterval(() => {
    if (!gameActive) return;
    seconds++;
    updateDisplay();
  }, 1000);

  if (animationId) cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(tick);
}

function tick() {
  animationId = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
/** Formats elapsed seconds as m:ss (e.g. 0:00, 12:05). */
function formatTime(s) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function updateDisplay() {
  scoreEl.textContent = score;
  movesEl.textContent = moves;
  timeEl.textContent = formatTime(seconds);
}

function updateUndoButton() {
  const btn = $('#undoBtn');
  if (btn) btn.disabled = !canUndo;
}

function updateSoundIcon() {
  const btn = $('#soundBtn');
  if (btn) btn.classList.toggle('muted', Sound.muted);
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function clearSelection() {
  selectedCell = null;
  renderBoard();
}

// ---------------------------------------------------------------------------
// Stock / waste actions
// ---------------------------------------------------------------------------
function onStockClick() {
  if (!gameActive) return;
  if (stock.length === 0) {
    // Recycle waste back to stock
    stock = waste.slice().reverse();
    waste = [];
    Sound.recycle();
  } else {
    const count = Math.min(drawCount, stock.length);
    waste.push(...stock.splice(-count));
    Sound.deal();
  }
  moves++;
  saveState();
  renderBoard();
}

// ---------------------------------------------------------------------------
// Move validation & execution
// ---------------------------------------------------------------------------
function getTopCardInTableau(pileIdx) {
  const p = tableau[pileIdx];
  return p.length > 0 ? p[p.length - 1] : null;
}

function onCardClick(pileIdx, cardIdx) {
  if (!gameActive || cardIdx === -1) return;

  const card = tableau[pileIdx][cardIdx];
  if (!card || !card.faceUp) {
    Sound.invalid();
    return;
  }

  // If something is selected, try to move it
  if (selectedCell && selectedCell.pileIdx === pileIdx && selectedCell.cardIdx === cardIdx) {
    // Clicked the same card — deselect
    clearSelection();
    return;
  }

  if (selectedCell) {
    // Try to move the selected run to this card's pile position
    const run = tableau[selectedCell.pileIdx].slice(selectedCell.cardIdx);
    if (run.length > 0 && canPlaceOnTableau(run[0], card)) {
      moveRun(selectedCell.pileIdx, selectedCell.cardIdx, pileIdx);
      return;
    }
    // Otherwise reselect
    selectedCell = { pileIdx, cardIdx };
    renderBoard();
    return;
  }

  // First click — select if it's a valid movable card (top card or a face-up run)
  if (cardIdx === tableau[pileIdx].length - 1) {
    selectedCell = { pileIdx, cardIdx };
    renderBoard();
  }
}

function tryMoveToFoundation(pileIdx, cardIdx) {
  if (!gameActive) return false;

  const p = tableau[pileIdx];
  const card = p[cardIdx];
  if (!card || !card.faceUp) return false;

  // Can only move top card to foundation
  if (cardIdx !== p.length - 1) return false;

  const f = foundation.findIndex(f => canPlaceOnFoundation(card, foundation[f][foundation[f].length - 1]));
  if (f === -1) return false;

  // Move it
  p.pop();
  foundation[f].push(card);
  score += 10;
  moves++;
  Sound.foundation();

  // Flip next card if needed
  if (p.length > 0 && !p[p.length - 1].faceUp) {
    p[p.length - 1].faceUp = true;
    score += 5;
    Sound.flip();
  }

  saveState();
  renderBoard();
  checkWin();
  return true;
}

function moveRun(srcPile, fromIdx, destPile) {
  const run = tableau[srcPile].splice(fromIdx);
  tableau[destPile].push(...run);
  moves++;
  Sound.place();

  // Flip card left in source pile
  if (tableau[srcPile].length > 0 && !tableau[srcPile][tableau[srcPile].length - 1].faceUp) {
    tableau[srcPile][tableau[srcPile].length - 1].faceUp = true;
    score += 5;
    Sound.flip();
  }

  selectedCell = null;
  saveState();
  renderBoard();

  if (!checkWin()) updateAutoFinish();
}

function moveWasteToFoundation() {
  if (!gameActive || waste.length === 0) return false;
  const card = waste[waste.length - 1];
  const f = isFoundationMove(card);
  if (f === null) return false;

  waste.pop();
  foundation[f].push(card);
  score += 10;
  moves++;
  Sound.foundation();
  saveState();
  renderBoard();
  checkWin();
  return true;
}

function moveWasteToTableau(destPile) {
  if (!gameActive || waste.length === 0) return false;
  const card = waste[waste.length - 1];
  const top = getTopCardInTableau(destPile);
  if (!canPlaceOnTableau(card, top)) return false;

  waste.pop();
  tableau[destPile].push(card);
  moves++;
  Sound.place();
  saveState();
  renderBoard();
  return true;
}

function isFoundationMove(card) {
  for (let f = 0; f < 4; f++) {
    if (canPlaceOnFoundation(card, foundation[f][foundation[f].length - 1])) return f;
  }
  return null;
}

function isTableauMove(card, exclude = -1) {
  for (let c = 0; c < 7; c++) {
    if (c === exclude) continue;
    const top = getTopCardInTableau(c);
    if (canPlaceOnTableau(card, top)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Win logic
// ---------------------------------------------------------------------------
function checkWin() {
  for (let f = 0; f < 4; f++) {
    if (foundation[f].length !== 13) return false;
  }
  celebrate();
  return true;
}

function calculateScore() {
  const timeBonus = Math.max(100, 700 - seconds * 2);
  return score + timeBonus;
}

function celebrate() {
  gameActive = false;
  if (timerId) clearInterval(timerId);
  if (animationId) cancelAnimationFrame(animationId);

  Sound.win();

  const finalScore = calculateScore();
  score = finalScore;

  winTimeEl.textContent = formatTime(seconds);
  winMovesEl.textContent = moves;
  winScoreEl.textContent = score;

  const isNewRecord = score > highScore;
  if (isNewRecord) {
    highScore = score;
    saveHighScore(highScore);
  }
  winHighScoreEl.textContent = isNewRecord ? `${highScore} (new record!)` : highScore;

  winModal.classList.remove('hidden');
  canvas.style.display = 'block';

  // Build cascade items from foundation piles
  const cascadeItems = [];
  for (let f = 0; f < 4; f++) {
    for (const card of foundation[f]) {
      cascadeItems.push({ suit: card.suit, rank: card.rank });
    }
  }
  shuffle(cascadeItems);
  cascadeItems.forEach((item, i) => {
    item.x = 60 + (i % 8) * (CW * 0.6);
    item.y = 40 + Math.floor(i / 8) * (CH * 0.55);
    item.onLaunch = () => Sound.place();
  });
  startCascade(cascadeItems, CW * 0.45, CH * 0.45);

  // Always report score to parent (matches kicau-mania pattern)
  reportScoreToParent(score);

  // ViralShare only on new record
  if (isNewRecord) {
    startViralShare();
  }
}

function startViralShare() {
  if (typeof window.ViralShare === 'undefined') return;
  try {
    window.ViralShare.show('solitaire', score, () => {
      winModal.classList.add('hidden');
    });
  } catch {}
}

function playAgain() {
  stopCascade();
  winModal.classList.add('hidden');
  canvas.style.display = 'none';
  clearSelection();
  startGame();
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------
// Bounded undo depth (500 steps) — caps memory growth during long games.
const MAX_UNDO = 500;

function saveState() {
  history.push({
    tableau: tableau.map(p => p.map(c => ({ ...c }))),
    foundation: foundation.map(p => p.map(c => ({ ...c }))),
    stock: stock.map(c => ({ ...c })),
    waste: waste.map(c => ({ ...c })),
    moves,
    score,
    seconds,
  });
  if (history.length > MAX_UNDO) history.shift();
  canUndo = true;
  updateUndoButton();
}

function undo() {
  if (!canUndo || history.length === 0) {
    Sound.invalid();
    return;
  }
  const prev = history.pop();
  tableau = prev.tableau.map(p => p.map(c => ({ ...c })));
  foundation = prev.foundation.map(p => p.map(c => ({ ...c })));
  stock = prev.stock.map(c => ({ ...c }));
  waste = prev.waste.map(c => ({ ...c }));
  moves = prev.moves;
  score = prev.score;
  seconds = prev.seconds;
  canUndo = history.length > 0;
  selectedCell = null;
  Sound.undo();
  renderBoard();
  updateUndoButton();
  updateDisplay();
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------
function showHint() {
  clearSelection();
  const available = getAvailableMoves();
  if (available.length === 0) {
    showToast('No moves available');
    Sound.invalid();
    return;
  }

  // Pick a foundation move if available, otherwise a random suggestion
  const foundationMove = available.find(m => m.destType === 'foundation');
  const move = foundationMove || available[Math.floor(Math.random() * available.length)];

  highlightHint(move);
  Sound.hint();
}

function getAvailableMoves() {
  const moves = [];

  // Waste to foundation
  if (waste.length > 0) {
    const card = waste[waste.length - 1];
    const f = isFoundationMove(card);
    if (f !== null) moves.push({ type: 'waste-foundation', card, source: 'waste', dest: f, destType: 'foundation' });
  }

  // Waste to tableau
  if (waste.length > 0) {
    const card = waste[waste.length - 1];
    const c = isTableauMove(card);
    if (c !== null) moves.push({ type: 'waste-tableau', card, source: 'waste', dest: c, destType: 'tableau' });
  }

  // Tableau to foundation
  for (let pile = 0; pile < 7; pile++) {
    const p = tableau[pile];
    if (p.length === 0) continue;
    const top = p[p.length - 1];
    if (!top.faceUp) continue;

    const f = isFoundationMove(top);
    if (f !== null) moves.push({ type: 'tableau-foundation', card: top, source: 'tableau', sourcePile: pile, dest: f, destType: 'foundation' });

    const c = isTableauMove(top, pile);
    if (c !== null) moves.push({ type: 'tableau-tableau', card: top, source: 'tableau', sourcePile: pile, dest: c, destType: 'tableau' });
  }

  return moves;
}

let hintTimer = null;

function highlightHint(move) {
  clearHintVisuals();

  if (move.source === 'tableau') {
    const cards = document.querySelectorAll(`.card[data-area="tableau"][data-pile="${move.sourcePile}"]`);
    cards.forEach(c => c.classList.add('hint'));
  } else if (move.source === 'waste') {
    document.querySelector('.slot[data-area="waste"]').classList.add('hint-target');
  }

  if (move.destType === 'foundation') {
    document.querySelector(`.slot[data-area="foundation"][data-pile="${move.dest}"]`).classList.add('hint-target');
  } else if (move.destType === 'tableau') {
    if (move.source === 'tableau') {
      const pile = document.querySelector(`.slot[data-area="tableau"][data-pile="${move.dest}"]`);
      if (pile) pile.classList.add('hint-target');
      else {
        const card = document.querySelector(`.card[data-area="tableau"][data-pile="${move.dest}"][data-index="0"]`);
        if (card) card.classList.add('hint-target');
      }
    }
  }

  hintTimer = setTimeout(clearHintVisuals, 3000);
}

function clearHintVisuals() {
  if (hintTimer) clearTimeout(hintTimer);
  document.querySelectorAll('.card.hint').forEach(c => c.classList.remove('hint'));
  document.querySelectorAll('.card.hint-target').forEach(c => c.classList.remove('hint-target'));
  document.querySelectorAll('.slot.hint-target').forEach(s => s.classList.remove('hint-target'));
  hintTimer = null;
}

// ---------------------------------------------------------------------------
// Auto finish
// ---------------------------------------------------------------------------
function updateAutoFinish() {
  if (!gameActive) return;
  const available = getAvailableMoves();
  if (available.length <= 1 && available.length > 0) {
    autoBtn.classList.remove('hidden');
  } else {
    autoBtn.classList.add('hidden');
  }
}

function autoFinish() {
  clearSelection();
  const available = getAvailableMoves();
  if (available.length === 0) return;

  // Prefer foundation moves
  const move = available.find(m => m.destType === 'foundation') || available[0];
  executeAutoMove(move);

  setTimeout(() => {
    if (gameActive) {
      updateAutoFinish();
    }
  }, 200);
}

function executeAutoMove(move) {
  if (move.source === 'waste') {
    moveWasteToFoundation();
  } else if (move.source === 'tableau') {
    // Move single top card to foundation
    if (move.destType === 'foundation') {
      const p = tableau[move.sourcePile];
      const card = p.pop();
      foundation[move.dest].push(card);
      score += 10;
      moves++;
      Sound.foundation();
      if (p.length > 0 && !p[p.length - 1].faceUp) {
        p[p.length - 1].faceUp = true;
        score += 5;
        Sound.flip();
      }
      saveState();
      renderBoard();
      checkWin();
    }
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
document.addEventListener('keydown', e => {
  if (!gameActive && !winModal.classList.contains('hidden')) {
    if (e.key === 'Enter' || e.key === ' ' || e.key.toLowerCase() === 'n') {
      playAgain();
    }
    return;
  }
  if (!gameActive) return;

  switch (e.key.toLowerCase()) {
    case 'z':
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); undo(); }
      break;
    case 'h':
      showHint();
      break;
    case 'n':
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault();
        if (confirm('Start a new game?')) startGame();
      }
      break;
    case ' ':
      e.preventDefault();
      break;
  }
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
$('#newBtn').addEventListener('click', () => {
  if (confirm('Start a new game?')) startGame();
});
$('#undoBtn').addEventListener('click', undo);
$('#hintBtn').addEventListener('click', showHint);
$('#soundBtn').addEventListener('click', () => {
  Sound.setMuted(!Sound.muted);
  saveSoundPreference(Sound.muted);
  updateSoundIcon();
});
playAgainBtn.addEventListener('click', playAgain);
autoBtn.addEventListener('click', autoFinish);

// Draw-mode segmented control (Draw 1 / Draw 3).
const segBtns = document.querySelectorAll('.seg-btn');
function updateSegUI() {
  segBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.draw) === drawCount));
}
segBtns.forEach((b) => {
  b.addEventListener('click', () => {
    drawCount = Number(b.dataset.draw);
    updateSegUI();
    startGame();
  });
});
updateSegUI();

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
highScore = loadHighScore();
Sound.setMuted(loadSoundPreference());
updateSoundIcon();
startGame();
