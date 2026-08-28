'use strict';

/* ============================================================================
   KEJAR KORUPTOR — pseudo-3D endless runner (Antarctic Adventure style)
   Theme: a corruptor flees the KPK chase — dodge police, grab money bags.
   Architecture: Config -> Assets (SVG->Image) -> Audio -> Music -> State ->
               Input -> Spawn/Physics/Collision -> Draw (pseudo-3D) -> Loop ->
               Parent bridge (postMessage)

   PSEUDO-3D PROJECTION
   --------------------
   Every world object sits on the ground plane at depth z (0 = player plane,
   growing toward the horizon). Perspective scale:
       s(z) = FOCAL / (FOCAL + z)          // 1 at the player, -> 0 at infinity
   Ground line at depth z:
       groundY(z) = HORIZON_Y + (BOTTOM_Y - HORIZON_Y) * s(z)
   Horizontal world position (lane fraction of half road width) maps to:
       screenX = CX + worldX * ROAD_HALF0 * s(z)
   Object size simply multiplies by s(z). The vanishing point is therefore
   (CX, HORIZON_Y): everything converges there as z -> infinity.
   ============================================================================ */

/* ---------------------------------------------------------------------------
   1. CONFIG
--------------------------------------------------------------------------- */
const CONFIG = {
  BASE_W: 360,
  BASE_H: 640,

  CX: 180,            // vanishing point x (screen center)
  HORIZON_Y: 208,     // vanishing point y
  BOTTOM_Y: 600,      // ground line at the player plane (z = 0)
  FOCAL: 140,         // perspective focal length (px)
  ROAD_HALF0: 150,    // road half width on screen at z = 0

  Z_FAR: 1100,        // spawn depth
  SEG_LEN: 40,        // road band length for alternating shading

  LANES: [-0.62, 0, 0.62],   // lane centers as fraction of road half width

  SPEED_START: 330,   // world units / s
  SPEED_MAX: 640,
  SPEED_ACCEL: 7,

  SCORE_DIVISOR: 12,
  MONEY_BONUS: 300,

  JUMP_VELOCITY: 390,  // px/s (screen space, straight up)
  JUMP_GRAVITY: 1400,

  // lives removed — 1 hit = game over (hard mode)
  SHAKE_SECONDS: 0.32,

  // police car lateral drift (slow, dodgeable)
  CAR_DRIFT_SPEED: 0.58,      // lane-frac units / s
  CAR_DRIFT_INTERVAL_MIN: 0.85,
  CAR_DRIFT_INTERVAL_RAND: 0.7,

  MIN_GAP: 430,        // min spawn gap (world units)
  GAP_RAND: 380,
  MONEY_GAP_MIN: 750,
  MONEY_GAP_RAND: 800,

  AGGRO_MONEY_CHANCE: 0.34,

  MONEY_BOB_SPEED: 3,    // radians/s — slow float
  MONEY_BOB_AMP: 10,     // pixels — float height

  STORAGE_KEY: 'kejarKoruptor_highScore',
  MAX_DT_MS: 34,

  PARENT_MESSAGE_TYPE: 'arcade-score',
};

// Dynamic game-over copy per obstacle type (per spec).
const GAME_OVER_REASON = {
  car: 'GAME OVER : Caught by the police car!',
  line: 'GAME OVER : Trapped by the KPK police line!',
  doc: 'GAME OVER : Evidence document has been seized!',
};

/* ---------------------------------------------------------------------------
   2. ASSETS — all visuals are inline SVG strings rendered to Image() via
   base64 data URIs. No external image files.
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

// --- PLAYER: the corruptor seen FROM BEHIND (camera chases his back),
// 16-bit vibe: white beanie, black-white striped shirt, dark pants.
// 4-frame run cycle + 1 jump pose. viewBox 48x62, feet at y=60.
function buildRunnerSVG(frame) {
  const INK = '#26262e';
  const SKIN = '#e8b48a';
  const poses = {
    run1: { // contact: left leg forward, right arm forward
      legL: [[20, 36], [14, 48], [13, 58]],  legR: [[28, 36], [34, 47], [37, 57]],
      armL: [[16, 20], [11, 28], [13, 35]],  armR: [[32, 20], [37, 27], [35, 34]],
      bob: 0,
    },
    run2: { // passing: legs under body, body bobs up
      legL: [[20, 36], [19, 48], [18, 58]],  legR: [[28, 36], [27, 47], [26, 57]],
      armL: [[16, 20], [13, 27], [16, 33]],  armR: [[32, 20], [35, 27], [32, 33]],
      bob: -3,
    },
    run3: { // opposite contact
      legL: [[20, 36], [13, 47], [10, 57]],  legR: [[28, 36], [34, 48], [35, 58]],
      armL: [[16, 20], [21, 27], [19, 34]],  armR: [[32, 20], [27, 28], [29, 35]],
      bob: 0,
    },
    run4: { // opposite passing
      legL: [[20, 36], [21, 48], [22, 58]],  legR: [[28, 36], [29, 47], [28, 57]],
      armL: [[16, 20], [19, 27], [16, 33]],  armR: [[32, 20], [29, 27], [32, 33]],
      bob: -3,
    },
    jump: { // airborne: knees tucked, arms raised
      legL: [[20, 36], [14, 43], [19, 49]],  legR: [[28, 36], [34, 43], [29, 49]],
      armL: [[16, 20], [10, 13], [12, 6]],   armR: [[32, 20], [38, 13], [36, 6]],
      bob: 0,
    },
  };
  const P = poses[frame] || poses.run1;

  function limb(points, width, color) {
    const d = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
    return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + width +
      '" stroke-linecap="round" stroke-linejoin="round"/>';
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 62">
    <g transform="translate(0,${P.bob})">
      <!-- far arm (behind torso) -->
      ${limb(P.armR, 5.5, '#c99a72')}
      <!-- legs: dark pants + black shoes -->
      ${limb(P.legL, 7, INK)}
      ${limb(P.legR, 7, INK)}
      ${limb([P.legL[1], P.legL[2]], 8, '#111116')}
      ${limb([P.legR[1], P.legR[2]], 8, '#111116')}
      <!-- striped shirt (white base + dark bands) -->
      <path d="M15,17 Q15,15 18,15 L30,15 Q33,15 33,17 L34,37 L14,37 Z" fill="#f2f2f2"/>
      <g fill="${INK}">
        <rect x="14.4" y="20" width="19.4" height="4"/>
        <rect x="14.6" y="27" width="19.2" height="4"/>
        <rect x="14.8" y="34" width="19" height="3.4"/>
      </g>
      <!-- near arm -->
      ${limb(P.armL, 5.5, SKIN)}
      <!-- head + white beanie (back view: no face) -->
      <circle cx="24" cy="10" r="6.6" fill="${SKIN}"/>
      <path d="M17.4,9 A6.6,6.6 0 0 1 30.6,9 L30.6,7.4 A6.6,6.6 0 0 0 17.4,7.4 Z" fill="#f2f2f2"/>
      <path d="M17.2,8.6 Q24,4.6 30.8,8.6 L30.8,5.6 Q24,1.6 17.2,5.6 Z" fill="#f2f2f2"/>
      <rect x="17" y="7.6" width="14" height="2.6" rx="1.3" fill="#d8d8dc"/>
      <!-- collar -->
      <rect x="19" y="14.4" width="10" height="2.4" rx="1.2" fill="${INK}"/>
    </g>
  </svg>`;
}

// --- MONEY BAG: green sack, tied neck, big $ sign. viewBox 40x46.
function buildMoneySVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 46">
    <path d="M20,10 C10,10 5,20 5,30 C5,40 12,44 20,44 C28,44 35,40 35,30 C35,20 30,10 20,10 Z" fill="#2d8a4e"/>
    <path d="M20,10 C14,10 10,17 9.4,26 C12,30 16,31.6 20,31.6 C24,31.6 28,30 30.6,26 C30,17 26,10 20,10 Z" fill="#3a9e5c"/>
    <path d="M13,4 L27,4 L24,12 L16,12 Z" fill="#1f6b38"/>
    <path d="M13,4 Q20,9 27,4 L26,7 Q20,11 14,7 Z" fill="#155c2d"/>
    <ellipse cx="15" cy="18" rx="3.4" ry="5" fill="#5cb870" opacity="0.55"/>
    <text x="20" y="40" text-anchor="middle" font-family="Arial Black, Arial, sans-serif"
      font-size="15" font-weight="900" fill="#ffd76a">$</text>
    <text x="20" y="40" text-anchor="middle" font-family="Arial Black, Arial, sans-serif"
      font-size="15" font-weight="900" fill="none" stroke="#155c2d" stroke-width="0.8">$</text>
  </svg>`;
}

// --- POLICE CAR: roadblock facing the player (front view) with red/blue
// light bar, windshield, headlights. viewBox 72x58.
function buildPoliceCarSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 58">
    <!-- light bar -->
    <rect x="20" y="2" width="14" height="6" rx="2" fill="#e03a3a"/>
    <rect x="38" y="2" width="14" height="6" rx="2" fill="#2f6fd1"/>
    <rect x="18" y="7" width="36" height="3" rx="1.5" fill="#22242c"/>
    <!-- roof + windshield -->
    <path d="M16,10 L56,10 L60,24 L12,24 Z" fill="#e8e6df"/>
    <path d="M18,12 L54,12 L57,23 L15,23 Z" fill="#28394b"/>
    <path d="M19,13 L34,13 L31,22 L17,22 Z" fill="#41586e" opacity="0.8"/>
    <!-- hood -->
    <path d="M8,24 L64,24 L68,40 L4,40 Z" fill="#e8e6df"/>
    <path d="M8,24 L64,24 L65,28 L7,28 Z" fill="#c9c6bc"/>
    <!-- POLICE badge strip -->
    <rect x="26" y="30" width="20" height="7" rx="2" fill="#22242c"/>
    <text x="36" y="35.8" text-anchor="middle" font-family="Arial, sans-serif"
      font-size="5.4" font-weight="bold" fill="#f2f2f2">POLICE</text>
    <!-- headlights -->
    <rect x="8" y="31" width="10" height="6" rx="2" fill="#ffe9a8"/>
    <rect x="54" y="31" width="10" height="6" rx="2" fill="#ffe9a8"/>
    <!-- bumper -->
    <rect x="4" y="40" width="64" height="9" rx="3" fill="#22242c"/>
    <rect x="10" y="42" width="52" height="3" rx="1.5" fill="#3a3d47"/>
    <!-- wheels peeking -->
    <rect x="2" y="46" width="12" height="9" rx="3" fill="#111116"/>
    <rect x="58" y="46" width="12" height="9" rx="3" fill="#111116"/>
    <!-- grille -->
    <rect x="28" y="42" width="16" height="4" rx="1.5" fill="#4a4d57"/>
  </svg>`;
}

// --- POLICE LINE: yellow-black striped tape barrier on two posts.
// viewBox 76x42.
function buildPoliceLineSVG() {
  let stripes = '';
  for (let i = -2; i < 10; i++) {
    stripes += `<path d="M${i * 12},14 l10,14 h-7 l-10,-14 Z" fill="#22242c"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 76 42">
    <clipPath id="tape"><rect x="4" y="14" width="68" height="14" rx="2"/></clipPath>
    <!-- posts -->
    <rect x="6" y="12" width="5" height="28" rx="2" fill="#8f939e"/>
    <rect x="65" y="12" width="5" height="28" rx="2" fill="#8f939e"/>
    <rect x="4" y="38" width="9" height="3" rx="1.5" fill="#6d717c"/>
    <rect x="63" y="38" width="9" height="3" rx="1.5" fill="#6d717c"/>
    <!-- tape -->
    <rect x="4" y="14" width="68" height="14" fill="#f2c230"/>
    <g clip-path="url(#tape)">${stripes}</g>
    <rect x="4" y="14" width="68" height="14" fill="none" stroke="#b98c14" stroke-width="1.6"/>
  </svg>`;
}

// --- EVIDENCE DOCUMENTS: red folder with papers + red stamp.
// viewBox 46x52.
function buildDocSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 46 52">
    <!-- papers behind -->
    <rect x="12" y="6" width="22" height="30" rx="2" fill="#f4f1e6" transform="rotate(-6 23 21)"/>
    <path d="M15,12 h16 M14,17 h16 M14,22 h12" stroke="#b9b4a4" stroke-width="1.6" transform="rotate(-6 23 21)"/>
    <!-- folder -->
    <path d="M8,14 L34,10 L40,44 L12,49 Z" fill="#c0392b"/>
    <path d="M8,14 L34,10 L35,16 L9,20 Z" fill="#962d22"/>
    <circle cx="24" cy="32" r="7" fill="none" stroke="#fff" stroke-width="2.4" opacity="0.85"/>
    <circle cx="24" cy="32" r="3" fill="#fff" opacity="0.6"/>
    <!-- paperclip -->
    <path d="M33,8 q4,0 4,4 v8 q0,3 -3,3 q-2.6,0 -2.6,-2.6 v-6" fill="none" stroke="#8f939e" stroke-width="1.8"/>
  </svg>`;
}

// --- CITY SKYLINE (horizon silhouette): dark towers, lit windows,
// and a Monas-style monument. Tile 480x90.
function buildSkylineSVG() {
  let windows = '';
  // deterministic lit windows on near-row towers
  const towers = [
    [10, 34, 40], [56, 22, 30], [92, 44, 34], [134, 30, 46],
    [188, 18, 26], [222, 52, 38], [268, 28, 30], [304, 40, 44],
    [356, 24, 34], [396, 46, 36], [440, 32, 40],
  ];
  towers.forEach(([x, w, h], t) => {
    for (let i = 0; i < w * h / 90; i++) {
      const wx = x + 3 + ((i * 13 + t * 7) % (w - 6));
      const wy = 90 - h + 4 + ((i * 17 + t * 5) % (h - 8));
      windows += `<rect x="${wx}" y="${wy}" width="2.4" height="3" fill="#f7d97b"/>`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 90">
    <!-- far row (lighter haze) -->
    <g fill="#1c2136">
      <rect x="0" y="52" width="34" height="38"/>
      <rect x="70" y="58" width="26" height="32"/>
      <rect x="150" y="50" width="30" height="40"/>
      <rect x="240" y="56" width="36" height="34"/>
      <rect x="330" y="52" width="28" height="38"/>
      <rect x="420" y="58" width="40" height="32"/>
    </g>
    <!-- near row -->
    <g fill="#12162a">
      ${towers.map(([x, w, h]) => `<rect x="${x}" y="${90 - h}" width="${w}" height="${h}"/>`).join('')}
    </g>
    ${windows}
    <!-- Monas-style monument -->
    <g>
      <rect x="196" y="34" width="7" height="56" fill="#0e1120"/>
      <path d="M193,34 L206,34 L199.5,14 L193,34 Z" fill="#0e1120"/>
      <path d="M199.5,6 L202.5,15 L199.5,18 L196.5,15 Z" fill="#e8b44a"/>
    </g>
  </svg>`;
}

const assets = {
  run1: null, run2: null, run3: null, run4: null, jump: null,
  money: null, car: null, line: null, doc: null, skyline: null,
};

let assetsReadyCount = 0;
const ASSET_TOTAL = 10;
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

  assets.run1 = loadSvgImage(buildRunnerSVG('run1'));
  assets.run2 = loadSvgImage(buildRunnerSVG('run2'));
  assets.run3 = loadSvgImage(buildRunnerSVG('run3'));
  assets.run4 = loadSvgImage(buildRunnerSVG('run4'));
  assets.jump = loadSvgImage(buildRunnerSVG('jump'));
  assets.money = loadSvgImage(buildMoneySVG());
  assets.car = loadSvgImage(buildPoliceCarSVG());
  assets.line = loadSvgImage(buildPoliceLineSVG());
  assets.doc = loadSvgImage(buildDocSVG());
  assets.skyline = loadSvgImage(buildSkylineSVG());

  Object.values(assets).forEach((img) => {
    if (img.complete) {
      markReady();
    } else {
      img.onload = markReady;
      // Defensive: a failed decode must never hang the loading screen.
      img.onerror = markReady;
    }
  });
}

/* ---------------------------------------------------------------------------
   3. AUDIO — SFX via Web Audio API oscillators. Auto-muted when hidden.
--------------------------------------------------------------------------- */
const SOUND_PREF_KEY = 'kejarKoruptor_soundMuted';

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
    // Private mode — session-only preference.
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

  // SFX jump: quick rising hop.
  jump() {
    this.sweep(280, 620, 0.14, 'square', 0.12);
  },

  // SFX money: bright double coin blip.
  money() {
    this.sweep(760, 1140, 0.08, 'square', 0.12);
    this.sweep(980, 1470, 0.1, 'square', 0.1, 0.07);
  },

  // SFX hit: thud + grind.
  hit() {
    this.sweep(180, 45, 0.3, 'sawtooth', 0.24);
    this.sweep(95, 60, 0.16, 'square', 0.16, 0.03);
  },

  // SFX game over: dramatic descending minor phrase.
  gameOver() {
    const notes = [440, 349, 294, 220];
    notes.forEach((f, i) => {
      this.sweep(f, f * 0.94, 0.2, 'square', 0.13, i * 0.18);
    });
  },
};

/* ---------------------------------------------------------------------------
   3b. BACKGROUND MUSIC — fast tense chiptune loop (A minor chase),
   lookahead-scheduled on the AudioContext clock.
--------------------------------------------------------------------------- */
const NOTE_SEMITONE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

function noteToFrequency(note) {
  const match = /^([A-G]#?)(\d)$/.exec(note);
  if (!match) return 440;
  const [, name, octaveStr] = match;
  const semitoneFromA4 = (parseInt(octaveStr, 10) - 4) * 12 + (NOTE_SEMITONE[name] - NOTE_SEMITONE.A);
  return 440 * Math.pow(2, semitoneFromA4 / 12);
}

const MUSIC_BPM = 172;
const MUSIC_EIGHTH = 60 / MUSIC_BPM / 2;

const MELODY = [
  'A4', 'C5', 'E5', 'C5', 'A4', 'C5', 'E5', 'G5',
  'F5', 'E5', 'D5', 'E5', 'C5', 'D5', 'E5', '',
  'A4', 'C5', 'E5', 'C5', 'A5', 'G5', 'E5', 'C5',
  'D5', 'E5', 'F5', 'E5', 'D5', 'C5', 'B4', '',
];

const BASS = [
  'A2', '', 'E3', '', 'A2', '', 'E3', '',
  'F2', '', 'C3', '', 'G2', '', 'B2', '',
  'A2', '', 'E3', '', 'A2', '', 'E3', '',
  'F2', '', 'G2', '', 'E2', '', 'E2', '',
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
  player: {
    lane: 1,        // discrete target lane 0..2
    laneFrac: 0,    // smoothed horizontal position (fraction of half road)
    jumpY: 0,       // jump height above ground (screen px)
    vy: 0,
    grounded: true,
    frameTimer: 0,
  },
  entities: [],     // {type:'car'|'line'|'doc'|'money', lane, z, bobPhase, worldX, targetX, driftCd}
  popups: [],
  speed: CONFIG.SPEED_START,
  dist: 0,
  score: 0,
  moneyScore: 0,
  highScore: 0,
  nextObstacleDist: 620,
  nextMoneyDist: 900,
  scroll: 0,        // total distance scrolled — drives road band shading
  shake: 0,
  time: 0,
  lastHitType: 'car',
  gameOverAt: 0,
  stars: [],        // precomputed star field
};

// Precompute star positions once (deterministic, above the skyline).
(function seedStars() {
  let seed = 42;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 46; i++) {
    state.stars.push({
      x: Math.floor(rnd() * CONFIG.BASE_W),
      y: Math.floor(rnd() * (CONFIG.HORIZON_Y - 60)),
      r: rnd() < 0.25 ? 1.6 : 1,
      tw: rnd() * Math.PI * 2,
    });
  }
})();

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
   5. CANVAS & RESPONSIVE SIZING (portrait letterbox)
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
   6. PSEUDO-3D PROJECTION HELPERS
--------------------------------------------------------------------------- */

// Perspective scale at depth z (1 at player plane, -> 0 at the horizon).
function scaleAt(z) {
  return CONFIG.FOCAL / (CONFIG.FOCAL + z);
}

// Screen y of the ground line at depth z.
function groundYAt(z) {
  return CONFIG.HORIZON_Y + (CONFIG.BOTTOM_Y - CONFIG.HORIZON_Y) * scaleAt(z);
}

// Screen x of a world-x (fraction of half road width) at depth z.
function screenXAt(worldX, z) {
  return CONFIG.CX + worldX * CONFIG.ROAD_HALF0 * scaleAt(z);
}

/* ---------------------------------------------------------------------------
   7. INPUT
   Keyboard: Left/Right or A/D = switch lane (discrete); Space/Up/W = jump.
   Touch: tap left/right half = switch lane; swipe up = jump; plus a
   dedicated on-screen JUMP button. Tap anywhere starts / restarts.
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
    if (performance.now() - state.gameOverAt > 400) startPlaying();
    return;
  }
}

function switchLane(dir) {
  if (isViralVisible()) return;
  if (state.mode !== 'playing') return;
  const next = Math.max(0, Math.min(CONFIG.LANES.length - 1, state.player.lane + dir));
  state.player.lane = next;
}

function doJump() {
  if (isViralVisible()) return;
  if (state.mode !== 'playing') return;
  const p = state.player;
  if (!p.grounded) return; // no double jump
  p.vy = CONFIG.JUMP_VELOCITY;
  p.grounded = false;
  AudioFX.jump();
}

function startPlaying() {
  resetGame();
  state.mode = 'playing';
  showScreen(null);
  MusicFX.start();
}

// Tap / swipe handling on the full-screen container.
const activePointers = new Map(); // pointerId -> {x, y, t, consumed}

container_pointerdown();
function container_pointerdown() {
  const container = document.getElementById('game-container');

  container.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (isViralVisible()) { ViralShare.hide(); return; }
    if (state.mode !== 'playing') {
      primaryAction();
      return;
    }
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), consumed: false });
  }, { passive: false });

  container.addEventListener('pointermove', (e) => {
    const ptr = activePointers.get(e.pointerId);
    if (!ptr || ptr.consumed) return;
    // Swipe up => jump.
    if (ptr.y - e.clientY > 28) {
      ptr.consumed = true;
      doJump();
    }
  }, { passive: true });

  function release(e) {
    const ptr = activePointers.get(e.pointerId);
    if (!ptr) return;
    activePointers.delete(e.pointerId);
    // Quick tap (no swipe consumed) => lane change by screen half.
    if (!ptr.consumed && performance.now() - ptr.t < 280) {
      switchLane(e.clientX < window.innerWidth / 2 ? -1 : 1);
    }
  }
  container.addEventListener('pointerup', release, { passive: true });
  container.addEventListener('pointercancel', release, { passive: true });
}

window.addEventListener('keydown', (e) => {
  if (isViralVisible()) {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
      e.preventDefault();
      ViralShare.hide();
    }
    return;
  }
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    if (!e.repeat) {
      if (state.mode === 'playing') doJump();
      else primaryAction();
    }
    return;
  }
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
    e.preventDefault();
    switchLane(-1);
  } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
    e.preventDefault();
    switchLane(1);
  }
});

/* ---------------------------------------------------------------------------
   8. GAME FLOW (screens / reset / game over)
--------------------------------------------------------------------------- */
const screens = {
  loading: document.getElementById('loading-screen'),
  start: document.getElementById('start-screen'),
  gameover: document.getElementById('gameover-screen'),
};
const scoreEl = document.getElementById('hud-score');
const highEl = document.getElementById('hud-high');
const startBestEl = document.getElementById('start-best');
const finalScoreEl = document.getElementById('final-score');
const finalHighEl = document.getElementById('final-high');
const newRecordEl = document.getElementById('new-record');
const goReasonEl = document.getElementById('go-reason');
const retryBtn = document.getElementById('retry-btn');
const jumpBtn = document.getElementById('jump-btn');

function padScore(n) {
  return String(Math.min(99999, n)).padStart(5, '0');
}

function showScreen(name) {
  screens.loading.hidden = name !== 'loading';
  screens.start.hidden = name !== 'start';
  screens.gameover.hidden = name !== 'gameover';
}

function resetGame() {
  const p = state.player;
  p.lane = 1;
  p.laneFrac = 0;
  p.jumpY = 0;
  p.vy = 0;
  p.grounded = true;
  p.frameTimer = 0;
  state.entities = [];
  state.popups = [];
  state.speed = CONFIG.SPEED_START;
  state.dist = 0;
  state.score = 0;
  state.moneyScore = 0;
  state.nextObstacleDist = 620;
  state.nextMoneyDist = 900;
  state.shake = 0;
  state.lastHitType = 'car';
  activePointers.clear();
  scoreEl.textContent = 'SCORE: 00000';
}

function goToStartScreen() {
  resetGame();
  state.mode = 'ready';
  startBestEl.textContent = 'Best score: ' + state.highScore;
  showScreen('start');
  canvas.focus();
}

// Report score to portal (js/pwa.js) when inside the portal iframe.
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

  goReasonEl.textContent = GAME_OVER_REASON[state.lastHitType] || GAME_OVER_REASON.car;
  finalScoreEl.textContent = String(state.score);
  finalHighEl.textContent = String(state.highScore);
  highEl.textContent = 'BEST: ' + padScore(state.highScore);
  newRecordEl.hidden = !isNewRecord;
  showScreen('gameover');
  reportScoreToParent(state.score);

  if (isNewRecord) {
    try {
      ViralShare.show('kejar-koruptor', state.score, function () {
        showScreen(null);
        startPlaying();
      });
    } catch (err) {
      console.error('[KejarKoruptor] ViralShare failed:', err);
    }
  }
}

retryBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (isViralVisible()) { ViralShare.hide(); return; }
  AudioFX.ensureCtx();
  startPlaying();
}, { passive: false });

jumpBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (isViralVisible()) { ViralShare.hide(); return; }
  AudioFX.ensureCtx();
  doJump();
}, { passive: false });

/* ---------------------------------------------------------------------------
   9. SPAWN, PHYSICS & COLLISION
--------------------------------------------------------------------------- */

function currentGap() {
  const t = (state.speed - CONFIG.SPEED_START) / (CONFIG.SPEED_MAX - CONFIG.SPEED_START);
  const shrink = 1 - 0.3 * t;
  return CONFIG.MIN_GAP + Math.random() * CONFIG.GAP_RAND * shrink;
}

function spawnObstacle() {
  const roll = Math.random();
  let type;
  if (roll < 0.4) type = 'car';
  else if (roll < 0.72) type = 'line';
  else type = 'doc';
  const lane = Math.floor(Math.random() * CONFIG.LANES.length);
  if (type === 'car') {
    // police car drifts slowly left-right; keep both discrete lane and continuous worldX
    state.entities.push({
      type,
      lane,
      z: CONFIG.Z_FAR,
      bobPhase: 0,
      worldX: CONFIG.LANES[lane],
      targetX: CONFIG.LANES[lane],
      driftCd: CONFIG.CAR_DRIFT_INTERVAL_MIN + Math.random() * CONFIG.CAR_DRIFT_INTERVAL_RAND,
    });
  } else {
    state.entities.push({
      type,
      lane,
      z: CONFIG.Z_FAR,
      bobPhase: 0,
    });
  }
  state.nextObstacleDist = state.dist + currentGap();
}

function spawnMoney() {
  state.entities.push({
    type: 'money',
    lane: Math.floor(Math.random() * CONFIG.LANES.length),
    z: CONFIG.Z_FAR,
    bobPhase: Math.random() * Math.PI * 2,
  });
  state.nextMoneyDist = state.dist + CONFIG.MONEY_GAP_MIN + Math.random() * CONFIG.MONEY_GAP_RAND;
}

// AABB overlap on two rectangles.
function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function handleHit(type) {
  state.lastHitType = type;
  state.shake = CONFIG.SHAKE_SECONDS;
  AudioFX.hit();
  gameOver();
}

function update(dtMs) {
  const dt = dtMs / 1000;
  const p = state.player;
  state.time += dt;

  // --- Speed & distance ramp ----------------------------------------------
  state.speed = Math.min(CONFIG.SPEED_MAX, state.speed + CONFIG.SPEED_ACCEL * dt);
  const dz = state.speed * dt;
  state.dist += dz;
  state.scroll += dz;

  // --- Timers --------------------------------------------------------------
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt);

  // --- Lane smoothing (discrete lanes, eased position) --------------------
  const targetFrac = CONFIG.LANES[p.lane];
  p.laneFrac += (targetFrac - p.laneFrac) * Math.min(1, dt * 13);

  // --- Jump physics (screen-space vertical parabola) ----------------------
  if (!p.grounded) {
    p.vy -= CONFIG.JUMP_GRAVITY * dt;
    p.jumpY += p.vy * dt;
    if (p.jumpY <= 0) {
      p.jumpY = 0;
      p.vy = 0;
      p.grounded = true;
    }
  }

  // --- Run animation -------------------------------------------------------
  p.frameTimer += dtMs;
  const frameMs = Math.max(80, 170 - state.speed * 0.09);

  // --- Score ---------------------------------------------------------------
  const newScore = Math.floor(state.dist / CONFIG.SCORE_DIVISOR) + state.moneyScore;
  if (newScore !== state.score) {
    state.score = newScore;
    scoreEl.textContent = 'SCORE: ' + padScore(state.score);
  }

  // --- Spawning (distance-driven) ------------------------------------------
  if (state.dist >= state.nextObstacleDist) spawnObstacle();
  if (state.dist >= state.nextMoneyDist) spawnMoney();

  // --- Entities approach the camera ---------------------------------------
  const airborne = p.jumpY > 6; // jumping clears every obstacle
  const pbW = 44, pbH = 70;      // player hitbox size at z = 0
  const pbX = CONFIG.CX + p.laneFrac * CONFIG.ROAD_HALF0 - pbW / 2;
  const pbY = CONFIG.BOTTOM_Y + 6 - pbH + p.jumpY;

  for (let i = state.entities.length - 1; i >= 0; i--) {
    const e = state.entities[i];
    e.z -= dz;
    if (e.type === 'money') e.bobPhase += dt * CONFIG.MONEY_BOB_SPEED;

    // police car drifts slowly left-right (only this type)
    if (e.type === 'car' && typeof e.worldX === 'number') {
      e.driftCd -= dt;
      if (e.driftCd <= 0) {
        e.driftCd = CONFIG.CAR_DRIFT_INTERVAL_MIN + Math.random() * CONFIG.CAR_DRIFT_INTERVAL_RAND;
        var dir = Math.random() < 0.5 ? -1 : 1;
        var newLane = e.lane + dir;
        if (newLane < 0 || newLane > 2) newLane = e.lane - dir;
        if (newLane < 0) newLane = 0;
        if (newLane > 2) newLane = 2;
        e.lane = newLane;
        e.targetX = CONFIG.LANES[newLane];
      }
      var dx = e.targetX - e.worldX;
      if (Math.abs(dx) > 0.001) {
        var step = Math.sign(dx) * Math.min(Math.abs(dx), CONFIG.CAR_DRIFT_SPEED * dt);
        e.worldX += step;
      }
    }

    if (e.z < -60) {
      state.entities.splice(i, 1);
      continue;
    }

    // Collision only inside the near-depth window
    if (e.z > -14 && e.z < 44) {
      if (e.type === 'money') {
        if (e.lane === p.lane && aabb(pbX, pbY, pbW, pbH, CONFIG.CX + CONFIG.LANES[e.lane] * CONFIG.ROAD_HALF0 * scaleAt(Math.max(0, e.z)) - 24, groundYAt(Math.max(0, e.z)) - 56, 48, 56)) {
          state.entities.splice(i, 1);
          state.moneyScore += CONFIG.MONEY_BONUS;
          state.score = Math.floor(state.dist / CONFIG.SCORE_DIVISOR) + state.moneyScore;
          scoreEl.textContent = 'SCORE: ' + padScore(state.score);
          AudioFX.money();
          state.popups.push({
            x: CONFIG.CX + p.laneFrac * CONFIG.ROAD_HALF0,
            y: CONFIG.BOTTOM_Y - 120,
            text: '+' + CONFIG.MONEY_BONUS, life: 1, color: '#ffd700',
          });
        }
      } else if (!airborne) {
        var hit = false;
        if (e.type === 'car') {
          // car uses continuous worldX — need overlap, not just discrete lane
          var carX = (typeof e.worldX === 'number') ? e.worldX : CONFIG.LANES[e.lane];
          if (Math.abs(carX - p.laneFrac) < 0.38) hit = true;
        } else {
          if (e.lane === p.lane) hit = true;
        }
        if (hit) {
          state.entities.splice(i, 1);
          handleHit(e.type);
          return; // instant game over, no lives
        }
      }
    }
  }

  // --- Floating popups -----------------------------------------------------
  for (let i = state.popups.length - 1; i >= 0; i--) {
    const t = state.popups[i];
    t.y -= 60 * dt;
    t.life -= dt;
    if (t.life <= 0) state.popups.splice(i, 1);
  }

  // Keep run animation ticking (full 4-frame cycle).
  if (p.grounded && p.frameTimer >= frameMs * 4) {
    p.frameTimer = 0;
  }
}

/* ---------------------------------------------------------------------------
   10. DRAW (pseudo-3D scene, painter's algorithm: far -> near)
--------------------------------------------------------------------------- */

function drawSky() {
  // Dusk-to-night gradient.
  const sky = ctx.createLinearGradient(0, 0, 0, CONFIG.HORIZON_Y + 14);
  sky.addColorStop(0, '#0b1026');
  sky.addColorStop(0.55, '#251a3e');
  sky.addColorStop(0.85, '#63304a');
  sky.addColorStop(1, '#93413a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CONFIG.BASE_W, CONFIG.HORIZON_Y + 14);

  // Stars (twinkle).
  for (const st of state.stars) {
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(state.time * 2.2 + st.tw);
    ctx.fillStyle = '#e8ecff';
    ctx.fillRect(st.x, st.y, st.r, st.r);
  }
  ctx.globalAlpha = 1;

  // Moon.
  ctx.fillStyle = 'rgba(246, 240, 200, 0.25)';
  ctx.beginPath();
  ctx.arc(296, 64, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f6f0c8';
  ctx.beginPath();
  ctx.arc(296, 64, 19, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e4dcae';
  ctx.beginPath();
  ctx.arc(290, 60, 4.4, 0, Math.PI * 2);
  ctx.arc(302, 70, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawSkyline() {
  // Slight parallax: skyline shifts opposite the runner's lane offset.
  const shift = -state.player.laneFrac * 12;
  const w = 480, h = 90;
  let x = (shift % w) - w;
  while (x < CONFIG.BASE_W) {
    ctx.drawImage(assets.skyline, x, CONFIG.HORIZON_Y - h + 4, w, h);
    x += w;
  }
  // Ground base below horizon (dark city floor).
  ctx.fillStyle = '#1a1c29';
  ctx.fillRect(0, CONFIG.HORIZON_Y + 2, CONFIG.BASE_W, CONFIG.BASE_H - CONFIG.HORIZON_Y - 2);
}

function drawRoad() {
  // Draw road bands from the FAR end toward the player (painter's order).
  const maxSeg = Math.ceil(CONFIG.Z_FAR / CONFIG.SEG_LEN);
  for (let k = maxSeg; k >= -1; k--) {
    const zFarEdge = k * CONFIG.SEG_LEN - (state.scroll % CONFIG.SEG_LEN);
    const zNearEdge = zFarEdge + CONFIG.SEG_LEN;
    if (zNearEdge <= -CONFIG.FOCAL * 0.4) continue; // behind the camera plane

    const s1 = scaleAt(Math.max(zFarEdge, -55));
    const s2 = scaleAt(Math.max(zNearEdge, -55));
    const y1 = CONFIG.HORIZON_Y + (CONFIG.BOTTOM_Y - CONFIG.HORIZON_Y) * s1;
    const y2 = CONFIG.HORIZON_Y + (CONFIG.BOTTOM_Y - CONFIG.HORIZON_Y) * s2;

    const worldZ = zFarEdge + state.scroll;
    const band = Math.floor(worldZ / CONFIG.SEG_LEN) % 2 === 0;

    // Asphalt band.
    ctx.fillStyle = band ? '#3c3c46' : '#43434e';
    quad(
      screenXAt(-1, Math.max(zFarEdge, -55)), y1,
      screenXAt(1, Math.max(zFarEdge, -55)), y1,
      screenXAt(1, Math.max(zNearEdge, -55)), y2,
      screenXAt(-1, Math.max(zNearEdge, -55)), y2
    );

    // Solid edge lines.
    ctx.fillStyle = '#d8d8d0';
    quad(
      screenXAt(-0.96, Math.max(zFarEdge, -55)), y1,
      screenXAt(-0.92, Math.max(zFarEdge, -55)), y1,
      screenXAt(-0.92, Math.max(zNearEdge, -55)), y2,
      screenXAt(-0.96, Math.max(zNearEdge, -55)), y2
    );
    quad(
      screenXAt(0.92, Math.max(zFarEdge, -55)), y1,
      screenXAt(0.96, Math.max(zFarEdge, -55)), y1,
      screenXAt(0.96, Math.max(zNearEdge, -55)), y2,
      screenXAt(0.92, Math.max(zNearEdge, -55)), y2
    );

    // Dashed lane separators (on alternate bands).
    if (band) {
      ctx.fillStyle = '#c8c8bd';
      for (const bx of [-0.333, 0.333]) {
        quad(
          screenXAt(bx - 0.014, Math.max(zFarEdge, -55)), y1,
          screenXAt(bx + 0.014, Math.max(zFarEdge, -55)), y1,
          screenXAt(bx + 0.014, Math.max(zNearEdge, -55)), y2,
          screenXAt(bx - 0.014, Math.max(zNearEdge, -55)), y2
        );
      }
    }
  }
}

// Fills a quadrilateral (road band / dash / edge line).
function quad(x1, y1, x2, y2, x3, y3, x4, y4) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

const ENTITY_ART = {
  car: { img: () => assets.car, w: 104, h: 84 },
  line: { img: () => assets.line, w: 112, h: 62 },
  doc: { img: () => assets.doc, w: 64, h: 72 },
  money: { img: () => assets.money, w: 58, h: 66 },
};

function drawEntity(e) {
  const z = Math.max(e.z, 0.001);
  const s = scaleAt(z);
  if (s <= 0.012) return; // too far / sub-pixel
  const art = ENTITY_ART[e.type];
  const w = art.w * s;
  const h = art.h * s;
  var worldX = (e.type === 'car' && typeof e.worldX === 'number') ? e.worldX : CONFIG.LANES[e.lane];
  const x = CONFIG.CX + worldX * CONFIG.ROAD_HALF0 * s - w / 2;

  // Money bags float with a gentle bob; obstacles sit on the ground.
  let y = groundYAt(z) - h + 2;
  if (e.type === 'money') {
    const bobOffset = Math.sin(e.bobPhase) * CONFIG.MONEY_BOB_AMP * s;
    y += bobOffset - 8 * s;
    // Shadow on ground (shrinks as bag rises).
    const shScale = 1 - Math.min(0.4, Math.abs(bobOffset) / 40);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, groundYAt(z) + 2, w * 0.38 * shScale, 6 * shScale, 0, 0, Math.PI * 2);
    ctx.fill();
    // Glow halo.
    const cx = x + w / 2;
    const cy = y + h / 2;
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, w * 0.85);
    grad.addColorStop(0, 'rgba(90, 200, 120, 0.5)');
    grad.addColorStop(1, 'rgba(90, 200, 120, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.85, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Contact shadow.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, groundYAt(z) + 2, w * 0.46, h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.drawImage(art.img(), x, y, w, h);
}

function drawPlayer() {
  const p = state.player;

  const w = 62, h = 80;
  const px = CONFIG.CX + p.laneFrac * CONFIG.ROAD_HALF0 - w / 2;
  const py = CONFIG.BOTTOM_Y + 8 - h - p.jumpY;

  // Shadow (shrinks while airborne, pulses during run).
  const airFactor = 1 - Math.min(0.5, p.jumpY / 160);
  const runBob = p.grounded ? (1 + Math.sin(p.frameTimer * 0.035) * 0.08) : 1;
  const shScale = airFactor * runBob;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.beginPath();
  ctx.ellipse(CONFIG.CX + p.laneFrac * CONFIG.ROAD_HALF0, CONFIG.BOTTOM_Y + 10, w * 0.42 * shScale, 8 * shScale, 0, 0, Math.PI * 2);
  ctx.fill();

  let img;
  if (!p.grounded) {
    img = assets.jump;
  } else {
    const frameMs = Math.max(80, 170 - state.speed * 0.09);
    const idx = Math.floor(p.frameTimer / frameMs) % 4;
    img = [assets.run1, assets.run2, assets.run3, assets.run4][idx];
  }
  ctx.drawImage(img, px, py, w, h);

  // Running dust particles (only when grounded and moving fast).
  if (p.grounded && state.speed > 400) {
    const dustAlpha = Math.min(0.4, (state.speed - 400) / 500);
    ctx.fillStyle = `rgba(180, 170, 150, ${dustAlpha})`;
    const dustX = CONFIG.CX + p.laneFrac * CONFIG.ROAD_HALF0;
    for (let i = 0; i < 3; i++) {
      const dx = Math.sin(p.frameTimer * 0.02 + i * 2.1) * 8;
      const dy = 2 + i * 3 + Math.sin(p.frameTimer * 0.03 + i) * 2;
      const r = 2 + Math.sin(p.frameTimer * 0.025 + i * 1.7) * 1;
      ctx.beginPath();
      ctx.ellipse(dustX + dx, CONFIG.BOTTOM_Y + 6 + dy, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
  if (state.shake > 0) {
    const m = state.shake * 14;
    ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
  }

  drawSky();
  drawSkyline();
  drawRoad();

  // Painter's order: far entities first (array is ordered near -> far,
  // so iterate from the end), then the player (nearest).
  for (let i = state.entities.length - 1; i >= 0; i--) drawEntity(state.entities[i]);
  drawPlayer();
  drawPopups();

  ctx.restore();
}

/* ---------------------------------------------------------------------------
   11. GAME LOOP + VISIBILITY-BASED PAUSE
--------------------------------------------------------------------------- */
let rafId = null;
let lastTs = 0;

function loop(ts) {
  if (!lastTs) lastTs = ts;
  const dtMs = Math.min(ts - lastTs, CONFIG.MAX_DT_MS);
  lastTs = ts;

  try {
    if (state.mode === 'playing') {
      update(dtMs);
    }
    draw();
    MusicFX.tick();
  } catch (err) {
    console.error('[KejarKoruptor] Error during update/draw:', err);
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
   12. SOUND TOGGLE
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
   13. INIT
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
