const HIGH_SCORE_KEY = 'arcade-high-score-v1';

function readHighScore() {
  const raw = localStorage.getItem(HIGH_SCORE_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function writeHighScore(value) {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) return;

  const current = readHighScore();
  if (next > current) {
    localStorage.setItem(HIGH_SCORE_KEY, String(next));
    updateHighScoreUI(next);
  }
}

function updateHighScoreUI(value = readHighScore()) {
  const el = document.getElementById('high-score');
  if (el) {
    el.textContent = `High Score: ${value}`;
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Ignore registration errors in local development.
    });
  });
}

function wireScoreMessages() {
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // Our own locally-hosted games (e.g. games/kicau-mania) post this shape.
    if (data.type === 'arcade-score') {
      writeHighScore(data.score);
      return;
    }

    // GamePix's embedded games post this shape natively — see
    // https://docs.gamepix.com/docs ("Handling Events").
    if (data.type === 'update_score' && typeof data.score !== 'undefined') {
      writeHighScore(data.score);
    }
  });
}

function initPwa() {
  updateHighScoreUI();
  registerServiceWorker();
  wireScoreMessages();
}

document.addEventListener('DOMContentLoaded', initPwa);
