'use strict';

/* ============================================================================
   MOBIL MBG — retro top-down runner (Road Fighter style)
   Theme: drive the MBG van, deliver food boxes fast.
   Architecture: Config -> Assets (SVG->Image) -> Audio -> Music -> State ->
               Input -> Spawn/Physics/Collision -> Draw -> Loop ->
               Parent bridge (postMessage)
   ============================================================================ */

/* ---------------------------------------------------------------------------
   1. CONFIG
   Internal (logical) resolution 360x640 (portrait 9:16). Physical pixels are
   scaled via resizeCanvas() for crisp rendering at any DPI.
--------------------------------------------------------------------------- */
const CONFIG = {
  BASE_W: 360,
  BASE_H: 640,

  ROAD_X: 30,             // road left edge
  ROAD_W: 300,            // road width
  LANES: 3,

  // --- STEERING ---------------------------------------------------------
  STEER_SPEED: 250,       // px/s horizontal

  // --- SCROLL SPEED -----------------------------------------------------
  SPEED_START: 270,       // px/s world scroll
  SPEED_MAX: 570,
  SPEED_ACCEL: 7,         // px/s per second
  KMH_FACTOR: 0.65,       // display km/h = speed * factor

  PLAYER_Y_OFFSET: 128,   // player feet distance from bottom

  FOOD_BONUS: 500,
  SCORE_DIVISOR: 18,      // distance px per 1 point

  INVULN_SECONDS: 1.6,
  SHAKE_SECONDS: 0.35,

  AGGRESSIVE_MIN_SCORE: 1200,

  MIN_GAP_PX: 230,        // min vertical gap between consecutive obstacles
  FOOD_GAP_MIN: 900,      // min distance between food boxes
  FOOD_GAP_RAND: 900,

  STORAGE_KEY: 'mobilMbg_highScore',
  MAX_DT_MS: 34,

  PARENT_MESSAGE_TYPE: 'arcade-score',
};

const LANE_W = CONFIG.ROAD_W / CONFIG.LANES;

function laneCenter(i) {
  return CONFIG.ROAD_X + LANE_W * (i + 0.5);
}

/* ---------------------------------------------------------------------------
   2. ASSETS — all visuals are inline SVG strings rendered to Image() via
   base64 data URIs. Zero external image files.
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

// --- PLAYER VAN: white delivery van, "MBG" painted on the roof,
// faithful to the reference photo (boxy body, windshield, mirrors).
// viewBox 60x108, facing up.
function buildVanSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 108">
    <!-- side mirrors -->
    <path d="M4,34 L-1,31 L-1,37 L4,38 Z" fill="#3a3a3a"/>
    <path d="M56,34 L61,31 L61,37 L56,38 Z" fill="#3a3a3a"/>
    <!-- main body -->
    <rect x="4" y="2" width="52" height="104" rx="13" fill="#f5f3ef"/>
    <rect x="4" y="2" width="52" height="104" rx="13" fill="none" stroke="#c8c2b6" stroke-width="2"/>
    <!-- hood vents -->
    <rect x="14" y="7" width="12" height="3.4" rx="1.7" fill="#d8d3c8"/>
    <rect x="34" y="7" width="12" height="3.4" rx="1.7" fill="#d8d3c8"/>
    <!-- headlights -->
    <rect x="7" y="4.5" width="7" height="4" rx="2" fill="#ffe9a8"/>
    <rect x="46" y="4.5" width="7" height="4" rx="2" fill="#ffe9a8"/>
    <!-- windshield -->
    <path d="M10,17 Q10,14 14,14 L46,14 Q50,14 50,17 L48,30 Q47,32 45,32 L15,32 Q13,32 12,30 Z" fill="#28394b"/>
    <path d="M13,17 Q13,16 15,16 L27,16 L24,30 L15,30 Q13.5,30 13.2,28 Z" fill="#41586e" opacity="0.85"/>
    <!-- roof panel with panel seams -->
    <rect x="11" y="34" width="38" height="46" fill="#efece6"/>
    <path d="M19,34 V80 M30,34 V80 M41,34 V80" stroke="#ddd8cd" stroke-width="1.4"/>
    <!-- dirt smudges -->
    <ellipse cx="17" cy="74" rx="6" ry="4" fill="#e3ddcf" opacity="0.7"/>
    <ellipse cx="43" cy="66" rx="5" ry="6" fill="#e3ddcf" opacity="0.55"/>
    <!-- MBG lettering -->
    <text x="30" y="66" text-anchor="middle" font-family="Arial Black, Arial, sans-serif"
      font-size="14.5" font-weight="900" letter-spacing="0.5" fill="#17181a">MBG</text>
    <!-- rear doors seam + rear window -->
    <path d="M30,82 V103" stroke="#d5d0c5" stroke-width="1.6"/>
    <rect x="13" y="83" width="34" height="9" rx="3" fill="#33424f"/>
    <!-- taillights -->
    <rect x="6" y="97" width="7" height="5" rx="2" fill="#d63a2f"/>
    <rect x="47" y="97" width="7" height="5" rx="2" fill="#d63a2f"/>
    <!-- bumper -->
    <rect x="6" y="102" width="48" height="4" rx="2" fill="#b9b3a7"/>
  </svg>`;
}

// --- ENEMY CAR: generic sedan seen from above. Pass a palette to get
// red / yellow / aggressive variants. viewBox 56x94, facing down (toward
// the player) so its windshield sits at the bottom of the sprite.
function buildEnemyCarSVG(body, shade, glass, aggressive) {
  const stripe = aggressive
    ? '<path d="M25,4 h6 V90 h-6 Z" fill="#f4f1e8" opacity="0.85"/>'
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 94">
    <!-- wheel arches peeking out -->
    <rect x="1" y="12" width="7" height="14" rx="3" fill="#22201e"/>
    <rect x="48" y="12" width="7" height="14" rx="3" fill="#22201e"/>
    <rect x="1" y="68" width="7" height="14" rx="3" fill="#22201e"/>
    <rect x="48" y="68" width="7" height="14" rx="3" fill="#22201e"/>
    <!-- body -->
    <rect x="4" y="3" width="48" height="88" rx="12" fill="${body}"/>
    <rect x="4" y="3" width="48" height="88" rx="12" fill="none" stroke="${shade}" stroke-width="2"/>
    ${stripe}
    <!-- hood highlight -->
    <ellipse cx="28" cy="14" rx="14" ry="7" fill="#ffffff" opacity="0.18"/>
    <!-- windshield (bottom = facing player) -->
    <path d="M11,58 Q11,55 15,55 L41,55 Q45,55 45,58 L43,72 Q42,74 40,74 L16,74 Q14,74 13,72 Z" fill="${glass}"/>
    <!-- roof -->
    <rect x="13" y="30" width="30" height="24" rx="4" fill="${shade}" opacity="0.5"/>
    <!-- rear window (top) -->
    <rect x="14" y="16" width="28" height="11" rx="4" fill="${glass}"/>
    <!-- headlights face down-screen -->
    <rect x="7" y="86" width="8" height="4.5" rx="2" fill="#fff3c4"/>
    <rect x="41" y="86" width="8" height="4.5" rx="2" fill="#fff3c4"/>
    <rect x="6" y="5" width="8" height="4" rx="2" fill="#c0392b" opacity="0.9"/>
    <rect x="42" y="5" width="8" height="4" rx="2" fill="#c0392b" opacity="0.9"/>
  </svg>`;
}

// --- MBG FOOD BOX: blue compartment tray (rice, chicken, veggies, fruit),
// glowing like a pickup. viewBox 64x64.
function buildFoodSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <defs>
      <clipPath id="tray"><rect x="6" y="8" width="52" height="50" rx="9"/></clipPath>
    </defs>
    <!-- tray -->
    <rect x="6" y="8" width="52" height="50" rx="9" fill="#2f7fd1"/>
    <rect x="6" y="8" width="52" height="50" rx="9" fill="none" stroke="#1d5fa8" stroke-width="2.5"/>
    <rect x="9" y="11" width="46" height="44" rx="7" fill="#3d8fe0"/>
    <g clip-path="url(#tray)">
      <!-- compartment dividers -->
      <path d="M32,11 V55 M9,33 H55" stroke="#1d5fa8" stroke-width="3.4"/>
      <!-- rice -->
      <rect x="10" y="34" width="21" height="20" fill="#f7f4ea"/>
      <circle cx="15" cy="39" r="1.5" fill="#7fb069"/>
      <circle cx="22" cy="44" r="1.5" fill="#7fb069"/>
      <circle cx="17" cy="49" r="1.5" fill="#7fb069"/>
      <circle cx="26" cy="38" r="1.5" fill="#7fb069"/>
      <!-- chicken -->
      <circle cx="17" cy="20" r="5.4" fill="#c98a3d"/>
      <circle cx="26" cy="24" r="4.4" fill="#b97a30"/>
      <circle cx="23" cy="15" r="3.6" fill="#d99a4e"/>
      <rect x="12.6" y="24" width="3" height="6" rx="1.5" fill="#f4f1e8"/>
      <!-- veggies -->
      <circle cx="38" cy="20" r="2.6" fill="#e67e22"/>
      <circle cx="45" cy="16" r="2.6" fill="#57a05a"/>
      <circle cx="49" cy="23" r="2.6" fill="#e67e22"/>
      <circle cx="41" cy="27" r="2.6" fill="#57a05a"/>
      <!-- fruit -->
      <path d="M36,52 A8,8 0 0 1 52,52 Z" fill="#e5533d"/>
      <path d="M39.5,52 A4.5,4.5 0 0 1 48.5,52 Z" fill="#f47f6b"/>
      <circle cx="44" cy="47" r="1.4" fill="#2c2c2c"/>
    </g>
    <!-- MBG badge -->
    <rect x="21" y="29" width="22" height="9" rx="3" fill="#2e8b57"/>
    <text x="32" y="36.4" text-anchor="middle" font-family="Arial, sans-serif"
      font-size="6.6" font-weight="bold" fill="#ffffff">MBG</text>
  </svg>`;
}

// --- OIL SPILL: irregular dark blob with faint sheen. viewBox 72x52.
function buildOilSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 52">
    <g fill="#26221c">
      <ellipse cx="34" cy="27" rx="24" ry="15"/>
      <ellipse cx="20" cy="22" rx="12" ry="9"/>
      <ellipse cx="48" cy="31" rx="13" ry="9"/>
      <ellipse cx="56" cy="20" rx="6" ry="4.4"/>
      <circle cx="10" cy="34" r="3.4"/>
      <circle cx="64" cy="34" r="2.6"/>
    </g>
    <ellipse cx="28" cy="21" rx="11" ry="4.4" fill="#453e30" opacity="0.75"/>
    <ellipse cx="46" cy="33" rx="7" ry="2.6" fill="#453e30" opacity="0.55"/>
  </svg>`;
}

// --- ROAD TILE: asphalt with baked-in lane dashes + edge lines.
// Tile is 360x160; dash period is 80px so tiling is seamless.
function buildRoadSVG() {
  let specks = '';
  for (let i = 0; i < 26; i++) {
    const x = 34 + ((i * 71) % 292);
    const y = (i * 53) % 160;
    specks += `<rect x="${x}" y="${y}" width="2.4" height="3.2" fill="#5a5a63"/>`;
  }
  // lane separators at x=130 and x=230 (3 lanes over road 30..330)
  let dashes = '';
  for (const lx of [130, 230]) {
    dashes += `<rect x="${lx - 2.4}" y="6" width="4.8" height="42" fill="#e9e7de"/>
               <rect x="${lx - 2.4}" y="86" width="4.8" height="42" fill="#e9e7de"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 160">
    <!-- grass shoulders -->
    <rect x="0" y="0" width="360" height="160" fill="#3f7d3a"/>
    <rect x="0" y="0" width="30" height="160" fill="#46893f"/>
    <rect x="330" y="0" width="30" height="160" fill="#46893f"/>
    <!-- asphalt -->
    <rect x="30" y="0" width="300" height="160" fill="#4a4a52"/>
    <rect x="30" y="0" width="300" height="160" fill="url(#none)"/>
    ${specks}
    <!-- solid edge lines -->
    <rect x="32" y="0" width="4" height="160" fill="#e9e7de"/>
    <rect x="324" y="0" width="4" height="160" fill="#e9e7de"/>
    ${dashes}
    <!-- curb stones -->
    <rect x="24" y="0" width="6" height="160" fill="#8f8f98"/>
    <rect x="330" y="0" width="6" height="160" fill="#8f8f98"/>
  </svg>`;
}

// --- ROADSIDE PROPS: sparse bushes/trees on the grass, tile 360x320.
function buildRoadsideSVG() {
  const bush = (x, y, s) => `
    <g transform="translate(${x},${y}) scale(${s})">
      <circle cx="-7" cy="0" r="9" fill="#356b31"/>
      <circle cx="7" cy="0" r="9" fill="#356b31"/>
      <circle cx="0" cy="-4" r="11" fill="#3f7d3a"/>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 320">
    ${bush(13, 40, 0.9)}
    ${bush(346, 120, 1.05)}
    ${bush(11, 210, 1.1)}
    ${bush(348, 290, 0.85)}
  </svg>`;
}

const assets = { van: null, enemyRed: null, enemyYellow: null, enemyAggro: null, food: null, oil: null, road: null, roadside: null };

const TILE_ROAD_H = 160;
const TILE_SIDE_H = 320;

let assetsReadyCount = 0;
const ASSET_TOTAL = 8;
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

  assets.van = loadSvgImage(buildVanSVG());
  assets.enemyRed = loadSvgImage(buildEnemyCarSVG('#d63a2f', '#a3271f', '#28394b', false));
  assets.enemyYellow = loadSvgImage(buildEnemyCarSVG('#f2c230', '#c79a1a', '#28394b', false));
  assets.enemyAggro = loadSvgImage(buildEnemyCarSVG('#8e44ad', '#6c3384', '#1d2a3a', true));
  assets.food = loadSvgImage(buildFoodSVG());
  assets.oil = loadSvgImage(buildOilSVG());
  assets.road = loadSvgImage(buildRoadSVG());
  assets.roadside = loadSvgImage(buildRoadsideSVG());

  Object.values(assets).forEach((img) => {
    if (img.complete) {
      markReady();
    } else {
      img.onload = markReady;
      // Defensive: an asset that fails decode must never hang the loading screen.
      img.onerror = markReady;
    }
  });
}

/* ---------------------------------------------------------------------------
   3. AUDIO — SFX through Web Audio API oscillators, no audio files.
   Auto-muted when tab hidden + manual toggle button.
--------------------------------------------------------------------------- */
const SOUND_PREF_KEY = 'mobilMbg_soundMuted';

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
    // Private mode — preference only applies for this session.
  }
}

const AudioFX = {
  ctx: null,
  userMuted: false,
  tabHidden: false,

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

  // Single tone, optionally sweeping f0 -> f1 (glissando).
  sweep(f0, f1, duration, type, gainStart, when = 0) {
    if (this.muted) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + duration);
    gain.gain.setValueAtTime(gainStart, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  },

  // SFX collect: bright double blip.
  collect() {
    this.sweep(660, 990, 0.08, 'square', 0.13);
    this.sweep(880, 1320, 0.1, 'square', 0.11, 0.07);
  },

  // SFX crash: low thud + metallic grind.
  crash() {
    this.sweep(170, 45, 0.3, 'sawtooth', 0.24);
    this.sweep(95, 60, 0.18, 'square', 0.18, 0.03);
  },

  // SFX game over: descending jingle.
  gameOver() {
    const notes = [392, 330, 262, 196];
    notes.forEach((f, i) => {
      this.sweep(f, f * 0.94, 0.18, 'square', 0.13, i * 0.16);
    });
  },
};

/* ---------------------------------------------------------------------------
   3b. BACKGROUND MUSIC — chiptune "score" played via oscillators with a
   precise lookahead scheduler on the AudioContext clock (not setTimeout).
   Driving 8-bit feel: square lead + triangle bass at 152 BPM.
--------------------------------------------------------------------------- */
const NOTE_SEMITONE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

function noteToFrequency(note) {
  const match = /^([A-G]#?)(\d)$/.exec(note);
  if (!match) return 440;
  const [, name, octaveStr] = match;
  const semitoneFromA4 = (parseInt(octaveStr, 10) - 4) * 12 + (NOTE_SEMITONE[name] - NOTE_SEMITONE.A);
  return 440 * Math.pow(2, semitoneFromA4 / 12);
}

const MUSIC_BPM = 152;
const MUSIC_EIGHTH = 60 / MUSIC_BPM / 2;

// '' = rest. Energetic loop in C major.
const MELODY = [
  'E5', 'G5', 'A5', 'G5', 'E5', 'D5', 'C5', 'D5',
  'E5', 'E5', 'G5', 'A5', 'C6', 'A5', 'G5', '',
  'F5', 'A5', 'C6', 'A5', 'G5', 'E5', 'D5', 'E5',
  'C5', 'D5', 'E5', 'G5', 'E5', 'D5', 'C5', '',
];

// Bass hits every other step: C - Am - F - G progression.
const BASS = [
  'C3', '', 'G3', '', 'C3', '', 'G3', '',
  'A2', '', 'E3', '', 'A2', '', 'E3', '',
  'F2', '', 'C3', '', 'F2', '', 'C3', '',
  'G2', '', 'D3', '', 'G2', '', 'B2', '',
];

const MusicFX = {
  playing: false,
  stepIndex: 0,
  nextStepTime: 0,
  scheduleAheadTime: 0.15,

  start() {
    if (this.playing) return;
    const ctx = AudioFX.ensureCtx();
    if (!ctx) return;
    this.playing = true;
    this.stepIndex = 0;
    this.nextStepTime = ctx.currentTime + 0.05;
  },

  stop() {
    this.playing = false;
  },

  scheduleNote(freq, startTime, duration, type, gainPeak) {
    const ctx = AudioFX.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(gainPeak, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
  },

  tick() {
    if (!this.playing || AudioFX.muted) return;
    const ctx = AudioFX.ctx;
    if (!ctx) return;
    // Resync when audio clock drifted past schedule (e.g., tab resume).
    if (this.nextStepTime < ctx.currentTime - 0.1) {
      this.nextStepTime = ctx.currentTime + 0.05;
    }
    while (this.nextStepTime < ctx.currentTime + this.scheduleAheadTime) {
      const i = this.stepIndex % MELODY.length;
      const lead = MELODY[i];
      const bass = BASS[i];
      if (lead) this.scheduleNote(noteToFrequency(lead), this.nextStepTime, MUSIC_EIGHTH * 0.9, 'square', 0.042);
      if (bass) this.scheduleNote(noteToFrequency(bass), this.nextStepTime, MUSIC_EIGHTH * 1.7, 'triangle', 0.085);
      this.nextStepTime += MUSIC_EIGHTH;
      this.stepIndex++;
    }
  },
};

/* ---------------------------------------------------------------------------
   4. STATE
--------------------------------------------------------------------------- */
const state = {
  mode: 'loading', // loading | ready | playing | paused | gameover
  player: { x: laneCenter(1), w: 56, h: 100, invuln: 0 },
  input: { left: false, right: false, pointers: new Map() }, // pointerId -> 'left'|'right'
  obstacles: [],   // {type:'car'|'aggro'|'oil', lane, x, y, w, h, img, targetX, retargetIn}
  foods: [],       // {x, y}
  popups: [],      // floating score texts
  speed: CONFIG.SPEED_START,
  dist: 0,
  score: 0,
  lives: 3,
  highScore: 0,
  nextObstacleDist: 600,
  nextFoodDist: 700,
  shake: 0,
  roadOffset: 0,
  sideOffset: 0,
  foodPulse: 0,
  gameOverAt: 0,
};

function loadHighScore() {
  try {
    const n = parseInt(localStorage.getItem(CONFIG.STORAGE_KEY), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function saveHighScore(value) {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, String(value));
  } catch {
    // Non-fatal.
  }
}

/* ---------------------------------------------------------------------------
   5. CANVAS & RESPONSIVE SIZING (portrait letterbox, same approach as
   kicau-mania so it behaves identically inside the portal iframe).
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
   6. INPUT — keyboard Left/Right or A/D to steer; Space to start/restart.
   Touch: HOLD left/right half of the screen to steer; tap to start/restart.
--------------------------------------------------------------------------- */
function isViralVisible() {
  try { return window.ViralShare && typeof ViralShare.isVisible === 'function' && ViralShare.isVisible(); } catch (_) { return false; }
}

function primaryAction() {
  AudioFX.ensureCtx();
  if (isViralVisible()) { ViralShare.hide(); return; }
  if (state.mode === 'ready') {
    startPlaying();
    return;
  }
  if (state.mode === 'gameover') {
    // Guard against accidental instant restart on death-tap spam.
    if (performance.now() - state.gameOverAt > 400) startPlaying();
    return;
  }
  // While playing the tap itself does nothing — steering uses held touches.
}

function startPlaying() {
  resetGame();
  state.mode = 'playing';
  showScreen(null);
  MusicFX.start();
}

function jumplessSteer(side, isDown, pointerId) {
  if (isDown) {
    state.input.pointers.set(pointerId, side);
  } else {
    state.input.pointers.delete(pointerId);
  }
  refreshTouchDirections();
}

function refreshTouchDirections() {
  let left = false;
  let right = false;
  state.input.pointers.forEach((side) => {
    if (side === 'left') left = true;
    else right = true;
  });
  state.input.touchLeft = left;
  state.input.touchRight = right;
}

const container = document.getElementById('game-container');

container.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (isViralVisible()) { ViralShare.hide(); return; }
  primaryAction();
  if (state.mode === 'playing') {
    const side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
    jumplessSteer(side, true, e.pointerId);
  }
}, { passive: false });

container.addEventListener('pointermove', (e) => {
  if (!state.input.pointers.has(e.pointerId)) return;
  const side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
  state.input.pointers.set(e.pointerId, side);
  refreshTouchDirections();
}, { passive: true });

function releasePointer(e) {
  if (state.input.pointers.has(e.pointerId)) {
    jumplessSteer('', false, e.pointerId);
  }
}
container.addEventListener('pointerup', releasePointer, { passive: true });
container.addEventListener('pointercancel', releasePointer, { passive: true });

window.addEventListener('keydown', (e) => {
  if (isViralVisible()) {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
      e.preventDefault();
      ViralShare.hide();
    }
    return;
  }
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!e.repeat) primaryAction();
    return;
  }
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
    e.preventDefault();
    state.input.keyLeft = true;
  } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
    e.preventDefault();
    state.input.keyRight = true;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') state.input.keyLeft = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') state.input.keyRight = false;
});

/* ---------------------------------------------------------------------------
   7. GAME FLOW (screens / reset / game over)
--------------------------------------------------------------------------- */
const screens = {
  loading: document.getElementById('loading-screen'),
  start: document.getElementById('start-screen'),
  gameover: document.getElementById('gameover-screen'),
};
const scoreEl = document.getElementById('hud-score');
const speedEl = document.getElementById('hud-speed');
const lifeIconsEl = document.getElementById('life-icons');
const highEl = document.getElementById('hud-high');
const startBestEl = document.getElementById('start-best');
const finalScoreEl = document.getElementById('final-score');
const finalHighEl = document.getElementById('final-high');
const newRecordEl = document.getElementById('new-record');
const retryBtn = document.getElementById('retry-btn');

function padScore(n) {
  return String(Math.min(99999, n)).padStart(5, '0');
}

function showScreen(name) {
  screens.loading.hidden = name !== 'loading';
  screens.start.hidden = name !== 'start';
  screens.gameover.hidden = name !== 'gameover';
}

function resetGame() {
  state.player.x = laneCenter(1);
  state.player.invuln = 0;
  state.obstacles = [];
  state.foods = [];
  state.popups = [];
  state.speed = CONFIG.SPEED_START;
  state.dist = 0;
  state.score = 0;
  state.lives = 3;
  state.nextObstacleDist = 600;
  state.nextFoodDist = 750;
  state.shake = 0;
  state.input.pointers.clear();
  state.input.touchLeft = false;
  state.input.touchRight = false;
  state.input.keyLeft = false;
  state.input.keyRight = false;
  scoreEl.textContent = 'SCORE: 00000';
  speedEl.textContent = '0 KM/H';
  lifeIconsEl.textContent = '\u2665\u2665\u2665';
}

function goToStartScreen() {
  resetGame();
  state.mode = 'ready';
  startBestEl.textContent = 'Best Score: ' + state.highScore;
  showScreen('start');
  canvas.focus();
}

// Report score to portal (js/pwa.js) when running inside the portal iframe.
function reportScoreToParent(score) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage({ type: CONFIG.PARENT_MESSAGE_TYPE, score }, '*');
  } catch {
    // Cross-origin — score still saved locally.
  }
}

function gameOver() {
  if (state.mode !== 'playing') return;
  state.mode = 'gameover';
  state.gameOverAt = performance.now();
  MusicFX.stop();
  AudioFX.gameOver();

  const isNewRecord = state.score > state.highScore;
  if (isNewRecord) {
    state.highScore = state.score;
    saveHighScore(state.highScore);
  }

  finalScoreEl.textContent = String(state.score);
  finalHighEl.textContent = String(state.highScore);
  highEl.textContent = 'BEST: ' + padScore(state.highScore);
  newRecordEl.hidden = !isNewRecord;
  showScreen('gameover');
  reportScoreToParent(state.score);

  if (isNewRecord) {
    try {
      ViralShare.show('mobil-mbg', state.score, function () {
        showScreen(null);
        startPlaying();
      });
    } catch (err) {
      console.error('[MobilMBG] ViralShare failed:', err);
    }
  }
}

retryBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  AudioFX.ensureCtx();
  startPlaying();
}, { passive: false });

/* ---------------------------------------------------------------------------
   8. SPAWN, PHYSICS & COLLISION
--------------------------------------------------------------------------- */

// Difficulty ramps: scroll speed climbs constantly; obstacle gaps shrink as
// speed rises; aggressive cars join after a score threshold and get more
// common from there.
function currentGap() {
  const t = (state.speed - CONFIG.SPEED_START) / (CONFIG.SPEED_MAX - CONFIG.SPEED_START); // 0..1
  const shrink = 1 - 0.32 * t; // gaps tighten up to ~32%
  return CONFIG.MIN_GAP_PX + Math.random() * 340 * shrink;
}

function pickCarImage(aggressive) {
  if (aggressive) return { img: assets.enemyAggro, w: 56, h: 94 };
  return Math.random() < 0.5
    ? { img: assets.enemyRed, w: 56, h: 94 }
    : { img: assets.enemyYellow, w: 56, h: 94 };
}

function spawnObstacle() {
  const roll = Math.random();
  const aggroUnlocked = state.score >= CONFIG.AGGRESSIVE_MIN_SCORE;
  const aggroChance = aggroUnlocked ? 0.08 + 0.07 * Math.min(1, (state.speed - CONFIG.SPEED_START) / (CONFIG.SPEED_MAX - CONFIG.SPEED_START)) : 0;

  if (roll < 0.24) {
    // OIL SPILL — flat hazard, forgiving hitbox, stays on the road.
    const w = 66;
    state.obstacles.push({
      type: 'oil', img: assets.oil,
      x: CONFIG.ROAD_X + 14 + Math.random() * (CONFIG.ROAD_W - w - 28),
      y: -70, w, h: 48,
    });
  } else {
    // ENEMY CAR — static cruiser or rare lane-changing aggressor.
    const aggressive = aggroUnlocked && Math.random() < aggroChance;
    const { img, w, h } = pickCarImage(aggressive);
    const lane = Math.floor(Math.random() * CONFIG.LANES);
    state.obstacles.push({
      type: aggressive ? 'aggro' : 'car', img,
      lane,
      x: laneCenter(lane) - w / 2,
      targetX: laneCenter(lane) - w / 2,
      y: -h - 20, w, h,
      retargetIn: 0.9 + Math.random() * 1.1,
    });
  }

  state.nextObstacleDist = state.dist + currentGap();
}

function spawnFood() {
  const lane = Math.floor(Math.random() * CONFIG.LANES);
  const x = laneCenter(lane) - 30;
  // Avoid dropping food on top of an obstacle in the same lane.
  const blocked = state.obstacles.some(
    (o) => o.y < 160 && Math.abs(o.x + o.w / 2 - (x + 30)) < 70
  );
  if (!blocked) state.foods.push({ x, y: -64 });
  state.nextFoodDist = state.dist + CONFIG.FOOD_GAP_MIN + Math.random() * CONFIG.FOOD_GAP_RAND;
}

// AABB: boxes overlap when they intersect on BOTH axes.
function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function playerHitbox() {
  const p = state.player;
  // Forgiving inset: visual body vs fair hitbox.
  return { x: p.x + 8, y: CONFIG.BASE_H - CONFIG.PLAYER_Y_OFFSET + 10, w: p.w - 16, h: p.h - 18 };
}

function damagePlayer(sourceX, sourceY) {
  if (state.player.invuln > 0) return;
  state.lives -= 1;
  state.player.invuln = CONFIG.INVULN_SECONDS;
  state.shake = CONFIG.SHAKE_SECONDS;
  AudioFX.crash();
  lifeIconsEl.textContent = '\u2665'.repeat(Math.max(0, state.lives));
  state.popups.push({ x: sourceX, y: sourceY, text: '-1', life: 0.9, color: '#ff5a5a' });
  if (state.lives <= 0) gameOver();
}

function update(dtMs) {
  const dt = dtMs / 1000;
  const p = state.player;

  // --- Scroll speed ramps up constantly -----------------------------------
  state.speed = Math.min(CONFIG.SPEED_MAX, state.speed + CONFIG.SPEED_ACCEL * dt);
  const worldDy = state.speed * dt;
  state.dist += worldDy;
  state.roadOffset = (state.roadOffset + worldDy) % TILE_ROAD_H;
  state.sideOffset = (state.sideOffset + worldDy) % TILE_SIDE_H;
  state.foodPulse += dt;

  // --- Invulnerability timer ----------------------------------------------
  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt);

  // --- Steering: keyboard OR held-touch, clamped to the road --------------
  const steerLeft = state.input.keyLeft || state.input.touchLeft;
  const steerRight = state.input.keyRight || state.input.touchRight;
  const dir = (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
  if (dir !== 0) {
    p.x += dir * CONFIG.STEER_SPEED * dt;
    const minX = CONFIG.ROAD_X + 12;
    const maxX = CONFIG.ROAD_X + CONFIG.ROAD_W - p.w - 12;
    p.x = Math.max(minX, Math.min(maxX, p.x));
  }

  // --- Distance score ------------------------------------------------------
  const newScore = Math.floor(state.dist / CONFIG.SCORE_DIVISOR);
  if (newScore !== state.score) {
    state.score = newScore;
    scoreEl.textContent = 'SCORE: ' + padScore(state.score);
    speedEl.textContent = Math.round(state.speed * CONFIG.KMH_FACTOR) + ' KM/H';
  }

  // --- Spawning (distance-driven) ------------------------------------------
  if (state.dist >= state.nextObstacleDist) spawnObstacle();
  if (state.dist >= state.nextFoodDist) spawnFood();

  // --- Move obstacles ------------------------------------------------------
  const pb = playerHitbox();
  for (let i = state.obstacles.length - 1; i >= 0; i--) {
    const o = state.obstacles[i];

    if (o.type === 'aggro') {
      // Aggressor: slightly faster than traffic, weaves between lanes.
      o.retargetIn -= dt;
      if (o.retargetIn <= 0) {
        o.retargetIn = 0.9 + Math.random() * 1.2;
        const delta = Math.random() < 0.5 ? -1 : 1;
        o.lane = Math.max(0, Math.min(CONFIG.LANES - 1, o.lane + delta));
        o.targetX = laneCenter(o.lane) - o.w / 2;
      }
      // Smooth horizontal chase toward the target lane center.
      const dx = o.targetX - o.x;
      const step = Math.sign(dx) * Math.min(Math.abs(dx), 170 * dt);
      o.x += step;
      o.y += worldDy * 1.1; // overtakes static traffic
    } else {
      o.y += worldDy;
    }

    if (o.y > CONFIG.BASE_H + 40) {
      state.obstacles.splice(i, 1);
      continue;
    }

    // --- COLLISION (skipped entirely while invulnerable) ------------------
    if (p.invuln <= 0) {
      if (o.type === 'oil') {
        // Generous inset — grazing an oil edge shouldn't kill.
        if (aabb(pb.x, pb.y, pb.w, pb.h, o.x + 12, o.y + 8, o.w - 24, o.h - 16)) {
          damagePlayer(o.x + o.w / 2, o.y);
        }
      } else {
        if (aabb(pb.x, pb.y, pb.w, pb.h, o.x + 6, o.y + 8, o.w - 12, o.h - 14)) {
          damagePlayer(o.x + o.w / 2, o.y);
          state.obstacles.splice(i, 1); // wreck removed so it can't re-hit
          continue;
        }
      }
    }
  }

  // --- Move food + pickup check -------------------------------------------
  for (let i = state.foods.length - 1; i >= 0; i--) {
    const f = state.foods[i];
    f.y += worldDy;
    if (f.y > CONFIG.BASE_H + 40) {
      state.foods.splice(i, 1);
      continue;
    }
    if (aabb(pb.x, pb.y, pb.w, pb.h, f.x + 8, f.y + 8, 48, 48)) {
      state.foods.splice(i, 1);
      state.score += CONFIG.FOOD_BONUS;
      scoreEl.textContent = 'SCORE: ' + padScore(state.score);
      AudioFX.collect();
      state.popups.push({ x: f.x + 32, y: f.y, text: '+' + CONFIG.FOOD_BONUS, life: 1, color: '#ffd700' });
    }
  }

  // --- Floating score popups ----------------------------------------------
  for (let i = state.popups.length - 1; i >= 0; i--) {
    const t = state.popups[i];
    t.y -= 60 * dt;
    t.life -= dt;
    if (t.life <= 0) state.popups.splice(i, 1);
  }
}

/* ---------------------------------------------------------------------------
   9. DRAW
--------------------------------------------------------------------------- */

// Draws a vertically repeating tile with the given pixel offset.
// The world scrolls DOWN the screen (car drives forward/up), so tiles
// shift downward as offset grows: first tile starts at (offset - tileH)
// which is always ≤ 0, covering the top edge, then repeats past the bottom.
function drawTiled(img, offset, y, w, h, tileH) {
  let yy = y + offset - tileH;
  while (yy < CONFIG.BASE_H) {
    ctx.drawImage(img, 0, yy, w, h);
    yy += tileH;
  }
}

function drawSceneBase() {
  // Asphalt + shoulders.
  drawTiled(assets.road, state.roadOffset, 0, CONFIG.BASE_W, TILE_ROAD_H, TILE_ROAD_H);
  // Roadside bushes (glued to the same scroll plane as the road).
  drawTiled(assets.roadside, state.sideOffset, 0, CONFIG.BASE_W, TILE_SIDE_H, TILE_SIDE_H);
}

function drawObstacle(o) {
  // Soft shadow for depth.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  if (o.type === 'oil') {
    // Oil IS a shadow-like blob; draw directly.
    ctx.drawImage(o.img, o.x, o.y, o.w, o.h);
    return;
  }
  ctx.beginPath();
  ctx.ellipse(o.x + o.w / 2 + 4, o.y + o.h / 2 + 6, o.w * 0.52, o.h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(o.img, o.x, o.y, o.w, o.h);
}

function drawFood(f) {
  // Pulsing glow ring so pickups read instantly.
  const pulse = 0.5 + 0.5 * Math.sin(state.foodPulse * 6);
  const r = 34 + pulse * 7;
  const cx = f.x + 32;
  const cy = f.y + 32;
  const grad = ctx.createRadialGradient(cx, cy, 6, cx, cy, r);
  grad.addColorStop(0, 'rgba(255, 235, 130, 0.85)');
  grad.addColorStop(0.6, 'rgba(255, 200, 60, 0.35)');
  grad.addColorStop(1, 'rgba(255, 200, 60, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Red/blue sunburst like the reference art.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.foodPulse * 1.4);
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(214, 58, 47, 0.55)' : 'rgba(242, 194, 48, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 0.95, (i * Math.PI) / 6, ((i + 0.5) * Math.PI) / 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.drawImage(assets.food, f.x, f.y, 64, 64);
}

function drawPlayer() {
  const p = state.player;
  // Flicker while invulnerable (skip drawing on alternate intervals).
  if (p.invuln > 0 && Math.floor(p.invuln * 10) % 2 === 0) return;

  const py = CONFIG.BASE_H - CONFIG.PLAYER_Y_OFFSET;
  // Shadow.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(p.x + p.w / 2 + 4, py + p.h / 2 + 6, p.w * 0.55, p.h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(assets.van, p.x, py, p.w, p.h);
}

function drawPopups() {
  ctx.textAlign = 'center';
  for (const t of state.popups) {
    ctx.globalAlpha = Math.min(1, t.life * 2);
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillStyle = t.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function draw() {
  ctx.save();
  // Screen shake on impact.
  if (state.shake > 0) {
    const m = state.shake * 14;
    ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
  }

  drawSceneBase();

  for (const o of state.obstacles) {
    if (o.type === 'oil') drawObstacle(o);
  }
  for (const f of state.foods) drawFood(f);
  for (const o of state.obstacles) {
    if (o.type !== 'oil') drawObstacle(o);
  }

  drawPlayer();
  drawPopups();

  ctx.restore();
}

/* ---------------------------------------------------------------------------
   10. GAME LOOP + VISIBILITY-BASED PAUSE
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
    console.error('[MobilMBG] Error during update/draw:', err);
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
  AudioFX.ensureCtx();
  if (state.mode === 'playing') MusicFX.start();

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
  highEl.textContent = 'BEST: ' + padScore(state.highScore);
  AudioFX.userMuted = loadSoundPreference();
  updateSoundToggleUI(AudioFX.userMuted);

  preloadAssets(() => {
    goToStartScreen();
    startLoop();
  });
}

init();
