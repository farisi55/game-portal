'use strict';

/* ============================================================================
   AYO KE KOPDES — endless runner ala Chrome Dino
   Tema: pergi berbelanja menuju Koperasi Desa (Kopdes) Merah Putih.
   Arsitektur: Config -> Assets (SVG->Image) -> Audio -> Music -> State ->
               Input -> Spawn/Physics/Collision -> Draw -> Loop ->
               Parent bridge (postMessage)
   ============================================================================ */

/* ---------------------------------------------------------------------------
   1. CONFIG
   Resolusi internal (logical) 960x540 (lanskap 16:9). Ukuran fisik di layar
   di-scale lewat resizeCanvas() supaya tajam di semua DPI & responsif.
--------------------------------------------------------------------------- */
const CONFIG = {
  BASE_W: 960,
  BASE_H: 540,
  GROUND_H: 110,          // ketebalan visual jalan/tanah
  GROUND_Y: 540 - 110,    // garis permukaan tanah (y = 430)

  // --- FISIKA LOMPATAN -------------------------------------------------
  // gravity diterapkan setiap frame: vy += GRAVITY * dt (px/s^2).
  // Impuls lompatan sekali di awal: vy = JUMP_VELOCITY (px/s, negatif = atas).
  // Tinggi apex = JUMP_VELOCITY^2 / (2*GRAVITY) = 960^2/5800 ≈ 159 px,
  // lama di udara ≈ 2*960/2900 ≈ 0.66 s — cukup untuk menyeberangi selokan
  // terlebar (150 px) bahkan pada kecepatan minimum.
  GRAVITY: 2900,
  JUMP_VELOCITY: -960,
  MAX_FALL_SPEED: 1300,

  PLAYER_X: 130,          // posisi horizontal pemain (tetap, dunia yang bergeser)
  PLAYER_DRAW_W: 74,      // lebar gambar pemain di canvas (viewBox 40x63)
  PLAYER_DRAW_H: 116,

  SPEED_START: 350,       // px/s
  SPEED_MAX: 780,
  SPEED_ACCEL: 8.5,       // px/s per detik — makin lama makin cepat

  SCORE_DIVISOR: 24,      // jarak (px) per 1 poin

  ROCK_MIN_W: 48,
  ROCK_MAX_W: 70,
  DITCH_MIN_W: 84,
  DITCH_MAX_W: 150,
  DITCH_SINK_COMMIT: 6,   // tenggelam sedalam ini = komit jatuh ke lubang
  DITCH_KILL_DEPTH: 14,   // jatuh sedalam ini (kaki menyentuh air selokan) = mati

  CROW_EXTRA_SPEED: 140,  // gagak terbang lebih cepat dari tanah
  CROW_FLAP_MS: 150,      // durasi 1 frame kepakan sayap

  FIRST_SPAWN_DIST: 600,
  STORAGE_KEY: 'ayoKopdes_highScore',
  MAX_DT_MS: 34,          // clamp delta time (~30fps) agar fisika stabil

  // Nama pesan postMessage ke portal (js/pwa.js) saat game over.
  PARENT_MESSAGE_TYPE: 'arcade-score',
};

/* ---------------------------------------------------------------------------
   2. ASSETS — semua visual berupa string SVG murni yang dirender ke Image()
   lewat data URI base64. Tidak ada satu pun file gambar eksternal.
--------------------------------------------------------------------------- */

const INK = '#33322f';      // siluet pemain & gagak (charcoal seperti referensi)
const INK_SOFT = '#6b6b6b'; // sayap jauh gagak (biar terbaca kedalaman)

function svgToDataUri(svg) {
  const encoded = btoa(unescape(encodeURIComponent(svg)));
  return 'data:image/svg+xml;base64,' + encoded;
}

function loadSvgImage(svg) {
  const img = new Image();
  img.src = svgToDataUri(svg);
  return img;
}

// --- PLAYER: bapak-bapak bertopi membawa keranjang belanja (siluet),
// ditracing setia dari gambar referensi: kepala besar berprofil (dahi-hidung-
// dagu), topi brim pendek, badan gempal, kaki pendek tebal + sepatu gemuk.
// ViewBox 40x63 (rasio referensi), kaki menghadap kanan.
function buildPlayerSVG(frame) {
  // Siklus jalan 4-frame: kontak (langkah lebar) -> lewat (kaki menopang) ->
  // kontak terbalik -> lewat. Frame "lewat" diberi bob -0.8 biar badan
  // memantul sedikit — larian terasa hidup. Kaki: polyline tebal
  // (pinggul -> lutut -> pergelangan), sepatu: segmen gemuk.
  const poses = {
    run1: { // kontak: kaki depan merentang maju, kaki belakang mendorong (tumit naik)
      front: [[21, 44.5], [26, 52], [28.5, 58]],   shoeF: [[27, 59.4], [34, 59.4]],
      back:  [[17, 44.5], [13.5, 52], [10.5, 57]], shoeB: [[7.8, 57.4], [13, 60.6]],
      bob: 0,
    },
    run2: { // lewat: kaki depan menopang di bawah badan, kaki belakang terangkat
      front: [[21, 44.5], [22, 52], [22, 58.5]],   shoeF: [[20.8, 60], [27.5, 60]],
      back:  [[17, 44.5], [14.5, 51.5], [16.5, 55.5]], shoeB: [[15.3, 59.6], [19.3, 56.6]],
      bob: -0.8,
    },
    run3: { // kontak terbalik: kaki depan mendorong ke belakang, kaki belakang melangkah maju
      front: [[21, 44.5], [17, 52], [14, 57]],     shoeF: [[11.3, 57.4], [16.5, 60.6]],
      back:  [[17, 44.5], [22.5, 52], [25, 58]],   shoeB: [[23.5, 59.4], [30.5, 59.4]],
      bob: 0,
    },
    run4: { // lewat terbalik
      front: [[21, 44.5], [22.5, 52], [23, 58.5]], shoeF: [[21.8, 60], [28.5, 60]],
      back:  [[17, 44.5], [19.5, 51.5], [17.5, 55.5]], shoeB: [[16.3, 59.6], [12.8, 56.6]],
      bob: -0.8,
    },
    jump: { // melayang: dua lutut terangkat, sepatu menyempit
      front: [[21, 44], [26.5, 49], [26, 54]],     shoeF: [[24.5, 55.2], [31, 54.6]],
      back:  [[17, 44], [13.5, 49], [14.5, 54]],   shoeB: [[11.8, 55.4], [17, 55]],
      bob: 0,
    },
  };
  const L = poses[frame] || poses.run1;

  function limb(points, width) {
    const d = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
    return '<path d="' + d + '" fill="none" stroke="' + INK + '" stroke-width="' + width +
      '" stroke-linecap="round" stroke-linejoin="round"/>';
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 63">
    <g transform="translate(0,${L.bob})">
      ${limb(L.back, 3.4)}
      ${limb(L.shoeB, 2.6)}
      ${limb(L.front, 3.4)}
      ${limb(L.shoeF, 2.6)}

      <!-- torso gempal + profil kepala + topi brim pendek (satu siluet) -->
      <path d="M14,9.5
        C13.5,5.5 16,2.5 20,2.5 C24,2.5 26.5,5.5 26,8.5
        L30.5,9.5 L30.5,12 L25.5,11.5
        C25.5,12.5 25.5,13 25.8,13.4
        L27.6,15.2 L26,16.2 L26.4,17 L25.2,17.8 L25.4,19
        C24.6,20.2 23.4,20.8 22.6,21.2
        C25.8,22.6 27.8,25 28.6,28.5
        C29.4,32 29.2,36 28.4,39.5
        C27.8,42 26.6,43.6 25,44.4
        L16.5,44.4
        C14.6,42.6 13.2,39.6 12.6,35.6
        C12,31 12.2,25.6 13.2,21.6
        C13.8,19 14.4,16.4 14.2,13.6
        C13.8,12.2 13.8,10.8 14,9.5 Z" fill="${INK}"/>

      <!-- lengan memegang keranjang, tangan di puncak pegangan -->
      <path d="M22,21.5 C25.5,23.5 27.5,27 28,31 L27.5,35.5 L24.5,35 C24.4,31 23,27.5 20.5,25 Z" fill="${INK}"/>

      <!-- keranjang: barang di atas rim, badan, anyaman putih, pegangan -->
      <rect x="18.6" y="31" width="3.4" height="9.5" rx="0.8" fill="#f2efe4"/>
      <rect x="19.7" y="28.5" width="1.6" height="3" fill="#f2efe4"/>
      <ellipse cx="27.5" cy="36.5" rx="1.8" ry="4" transform="rotate(22 27.5 36.5)" fill="#f2efe4"/>
      <circle cx="15.5" cy="38.5" r="1.8" fill="#f2efe4"/>
      <circle cx="17.5" cy="37.5" r="1.4" fill="#f2efe4"/>
      <path d="M13,40 L35,40 L31,52 L17,52 Z" fill="${INK}"/>
      <path d="M16.8,41.5 L17.9,50.5 M20.3,41.5 L20.9,50.5 M23.8,41.5 L23.9,50.5 M27.3,41.5 L26.9,50.5 M30.8,41.5 L29.9,50.5" stroke="#f2efe4" stroke-width="0.9" fill="none"/>
      <path d="M14.2,43.6 L33.8,43.6 M15.2,46.8 L32.8,46.8 M16.2,50 L31.8,50" stroke="#f2efe4" stroke-width="0.9" fill="none"/>
      <path d="M16.5,40 L24,33.2 L31.5,40" fill="none" stroke="${INK}" stroke-width="1.1"/>
    </g>
  </svg>`;
}

// --- GAGAK: siluet burung terbang (menghadap kiri, menuju pemain).
// 2 frame: sayap terangkat & sayap merenduk — kepakan tidak kaku.
function buildCrowSVG(wing) {
  const wings = {
    up: `
      <path d="M62,48 C86,38 114,16 134,6 L130,16 C120,20 114,26 108,28 C114,34 106,38 100,40 C104,46 96,50 88,52 C80,56 70,56 66,54 Z" fill="${INK_SOFT}"/>
      <path d="M52,52 C36,42 26,22 28,2 L38,10 C42,20 52,28 62,34 C66,40 62,50 56,54 Z" fill="${INK}"/>`,
    down: `
      <path d="M62,56 C88,68 112,80 132,88 L126,76 C114,72 106,66 98,62 C102,58 94,54 86,52 C78,50 68,52 62,56 Z" fill="${INK_SOFT}"/>
      <path d="M52,54 C40,64 32,80 32,94 L40,90 C44,80 52,72 62,66 C66,60 62,52 56,50 Z" fill="${INK}"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 100">
    ${wings[wing] || wings.up}
    <!-- badan + ekor bercabang -->
    <path d="M14,54 C20,46 32,42 46,43 C60,44 74,50 86,58 L118,72 L106,74 L114,82 L98,77 L102,87 L88,75 C74,66 58,63 44,62 C32,61 20,60 14,54 Z" fill="${INK}"/>
    <!-- paruh sedikit terbuka + mata -->
    <path d="M16,50 L2,53 L15,56 Z" fill="${INK}"/>
    <path d="M16,57 L4,59 L16,61 Z" fill="${INK}"/>
    <circle cx="24" cy="50" r="1.8" fill="#e8e8e8"/>
    <!-- kaki menggantung -->
    <path d="M62,66 L58,82 M70,66 L72,82" stroke="${INK}" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M53,84 L58,81 L63,85 M67,84 L72,81 L77,85" stroke="${INK}" stroke-width="2" stroke-linecap="round" fill="none"/>
  </svg>`;
}

// --- BATU BESAR: rintangan daratan yang harus dilompati.
function buildRockSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 78">
    <path d="M6,74 L14,40 L34,16 L62,10 L84,28 L94,74 Z" fill="#7d7d78"/>
    <path d="M14,40 L34,16 L62,10 L56,32 L32,44 Z" fill="#94948e"/>
    <path d="M62,10 L84,28 L94,74 L66,74 L56,32 Z" fill="#66665f"/>
    <path d="M32,44 L40,60 M56,32 L52,52 M66,74 L72,58" stroke="#54544e" stroke-width="2" fill="none"/>
    <circle cx="12" cy="71" r="3" fill="#6b6b64"/>
    <circle cx="90" cy="70" r="2.5" fill="#6b6b64"/>
  </svg>`;
}

// --- LANGIT JAUH (parallax paling lambat): siluet bukit, rumah, pohon desa.
function buildSkylineSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 180">
    <g fill="#c9d6d2">
      <path d="M0,180 L0,128 Q90,66 190,128 L190,180 Z" opacity="0.7"/>
      <rect x="20" y="122" width="70" height="58"/>
      <path d="M14,122 L55,94 L96,122 Z"/>
      <circle cx="126" cy="148" r="22"/>
      <circle cx="152" cy="158" r="15"/>
      <rect x="180" y="112" width="90" height="68"/>
      <path d="M174,112 L225,80 L276,112 Z"/>
      <path d="M300,180 L300,124 a24,24 0 0 1 48,0 L348,180 Z"/>
      <rect x="318" y="92" width="6" height="16"/>
      <rect x="430" y="126" width="80" height="54"/>
      <path d="M424,126 L470,99 L516,126 Z"/>
      <circle cx="544" cy="164" r="14"/>
      <circle cx="566" cy="170" r="10"/>
      <rect x="592" y="102" width="26" height="18"/>
      <path d="M596,120 L594,180 M614,120 L616,180" stroke="#c9d6d2" stroke-width="4"/>
    </g>
  </svg>`;
}

// --- RUMAH TOKO (parallax sedang): deretan ruko dengan papan "KOPDES"
// merah-putih, tenda awning, bendera. MURNI latar — tidak pernah jadi rintangan.
function buildShopsSVG() {
  const awning = (x, w, y) => {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="24" fill="#8fa5a1"/>`;
    for (let i = 0; i < w; i += 28) {
      s += `<rect x="${x + i + 14}" y="${y}" width="14" height="24" fill="#f4f1e8"/>`;
    }
    return s;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 230">
    <!-- ruko 1: KOPDES merah putih -->
    <rect x="10" y="90" width="180" height="140" fill="#a3b8b4"/>
    <rect x="6" y="80" width="188" height="14" fill="#93a9a5"/>
    <rect x="20" y="100" width="160" height="30" fill="#c62828"/>
    <text x="100" y="122" text-anchor="middle" font-family="Arial, sans-serif" font-size="21" font-weight="bold" letter-spacing="3" fill="#ffffff">KOPDES</text>
    ${awning(16, 168, 134)}
    <rect x="30" y="176" width="66" height="54" fill="#8aa39f"/>
    <rect x="120" y="176" width="42" height="54" fill="#8aa39f"/>
    <path d="M30,198 h66 M120,198 h42" stroke="#a3b8b4" stroke-width="4"/>
    <path d="M196,88 L196,28" stroke="#93a9a5" stroke-width="4"/>
    <rect x="196" y="30" width="26" height="8" fill="#c62828"/>
    <rect x="196" y="38" width="26" height="8" fill="#f4f1e8"/>

    <!-- ruko 2: toko kelontong -->
    <rect x="230" y="70" width="160" height="160" fill="#a3b8b4"/>
    <rect x="226" y="60" width="168" height="14" fill="#93a9a5"/>
    <rect x="242" y="80" width="136" height="26" fill="#7d9691"/>
    <text x="310" y="99" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="bold" letter-spacing="4" fill="#f4f1e8">TOKO</text>
    ${awning(236, 148, 110)}
    <rect x="246" y="158" width="52" height="72" fill="#8aa39f"/>
    <rect x="322" y="158" width="52" height="72" fill="#8aa39f"/>
    <path d="M246,186 h52 M322,186 h52" stroke="#a3b8b4" stroke-width="4"/>

    <!-- pohon -->
    <rect x="416" y="150" width="10" height="80" fill="#7d9691"/>
    <circle cx="421" cy="128" r="27" fill="#8fa5a1"/>
    <circle cx="399" cy="144" r="18" fill="#8fa5a1"/>
    <circle cx="443" cy="144" r="18" fill="#8fa5a1"/>

    <!-- warung tenda -->
    <path d="M462,132 L618,132 L606,108 L474,108 Z" fill="#8fa5a1"/>
    <rect x="470" y="132" width="140" height="98" fill="#a3b8b4"/>
    <rect x="490" y="158" width="60" height="72" fill="#8aa39f"/>
    <rect x="564" y="176" width="30" height="22" fill="#8aa39f"/>
    <rect x="564" y="204" width="30" height="26" fill="#8aa39f"/>

    <!-- ruko 4: sembako -->
    <rect x="640" y="84" width="150" height="146" fill="#a3b8b4"/>
    <rect x="636" y="74" width="158" height="14" fill="#93a9a5"/>
    <rect x="652" y="94" width="126" height="26" fill="#7d9691"/>
    <text x="715" y="113" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="bold" letter-spacing="2" fill="#f4f1e8">SEMBAKO</text>
    ${awning(646, 138, 124)}
    <rect x="656" y="172" width="54" height="58" fill="#8aa39f"/>
    <rect x="726" y="172" width="48" height="58" fill="#8aa39f"/>
  </svg>`;
}

// --- JALAN TANAH (parallax penuh / kecepatan dunia), bisa di-tile mulus.
function buildGroundSVG() {
  let specks = '';
  for (let i = 0; i < 30; i++) {
    const x = (i * 53) % 640;
    const y = 18 + ((i * 37) % 80);
    specks += `<rect x="${x}" y="${y}" width="${3 + (i % 3)}" height="2.4" rx="1.2" fill="#a87f4e" opacity="0.8"/>`;
  }
  let stones = '';
  for (let i = 0; i < 8; i++) {
    const x = 30 + (i * 89) % 600;
    stones += `<ellipse cx="${x}" cy="${26 + (i * 29) % 66}" rx="4.5" ry="3" fill="#9a9a92"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 110">
    <rect x="0" y="0" width="640" height="110" fill="#c9a06b"/>
    <rect x="0" y="0" width="640" height="7" fill="#dcb27b"/>
    <rect x="0" y="7" width="640" height="3" fill="#b78d58"/>
    ${specks}
    ${stones}
  </svg>`;
}

// --- Awan (parallax paling lambat, di atas semuanya).
function buildCloudsSVG() {
  const cloud = (x, y, s) => `
    <g fill="#ffffff" opacity="0.92" transform="translate(${x},${y}) scale(${s})">
      <ellipse cx="0" cy="0" rx="34" ry="16"/>
      <ellipse cx="-24" cy="6" rx="20" ry="11"/>
      <ellipse cx="26" cy="6" rx="22" ry="12"/>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 140">
    ${cloud(100, 46, 1)}
    ${cloud(330, 82, 0.72)}
    ${cloud(530, 36, 0.86)}
  </svg>`;
}

const assets = {
  player: { run1: null, run2: null, run3: null, run4: null, jump: null },
  crow: { up: null, down: null },
  rock: null,
  skyline: null,
  shops: null,
  ground: null,
  clouds: null,
};

// Lebar tile tiap layer (harus = viewBox width SVG-nya, dipakai drawTiled).
const TILE_W = { skyline: 640, shops: 800, ground: 640, clouds: 640 };

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

  assets.player.run1 = loadSvgImage(buildPlayerSVG('run1'));
  assets.player.run2 = loadSvgImage(buildPlayerSVG('run2'));
  assets.player.run3 = loadSvgImage(buildPlayerSVG('run3'));
  assets.player.run4 = loadSvgImage(buildPlayerSVG('run4'));
  assets.player.jump = loadSvgImage(buildPlayerSVG('jump'));
  assets.crow.up = loadSvgImage(buildCrowSVG('up'));
  assets.crow.down = loadSvgImage(buildCrowSVG('down'));
  assets.rock = loadSvgImage(buildRockSVG());
  assets.skyline = loadSvgImage(buildSkylineSVG());
  assets.shops = loadSvgImage(buildShopsSVG());
  assets.ground = loadSvgImage(buildGroundSVG());
  assets.clouds = loadSvgImage(buildCloudsSVG());

  const all = [
    assets.player.run1, assets.player.run2, assets.player.run3, assets.player.run4,
    assets.player.jump, assets.crow.up, assets.crow.down, assets.rock,
    assets.skyline, assets.shops, assets.ground, assets.clouds,
  ];
  all.forEach((img) => {
    if (img.complete) {
      markReady();
    } else {
      img.onload = markReady;
      // Defensif: aset yang gagal decode tidak boleh menggantungkan game
      // di layar loading selamanya.
      img.onerror = markReady;
    }
  });
}

/* ---------------------------------------------------------------------------
   3. AUDIO — SFX lewat Web Audio API (oscillator), tanpa file audio.
   Di-mute otomatis saat tab/iframe disembunyikan + tombol toggle manual.
--------------------------------------------------------------------------- */
const SOUND_PREF_KEY = 'ayoKopdes_soundMuted';

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
    // Mode privat — preferensi cukup berlaku untuk sesi ini.
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

  // Nada tunggu dengan pitch yang bisa " menyapu" dari f0 ke f1 (glissando).
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

  // SFX lompat: "bloop" pendek yang nadanya meloncat naik.
  jump() {
    this.sweep(260, 620, 0.13, 'square', 0.12);
  },

  // SFX mati: benturan pendek lalu rangkaian nada menurun.
  die() {
    this.sweep(180, 40, 0.2, 'triangle', 0.22);
    const notes = [392, 311, 247, 175];
    notes.forEach((f, i) => {
      this.sweep(f, f * 0.92, 0.16, 'square', 0.12, 0.18 + i * 0.14);
    });
  },
};

/* ---------------------------------------------------------------------------
   3b. MUSIK LATAR — "partitur" 8-bit (nama not + durasi) yang dimainkan lewat
   oscillator, seperti semangat MIDI. Dua track: melodi lead (square) dan bass
   (triangle). Dijadwalkan presisi memakai jam AudioContext dengan pola
   lookahead scheduler, bukan setTimeout.
--------------------------------------------------------------------------- */
const NOTE_SEMITONE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

function noteToFrequency(note) {
  const match = /^([A-G]#?)(\d)$/.exec(note);
  if (!match) return 440;
  const [, name, octaveStr] = match;
  const semitoneFromA4 = (parseInt(octaveStr, 10) - 4) * 12 + (NOTE_SEMITONE[name] - NOTE_SEMITONE.A);
  return 440 * Math.pow(2, semitoneFromA4 / 12);
}

const MUSIC_BPM = 138;
const MUSIC_BEAT = 60 / MUSIC_BPM;
const MUSIC_EIGHTH = MUSIC_BEAT / 2;

// 4 bar x 8 ketukan eighth-note, nada '' = rest. Ceria, pentatonik-major.
const MELODY = [
  'E5', 'G5', 'A5', 'G5', 'E5', 'D5', 'C5', 'D5',
  'E5', 'E5', 'G5', 'E5', 'D5', 'C5', 'A4', 'C5',
  'E5', 'G5', 'A5', 'C6', 'A5', 'G5', 'E5', 'G5',
  'A5', 'G5', 'E5', 'D5', 'C5', 'D5', 'C5', '',
];

// Bass memukul tiap 2 ketukan (quarter note): C - Am - F - G.
const BASS = [
  'C3', '', 'G3', '', 'C3', '', 'G3', '',
  'A2', '', 'E3', '', 'A2', '', 'E3', '',
  'F2', '', 'C3', '', 'F2', '', 'C3', '',
  'G2', '', 'D3', '', 'G2', '', 'G2', '',
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
    // Resync kalau jam audio sudah melampaui jadwal (mis. habis resume tab).
    if (this.nextStepTime < ctx.currentTime - 0.1) {
      this.nextStepTime = ctx.currentTime + 0.05;
    }
    while (this.nextStepTime < ctx.currentTime + this.scheduleAheadTime) {
      const i = this.stepIndex % MELODY.length;
      const lead = MELODY[i];
      const bass = BASS[i];
      if (lead) this.scheduleNote(noteToFrequency(lead), this.nextStepTime, MUSIC_EIGHTH * 0.92, 'square', 0.045);
      if (bass) this.scheduleNote(noteToFrequency(bass), this.nextStepTime, MUSIC_EIGHTH * 1.7, 'triangle', 0.09);
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
  // y = posisi KAKI pemain dalam koordinat canvas (GROUND_Y saat di tanah).
  player: { y: CONFIG.GROUND_Y, vy: 0, grounded: true, inDitch: false, frame: 'run1', frameTimer: 0 },
  obstacles: [],   // {type:'rock'|'ditch'|'crow', x, ...}
  particles: [],   // debu di kaki pemain
  speed: CONFIG.SPEED_START,
  dist: 0,         // total jarak dunia (px) — sumber skor
  score: 0,
  highScore: 0,
  nextSpawnDist: CONFIG.FIRST_SPAWN_DIST,
  lastObstacle: '',
  crowFlapTimer: 0,
  crowWing: 'up',
  dustTimer: 0,
  bg: { clouds: 0, skyline: 0, shops: 0, ground: 0 },
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
    // Tidak fatal.
  }
}

/* ---------------------------------------------------------------------------
   5. CANVAS & RESPONSIVE SIZING
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
   6. INPUT — Spasi / Panah Atas / sentuh layar untuk lompat.
--------------------------------------------------------------------------- */
function primaryAction() {
  AudioFX.ensureCtx();
  if (state.mode === 'ready') {
    startPlaying();
    return;
  }
  if (state.mode === 'gameover') {
    // Guard 350 ms supaya restart tak terpicu tak sengaja saat spam tap mati.
    if (performance.now() - state.gameOverAt > 350) startPlaying();
    return;
  }
  if (state.mode !== 'playing') return;
  jump();
}

function jump() {
  // Hanya boleh melompat saat kaki menapak (tidak ada double jump).
  if (!state.player.grounded) return;
  state.player.vy = CONFIG.JUMP_VELOCITY;
  state.player.grounded = false;
  AudioFX.jump();
  spawnDust(5);
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  primaryAction();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!e.repeat) primaryAction();
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
  state.player.y = CONFIG.GROUND_Y;
  state.player.vy = 0;
  state.player.grounded = true;
  state.player.inDitch = false;
  state.player.frame = 'run1';
  state.player.frameTimer = 0;
  state.obstacles = [];
  state.particles = [];
  state.speed = CONFIG.SPEED_START;
  state.dist = 0;
  state.score = 0;
  state.nextSpawnDist = CONFIG.FIRST_SPAWN_DIST;
  state.lastObstacle = '';
  state.dustTimer = 0;
  scoreEl.textContent = padScore(0);
}

function goToStartScreen() {
  resetGame();
  state.mode = 'ready';
  startBestEl.textContent = 'Skor terbaik: ' + state.highScore;
  showScreen('start');
}

function startPlaying() {
  resetGame();
  state.mode = 'playing';
  showScreen(null);
  MusicFX.start();
}

// Lapor skor ke portal (js/pwa.js) bila game dijalankan di dalam iframe.
function reportScoreToParent(score) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage({ type: CONFIG.PARENT_MESSAGE_TYPE, score }, '*');
  } catch {
    // Cross-origin — skor tetap tersimpan lokal.
  }
}

function gameOver() {
  if (state.mode !== 'playing') return;
  state.mode = 'gameover';
  state.gameOverAt = performance.now();
  MusicFX.stop();
  AudioFX.die();

  const isNewRecord = state.score > state.highScore;
  if (isNewRecord) {
    state.highScore = state.score;
    saveHighScore(state.highScore);
  }

  finalScoreEl.textContent = String(state.score);
  finalHighEl.textContent = String(state.highScore);
  highEl.textContent = 'HI ' + padScore(state.highScore);
  newRecordEl.hidden = !isNewRecord;
  showScreen('gameover');
  reportScoreToParent(state.score);
}

retryBtn.addEventListener('click', () => {
  AudioFX.ensureCtx();
  startPlaying();
});

/* ---------------------------------------------------------------------------
   8. SPAWN, PHYSICS & COLLISION
--------------------------------------------------------------------------- */

// Pilih tipe rintangan berikutnya. Gagak baru muncul setelah skor 60
// (seperti dino asli yang memperkenalkan burung belakangan).
function pickObstacleType() {
  const r = Math.random();
  if (state.score >= 60) {
    if (r < 0.36) return 'rock';
    if (r < 0.62) return 'ditch';
    return 'crow';
  }
  return r < 0.55 ? 'rock' : 'ditch';
}

function spawnObstacle() {
  const type = pickObstacleType();
  const o = { type, x: CONFIG.BASE_W + 60 };

  if (type === 'rock') {
    o.w = CONFIG.ROCK_MIN_W + Math.random() * (CONFIG.ROCK_MAX_W - CONFIG.ROCK_MIN_W);
    o.h = o.w * 0.78;
  } else if (type === 'ditch') {
    o.w = CONFIG.DITCH_MIN_W + Math.random() * (CONFIG.DITCH_MAX_W - CONFIG.DITCH_MIN_W);
  } else {
    // Dua ketinggian: LOW (harus dilompati) & HIGH (cukup berlari di bawahnya).
    o.low = Math.random() < 0.5;
    // Hitbox badan gagak: y+11 .. y+33 dari gambar kecil 56x40 px.
    o.y = o.low ? CONFIG.GROUND_Y - 77 : CONFIG.GROUND_Y - 165;
    o.bobPhase = Math.random() * Math.PI * 2;
  }

  state.obstacles.push(o);
  state.lastObstacle = type;

  // Jarak antar rintangan menskalakan dengan kecepatan supaya waktu reaksi
  // tetap adil saat game makin cepat. Selokan berikutnya diberi jarak ekstra.
  let gap = state.speed * (0.9 + Math.random() * 0.75);
  if (type === 'ditch') gap *= 1.25;
  state.nextSpawnDist = state.dist + gap;
}

// AABB (axis-aligned bounding box): dua kotak bersinggungan bila
// overlap pada sumbu X DAN sumbu Y secara bersamaan.
function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function playerHitbox(feetY) {
  // Torso+kepala+kaki di unit viewBox 12..34 dari lebar 40 (scale 1.84 px/unit)
  // → px 22..63 dari sisi kiri gambar; sedikit longgar agar adil.
  return { x: CONFIG.PLAYER_X + 20, y: feetY - 108, w: 42, h: 104 };
}

// Selokan = lubang di tanah. Pemain hanya "ditopang tanah" bila titik
// tengah kakinya TIDAK berada di atas lubang.
function playerSupported() {
  const centerX = CONFIG.PLAYER_X + 41;
  for (const o of state.obstacles) {
    if (o.type !== 'ditch') continue;
    if (centerX > o.x + 4 && centerX < o.x + o.w - 4) return false;
  }
  return true;
}

function spawnDust(n) {
  for (let i = 0; i < n; i++) {
    state.particles.push({
      x: CONFIG.PLAYER_X + 30 + Math.random() * 20,
      y: CONFIG.GROUND_Y - 2,
      vx: -(40 + Math.random() * 70),
      vy: -(20 + Math.random() * 50),
      life: 0.4 + Math.random() * 0.2,
      r: 2 + Math.random() * 2.5,
    });
  }
}

function update(dtMs) {
  const dt = dtMs / 1000;
  const p = state.player;

  // --- Kecepatan dunia meningkat perlahan ---------------------------------
  state.speed = Math.min(CONFIG.SPEED_MAX, state.speed + CONFIG.SPEED_ACCEL * dt);
  const worldDx = state.speed * dt;
  state.dist += worldDx;

  // --- GRAVITY ------------------------------------------------------------
  // vy diintegrasikan dulu (semi-implicit Euler: vy += g*dt lalu y += vy*dt)
  // — stabil untuk game kecepatan tinggi dan clamp di kecepatan jatuh maks.
  p.vy = Math.min(p.vy + CONFIG.GRAVITY * dt, CONFIG.MAX_FALL_SPEED);
  p.y += p.vy * dt;

  const wasAirborne = !p.grounded;

  if (p.vy >= 0 && p.y >= CONFIG.GROUND_Y) {
    // p.inDitch = pemain sudah terlanjur jatuh ke lubang dan TIDAK bisa
    // menapak kembali, meski pusat badannya keluar zona selokan. Tanpa
    // komitmen ini pemain sempat melewati tepi seberang sebelum cukup
    // dalam, lalu "memanjat" kembali ke atas tanah — bug tidak game over.
    if (!p.inDitch && playerSupported()) {
      // Tanah solid: mendarat / tetap menapak.
      p.y = CONFIG.GROUND_Y;
      p.vy = 0;
      p.grounded = true;
      if (wasAirborne && state.mode === 'playing') spawnDust(4);
    } else {
      // Di atas selokan: tidak ada penopang → jatuh ke dalam lubang.
      if (!p.inDitch && p.y > CONFIG.GROUND_Y + CONFIG.DITCH_SINK_COMMIT) {
        p.inDitch = true;
      }
      p.grounded = false;
      if (p.y > CONFIG.GROUND_Y + CONFIG.DITCH_KILL_DEPTH) {
        gameOver();
        return;
      }
    }
  } else if (p.y < CONFIG.GROUND_Y) {
    p.grounded = false;
  }

  // --- Animasi lari (frame berganti makin cepat saat makin cepat) ---------
  if (p.grounded) {
    const frameMs = Math.max(70, 150 - state.speed * 0.07);
    p.frameTimer += dtMs;
    if (p.frameTimer >= frameMs) {
      p.frameTimer = 0;
      p.frame = p.frame === 'run1' ? 'run2' : p.frame === 'run2' ? 'run3'
        : p.frame === 'run3' ? 'run4' : 'run1';
    }
    state.dustTimer += dtMs;
    if (state.dustTimer > 90) {
      state.dustTimer = 0;
      spawnDust(1);
    }
  }

  // --- Spawner berbasis jarak ---------------------------------------------
  if (state.dist >= state.nextSpawnDist) spawnObstacle();

  // --- Gerak rintangan (dunia bergeser ke kiri) ---------------------------
  state.crowFlapTimer += dtMs;
  if (state.crowFlapTimer >= CONFIG.CROW_FLAP_MS) {
    state.crowFlapTimer = 0;
    state.crowWing = state.crowWing === 'up' ? 'down' : 'up';
  }

  for (let i = state.obstacles.length - 1; i >= 0; i--) {
    const o = state.obstacles[i];
    o.x -= worldDx;
    if (o.type === 'crow') o.x -= CONFIG.CROW_EXTRA_SPEED * dt;
    if (o.x + 200 < 0) {
      state.obstacles.splice(i, 1);
      continue;
    }

    // --- COLLISION --------------------------------------------------------
    const pb = playerHitbox(p.y);
    if (o.type === 'rock') {
      if (aabb(pb.x, pb.y, pb.w, pb.h, o.x + 5, CONFIG.GROUND_Y - o.h + 6, o.w - 10, o.h - 6)) {
        gameOver();
        return;
      }
    } else if (o.type === 'crow') {
      // Bob naik-turun mengikuti kepakan; hitbox mengikuti bob yang sama.
      o.bobPhase += dt * 6;
      const bob = Math.sin(o.bobPhase) * 4;
      if (aabb(pb.x, pb.y, pb.w, pb.h, o.x + 6, o.y + bob + 11, 40, 22)) {
        gameOver();
        return;
      }
    }
    // 'ditch' tidak memakai AABB — ditangani lewat logika penopang tanah.
  }

  // --- Skor berbasis jarak ------------------------------------------------
  const newScore = Math.floor(state.dist / CONFIG.SCORE_DIVISOR);
  if (newScore !== state.score) {
    state.score = newScore;
    scoreEl.textContent = padScore(state.score);
  }

  // --- PARTIKEL DEBU ------------------------------------------------------
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const d = state.particles[i];
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vy += 300 * dt;
    d.life -= dt;
    if (d.life <= 0) state.particles.splice(i, 1);
  }

  // --- PARALLAX -----------------------------------------------------------
  // Tiap layer bergeser dengan pecahan kecepatan dunia yang berbeda:
  // makin jauh objeknya, makin lambat — itulah ilusi kedalaman.
  state.bg.clouds = (state.bg.clouds + worldDx * 0.04) % TILE_W.clouds;
  state.bg.skyline = (state.bg.skyline + worldDx * 0.08) % TILE_W.skyline;
  state.bg.shops = (state.bg.shops + worldDx * 0.22) % TILE_W.shops;
  state.bg.ground = (state.bg.ground + worldDx) % TILE_W.ground;
}

/* ---------------------------------------------------------------------------
   9. DRAW
--------------------------------------------------------------------------- */

// Menggambar image yang bisa di-tile secara horizontal dengan offset.
function drawTiled(img, offset, y, w, h, tileW) {
  let x = -offset;
  while (x < CONFIG.BASE_W) {
    ctx.drawImage(img, x, y, w, h);
    x += tileW;
  }
}

function drawSky() {
  const sky = ctx.createLinearGradient(0, 0, 0, CONFIG.GROUND_Y);
  sky.addColorStop(0, '#aee3f5');
  sky.addColorStop(0.75, '#d9f0f2');
  sky.addColorStop(1, '#fdeecb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CONFIG.BASE_W, CONFIG.GROUND_Y);

  // Matahari pagi (statis).
  ctx.fillStyle = 'rgba(255, 224, 138, 0.55)';
  ctx.beginPath();
  ctx.arc(810, 86, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe08a';
  ctx.beginPath();
  ctx.arc(810, 86, 34, 0, Math.PI * 2);
  ctx.fill();
}

function drawDitch(o, waterOnly) {
  const top = CONFIG.GROUND_Y;
  if (!waterOnly) {
    // Lubang: tanah gelap sampai dasar canvas.
    ctx.fillStyle = '#3d2f23';
    ctx.fillRect(o.x, top, o.w, CONFIG.BASE_H - top);
    // Bibir selokan.
    ctx.fillStyle = '#2c211a';
    ctx.fillRect(o.x, top, 5, CONFIG.BASE_H - top);
    ctx.fillRect(o.x + o.w - 5, top, 5, CONFIG.BASE_H - top);
  }
  // Air hampir setinggi bibir selokan: pemain yang jatuh mati terlihat
  // kakinya menyentuh air (DITCH_KILL_DEPTH 14 > 12).
  const waterY = top + 12;
  ctx.fillStyle = '#4a7d96';
  ctx.fillRect(o.x + 3, waterY, o.w - 6, CONFIG.BASE_H - waterY);
  ctx.fillStyle = '#79b3cc';
  ctx.fillRect(o.x + 3, waterY, o.w - 6, 4);
}

function drawObstacle(o) {
  if (o.type === 'rock') {
    // SVG viewBox 100x78, basis visual di y=74 → 4/78 padding di bawah.
    // Gambar sedikit lebih rendah agar basis batu menempel ke GROUND_Y.
    const rockDrawY = CONFIG.GROUND_Y - o.h + o.h * (4 / 78);
    ctx.drawImage(assets.rock, o.x, rockDrawY, o.w, o.h);
  } else if (o.type === 'crow') {
    const bob = Math.sin(o.bobPhase || 0) * 4;
    ctx.drawImage(assets.crow[state.crowWing], o.x, o.y + bob, 56, 40);
  }
  // ditch digambar terpisah lewat drawDitch().
}

function drawPlayer() {
  const p = state.player;
  const frame = p.grounded ? p.frame : 'jump';
  ctx.drawImage(
    assets.player[frame],
    CONFIG.PLAYER_X,
    p.y - CONFIG.PLAYER_DRAW_H,
    CONFIG.PLAYER_DRAW_W,
    CONFIG.PLAYER_DRAW_H
  );
}

function draw() {
  drawSky();
  drawTiled(assets.clouds, state.bg.clouds, 30, 640, 140, TILE_W.clouds);
  drawTiled(assets.skyline, state.bg.skyline, CONFIG.GROUND_Y - 180, 640, 180, TILE_W.skyline);
  drawTiled(assets.shops, state.bg.shops, CONFIG.GROUND_Y - 230, 800, 230, TILE_W.shops);
  drawTiled(assets.ground, state.bg.ground, CONFIG.GROUND_Y, 640, CONFIG.GROUND_H, TILE_W.ground);

  // Lubang selokan (di atas tekstur tanah supaya terlihat menembus).
  for (const o of state.obstacles) {
    if (o.type === 'ditch') drawDitch(o, false);
  }

  for (const o of state.obstacles) drawObstacle(o);

  // Debu.
  ctx.fillStyle = 'rgba(160, 130, 95, 0.55)';
  for (const d of state.particles) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPlayer();

  // Permukaan air digambar terakhir: pemain yang jatuh ke selokan
  // terlihat tenggelam di balik air.
  for (const o of state.obstacles) {
    if (o.type === 'ditch') drawDitch(o, true);
  }
}

/* ---------------------------------------------------------------------------
   10. GAME LOOP + VISIBILITY-BASED PAUSE
   Di 'ready' dunia tidak bergerak kecuali awan — pemain berdiri di warung
   menunggu pemain menekan tombol.
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
    } else if (state.mode === 'ready') {
      state.bg.clouds = (state.bg.clouds + 8 * (dtMs / 1000)) % TILE_W.clouds;
    }
    draw();
    MusicFX.tick();
  } catch (err) {
    console.error('[AyoKopdes] Error saat update/draw:', err);
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
  highEl.textContent = 'HI ' + padScore(state.highScore);
  AudioFX.userMuted = loadSoundPreference();
  updateSoundToggleUI(AudioFX.userMuted);

  preloadAssets(() => {
    goToStartScreen();
    startLoop();
  });
}

init();
