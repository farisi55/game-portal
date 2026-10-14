import { Sound } from './sound.js';
import { SUIT_PATHS, startCascade, stopCascade } from './win.js';

/* ================= Constants & state ================= */
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const isRed = s => s === 1 || s === 2;
const suitSvg = s => `<svg viewBox="0 0 24 24"><path fill="currentColor" d="${SUIT_PATHS[s]}"/></svg>`;
const wait = ms => new Promise(r => setTimeout(r, ms));

// Lucide "rotate-ccw" inlined (CDN dibuang demi CSP gimboot.com — hanya 'self').
const ROTATE_CCW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

/* ================= Gimboot integration ================= */
// Mirrors the pattern in games/kicau-mania/game.js — score is relayed to the
// portal shell via postMessage, best score persists in localStorage, and the
// shared ViralShare overlay is offered on a new record.
const STORAGE_KEY = 'solitaire_highScore';
const PARENT_MESSAGE_TYPE = 'arcade-score';

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

// When opened standalone (not inside the portal iframe) window.parent ===
// window, so this is a harmless no-op.
function reportScoreToParent(score) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage({ type: PARENT_MESSAGE_TYPE, score }, '*');
  } catch {}
}

const board = document.getElementById('board');
const $ = id => document.getElementById(id);

const cards = []; // { id, suit, rank, faceUp, el, x, y }
let S = null;     // { stock, waste, found[4], tab[7] }  (arrays of card ids)
let drawCount = 1;
let score = 0, moves = 0, seconds = 0, timerId = null, timerStarted = false;
let history = [];
let busy = false, won = false;
let L = null;     // layout
const slots = { stock: null, waste: null, found: [], tab: [] };
let drag = null;
let highScore = 0;

/* ================= Build DOM ================= */
function buildCards() {
  for (let s = 0; s < 4; s++) {
    for (let r = 1; r <= 13; r++) {
      const id = cards.length;
      const el = document.createElement('div');
      el.className = 'card' + (isRed(s) ? ' red' : '');
      el.dataset.id = id;
      let center;
      if (r > 10) center = `<div class="face-letter">${RANKS[r]}${suitSvg(s)}</div>`;
      else center = `<div class="pip-big">${suitSvg(s)}</div>`;
      el.innerHTML = `
        <div class="card-inner">
          <div class="face front">
            <div class="corner tl"><span class="r">${RANKS[r]}</span><span class="s">${suitSvg(s)}</span></div>
            <div class="corner tr"><span class="s">${suitSvg(s)}</span></div>
            ${center}
          </div>
          <div class="face back"></div>
        </div>`;
      board.appendChild(el);
      cards.push({ id, suit: s, rank: r, faceUp: false, el, x: 0, y: 0, z: 0, zt: null });
    }
  }
}

function buildSlots() {
  const mk = (cls, html = '') => {
    const d = document.createElement('div');
    d.className = 'slot ' + cls;
    d.innerHTML = html;
    board.appendChild(d);
    return d;
  };
  slots.stock = mk('stock-slot', ROTATE_CCW_SVG);
  slots.waste = mk('waste-slot');
  for (let i = 0; i < 4; i++) slots.found.push(mk('found-slot', suitSvg(i)));
  for (let i = 0; i < 7; i++) slots.tab.push(mk('tab-slot'));
}

/* ================= Layout ================= */
function computeLayout() {
  const W = board.clientWidth, H = board.clientHeight;
  const pad = Math.max(10, Math.min(24, W * 0.025));
  const gap = Math.max(5, Math.min(18, W * 0.016));
  const cw = Math.floor(Math.min(112, (W - 2 * pad - 6 * gap) / 7, (H - 2 * pad) / (1.4 * 3.1)));
  const ch = Math.round(cw * 1.4);
  const totalW = 7 * cw + 6 * gap;
  const left = (W - totalW) / 2;
  const colX = c => left + c * (cw + gap);
  const topY = pad;
  const tabY = pad + ch + Math.max(gap * 1.4, 14);
  document.documentElement.style.setProperty('--cw', cw + 'px');
  document.documentElement.style.setProperty('--ch', ch + 'px');
  L = { W, H, pad, gap, cw, ch, colX, topY, tabY };

  place(slots.stock, colX(0), topY);
  place(slots.waste, colX(1), topY);
  for (let i = 0; i < 4; i++) place(slots.found[i], colX(3 + i), topY);
  for (let i = 0; i < 7; i++) place(slots.tab[i], colX(i), tabY);
}
function place(el, x, y) { el.style.left = x + 'px'; el.style.top = y + 'px'; }

function tabOffsets(col) {
  const pile = S.tab[col];
  let down = L.cw * 0.13, up = L.cw * 0.3;
  let sum = 0;
  for (let i = 0; i < pile.length - 1; i++) sum += cards[pile[i]].faceUp ? up : down;
  const avail = L.H - L.tabY - L.pad - L.ch;
  const k = sum > avail && sum > 0 ? Math.max(0.35, avail / sum) : 1;
  return { down: down * k, up: up * k };
}

/* ================= Render ================= */
function setCard(c, x, y, z) {
  const moved = Math.abs(c.x - x) > 0.5 || Math.abs(c.y - y) > 0.5;
  c.x = x; c.y = y;
  c.el.style.transform = `translate(${x}px, ${y}px)`;
  c.el.classList.toggle('faceup', c.faceUp);
  c.z = z;
  if (moved) {
    clearTimeout(c.zt);
    c.el.style.zIndex = 2000 + z;
    c.zt = setTimeout(() => { c.el.style.zIndex = c.z; c.zt = null; }, 300);
  } else if (!c.zt) {
    c.el.style.zIndex = z;
  }
}

function render() {
  const { colX, topY, tabY, cw } = L;
  S.stock.forEach((id, i) => {
    const c = cards[id];
    const lift = Math.floor(i / 8) * 0.6;
    setCard(c, colX(0) - lift, topY - lift, 100 + i);
    c.el.classList.add('in-stock');
  });
  const wl = S.waste.length;
  const fanStart = Math.max(0, wl - (drawCount === 3 ? 3 : 1));
  S.waste.forEach((id, i) => {
    const c = cards[id];
    const off = drawCount === 3 && i >= fanStart ? (i - fanStart) * cw * 0.24 : 0;
    setCard(c, colX(1) + off, topY, 200 + i);
    c.el.classList.remove('in-stock');
  });
  S.found.forEach((pile, f) => pile.forEach((id, i) => {
    setCard(cards[id], colX(3 + f), topY, 300 + i);
    cards[id].el.classList.remove('in-stock');
  }));
  S.tab.forEach((pile, col) => {
    const o = tabOffsets(col);
    let y = tabY;
    pile.forEach((id, i) => {
      const c = cards[id];
      setCard(c, colX(col), y, 400 + i);
      c.el.classList.remove('in-stock');
      y += c.faceUp ? o.up : o.down;
    });
  });
  slots.stock.querySelector('svg')?.style.setProperty('opacity', S.stock.length ? '0' : '1');
  updateHud();
}

function renderInstant() {
  board.classList.add('instant');
  render();
  cards.forEach(c => { clearTimeout(c.zt); c.zt = null; c.el.style.zIndex = c.z; });
  void board.offsetWidth;
  board.classList.remove('instant');
}

/* ================= HUD ================= */
function fmtTime(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function updateHud() {
  $('score').textContent = score;
  $('moves').textContent = moves;
  $('time').textContent = fmtTime(seconds);
  $('undoBtn').disabled = history.length === 0 || busy;
  $('autoBtn').classList.toggle('hidden', !canAutoFinish() || busy);
}
function startTimer() {
  if (timerStarted) return;
  timerStarted = true;
  timerId = setInterval(() => { seconds++; $('time').textContent = fmtTime(seconds); }, 1000);
}
function stopTimer() { clearInterval(timerId); timerId = null; }

let toastT;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ================= Rules ================= */
const top = arr => arr[arr.length - 1];
function pileOf(ref) {
  if (ref.t === 'stock') return S.stock;
  if (ref.t === 'waste') return S.waste;
  if (ref.t === 'found') return S.found[ref.i];
  return S.tab[ref.i];
}
function locate(id) {
  let i;
  if ((i = S.stock.indexOf(id)) >= 0) return { ref: { t: 'stock' }, index: i };
  if ((i = S.waste.indexOf(id)) >= 0) return { ref: { t: 'waste' }, index: i };
  for (let f = 0; f < 4; f++) if ((i = S.found[f].indexOf(id)) >= 0) return { ref: { t: 'found', i: f }, index: i };
  for (let c = 0; c < 7; c++) if ((i = S.tab[c].indexOf(id)) >= 0) return { ref: { t: 'tab', i: c }, index: i };
  return null;
}
function canFound(card, f) {
  if (card.suit !== f) return false;
  const p = S.found[f];
  return p.length === 0 ? card.rank === 1 : cards[top(p)].rank === card.rank - 1;
}
function canTab(card, col) {
  const p = S.tab[col];
  if (p.length === 0) return card.rank === 13;
  const t = cards[top(p)];
  return t.faceUp && isRed(t.suit) !== isRed(card.suit) && t.rank === card.rank + 1;
}
function canDrop(ids, ref) {
  const lead = cards[ids[0]];
  if (ref.t === 'found') return ids.length === 1 && canFound(lead, ref.i);
  if (ref.t === 'tab') return canTab(lead, ref.i);
  return false;
}
function canAutoFinish() {
  if (!S || won) return false;
  if (S.stock.length || S.waste.length) return false;
  return S.tab.some(p => p.length) && S.tab.every(p => p.every(id => cards[id].faceUp));
}

/* ================= History ================= */
function snapshot() {
  history.push({
    stock: [...S.stock], waste: [...S.waste],
    found: S.found.map(p => [...p]), tab: S.tab.map(p => [...p]),
    up: cards.map(c => c.faceUp), score, moves,
  });
  if (history.length > 500) history.shift();
}
function undo() {
  if (busy || !history.length) return;
  clearHints();
  const h = history.pop();
  S = { stock: h.stock, waste: h.waste, found: h.found, tab: h.tab };
  const flipped = cards.some((c, i) => c.faceUp !== h.up[i]);
  cards.forEach((c, i) => c.faceUp = h.up[i]);
  score = h.score; moves = h.moves + 1;
  render();
  flipped ? Sound.flip() : Sound.place();
}

/* ================= Actions ================= */
function moveCards(from, startIndex, to) {
  snapshot();
  startTimer();
  const src = pileOf(from);
  const moving = src.splice(startIndex);
  pileOf(to).push(...moving);
  moves++;

  // Scoring (standard)
  if (to.t === 'found' && from.t !== 'found') score += 10;
  if (from.t === 'waste' && to.t === 'tab') score += 5;
  if (from.t === 'found' && to.t === 'tab') score = Math.max(0, score - 15);

  let flipped = false;
  if (from.t === 'tab' && src.length && !cards[top(src)].faceUp) {
    cards[top(src)].faceUp = true;
    score += 5;
    flipped = true;
  }
  render();
  to.t === 'found' ? Sound.foundation() : Sound.place();
  if (flipped) setTimeout(() => Sound.flip(), 120);
  checkWin();
}

function drawStock() {
  if (busy) return;
  clearHints();
  if (!S.stock.length && !S.waste.length) return;
  snapshot();
  startTimer();
  moves++;
  if (S.stock.length) {
    const n = Math.min(drawCount, S.stock.length);
    for (let i = 0; i < n; i++) {
      const id = S.stock.pop();
      cards[id].faceUp = true;
      S.waste.push(id);
    }
    render();
    Sound.flip();
  } else {
    while (S.waste.length) {
      const id = S.waste.pop();
      cards[id].faceUp = false;
      S.stock.push(id);
    }
    if (drawCount === 1) score = Math.max(0, score - 100);
    render();
    Sound.recycle();
  }
}

function bestTarget(ids, from) {
  const lead = cards[ids[0]];
  if (ids.length === 1 && from.t !== 'found' && canFound(lead, lead.suit)) return { t: 'found', i: lead.suit };
  const loc = locate(ids[0]);
  const options = [];
  for (let c = 0; c < 7; c++) {
    if (from.t === 'tab' && from.i === c) continue;
    if (!canTab(lead, c)) continue;
    // Moving a king that's already at the bottom of a column to an empty one is pointless
    if (S.tab[c].length === 0 && from.t === 'tab' && loc.index === 0) continue;
    options.push({ c, empty: S.tab[c].length === 0 });
  }
  options.sort((a, b) => a.empty - b.empty);
  if (options.length) return { t: 'tab', i: options[0].c };
  return null;
}

function tapCard(id) {
  const loc = locate(id);
  const ids = pileOf(loc.ref).slice(loc.index);
  const target = bestTarget(ids, loc.ref);
  if (target) moveCards(loc.ref, loc.index, target);
  else {
    Sound.invalid();
    ids.forEach(i => {
      const el = cards[i].el;
      el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 400);
    });
  }
}

/* ================= Drag & drop ================= */
board.addEventListener('pointerdown', e => {
  if (e.button !== undefined && e.button !== 0) return;
  Sound.unlock();
  if (busy || won) return;
  const slot = e.target.closest('.slot');
  if (slot === slots.stock) { drawStock(); return; }
  const el = e.target.closest('.card');
  if (!el) return;
  const id = +el.dataset.id;
  const loc = locate(id);
  if (!loc) return;
  if (loc.ref.t === 'stock') { drawStock(); return; }
  const pile = pileOf(loc.ref);
  if (!cards[id].faceUp) return;
  if ((loc.ref.t === 'waste' || loc.ref.t === 'found') && loc.index !== pile.length - 1) return;
  clearHints();
  const ids = pile.slice(loc.index);
  drag = {
    ids, from: loc.ref, index: loc.index, sx: e.clientX, sy: e.clientY, moved: false,
    origin: ids.map(i => ({ x: cards[i].x, y: cards[i].y })), target: null,
  };
  e.preventDefault();
});

window.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    drag.ids.forEach((id, k) => {
      const c = cards[id];
      clearTimeout(c.zt);
      c.el.classList.add('dragging');
      c.el.style.zIndex = 5000 + k;
    });
  }
  drag.ids.forEach((id, k) => {
    const o = drag.origin[k];
    cards[id].el.style.transform = `translate(${o.x + dx}px, ${o.y + dy}px) scale(1.03)`;
  });
  const t = findDropTarget(drag.origin[0].x + dx, drag.origin[0].y + dy);
  if (!sameRef(t, drag.target)) {
    setDropHighlight(drag.target, false);
    drag.target = t;
    setDropHighlight(t, true);
  }
});

function endDrag(e, cancel) {
  if (!drag) return;
  const d = drag;
  drag = null;
  setDropHighlight(d.target, false);
  d.ids.forEach(id => cards[id].el.classList.remove('dragging'));
  if (!d.moved) {
    if (!cancel) tapCard(d.ids[0]);
    return;
  }
  // force animated return/move from current dragged position
  d.ids.forEach((id, k) => {
    const c = cards[id];
    c.x = -9999; // ensure it's treated as moved for z-index bump
  });
  if (!cancel && d.target) moveCards(d.from, d.index, d.target);
  else {
    if (!cancel) Sound.invalid();
    render();
  }
}
window.addEventListener('pointerup', e => endDrag(e, false));
window.addEventListener('pointercancel', e => endDrag(e, true));

function sameRef(a, b) { return (!a && !b) || (a && b && a.t === b.t && a.i === b.i); }

function pileRect(ref) {
  const { colX, topY, tabY, cw, ch } = L;
  if (ref.t === 'found') return { x: colX(3 + ref.i), y: topY, w: cw, h: ch };
  const p = S.tab[ref.i];
  const lastY = p.length ? cards[top(p)].y : tabY;
  return { x: colX(ref.i), y: tabY, w: cw, h: Math.max(lastY - tabY, 0) + ch };
}

function findDropTarget(x, y) {
  const { cw, ch } = L;
  let best = null, bestArea = 0;
  const refs = [...[0, 1, 2, 3].map(i => ({ t: 'found', i })), ...[0, 1, 2, 3, 4, 5, 6].map(i => ({ t: 'tab', i }))];
  for (const ref of refs) {
    if (sameRef(ref, drag.from)) continue;
    if (!canDrop(drag.ids, ref)) continue;
    const r = pileRect(ref);
    // only the bottom-most card area of a tableau column counts heavily
    const ox = Math.max(0, Math.min(x + cw, r.x + r.w) - Math.max(x, r.x));
    const oy = Math.max(0, Math.min(y + ch, r.y + r.h) - Math.max(y, r.y));
    const area = ox * oy;
    if (area > bestArea) { bestArea = area; best = ref; }
  }
  return bestArea > cw * ch * 0.08 ? best : null;
}

function targetEl(ref) {
  if (!ref) return null;
  const p = pileOf(ref);
  if (p.length) return cards[top(p)].el;
  return ref.t === 'found' ? slots.found[ref.i] : slots.tab[ref.i];
}
function setDropHighlight(ref, on) {
  const el = targetEl(ref);
  if (el) el.classList.toggle('drop-ok', on);
}

/* ================= Hints ================= */
let hintTimer = null;
function clearHints() {
  clearTimeout(hintTimer);
  document.querySelectorAll('.hint, .hint-target').forEach(el => el.classList.remove('hint', 'hint-target'));
}
function findHint() {
  const cand = [];
  const sources = [];
  if (S.waste.length) sources.push({ ref: { t: 'waste' }, index: S.waste.length - 1 });
  for (let c = 0; c < 7; c++) {
    const p = S.tab[c];
    if (!p.length) continue;
    const firstUp = p.findIndex(id => cards[id].faceUp);
    for (let i = firstUp; i >= 0 && i < p.length; i++) sources.push({ ref: { t: 'tab', i: c }, index: i });
  }
  for (const s of sources) {
    const p = pileOf(s.ref);
    const ids = p.slice(s.index);
    const lead = cards[ids[0]];
    // To foundation
    if (ids.length === 1 && canFound(lead, lead.suit)) {
      cand.push({ pr: 1, s, to: { t: 'found', i: lead.suit } });
      continue;
    }
    for (let c = 0; c < 7; c++) {
      if (s.ref.t === 'tab' && s.ref.i === c) continue;
      if (!canTab(lead, c)) continue;
      const emptyTarget = S.tab[c].length === 0;
      if (s.ref.t === 'waste') { cand.push({ pr: 3, s, to: { t: 'tab', i: c } }); break; }
      const below = s.index > 0 ? cards[p[s.index - 1]] : null;
      if (below && !below.faceUp) cand.push({ pr: 2, s, to: { t: 'tab', i: c } });
      else if (below && below.faceUp && canFound(below, below.suit)) cand.push({ pr: 3, s, to: { t: 'tab', i: c } });
      else if (!below && !emptyTarget && hasKeyToPlace(s.ref.i)) cand.push({ pr: 4, s, to: { t: 'tab', i: c } });
      if (cand.length && cand[cand.length - 1].s === s) break;
    }
  }
  cand.sort((a, b) => a.pr - b.pr);
  if (cand.length) return cand[0];
  if (S.stock.length) return { stock: true };
  if (S.waste.length) return { stock: true, recycle: true };
  return null;
}
function hasKeyToPlace(exceptCol) {
  const w = S.waste.length && cards[top(S.waste)];
  if (w && w.rank === 13) return true;
  return S.tab.some((p, c) => c !== exceptCol && p.some((id, i) => i > 0 && cards[id].faceUp && cards[id].rank === 13 && !cards[p[i - 1]].faceUp));
}
function showHint() {
  if (busy || won) return;
  clearHints();
  const h = findHint();
  if (!h) { toast('No more moves available. Try undo or a new game.'); Sound.invalid(); return; }
  if (h.stock) {
    const el = S.stock.length ? cards[top(S.stock)].el : slots.stock;
    el.classList.add(S.stock.length ? 'hint' : 'hint-target');
    toast(h.recycle ? 'Recycle the waste pile back into the stock.' : 'Draw a card from the stock.');
  } else {
    pileOf(h.s.ref).slice(h.s.index).forEach(id => cards[id].el.classList.add('hint'));
    const tEl = targetEl(h.to);
    if (tEl) tEl.classList.add('hint-target');
  }
  hintTimer = setTimeout(clearHints, 1800);
}

/* ================= Auto finish & win ================= */
async function autoFinish() {
  if (busy || !canAutoFinish()) return;
  busy = true;
  updateHud();
  while (!won) {
    let pick = null;
    for (let c = 0; c < 7; c++) {
      const p = S.tab[c];
      if (!p.length) continue;
      const card = cards[top(p)];
      if (canFound(card, card.suit) && (!pick || card.rank < cards[top(S.tab[pick])].rank)) pick = c;
    }
    if (pick === null) break;
    busy = false;
    moveCards({ t: 'tab', i: pick }, S.tab[pick].length - 1, { t: 'found', i: cards[top(S.tab[pick])].suit });
    if (won) return;
    busy = true;
    await wait(110);
  }
  busy = false;
  updateHud();
}

function checkWin() {
  if (S.found.every(p => p.length === 13)) {
    won = true;
    stopTimer();
    updateHud();
    setTimeout(celebrate, 450);
  }
}

function celebrate() {
  Sound.win();
  const rect = board.getBoundingClientRect();
  const items = [];
  for (let r = 13; r >= 1; r--) {
    for (let f = 0; f < 4; f++) {
      const c = cards[S.found[f][r - 1]];
      items.push({
        suit: c.suit, rank: c.rank,
        x: rect.left + c.x, y: rect.top + c.y,
        onLaunch: () => { c.el.style.visibility = 'hidden'; },
      });
    }
  }
  startCascade(items, L.cw, L.ch);
  $('winTime').textContent = fmtTime(seconds);
  $('winMoves').textContent = moves;
  $('winScore').textContent = score;

  // Gimboot: best-score tracking + report to the portal shell. Solitaire has
  // no additive score bonus (unlike kicau-mania) — the final score is the
  // running score at the moment all 52 cards reach the foundations.
  const isNewRecord = score > highScore;
  if (isNewRecord) {
    highScore = score;
    saveHighScore(highScore);
  }
  $('winHighScore').textContent = isNewRecord ? `${highScore} (new record!)` : highScore;
  reportScoreToParent(score);

  setTimeout(() => {
    if (!won) return;
    $('winModal').classList.remove('hidden');
    if (isNewRecord) {
      try {
        if (window.ViralShare) {
          ViralShare.show('solitaire', score, () => $('winModal').classList.add('hidden'));
        }
      } catch (err) {
        console.error('[Solitaire] ViralShare failed:', err);
      }
    }
  }, 3200);
}

/* ================= New game & deal ================= */
function shuffleIds() {
  const a = cards.map(c => c.id);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let dealToken = 0;
async function newGame() {
  const token = ++dealToken;
  busy = true; won = false;
  stopCascade();
  $('winModal').classList.add('hidden');
  clearHints();
  stopTimer();
  timerStarted = false; seconds = 0; score = 0; moves = 0; history = [];
  cards.forEach(c => { c.el.style.visibility = ''; });

  const firstDeal = !S;
  const wasSpread = S && (S.waste.length || S.tab.some(p => p.length) || S.found.some(p => p.length));
  cards.forEach(c => c.faceUp = false);
  S = { stock: shuffleIds(), waste: [], found: [[], [], [], []], tab: [[], [], [], [], [], [], []] };
  if (firstDeal) renderInstant(); else render();
  updateHud();
  if (wasSpread) await wait(420);
  if (token !== dealToken) return;

  Sound.shuffle();
  // small riffle wiggle on the stock
  const stack = S.stock.slice(-14);
  stack.forEach((id, k) => {
    const c = cards[id];
    c.el.style.transform = `translate(${c.x + (k % 2 ? 1 : -1) * L.cw * 0.18}px, ${c.y}px)`;
  });
  await wait(330);
  stack.forEach(id => { const c = cards[id]; c.el.style.transform = `translate(${c.x}px, ${c.y}px)`; });
  await wait(450);
  if (token !== dealToken) return;

  for (let r = 0; r < 7; r++) {
    for (let c = r; c < 7; c++) {
      if (token !== dealToken) return;
      S.tab[c].push(S.stock.pop());
      render();
      Sound.deal();
      await wait(55);
    }
  }
  await wait(220);
  for (let c = 0; c < 7; c++) {
    if (token !== dealToken) return;
    cards[top(S.tab[c])].faceUp = true;
    render();
    Sound.flip();
    await wait(80);
  }
  busy = false;
  updateHud();
}

/* ================= Controls ================= */
function setDraw(n, restart) {
  drawCount = n;
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', +b.dataset.draw === n));
  if (restart) { toast(`New game · Draw ${n}`); newGame(); }
}
document.querySelectorAll('.seg-btn').forEach(b =>
  b.addEventListener('click', () => { if (+b.dataset.draw !== drawCount) setDraw(+b.dataset.draw, true); }));

$('newBtn').addEventListener('click', () => { Sound.unlock(); newGame(); });
$('playAgainBtn').addEventListener('click', () => { Sound.unlock(); newGame(); });
$('undoBtn').addEventListener('click', undo);
$('hintBtn').addEventListener('click', () => { Sound.unlock(); showHint(); });
$('autoBtn').addEventListener('click', autoFinish);
$('soundBtn').addEventListener('click', () => {
  Sound.setMuted(!Sound.muted);
  $('soundBtn').classList.toggle('muted', Sound.muted);
  toast(Sound.muted ? 'Sound off' : 'Sound on');
});

window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'h') showHint();
  else if (k === 'n') newGame();
  else if (k === 'u') undo();
  else if (k === ' ' || k === 'd') { e.preventDefault(); drawStock(); }
});

let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { computeLayout(); renderInstant(); }, 60);
});

/* ================= Boot ================= */
highScore = loadHighScore();
buildSlots();
buildCards();
computeLayout();
setDraw(1, false);
newGame();
