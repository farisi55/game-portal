'use strict';

/* ============================================================================
   KICAU MANIA — Flappy Bird bertema kontes burung berkicau
   Arsitektur: Config -> Assets (SVG->Image) -> Audio -> State -> Input ->
               Update -> Collision -> Draw -> Loop -> Parent bridge (postMessage)
   ============================================================================ */

/* ---------------------------------------------------------------------------
   1. CONFIG
   Resolusi internal (logical) tetap; ukuran fisik di layar diatur terpisah
   lewat resizeCanvas() supaya rasio aspek selalu terjaga di semua device.
--------------------------------------------------------------------------- */
const CONFIG = {
  BASE_W: 360,
  BASE_H: 640,
  GROUND_H: 64,

  GRAVITY: 1400,          // px/s^2
  FLAP_VELOCITY: -380,    // px/s (impuls ke atas)
  MAX_FALL_SPEED: 620,    // px/s
  MAX_ROTATION_UP: -0.5,  // radian, dongak saat naik
  MAX_ROTATION_DOWN: 1.3, // radian, menukik saat jatuh

  BIRD_X: 100,
  BIRD_RADIUS: 15,
  WING_FRAME_MS: 90,

  PIPE_W: 56,
  PIPE_GAP: 168,
  PIPE_SPEED: 130,        // px/s
  PIPE_SPAWN_MS: 1500,
  PIPE_MIN_MARGIN: 70,    // jarak minimum gap ke langit-langit / tanah

  PARALLAX_MOUNTAIN: 18,  // px/s
  PARALLAX_TREES: 55,     // px/s

  STORAGE_KEY: 'kicauMania_highScore',
  MAX_DT_MS: 34,          // clamp delta time (~30fps) agar tidak "meloncat" setelah tab disembunyikan

  // Nama pesan yang dikirim ke window.parent lewat postMessage setiap game
  // over, supaya portal (js/pwa.js) bisa memperbarui high-score gabungannya
  // sendiri. Formatnya cocok dengan yang sudah didengarkan js/pwa.js.
  PARENT_MESSAGE_TYPE: 'arcade-score',
};

/* ---------------------------------------------------------------------------
   2. ASSETS — semua visual di-generate sebagai string SVG lalu dirender ke
   Image() lewat data URI base64. Tidak ada file .png/.jpg eksternal sama sekali.
--------------------------------------------------------------------------- */

function svgToDataUri(svg) {
  const encoded = btoa(unescape(encodeURIComponent(svg)));
  return 'data:image/svg+xml;base64,' + encoded;
}

function loadSvgImage(svg) {
  const img = new Image();
  img.src = svgToDataUri(svg);
  return img;
}

// --- Burung "Murai Batu": badan hitam mengilap, dada rufous, ekor bercabang
// putih-hitam. 3 frame sayap (up/mid/down) untuk animasi kepakan.
function buildBirdSVG(wing) {
  const wingPaths = {
    up: 'M24,18 C30,4 42,4 40,16 C34,14 28,16 24,18 Z',
    mid: 'M22,22 C30,16 42,18 40,24 C32,26 26,25 22,22 Z',
    down: 'M22,26 C28,36 40,38 38,28 C32,24 26,24 22,26 Z',
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 50">
    <path d="M18,22 L2,10 L10,22 L2,34 L18,26 Z" fill="#100f0d"/>
    <path d="M18,23 L6,16 L11,23 L6,30 L18,25 Z" fill="#f4f1e8"/>
    <ellipse cx="30" cy="24" rx="16" ry="13" fill="#131211"/>
    <ellipse cx="23" cy="15" rx="5.5" ry="4.2" fill="#f4f1e8"/>
    <path d="${wingPaths[wing]}" fill="#1c1a18"/>
    <ellipse cx="33" cy="30" rx="10" ry="8" fill="#c9601c"/>
    <circle cx="38" cy="18" r="3.4" fill="#fff"/>
    <circle cx="39" cy="18" r="1.7" fill="#141414"/>
    <path d="M46,21 L55,23 L46,26 Z" fill="#e8a13a"/>
  </svg>`;
}

// --- Tiang Bambu Gantangan: pengganti pipa hijau. Satu tekstur badan bambu
// (bisa diulang vertikal) + satu "cap" berisi palang gantangan horizontal.
// Body dan cap dirancang dalam satu sistem koordinat yang sama: 60 unit
// pertama pada keduanya mengacu ke lebar tiang yang sama (rim cap x=4..56,
// pusat di x=30 — sama seperti rect badan x=8..52, pusat juga x=30). Cap
// hanya menambah unit ekstra di kanan untuk palang gantangan. drawPipe()
// memakai dua konstanta ini untuk menyamakan skala per-unit keduanya saat
// digambar, supaya sisi tiang cap dan badan selalu presisi menyatu — lihat
// catatan di drawPipe().
const BAMBOO_BODY_VIEWBOX_W = 60;
const BAMBOO_CAP_VIEWBOX_W = 76;

function buildBambooBodySVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BAMBOO_BODY_VIEWBOX_W} 120">
    <defs>
      <linearGradient id="bb" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#6b9b2e"/>
        <stop offset="45%" stop-color="#a8d66b"/>
        <stop offset="100%" stop-color="#557f22"/>
      </linearGradient>
    </defs>
    <rect x="8" y="0" width="44" height="120" fill="url(#bb)"/>
    <rect x="8" y="0" width="44" height="7" fill="#3f5c18" opacity="0.75"/>
    <rect x="8" y="38" width="44" height="7" fill="#3f5c18" opacity="0.75"/>
    <rect x="8" y="76" width="44" height="7" fill="#3f5c18" opacity="0.75"/>
    <rect x="8" y="113" width="44" height="7" fill="#3f5c18" opacity="0.75"/>
    <rect x="12" y="0" width="4" height="120" fill="#fff" opacity="0.18"/>
  </svg>`;
}

// Rim sengaja dibuat SETINGGI PENUH viewBox (y=0..46, tanpa rx/sudut
// membulat) supaya tidak ada margin transparan di sisi yang menyambung ke
// badan, dan tidak ada sudut membulat yang bentrok dengan sudut siku badan
// — dua hal ini yang sebelumnya membuat terlihat ada jeda di sambungannya.
function buildBambooCapSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BAMBOO_CAP_VIEWBOX_W} 46">
    <defs>
      <linearGradient id="bc" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#77a83a"/>
        <stop offset="50%" stop-color="#b3dd7f"/>
        <stop offset="100%" stop-color="#4d7420"/>
      </linearGradient>
    </defs>
    <rect x="4" y="0" width="52" height="46" fill="url(#bc)"/>
    <rect x="4" y="0" width="52" height="46" fill="none" stroke="#3f5c18" stroke-width="1.5" opacity="0.6"/>
    <rect x="56" y="18" width="15" height="9" rx="3" fill="#8a5a2e"/>
    <circle cx="73" cy="22.5" r="5.2" fill="#6b4321"/>
    <path d="M56,18 L61,12 L66,18 Z" fill="#6b4321" opacity="0.7"/>
  </svg>`;
}

// --- Latar: pegunungan jauh (parallax lambat) dan pepohonan (parallax sedang),
// keduanya dibangun dari path gelombang periodik agar bisa di-tile mulus.
function buildMountainsSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220">
    <path d="M0,150 Q50,105 100,150 T200,150 T300,150 T400,150 L400,220 L0,220 Z" fill="#9fc2ad"/>
    <path d="M0,175 Q60,140 120,175 T240,175 T360,175 T480,175 L400,220 L0,220 Z" fill="#82ac93"/>
  </svg>`;
}

function buildTreesSVG() {
  let blobs = '';
  const positions = [30, 95, 160, 225, 290, 355];
  positions.forEach((x, i) => {
    const h = i % 2 === 0 ? 70 : 56;
    blobs += `<rect x="${x - 4}" y="${150 - h * 0.35}" width="8" height="${h * 0.35}" fill="#5c3d1e"/>`;
    blobs += `<circle cx="${x}" cy="${150 - h * 0.35}" r="${h * 0.42}" fill="#3f7d45"/>`;
    blobs += `<circle cx="${x - 18}" cy="${150 - h * 0.3}" r="${h * 0.3}" fill="#488a4d"/>`;
    blobs += `<circle cx="${x + 18}" cy="${150 - h * 0.3}" r="${h * 0.3}" fill="#488a4d"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150">${blobs}</svg>`;
}

function buildGroundSVG() {
  let tufts = '';
  let dots = '';
  for (let x = 10; x < 400; x += 26) {
    tufts += `<path d="M${x},18 L${x + 4},4 L${x + 8},18 Z" fill="#6ab13f"/>`;
  }
  for (let x = 14; x < 400; x += 21) {
    const y = 34 + ((x * 7) % 22);
    dots += `<circle cx="${x}" cy="${y}" r="1.6" fill="#79471f" opacity="0.6"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 80">
    <rect x="0" y="0" width="400" height="80" fill="#8a5a2e"/>
    <rect x="0" y="0" width="400" height="18" fill="#7ec850"/>
    ${tufts}
    ${dots}
  </svg>`;
}

const assets = {
  bird: { up: null, mid: null, down: null },
  bambooBody: null,
  bambooCap: null,
  mountains: null,
  trees: null,
  ground: null,
};

let assetsReadyCount = 0;
const ASSET_TOTAL = 8; // bird.up, bird.mid, bird.down, bambooBody, bambooCap, mountains, trees, ground
let onAssetsReady = null;

function markReady() {
  assetsReadyCount++;
  if (assetsReadyCount >= ASSET_TOTAL && typeof onAssetsReady === 'function') {
    onAssetsReady();
    onAssetsReady = null;
  }
}

function preloadAssets(callback) {
  onAssetsReady = callback;

  assets.bird.up = loadSvgImage(buildBirdSVG('up'));
  assets.bird.mid = loadSvgImage(buildBirdSVG('mid'));
  assets.bird.down = loadSvgImage(buildBirdSVG('down'));
  assets.bambooBody = loadSvgImage(buildBambooBodySVG());
  assets.bambooCap = loadSvgImage(buildBambooCapSVG());
  assets.mountains = loadSvgImage(buildMountainsSVG());
  assets.trees = loadSvgImage(buildTreesSVG());
  assets.ground = loadSvgImage(buildGroundSVG());

  [
    assets.bird.up, assets.bird.mid, assets.bird.down,
    assets.bambooBody, assets.bambooCap, assets.mountains, assets.trees, assets.ground,
  ].forEach((img) => {
    if (img.complete) {
      markReady();
    } else {
      img.onload = markReady;
      // Defensif: satu aset yang gagal decode tidak boleh membuat game
      // tersangkut selamanya di layar loading — anggap "selesai" juga.
      img.onerror = markReady;
    }
  });
}

/* ---------------------------------------------------------------------------
   3. AUDIO — efek suara pendek lewat Web Audio API (oscillator), tanpa file
   audio eksternal. Di-mute otomatis saat tab/iframe disembunyikan.
--------------------------------------------------------------------------- */
const SOUND_PREF_KEY = 'kicauMania_soundMuted';

function loadSoundPreference() {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveSoundPreference(muted) {
  try {
    localStorage.setItem(SOUND_PREF_KEY, String(muted));
  } catch {
    // localStorage bisa gagal (mode privat) — tidak fatal, preferensi cukup berlaku untuk sesi ini.
  }
}

const AudioFX = {
  ctx: null,
  userMuted: false, // preferensi eksplisit dari tombol, tersimpan di localStorage
  tabHidden: false, // status sementara saat tab/iframe tersembunyi

  get muted() {
    return this.userMuted || this.tabHidden;
  },

  ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (!this.muted && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },

  applyMuteState() {
    if (!this.ctx) return;
    if (this.muted) {
      if (this.ctx.state === 'running') this.ctx.suspend();
    } else if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  setUserMuted(muted) {
    this.userMuted = muted;
    saveSoundPreference(muted);
    this.applyMuteState();
  },

  setTabHidden(hidden) {
    this.tabHidden = hidden;
    this.applyMuteState();
  },

  tone(freq, duration, type, gainStart) {
    if (this.muted) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = gainStart;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  },

  flap() { this.tone(340, 0.09, 'square', 0.15); },
  score() { this.tone(950, 0.12, 'sine', 0.18); },
  hit() { this.tone(120, 0.25, 'sawtooth', 0.2); },
};

/* ---------------------------------------------------------------------------
   3b. MUSIK LATAR — bukan file audio (.mp3/.mid) yang diimpor, melainkan
   "partitur" (nama not + durasi) yang ditulis langsung di JS dan dimainkan
   lewat oscillator — mirip semangat MIDI: yang disimpan adalah instruksi
   nada, bukan gelombang suara hasil rekaman. Dijadwalkan presisi memakai
   jam AudioContext sendiri (bukan setTimeout) supaya tidak ada jeda/geser
   antar not walau frame rate game naik-turun.
--------------------------------------------------------------------------- */
const NOTE_SEMITONE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

function noteToFrequency(note) {
  const match = /^([A-G]#?)(\d)$/.exec(note);
  if (!match) return 440;
  const [, name, octaveStr] = match;
  const semitoneFromA4 = (parseInt(octaveStr, 10) - 4) * 12 + (NOTE_SEMITONE[name] - NOTE_SEMITONE.A);
  return 440 * Math.pow(2, semitoneFromA4 / 12);
}

const MUSIC_BPM = 140;
const BEAT = 60 / MUSIC_BPM;
const EIGHTH = BEAT / 2;

// Melodi pentatonik ceria (C D E G A) — tangga nada yang "aman", tidak ada
// interval sumbang, cocok untuk tema kicauan burung dan enak diulang-ulang
// sebagai musik latar tanpa terasa mengganggu.
const MELODY = [
  { note: 'C5', dur: EIGHTH }, { note: 'E5', dur: EIGHTH }, { note: 'G5', dur: EIGHTH }, { note: 'E5', dur: EIGHTH },
  { note: 'D5', dur: EIGHTH }, { note: 'E5', dur: EIGHTH }, { note: 'D5', dur: EIGHTH }, { note: 'C5', dur: EIGHTH },
  { note: 'E5', dur: EIGHTH }, { note: 'G5', dur: EIGHTH }, { note: 'A5', dur: EIGHTH }, { note: 'G5', dur: EIGHTH },
  { note: 'E5', dur: EIGHTH }, { note: 'D5', dur: EIGHTH }, { note: 'C5', dur: EIGHTH }, { note: 'C5', dur: BEAT },
];

const MusicFX = {
  playing: false,
  noteIndex: 0,
  nextNoteTime: 0,
  scheduleAheadTime: 0.15, // detik — jadwalkan not yang jatuh dalam 150ms ke depan

  start() {
    if (this.playing) return;
    const ctx = AudioFX.ensureCtx();
    if (!ctx) return;
    this.playing = true;
    this.noteIndex = 0;
    this.nextNoteTime = ctx.currentTime + 0.05;
  },

  scheduleNote(freq, startTime, duration) {
    const ctx = AudioFX.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    // Amplop volume sederhana (naik cepat, turun halus) supaya tiap not
    // terdengar seperti nada musik, bukan sekadar bunyi "beep" datar.
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.11, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
  },

  // Dipanggil tiap frame dari game loop. Pola "lookahead scheduler" ini
  // adalah cara yang direkomendasikan Web Audio API untuk musik yang presisi
  // — menjadwalkan not sedikit di depan jam audio, bukan memutar satu-satu
  // lewat setTimeout yang gampang meleset.
  tick() {
    if (!this.playing || AudioFX.muted) return;
    const ctx = AudioFX.ctx;
    if (!ctx) return;
    while (this.nextNoteTime < ctx.currentTime + this.scheduleAheadTime) {
      const step = MELODY[this.noteIndex % MELODY.length];
      this.scheduleNote(noteToFrequency(step.note), this.nextNoteTime, step.dur * 0.92);
      this.nextNoteTime += step.dur;
      this.noteIndex++;
    }
  },
};

/* ---------------------------------------------------------------------------
   4. STATE
--------------------------------------------------------------------------- */
const state = {
  mode: 'loading', // loading | ready | playing | paused | gameover
  bird: { y: 0, vy: 0, rotation: 0, wingFrame: 'mid', wingTimer: 0 },
  pipes: [], // { x, gapY, scored }
  spawnTimer: 0,
  score: 0,
  highScore: 0,
  bgOffsetMountain: 0,
  bgOffsetTrees: 0,
  bgOffsetGround: 0,
};

function loadHighScore() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function saveHighScore(value) {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, String(value));
  } catch {
    // localStorage bisa gagal (mode privat) — tidak fatal, skor tetap tampil sesi ini.
  }
}

/* ---------------------------------------------------------------------------
   5. CANVAS & RESPONSIVE SIZING
   Resolusi logika tetap CONFIG.BASE_W x CONFIG.BASE_H. Ukuran fisik/CSS
   menyesuaikan layar sambil menjaga rasio aspek (letterbox bila perlu).
--------------------------------------------------------------------------- */
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CONFIG.BASE_W * dpr;
  canvas.height = CONFIG.BASE_H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);

/* ---------------------------------------------------------------------------
   6. INPUT
--------------------------------------------------------------------------- */
function isViralVisible() {
  try { return window.ViralShare && typeof ViralShare.isVisible === 'function' && ViralShare.isVisible(); } catch (_) { return false; }
}

function flap() {
  if (isViralVisible()) { ViralShare.hide(); return; }
  MusicFX.start();
  if (state.mode === 'ready') {
    startPlaying();
  }
  if (state.mode !== 'playing') return;
  state.bird.vy = CONFIG.FLAP_VELOCITY;
  AudioFX.flap();
}

function onPointerDown(e) {
  e.preventDefault();
  if (isViralVisible()) { ViralShare.hide(); return; }
  flap();
}

canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
window.addEventListener('keydown', (e) => {
  if (isViralVisible()) {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter' || e.code === 'Escape') {
      e.preventDefault();
      ViralShare.hide();
    }
    return;
  }
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    flap();
  }
});

/* ---------------------------------------------------------------------------
   7. GAME FLOW (start / reset / game over)
--------------------------------------------------------------------------- */
const screens = {
  loading: document.getElementById('loading-screen'),
  start: document.getElementById('start-screen'),
  gameover: document.getElementById('gameover-screen'),
};
const scoreEl = document.getElementById('hud-score');
const finalScoreEl = document.getElementById('final-score');
const finalHighEl = document.getElementById('final-high');
const newRecordEl = document.getElementById('new-record');
const retryBtn = document.getElementById('retry-btn');

function resetGame() {
  state.bird.y = CONFIG.BASE_H / 2;
  state.bird.vy = 0;
  state.bird.rotation = 0;
  state.pipes = [];
  state.spawnTimer = 0;
  state.score = 0;
  scoreEl.textContent = '0';
}

function showScreen(name) {
  screens.loading.hidden = name !== 'loading';
  screens.start.hidden = name !== 'start';
  screens.gameover.hidden = name !== 'gameover';
}

// Ketuk/klik di layar mulai untuk langsung bermain.
screens.start.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (isViralVisible()) { ViralShare.hide(); return; }
  flap();
});

function startPlaying() {
  resetGame();
  state.mode = 'playing';
  showScreen(null);
}

function goToStartScreen() {
  resetGame();
  state.mode = 'ready';
  showScreen('start');
}

// Lapor skor ke halaman portal yang meng-iframe game ini (lihat js/pwa.js di
// root portal), supaya high-score gabungan di katalog/pemutar ikut ter-update.
// Kalau game ini dibuka berdiri sendiri (bukan lewat iframe portal),
// window.parent === window sehingga pengiriman ini dilewati begitu saja.
function reportScoreToParent(score) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage({ type: CONFIG.PARENT_MESSAGE_TYPE, score }, '*');
  } catch {
    // Cross-origin atau parent menolak — tidak fatal, skor tetap tersimpan
    // secara lokal lewat localStorage di bawah.
  }
}

function gameOver() {
  if (state.mode !== 'playing') return;
  state.mode = 'gameover';
  AudioFX.hit();

  const isNewRecord = state.score > state.highScore;
  if (isNewRecord) {
    state.highScore = state.score;
    saveHighScore(state.highScore);
  }

  finalScoreEl.textContent = String(state.score);
  finalHighEl.textContent = String(state.highScore);
  newRecordEl.hidden = !isNewRecord;
  showScreen('gameover');
  reportScoreToParent(state.score);

  if (isNewRecord) {
    try {
      ViralShare.show('kicau-mania', state.score, function () {
        showScreen(null);
        startPlaying();
      });
    } catch (err) {
      console.error('[KicauMania] ViralShare failed:', err);
    }
  }
}

retryBtn.addEventListener('click', function (e) {
  if (isViralVisible()) { e.preventDefault(); ViralShare.hide(); return; }
  startPlaying();
});

/* ---------------------------------------------------------------------------
   8. PHYSICS & COLLISION
--------------------------------------------------------------------------- */
function spawnPipe() {
  const margin = CONFIG.PIPE_MIN_MARGIN;
  const usableH = CONFIG.BASE_H - CONFIG.GROUND_H;
  const minGapY = margin + CONFIG.PIPE_GAP / 2;
  const maxGapY = usableH - margin - CONFIG.PIPE_GAP / 2;
  const gapY = minGapY + Math.random() * (maxGapY - minGapY);
  state.pipes.push({ x: CONFIG.BASE_W + CONFIG.PIPE_W, gapY, scored: false });
}

function circleRectCollide(cx, cy, r, rx, ry, rw, rh) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

function update(dtMs) {
  const dt = dtMs / 1000;
  const b = state.bird;

  b.vy = Math.min(b.vy + CONFIG.GRAVITY * dt, CONFIG.MAX_FALL_SPEED);
  b.y += b.vy * dt;

  const targetRotation = b.vy < 0
    ? CONFIG.MAX_ROTATION_UP
    : Math.min(CONFIG.MAX_ROTATION_DOWN, (b.vy / CONFIG.MAX_FALL_SPEED) * CONFIG.MAX_ROTATION_DOWN);
  b.rotation += (targetRotation - b.rotation) * Math.min(1, dt * 10);

  b.wingTimer += dtMs;
  if (b.wingTimer >= CONFIG.WING_FRAME_MS) {
    b.wingTimer = 0;
    b.wingFrame = b.wingFrame === 'up' ? 'down' : b.wingFrame === 'down' ? 'mid' : 'up';
  }

  if (b.y - CONFIG.BIRD_RADIUS < 0) {
    b.y = CONFIG.BIRD_RADIUS;
    b.vy = 0;
  }

  const groundY = CONFIG.BASE_H - CONFIG.GROUND_H;
  if (b.y + CONFIG.BIRD_RADIUS >= groundY) {
    b.y = groundY - CONFIG.BIRD_RADIUS;
    gameOver();
    return;
  }

  state.spawnTimer += dtMs;
  if (state.spawnTimer >= CONFIG.PIPE_SPAWN_MS) {
    state.spawnTimer = 0;
    spawnPipe();
  }

  const moveX = CONFIG.PIPE_SPEED * dt;
  for (let i = state.pipes.length - 1; i >= 0; i--) {
    const p = state.pipes[i];
    p.x -= moveX;

    const topH = p.gapY - CONFIG.PIPE_GAP / 2;
    const bottomY = p.gapY + CONFIG.PIPE_GAP / 2;
    const bottomH = groundY - bottomY;

    if (circleRectCollide(CONFIG.BIRD_X, b.y, CONFIG.BIRD_RADIUS, p.x, 0, CONFIG.PIPE_W, topH) ||
        circleRectCollide(CONFIG.BIRD_X, b.y, CONFIG.BIRD_RADIUS, p.x, bottomY, CONFIG.PIPE_W, bottomH)) {
      gameOver();
      return;
    }

    if (!p.scored && p.x + CONFIG.PIPE_W < CONFIG.BIRD_X - CONFIG.BIRD_RADIUS) {
      p.scored = true;
      state.score++;
      scoreEl.textContent = String(state.score);
      AudioFX.score();
    }

    if (p.x + CONFIG.PIPE_W < -10) {
      state.pipes.splice(i, 1);
    }
  }

  state.bgOffsetMountain = (state.bgOffsetMountain + CONFIG.PARALLAX_MOUNTAIN * dt) % 400;
  state.bgOffsetTrees = (state.bgOffsetTrees + CONFIG.PARALLAX_TREES * dt) % 400;
  state.bgOffsetGround = (state.bgOffsetGround + CONFIG.PIPE_SPEED * dt) % 400;
}

/* ---------------------------------------------------------------------------
   9. DRAW
--------------------------------------------------------------------------- */
function drawParallaxLayer(img, offset, y, h) {
  const w = 400;
  let x = -offset;
  while (x < CONFIG.BASE_W) {
    ctx.drawImage(img, x, y, w, h);
    x += w;
  }
}

function drawPipe(p) {
  const topH = p.gapY - CONFIG.PIPE_GAP / 2;
  const bottomY = p.gapY + CONFIG.PIPE_GAP / 2;
  const groundY = CONFIG.BASE_H - CONFIG.GROUND_H;
  const bottomH = groundY - bottomY;
  const capH = 34;

  // Cap dan badan berbagi skala per-unit yang sama (turunan dari lebar
  // gambar badan / lebar viewBox-nya), supaya rim pada cap presisi menyatu
  // dengan tepi badan di bawah/atasnya — sebelumnya cap digambar dengan
  // lebar tujuan independen (PIPE_W+12) yang tidak sebanding dengan lebar
  // viewBox aslinya, sehingga rim-nya bergeser dari sumbu tiang.
  const scale = CONFIG.PIPE_W / BAMBOO_BODY_VIEWBOX_W;
  const capDrawW = BAMBOO_CAP_VIEWBOX_W * scale;

  // Tiang atas (menggantung dari langit-langit turun ke gap)
  let y = 0;
  while (y < topH - capH) {
    ctx.drawImage(assets.bambooBody, p.x, y, CONFIG.PIPE_W, Math.min(80, topH - capH - y));
    y += 80;
  }
  ctx.save();
  ctx.translate(p.x, topH);
  ctx.scale(1, -1);
  ctx.drawImage(assets.bambooCap, 0, 0, capDrawW, capH);
  ctx.restore();

  // Tiang bawah (dari gap turun ke tanah)
  ctx.drawImage(assets.bambooCap, p.x, bottomY, capDrawW, capH);
  y = bottomY + capH;
  while (y < groundY) {
    ctx.drawImage(assets.bambooBody, p.x, y, CONFIG.PIPE_W, Math.min(80, groundY - y));
    y += 80;
  }
}

function drawBird() {
  const b = state.bird;
  const img = assets.bird[b.wingFrame];
  ctx.save();
  ctx.translate(CONFIG.BIRD_X, b.y);
  ctx.rotate(b.rotation);
  ctx.drawImage(img, -26, -21, 52, 42);
  ctx.restore();
}

function draw() {
  const sky = ctx.createLinearGradient(0, 0, 0, CONFIG.BASE_H);
  sky.addColorStop(0, '#bfe7f0');
  sky.addColorStop(1, '#eaf6e6');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CONFIG.BASE_W, CONFIG.BASE_H);

  drawParallaxLayer(assets.mountains, state.bgOffsetMountain, CONFIG.BASE_H - 300, 220);
  drawParallaxLayer(assets.trees, state.bgOffsetTrees, CONFIG.BASE_H - CONFIG.GROUND_H - 140, 150);

  state.pipes.forEach(drawPipe);

  drawParallaxLayer(assets.ground, state.bgOffsetGround, CONFIG.BASE_H - CONFIG.GROUND_H, CONFIG.GROUND_H);

  drawBird();
}

/* ---------------------------------------------------------------------------
   10. GAME LOOP + VISIBILITY-BASED PAUSE
   Tidak lagi bergantung pada SDK iklan manapun — dijeda otomatis saat tab
   atau iframe-nya tersembunyi (mis. pemain pindah tab di portal), dan
   lanjut lagi saat terlihat kembali.
--------------------------------------------------------------------------- */
let rafId = null;
let lastTs = 0;

function loop(ts) {
  if (!lastTs) lastTs = ts;
  const dtMs = Math.min(ts - lastTs, CONFIG.MAX_DT_MS);
  lastTs = ts;

  try {
    if (state.mode === 'playing') update(dtMs);
    draw();
    MusicFX.tick();
  } catch (err) {
    // Satu frame yang gagal tidak boleh mematikan seluruh loop secara diam-diam.
    console.error('[KicauMania] Error saat update/draw:', err);
  }

  rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function startLoop() {
  if (rafId === null) {
    lastTs = 0;
    rafId = requestAnimationFrame(loop);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state.mode === 'playing') state.mode = 'paused';
    stopLoop();
    AudioFX.setTabHidden(true);
  } else {
    AudioFX.setTabHidden(false);
    if (state.mode === 'paused') state.mode = 'playing';
    startLoop();
  }
});

/* ---------------------------------------------------------------------------
   11. SOUND TOGGLE
--------------------------------------------------------------------------- */
const soundToggleBtn = document.getElementById('sound-toggle');
const soundWavesIcon = document.getElementById('sound-waves');
const soundMuteIcon = document.getElementById('sound-mute-x');

function updateSoundToggleUI(muted) {
  soundWavesIcon.hidden = muted;
  soundMuteIcon.hidden = !muted;
  soundToggleBtn.setAttribute('aria-pressed', String(muted));
  soundToggleBtn.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
}

soundToggleBtn.addEventListener('click', () => {
  // Kalau ini interaksi pertama pemain (mis. mereka menekan tombol ini
  // sebelum sempat terbang), tetap pastikan AudioContext & musik latar
  // ter-inisialisasi dengan benar, bukan cuma togel status mute-nya.
  AudioFX.ensureCtx();
  MusicFX.start();

  const nextMuted = !AudioFX.userMuted;
  AudioFX.setUserMuted(nextMuted);
  updateSoundToggleUI(nextMuted);
});

/* ---------------------------------------------------------------------------
   12. INIT
--------------------------------------------------------------------------- */
function init() {
  resizeCanvas();
  state.highScore = loadHighScore();
  AudioFX.userMuted = loadSoundPreference();
  updateSoundToggleUI(AudioFX.userMuted);

  preloadAssets(() => {
    goToStartScreen();
    startLoop();
  });
}

init();
