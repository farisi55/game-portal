---
doc_id: PRD-GIMBOOT-001
version: 1.4.0
status: ready
created: 2026-08-28
flow_compatibility: vibe-coding-v1.7
project_shape: fullstack
---

# Gimboot (Game Portal) — Product Requirements Document

*Catatan: dokumen ini mendokumentasikan Gimboot yang sudah berjalan/dalam pengembangan aktif — bukan proyek baru dari nol. Detail struktur teknis mengacu pada kondisi repository saat ini (lihat §4.2). Versi 1.3.0 mengintegrasikan hasil audit langsung terhadap source code (`game-portal-main.zip`, 2026-08-28). Versi ini (1.4.0) mengintegrasikan jawaban developer atas keenam [DECISION NEEDED] di §10 Open Questions v1.3.0 (dijawab 2026-08-30) — lihat perubahan bertanda "[DIJAWAB 2026-08-30]" di seluruh dokumen.*

## 1. Executive Summary
- **Project Shape:** Fullstack (varian edge/serverless — tidak ada server persisten). [AUDIT KODE — KOREKSI] Backend BUKAN Cloudflare Pages Functions — dikonfirmasi via `wrangler.toml`, backend aktual adalah satu Cloudflare Worker (`src/index.js`) dengan static assets, di-deploy dengan `wrangler deploy`. Lihat §4.1/§4.2.
- **Problem:** Gamer kasual mobile kesulitan menemukan portal mini-game yang ringan, cepat diakses via browser, teroptimasi untuk pencarian Google, dan punya mekanisme berbagi skor yang bisa viral ke media sosial.
- **Solution:** Gimboot menyajikan katalog game HTML5 dalam bentuk PWA, teroptimasi SEO lewat clean URL & meta tag dinamis, dilengkapi modul viral sharing terpusat (`ui-share.js`). Katalog live BUKAN murni "mini-game bertema lokal buatan sendiri" — pembacaan kode `src/index.js` mengonfirmasi katalog adalah gabungan dari game first-party DAN feed live dari GameMonetize + GamePix (digabung & di-cache 30 menit di edge), sejalan dengan tagline `manifest.json` sendiri ("Hundreds of free browser games"). [DIJAWAB 2026-08-30] Keempat game first-party (Ayo Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania) dikonfirmasi developer masih aktif — lihat §10.
- **Success metric:** Dikonfirmasi developer — kombinasi install PWA + share action (Web Share API). Baseline angka diusulkan: ≥1.000 install/bulan & ≥300 share dalam 3 bulan pertama [ASSUMED — angka spesifik belum dikonfirmasi, bisa disesuaikan].
- **MVP deadline:** Tidak disebutkan secara formal. [DIJAWAB 2026-08-30] Keempat game first-party (Ayo Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania) dikonfirmasi developer masih aktif — MVP untuk sisi katalog first-party sudah tercapai. Catatan implementasi: `src/index.js` (server) saat ini baru mengenali Kicau Mania di `LOCAL_GAMES`-nya, sedangkan `js/config.js` (client) sudah mencakup keempatnya — `src/index.js` perlu disinkronkan agar link share, halaman `/play/`, dan `sitemap.xml` juga berfungsi untuk Ayo Kopdes/Kejar Koruptor/Mobil MBG (lihat changelog Task #002). Katalog yang tampil ke pengguna sudah jauh lebih besar dari 4 judul berkat agregasi GameMonetize/GamePix. Sisa pekerjaan diprioritaskan pada hardening: audit clean-code (Phase 1, wajib selesai lebih dulu — dikonfirmasi developer), testing, dan observability, sebelum fitur baru dilanjutkan.

## 2. Users & Context
- **Primary users:** Gamer kasual (khususnya pengguna mobile) yang mencari hiburan cepat via browser, serta pengguna media sosial yang menyukai tantangan skor tinggi dari teman.
- **User goal:** Bermain mini-game tanpa instalasi app store dan tanpa akun, lalu memamerkan/membagikan skor tertinggi ke jejaring sosial.
- **Current pain:** Game HTML5 kasual pada umumnya lambat dimuat, minim optimasi SEO (banyak berbasis SPA/hash-routing sehingga sulit diindeks Google), dan jarang punya mekanisme viral sharing skor yang menarik secara visual.
- **Environment:** Peramban web (mobile & desktop); dapat diinstal sebagai PWA ke home screen.
- **External API consumers:** Tidak ada — seluruh endpoint Gimboot (dilayani `src/index.js`, [AUDIT KODE] bukan `functions/api/`/`functions/share/` yang non-aktif — lihat §4.2) hanya dikonsumsi oleh frontend Gimboot sendiri (dikonfirmasi di brief). [AUDIT KODE — arah sebaliknya, belum tercatat sebelumnya] Gimboot sendiri berperan sebagai CONSUMER dari dua API pihak ketiga (feed katalog GameMonetize & GamePix) — lihat §4.1.

## 3. Scope

### 3.1 In-Scope Features
| Feature | Priority | Description |
|---|---|---|
| Katalog Game (first-party + agregasi) | P0 — MVP | [AUDIT KODE] Menyajikan game first-party (Ayo Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania — status roster perlu konfirmasi, lihat §10) DIGABUNG dengan katalog live dari feed GameMonetize + GamePix |
| Clean URL & Dynamic SEO | P0 — MVP | Routing game via URL bersih (`/play/:id/:slug`, [AUDIT KODE] bukan lagi pola `/main/{slug}` di draf sebelumnya); injeksi meta tag & canonical link dinamis, ditambah sitemap dinamis (`/sitemap.xml`) |
| Viral Sharing & High Score System | P0 — MVP | Modul `ui-share.js`: animasi confetti saat rekor pecah + Web Share API dengan copywriting dinamis |
| PWA (Progressive Web App) | P0 — MVP | Instalasi ke home screen + offline caching via `manifest.json` & `sw.js` |
| Serverless API Backend | P0 — MVP | [AUDIT KODE] Endpoint edge untuk katalog & pencarian game, serta generator meta-sharing/play dinamis — seluruhnya dilayani satu Cloudflare Worker (`src/index.js`), BUKAN `functions/api/`/`functions/share/` (dikonfirmasi non-aktif pada model deploy saat ini) |

Catatan prioritas: [AUDIT KODE — KOREKSI] premis "katalog baru berisi 4 judul" pada draf sebelumnya sudah tidak akurat — katalog live saat ini mencakup hingga ~200 judul gabungan (first-party + GameMonetize + GamePix), sehingga fitur pencarian (`search.js`/`handleApiSearch`) justru lebih relevan dipertahankan di P0, bukan kandidat penurunan ke P1.

### 3.2 Out of Scope (explicit)
- Fitur multiplayer online real-time.
- Penyimpanan cloud untuk progres profil pengguna atau sistem login/otentikasi.
- Pembuatan aset atau rendering 3D kompleks (hanya 2D dan pseudo-3D).

### 3.3 Future Considerations
*(usulan — belum divalidasi developer, kecuali item audit clean-code yang diminta langsung oleh developer)*
- Leaderboard global read-only berbasis snapshot statis ter-generate berkala via edge function, tanpa perlu akun/login.
- Penambahan game bertema lokal baru di luar 4 judul saat ini.
- Dark mode / theming portal.

## 4. Technical Specification

### 4.1 Tech Stack
- **Language & Runtime:** Vanilla JavaScript (ES2022+), HTML5 Canvas API (untuk game first-party), CSS3; runtime edge Cloudflare Workers.
- **Framework:** Tanpa framework reaktif untuk game (Vanilla JS murni); Tailwind CSS (via CDN) untuk styling shell portal (dikonfirmasi via `js/tailwind-config.js`).
- **Database:** none — skor & state pemain disimpan lokal via `localStorage`. [AUDIT KODE] BUKAN satu wrapper tunggal via `js/state.js` — `state.js` hanya menangani favorit & recently-played; skor per-game disimpan mandiri oleh tiap `games/{slug}/game.js`, dan ada pula skor global lintas game di `js/pwa.js`. Detail lengkap di §4.2.
- **ORM / Query builder:** omit (tidak ada database).
- **Cache:** Tidak ada layer cache terpisah (mis. Redis); caching terjadi implisit lewat Cloudflare CDN edge cache untuk aset statis + Service Worker (`sw.js`) untuk offline asset caching. [AUDIT KODE] Tambahan: `src/index.js` juga mengimplementasikan cache edge 30 menit (Cache API) khusus untuk hasil gabungan feed GameMonetize/GamePix.
- **Infrastructure:** [AUDIT KODE — KOREKSI] BUKAN "Cloudflare Pages + Cloudflare Pages Functions". Dikonfirmasi via `wrangler.toml`: satu Cloudflare Worker dengan static assets (`main = "./src/index.js"`, `[assets]`, `run_worker_first = ["/*"]`), di-deploy dengan `npx wrangler deploy` — file `wrangler.toml` itu sendiri secara eksplisit menyatakan `wrangler pages deploy` tidak berlaku untuk konfigurasi ini.
- **Container orchestration:** none (edge/serverless, bukan berbasis container).
- **Key third-party services:** GameMonetize/GamePix — [AUDIT KODE] perannya ganda, sebelumnya hanya tercatat sebagian: (1) jaringan iklan, diverifikasi via `ads.txt`; DAN (2) sumber katalog game LIVE yang di-fetch server-side oleh `src/index.js` (GameMonetize via `feed.php`, GamePix via `feeds.gamepix.com/v2/json`), digabung dengan game first-party, lalu di-cache di edge. Peran (2) sebelumnya tidak tercatat di PRD versi manapun.
- **Webhook providers:** none — `ads.txt` adalah file verifikasi statis, bukan penerima webhook.
- **Frontend framework (if applicable):** none (Vanilla JS + utility class Tailwind; tanpa React/Vue/Svelte).

### 4.2 Architecture
- **Pattern:** Serverless/edge, static-first — seluruh logika game berjalan di klien (Canvas); backend edge hanya untuk SEO meta-injection dan query katalog ringan.
- **Module structure** *(direkonstruksi dari struktur repo existing, diperbarui dengan konfirmasi developer)*:

```
game-portal/
├── css/
│   └── style.css                 # style global shell portal
├── functions/                    # [DIJAWAB 2026-08-30] Konvensi Cloudflare Pages Functions, TIDAK aktif pada model deploy Worker-with-assets saat ini — developer memutuskan folder ini DIHAPUS (clean code); lihat changelog Task #002 untuk status eksekusi.
│   ├── api/
│   │   ├── games.js              # akan dihapus — logika yang jalan ada di src/index.js (handleApiGames)
│   │   └── search.js             # akan dihapus — logika yang jalan ada di src/index.js (handleApiSearch)
│   └── share/
│       └── [id].js               # akan dihapus — logika yang jalan ada di src/index.js (handleShareRoute)
├── games/
│   ├── ayo-kopdes/
│   │   ├── game.js
│   │   ├── index.html
│   │   ├── style.css
│   │   └── thumb.svg
│   ├── kejar-koruptor/           # [DIJAWAB 2026-08-30] dikonfirmasi masih aktif
│   ├── kicau-mania/              # aktif; satu-satunya yang sudah dikenali src/index.js saat ini
│   ├── mobil-mbg/                # [DIJAWAB 2026-08-30] dikonfirmasi masih aktif
│   └── shared/
│       ├── ui-share.css
│       └── ui-share.js           # modul share/confetti (TIDAK menyimpan skor — lihat catatan state.js di bawah)
├── js/
│   ├── catalog.js                # render & manajemen katalog game
│   ├── config.js                 # konfigurasi/konstanta aplikasi, termasuk LOCAL_GAMES sisi klien (4 game, sudah benar — lihat §10)
│   ├── player.js                 # [AUDIT KODE] controller halaman player lengkap: resolve game, favorit, recently-played, fullscreen, native share/clipboard, related-games, lazy iframe load — BUKAN sekadar "loader game & kontrol audio"; tidak ada logika audio di file ini
│   ├── pwa.js                    # [AUDIT KODE] registrasi service worker + tracker skor tertinggi GLOBAL lintas game via window.postMessage (termasuk dari game GamePix ter-embed) — TIDAK ada kode install-prompt (beforeinstallprompt dsb.) di file ini maupun di seluruh repo
│   ├── state.js                  # [AUDIT KODE] wrapper localStorage untuk FAVORIT & RECENTLY-PLAYED saja — TIDAK berisi logika skor sama sekali
│   ├── tailwind-config.js        # konfigurasi Tailwind tanpa build step penuh
│   └── utils.js                  # escapeHtml, debounce, slugify, buildPlayUrl, buildGamePageUrl, isAllowedEmbedUrl, readSessionGames/writeSessionGames, fetchGameCatalog
├── src/
│   └── index.js                  # satu-satunya Worker entry point yang aktif. Menangani static-asset fallback, /api/games, /api/search, /share/:id, /play/:id/:slug, /game (redirect), /sitemap.xml, plus security headers (CSP nonce-based) untuk semua response. [DIJAWAB 2026-08-30 — TINDAK LANJUT] `LOCAL_GAMES` di file ini baru berisi Kicau Mania — perlu ditambah Ayo Kopdes/Kejar Koruptor/Mobil MBG menyusul keputusan roster (lihat changelog Task #002).
├── _headers                      # fallback saja — src/index.js menegakkan CSP nonce-based-nya sendiri di level Worker untuk semua response
├── .assetsignore
├── .avicon.svg                   # [DIJAWAB 2026-08-30] developer memutuskan `favicon.svg` yang dipakai sebagai favicon resmi — file ini jadi kandidat dihapus, lihat changelog Task #002
├── .gitignore                    # [AUDIT KODE] saat ini hanya mengecualikan folder tool AI, BELUM ada pola .env/*.pem/*.key/*.p12/secrets/
├── ads.txt                       # verifikasi GameMonetize/GamePix
├── favicon.svg                   # [DIJAWAB 2026-08-30] dikonfirmasi developer sebagai favicon resmi. Catatan: isi filenya saat ini (742 KB, hasil trace/vektorisasi kompleks) tidak cocok dengan deskripsi ikon pixel-art di README, dan belum direferensikan di `index.html`/`game.html`/`manifest.json` — perlu diverifikasi & dipasang (lihat changelog Task #002).
├── game.html                     # shell lama; kini 301-redirect ke /game oleh src/index.js
├── icon-192.png / icon-512.png   # ikon PWA aktif — direferensikan index.html, game.html, manifest.json, sw.js, src/index.js
├── index.html                    # landing page / katalog utama
├── manifest.json                 # PWA manifest — [AUDIT KODE] screenshot "wide"/"narrow" yang dirujuk (screenshot-desktop.png/screenshot-mobile.png) ternyata file identik, lihat di bawah
├── README.md                     # [AUDIT KODE] dokumentasi developer-facing yang cukup mutakhir; salah satu sumber utama audit ini
├── robots.txt                    # mengarah ke /sitemap.xml — mengonfirmasi route sitemap dinamis memang disengaja
├── screenshot-desktop.png / screenshot-mobile.png  # [AUDIT KODE — BARU DITEMUKAN] checksum identik, sama-sama 1254×1254px persegi — bukan dua screenshot desktop/mobile yang berbeda
├── sw.js                         # service worker (offline caching)
└── wrangler.toml                 # [AUDIT KODE] konfigurasi Cloudflare Worker + static assets — BUKAN Cloudflare Pages/Functions
```

- **Key design patterns:** Module pattern per file JS (tanpa bundler wajib); Adapter pattern pada `state.js` sebagai wrapper `localStorage` ([AUDIT KODE] cakupannya favorit & recently-played, bukan skor); isolasi ala-Strategy per game (tiap game mandiri dalam foldernya sendiri, termasuk skor & preferensi suaranya sendiri).
- **Data flow:** [AUDIT KODE — diperbarui] Browser → `index.html` (`js/catalog.js` memanggil `/api/games` ke `src/index.js`, yang menggabungkan game first-party + hasil fetch GameMonetize & GamePix) → pilih game → `/play/{id}/{slug}` (canonical, SEO meta di-inject `src/index.js`) → `js/player.js` resolve data game → iframe dimuat setelah "Play Now" ditekan → untuk game first-party: skor ditulis ke `localStorage` per-game (`games/{slug}/game.js`, BUKAN `js/state.js`) dan opsional ke tracker global (`js/pwa.js`) → saat rekor pecah, `ui-share.js` memicu confetti + Web Share API → tautan share (opsional) memanggil `/share/{id}` di `src/index.js` (BUKAN `functions/share/[id].js` yang non-aktif) untuk generate OG meta dinamis.
- **Key architectural decisions:**
  1. Vanilla JS + HTML5 Canvas dibanding game engine (Phaser/PixiJS) untuk game first-party — menjaga ukuran bundel sekecil mungkin demi kecepatan muat di mobile (hard constraint eksplisit).
  2. `localStorage` dibanding database terpusat untuk skor & state pemain — menghilangkan kebutuhan backend stateful/auth untuk data pemain, meski katalog sendiri kini bergantung pada dua feed eksternal (lihat poin 6).
  3. [AUDIT KODE — KOREKSI] Cloudflare Worker dengan static assets (`wrangler deploy`) dibanding Cloudflare Pages tradisional atau server Node/Express — deploy global instan, auto-scaling bawaan, satu titik kontrol untuk security headers di semua response, cocok untuk pengelolaan solo developer.
  4. Meta tag dinamis via Worker (`src/index.js`, [AUDIT KODE] bukan `functions/share/[id].js` yang non-aktif) dibanding halaman HTML statis terpisah per game — menghindari duplikasi N halaman sambil tetap mendapat OG tag/canonical link presisi per game/rute untuk keperluan SEO & viral sharing.
  5. Tailwind CSS utility-first dibanding framework SPA (React/Vue) untuk shell portal — bundel tetap tipis, konsisten dengan constraint "tanpa reactive framework" pada game.
  6. [AUDIT KODE — BARU, sebelumnya tidak tercatat] Agregasi katalog live dari GameMonetize + GamePix dibanding kurasi manual murni — memperbesar jumlah judul yang bisa ditawarkan tanpa menambah beban development per game, dengan trade-off ketergantungan pada uptime dua API eksternal (dimitigasi `Promise.allSettled` per-sumber + cache edge 30 menit, belum diuji beban — lihat §9 Phase 7).

### 4.3 Code Standards
- **Naming — files:** kebab-case (dikonfirmasi dari struktur asli: `ayo-kopdes`, `kejar-koruptor`, `ui-share.js`).
- **Naming — functions:** camelCase [ASSUMED — konvensi standar JS, belum eksplisit dikonfirmasi].
- **Naming — classes/types:** PascalCase [ASSUMED — proyek ini minim OOP class-based; mayoritas modul berbasis fungsi].
- **Formatter:** Prettier, config default [ASSUMED — standar aman untuk vanilla JS, risiko rendah untuk diubah kapan saja].
- **Linter:** ESLint dengan preset `eslint:recommended` [ASSUMED — cukup sebagai baseline tanpa build step berat].
- **Testing framework:** tahap Task Execution (P04) pada Vibe Coding Flow mewajibkan QA/test gate berupa test command yang terlihat + hasil pass/fail sebelum sebuah task berstatus COMPLETED — jadi proyek ini butuh mekanisme test minimal, bukan sekadar opsional. Usulan: Node.js built-in test runner (`node --test`) atau Vitest untuk modul murni (`js/state.js`, `js/utils.js`) dan untuk `src/index.js` [AUDIT KODE — KOREKSI, bukan `functions/api/*`/`functions/share/*` yang non-aktif; catatan: handler di `src/index.js` belum di-export, kemungkinan perlu penyesuaian kecil atau test runner yang mendukung lingkungan Workers seperti `@cloudflare/vitest-pool-workers`], ditambah smoke-test checklist manual untuk logika Canvas per game (sulit di-unit-test penuh).
- **Test coverage target:** Tidak perlu persentase global — fokus pada modul bernilai tinggi & mudah diuji (`state.js`, `src/index.js` [AUDIT KODE — bukan `functions/`, yang non-aktif]), selaras syarat "visible test command + pass/fail output" per task di P04.
- **Error handling:** [ASSUMED] try-catch di boundary route handler `src/index.js` ([AUDIT KODE] bukan `functions/api/*`/`functions/share/*` yang non-aktif) dengan fallback response terstruktur; sisi klien menggunakan try-catch di sekitar akses `localStorage` (dikonfirmasi ada di tiap `games/{slug}/game.js` dan `js/pwa.js` — mengantisipasi private/incognito mode yang membatasi storage).

### 4.4 API Design
- **API type:** REST-like (edge Worker Cloudflare, [AUDIT KODE] bukan Pages Functions, tanpa framework REST formal).
- **Base URL pattern:** `/api/` untuk katalog & pencarian (mis. `/api/games`, `/api/search?q=`); `/share/:id` untuk endpoint meta dinamis. [AUDIT KODE — BARU, belum tercatat sebelumnya] `/play/:id/:slug` (halaman pemutaran game canonical, SEO meta di-inject server-side); `/game` (redirect target pengganti `game.html`); `/sitemap.xml` (sitemap dinamis, dirujuk `robots.txt`). Seluruhnya ditangani `src/index.js`.
- **Authentication method:** none — seluruh endpoint publik & read-only (tanpa login, sesuai Out-of-Scope).
- **Response envelope:** `{ data, error }` [ASSUMED — konvensi sederhana; aman diubah kapan saja karena tanpa consumer eksternal].
- **Error format:** `{ code, message }` [ASSUMED — tanpa `request_id`, skala kecil tanpa tracing terdistribusi].
- **Pagination:** none secara eksplisit. [AUDIT KODE — KOREKSI] Klaim sebelumnya ("jumlah game masih sangat kecil, 4 judul") sudah tidak akurat — `/api/games`/`/api/search` membatasi hasil ke default beberapa lusin, maksimum ~200 gabungan game first-party + GameMonetize + GamePix.
- **API versioning strategy:** none — tidak ada consumer eksternal (dikonfirmasi di brief).
- **Backward compatibility policy:** Tidak wajib (internal-only), namun disarankan additive-only agar `js/catalog.js`/`game.html` di frontend tidak break saat endpoint diperbarui.
- **Rate limiting store:** none (tanpa Redis/database) — mengandalkan proteksi bawaan Cloudflare WAF/rate limiting di edge, sesuai hard constraint.
- **Webhook inbound verification:** none — tidak ada webhook masuk dalam scope ini.

### 4.5 Data Model
Diomit sesuai aturan template: §4.1 Database = "none", sehingga Phase 2 (Domain & Data) tidak berlaku untuk proyek ini.

## 5. Feature Specifications

### Feature: Katalog Game (First-Party + Agregasi Live)
- **User story:** Sebagai gamer kasual, saya ingin melihat daftar game yang bisa langsung dimainkan, sehingga saya bisa memilih & memainkan game yang saya minati tanpa instalasi aplikasi.
- **Acceptance criteria:**
  - [ ] Halaman utama (`index.html`) menampilkan game first-party (Ayo Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania — [DIJAWAB 2026-08-30] keempatnya dikonfirmasi developer masih aktif) lengkap dengan thumbnail dan judul, DIGABUNG dengan hasil agregasi GameMonetize/GamePix.
  - [ ] Setiap game first-party dapat dimuat & dimainkan sepenuhnya via HTML5 Canvas murni tanpa dependency game-engine eksternal; game hasil agregasi dimuat via iframe embed tervalidasi (`isAllowedEmbedUrl`).
  - [ ] First Contentful Paint katalog < 1.5 detik pada koneksi 4G [ASSUMED — selaras hard constraint ukuran file minimal].
- **Business rules:** Setiap game first-party mandiri dalam folder sendiri (`games/{slug}/`) berisi minimal `game.js`, `index.html`, `style.css`, `thumb.svg`. [DIJAWAB 2026-08-30] Status "lengkap & live" untuk keempatnya dikonfirmasi developer. Catatan implementasi: `src/index.js` (server) perlu disinkronkan agar `LOCAL_GAMES`-nya mencakup ketiga game selain Kicau Mania juga — lihat changelog Task #002.
- **UI notes:** Grid/list katalog responsif, mobile-first.
- **Priority:** P0

### Feature: Sistem Clean URL & Dynamic SEO
- **User story:** Sebagai pengguna yang menemukan game via Google, saya ingin mengakses halaman game dengan URL bersih dan info relevan di hasil pencarian, sehingga saya percaya diri untuk klik dan bermain.
- **Acceptance criteria:**
  - [ ] URL game tanpa ekstensi `.html` — [AUDIT KODE — KOREKSI] pola aktual adalah `/play/{id}/{slug}` (bukan `/main/ayo-kopdes` seperti draf sebelumnya); `game.html` lama kini 301-redirect ke `/game`.
  - [ ] Setiap halaman game punya meta title, meta description, dan canonical link yang diinjeksi dinamis sesuai game yang dimuat.
  - [ ] `robots.txt` mengizinkan indexing seluruh halaman game publik; [AUDIT KODE — BARU] `robots.txt` juga sudah mengarah ke `/sitemap.xml` dinamis yang di-generate `src/index.js`.
- **Business rules:** Meta tag dinamis wajib di-escape/disanitasi sebelum diinjeksi ke response HTML — [AUDIT KODE] khususnya pada `src/index.js` (rute `/share/:id`, `/play/:id/:slug`, `/game` — bukan `functions/share/[id].js` yang non-aktif) yang membaca parameter dari URL — untuk mencegah XSS. Escaping sudah diimplementasikan di kode saat ini; test otomatis yang membuktikannya belum ada.
- **UI notes:** Tidak ada UI baru; efek utama pada `<head>` dokumen.
- **Priority:** P0

### Feature: Viral Sharing & High Score System
- **User story:** Sebagai pemain yang memecahkan rekor pribadi, saya ingin merayakan pencapaian tersebut dan membagikannya ke media sosial, sehingga saya bisa menantang teman-teman.
- **Acceptance criteria:**
  - [ ] Saat skor melampaui rekor tersimpan di `localStorage`, animasi confetti dipicu otomatis oleh `ui-share.js`.
  - [ ] Tombol share memicu Web Share API dengan copywriting dinamis (menyebutkan nama game & skor).
  - [ ] Tersedia fallback (copy-to-clipboard/link manual) untuk browser tanpa dukungan Web Share API.
- **Business rules:** [AUDIT KODE — KOREKSI] Rekor tertinggi disimpan PER GAME secara terpisah di `localStorage` oleh masing-masing `games/{slug}/game.js` — BUKAN via `js/state.js`, yang pembacaan kodenya mengonfirmasi hanya mengelola favorit & recently-played. Ada pula rekor GLOBAL lintas game (`arcade-high-score-v1`, dikelola `js/pwa.js` via `window.postMessage`, termasuk dari game GamePix ter-embed) yang sebelumnya tidak tercatat. Tidak ada validasi skor sisi server (trade-off yang disengaja mengingat tidak ada backend stateful) — skor berpotensi dimanipulasi di sisi klien, dan ini diterima sebagai batasan produk saat ini, bukan bug.
- **UI notes:** Modal/toast perayaan rekor + tombol share, styling via `ui-share.css` konsisten lintas game.
- **Priority:** P0

### Feature: PWA (Progressive Web App)
- **User story:** Sebagai pengguna mobile yang sering bermain, saya ingin memasang Gimboot ke home screen dan tetap bisa mengakses game favorit secara offline, sehingga pengalaman terasa seperti aplikasi native.
- **Acceptance criteria:**
  - [ ] `manifest.json` valid dan lolos audit installability (Lighthouse PWA check).
  - [ ] `sw.js` meng-cache aset inti (shell portal + game yang pernah dimainkan) untuk akses offline.
  - [ ] Prompt instalasi (add-to-home-screen) dapat dipicu ulang dari UI (`js/pwa.js`). [AUDIT KODE — TEMUAN] Pembacaan penuh `js/pwa.js` dan pencarian menyeluruh di seluruh repo TIDAK menemukan kode `beforeinstallprompt`/install-prompt kustom apa pun — kriteria ini belum terpenuhi; instalasi PWA saat ini sepenuhnya mengandalkan perilaku bawaan browser dari `manifest.json`.
- **Business rules:** Update service worker wajib pakai strategi cache-busting/versioning agar pengguna tidak terjebak aset game versi lama setelah deploy baru.
- **UI notes:** Tombol "Install App" pada shell portal.
- **Priority:** P0

### Feature: Serverless API Backend
- **User story:** Sebagai bagian sistem, portal membutuhkan endpoint ringan untuk data katalog, pencarian, dan meta tag berbagi/pemutaran dinamis, sehingga fitur SEO dan viral sharing berjalan tanpa database.
- **Acceptance criteria:**
  - [ ] [AUDIT KODE — KOREKSI] `src/index.js` (`handleApiGames`, BUKAN `functions/api/games.js` yang non-aktif) mengembalikan metadata game (id, nama, slug/kategori, thumbnail, url, dimensi) dalam format JSON konsisten, gabungan game first-party + GameMonetize + GamePix.
  - [ ] `src/index.js` (`handleShareRoute`/`handlePlayRoute`, BUKAN `functions/share/[id].js` yang non-aktif) menghasilkan response dengan Open Graph tag sesuai parameter (game & skor) dari URL, tervalidasi lewat social-card debugger (mis. Facebook Sharing Debugger).
- **Business rules:** Seluruh endpoint read-only & stateless (tidak menulis ke storage apa pun); input dari URL/query wajib divalidasi & di-escape sebelum digunakan dalam response HTML untuk mencegah reflected XSS (sudah diimplementasikan). [DIJAWAB 2026-08-30] Response JSON `/api/games`/`/api/search` mengirim header `Access-Control-Allow-Origin: '*'` (wildcard) — developer memutuskan ini DITERIMA sebagai kebijakan yang sah untuk endpoint publik read-only ini; hard rule CORS di §8 sudah direvisi mengikuti keputusan ini, bukan kodenya yang diubah.
- **UI notes:** Tidak ada UI langsung — dikonsumsi oleh `js/catalog.js` dan tautan share/play.
- **Priority:** P0 (mendukung Fitur 2 & 3); [AUDIT KODE — KOREKSI] sub-fitur pencarian TIDAK lagi kandidat penurunan ke P1 — lihat catatan §3.1.

## 6. Non-Functional Requirements

### 6.1 Performance & Scale
- Response time target: P95 < 200ms untuk edge function ([AUDIT KODE] rute `src/index.js` — `/api/games`, `/api/search`, `/share/:id`, `/play/:id/:slug`) [ASSUMED, wajar untuk beban kerja Cloudflare Workers].
- Concurrent users (initial): puluhan–ratusan pengguna aktif di bulan pertama [ASSUMED — belum ada baseline traffic yang disebutkan].
- Concurrent users (6-month target): 10.000+ (dari brief). **Keputusan (dikonfirmasi developer):** Simple Mode berlaku untuk kondisi saat ini (traffic jauh di bawah 10.000); begitu traffic actual mendekati/melewati 10.000 pengguna serentak, standard scaling rigor wajib diterapkan (load testing formal, review kapasitas Cloudflare Functions, evaluasi ulang strategi caching). Usulan tambahan [ASSUMED]: pasang monitoring/alert early-warning di ~70–80% dari ambang (7.000–8.000 pengguna serentak) via Cloudflare Analytics, agar transisi ke scaling rigor tidak reaktif di detik-detik terakhir.

### 6.2 Security
- Auth standard: none (tanpa login, sesuai Out-of-Scope).
- JWT algorithm / Password hashing: omit (tidak ada akun/otentikasi).
- PII handling: Tidak ada PII yang dikumpulkan — `localStorage` hanya menyimpan skor & preferensi lokal per perangkat.
- Error tracking PII policy: pastikan Cloudflare Workers Logs tidak mencatat parameter URL yang berpotensi memuat data pengguna (mis. teks share kustom, bila ada di masa depan).
- Session: omit (tidak ada sesi login).
- Brute force protection: omit (tidak ada auth untuk dibobol); disarankan tetap ada rate-limiting dasar pada `/api/search` untuk mencegah abuse/scraping berlebihan.
- Secret rotation strategy: Belum relevan saat ini (belum ada secret aktif) [ASSUMED]; begitu ada kredensial pihak ketiga (mis. GameMonetize), rotasi wajib via Cloudflare environment variable ([AUDIT KODE] bukan spesifik "Cloudflare Pages" — proyek ini deploy sebagai Worker), bukan hardcode.

### 6.3 Scalability
- Growth expectation: 10.000+ pengguna serentak dalam 6 bulan pertama (dari brief).
- Scaling strategy: auto-scale penuh via edge Cloudflare untuk kondisi saat ini (Simple Mode); rencana scaling formal disiapkan begitu traffic mendekati ambang 10.000 (lihat §6.1).
- Caching: Cloudflare CDN edge cache untuk seluruh aset statis (games, css, js) + Service Worker untuk offline; tidak ada cache layer terpisah (Redis) karena tidak dibutuhkan.
- DB scaling: tidak berlaku (tanpa database).

### 6.4 Compliance
- Standards: WCAG 2.1 AA disarankan namun bukan prioritas MVP saat ini [ASSUMED, selaras skala proyek solo/indie] — dapat direvisit bila basis pengguna tumbuh signifikan.
- Regulations: none — tidak ada pengumpulan PII/akun sehingga UU PDP Indonesia tidak relevan langsung pada versi saat ini (evaluasi ulang bila di masa depan ditambahkan akun/leaderboard berbasis identitas).

### 6.5 Observability
- **Logging:** Cloudflare Workers Logs (bawaan) — dari brief. [AUDIT KODE] disebut "Pages/Workers Logs" di draf sebelumnya — dikonfirmasi Workers, bukan Pages, untuk proyek ini.
- **Log levels:** [ASSUMED] ERROR & WARN di production; hindari logging verbose demi performa edge function.
- **Error tracking / crash reporting:** Browser Console (sisi klien) + Cloudflare Dashboard (Worker) — dari brief; tidak ada Sentry/pihak ketiga.
- **Metrics:** Cloudflare Analytics bawaan — gratis, tanpa setup tambahan [ASSUMED].
- **Alerting:** Cloudflare standard uptime/error rate alerts, opsional (dari brief).
- **Health endpoints:** [ASSUMED/usulan] `GET /api/health` disarankan. [AUDIT KODE] Karena `functions/` tidak aktif pada model deploy saat ini, endpoint ini seharusnya ditambahkan sebagai route baru di `src/index.js`, bukan file terpisah — untuk memonitor ketersediaan API/share/play secara terpisah dari aset statis (yang selalu tersedia via CDN); non-orchestrated (bukan container).

## 7. Environment & Configuration
- **Environments:** dev (`wrangler dev` lokal) / preview / prod (branch production). [DIJAWAB 2026-08-30] Dikonfirmasi developer: mekanisme CI/CD adalah **Cloudflare Workers Builds** (produk Git-integration Cloudflare khusus Workers, bukan "Cloudflare Pages Preview Deployment" seperti draf sebelumnya) — preview deployment mengikuti mekanisme bawaan Workers Builds tersebut.
- **Required env vars:** Belum ada secret aktif per brief; env var baru (mis. site ID GameMonetize) ditambahkan via Cloudflare dashboard begitu dibutuhkan [ASSUMED/deferred].
- **Feature flags:** none disebutkan.
- **CI/CD:** [DIJAWAB 2026-08-30] **Cloudflare Workers Builds** — dikonfirmasi developer. BUKAN "Cloudflare Pages Git integration" (produk berbeda, khusus Pages) dan bukan CI eksternal (GitHub Actions dsb.).
- **CI secret masking:** Dikelola via Cloudflare environment variables (terenkripsi bawaan platform Workers Builds).
- **Container secret handling:** omit (bukan container-based).
- **Deployment / distribution command:** [AUDIT KODE — KOREKSI] Perintah manual/definitif dikonfirmasi `wrangler.toml`: `npx wrangler deploy`. `wrangler pages deploy` TIDAK berlaku untuk konfigurasi ini (bukan sekadar "jalur darurat" seperti draf sebelumnya — perintah ini secara eksplisit dinyatakan tidak cocok oleh komentar di `wrangler.toml` sendiri). Auto-deploy saat push/merge berjalan lewat Cloudflare Workers Builds.
- **Application versioning strategy:** Semver (MAJOR.MINOR.PATCH) [ASSUMED — selaras tahap Changelog pada Vibe Coding Flow].
- **Version tag/build-number format:** `vX.Y.Z` [ASSUMED].
- **Release trigger:** [DIJAWAB 2026-08-30] Auto-deploy saat push/merge ke branch production via Cloudflare Workers Builds.
- **Backup strategy:** Version control Git (dari brief) — seluruh source code; tidak ada backup database (tidak berlaku).
- **Backup retention:** mengikuti riwayat commit Git.
- **RTO / RPO:** RTO < 5 menit (redeploy otomatis via Git → Worker, atau `wrangler rollback` manual — lihat di bawah); RPO N/A (tanpa database terpusat, dari brief).
- **Rollback / update-channel strategy:** [AUDIT KODE — KOREKSI, diverifikasi ke dokumentasi Cloudflare Workers terkini] BUKAN "via Cloudflare Pages dashboard". Untuk Worker: `wrangler rollback` (CLI, rollback instan ke version sebelumnya) atau via Cloudflare dashboard (Workers & Pages → pilih Worker → tab Deployments → menu titik-tiga pada versi tujuan → Rollback).

## 8. Constraints & Anti-patterns

### Technical Constraints
- Tidak boleh menggunakan library game engine eksternal (Phaser, PixiJS, dll.) — hard constraint eksplisit.
- Harus berjalan sesuai batasan runtime Cloudflare Workers (tanpa akses penuh Node.js API seperti `fs`; gunakan Web API standar).
- Harus patuh kebijakan Autoplay browser modern untuk BGM berbasis Web Audio API (audio context perlu dipicu oleh user-gesture).

### Forbidden Patterns
- Tidak ada dependency ke database/ORM apa pun (sesuai Database: none).
- Tidak boleh menginjeksi parameter URL/query ke HTML/meta tag response tanpa escaping — risiko XSS. [AUDIT KODE] Rute yang relevan saat ini: `src/index.js` (`/share/:id`, `/play/:id/:slug`, `/game`) — bukan `functions/share/[id].js` yang non-aktif; sudah diimplementasikan di kode.
- Tidak boleh memutar audio (Web Audio API) tanpa interaksi pengguna eksplisit terlebih dahulu.
- Tidak boleh menambah library/aset yang signifikan menambah ukuran bundel tanpa evaluasi dampak performa. [AUDIT KODE] `favicon.svg` (742 KB, tidak terpakai) berpotensi melanggar prinsip ini jika suatu saat tanpa sengaja ter-link — lihat §4.2 & §10.
- Tidak boleh menyimpan kredensial/API key pihak ketiga (mis. GameMonetize) di source code — gunakan Cloudflare environment variable ([AUDIT KODE] bukan spesifik "Cloudflare Pages").
- Tidak boleh mengandalkan `localStorage` sebagai sumber kebenaran terverifikasi untuk fitur kompetitif publik (leaderboard global) di masa depan — perlu backend bila suatu saat dibutuhkan.
- Hindari CORS wildcard (`*`) pada endpoint yang mengharuskan otentikasi atau mengubah state. [DIJAWAB 2026-08-30 — HARD RULE DIREVISI] `src/index.js` mengirim `Access-Control-Allow-Origin: '*'` pada `/api/games` dan `/api/search`; developer memutuskan ini DITERIMA sebagai kebijakan yang sah, karena keduanya publik, read-only, tanpa data sensitif/otentikasi. Aturan sebelumnya ("hindari wildcard pada `functions/api/`") direvisi menjadi: wildcard boleh untuk endpoint publik read-only seperti ini; wildcard TETAP dilarang untuk endpoint apa pun di masa depan yang butuh otentikasi atau menulis state.

### Known Third-Party Limitations
- GameMonetize sempat menolak pengajuan portal ini sebelumnya, yang menjadi alasan ditambahkannya game first-party (termasuk Kicau Mania). Saat menambah game baru atau resubmit ke ad network, pastikan rasio konten orisinal tetap memadai agar tidak ditolak ulang.
- Rate limit/kebijakan spesifik GameMonetize/GamePix lainnya belum dicantumkan di brief — ini pengingat untuk dicek manual ke dokumentasi resmi sebelum integrasi lanjutan, bukan keputusan yang perlu dijawab di sini.

### Security Hard Rules
- Tidak ada secret di source code (bila ada API key ads di masa depan) — gunakan Cloudflare environment variables. [AUDIT KODE] `.gitignore` saat ini belum punya pola `.env`/`*.pem`/`*.key`/`*.p12`/`secrets/` — aturan ini belum ditegakkan secara teknis, lihat changelog Task #001.
- CORS boleh wildcard (`*`) HANYA pada endpoint publik, read-only, tanpa otentikasi (`/api/games`, `/api/search`) — [DIJAWAB 2026-08-30] direvisi dari larangan total sebelumnya, atas keputusan developer. Wildcard tetap dilarang untuk endpoint apa pun yang butuh otentikasi atau menulis state.
- Seluruh output dinamis (terutama rute `/share/:id`, `/play/:id/:slug`, `/game` di `src/index.js` — [AUDIT KODE] bukan `functions/share/[id].js` yang non-aktif) wajib melalui output encoding/sanitasi sebelum dikembalikan sebagai HTML — sudah diimplementasikan di kode saat ini.

## 9. Development Phases

| Phase | Name | Focus | Applies when | Status saat ini (dari struktur repo) |
|---|---|---|---|---|
| Phase 1 | Foundation | Scaffolding, CI/CD, logging init, health endpoint, env var validation | Always | `wrangler.toml`, `_headers`, `manifest.json`, `sw.js` sudah ada. [DIJAWAB 2026-08-30] CI/CD dikonfirmasi via Cloudflare Workers Builds (bukan "Cloudflare Pages Git integration"). Health endpoint (`/api/health`) belum ada — akan jadi route baru di `src/index.js`, bukan file `functions/`. **Prasyarat tambahan (dikonfirmasi developer):** audit clean-code WAJIB selesai di fase ini sebelum Phase 3+ dilanjutkan — kini mencakup eksekusi penghapusan `functions/api/*`/`functions/share/[id].js` (dikonfirmasi dihapus), pemasangan `favicon.svg` yang benar (dikonfirmasi dipakai, isi & wiring perlu diverifikasi), dan sinkronisasi roster game first-party di `src/index.js` (keempat game dikonfirmasi aktif) — lihat changelog Task #002. |
| Phase 2 | Domain & Data | Models, migrations | §4.5 Database ≠ "none" | Tidak berlaku (Database: none) |
| Phase 3 | Core Features | P0 features + unit test | Always | [DIJAWAB 2026-08-30] Keempat game first-party (Ayo Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania) dikonfirmasi developer selesai & aktif; `src/index.js` masih perlu disinkronkan agar mengenali keempatnya (lihat changelog Task #002). Katalog yang tampil ke pengguna sudah lebih besar dari 4 judul berkat agregasi GameMonetize/GamePix. Unit test untuk modul (`js/`, `src/index.js` — bukan `functions/` yang akan dihapus) masih perlu disiapkan (lihat §4.3). |
| Phase 4 | Integration | Third-party API + circuit breaker + webhook signature | §4.1 lists third-party services | `ads.txt` untuk GameMonetize/GamePix sudah ada. [DIJAWAB 2026-08-30] Dikonfirmasi developer: dibutuhkan unit monetisasi terpisah (ad-script) yang memang belum dibangun — bukan sekadar pengujian atas fetch feed katalog yang sudah ada di `src/index.js` (yang sudah punya fallback per-sumber via `Promise.allSettled` + cache edge 30 menit, dan tetap dipertahankan sebagai fitur tersendiri). Lihat changelog Task #011. |
| Phase 5 | UI/UX | Screens/components + XSS/output encoding + SRI | Project Shape has UI | `css/style.css` & `games/shared/ui-share.css` sudah ada. [AUDIT KODE] Output encoding sudah diverifikasi diimplementasikan pada `src/index.js` (bukan `functions/share/[id].js` yang akan dihapus); yang masih perlu adalah test otomatis yang membuktikannya. |
| Phase 6 | Testing & QA | Integration + E2E + coverage check | Always | Belum ada test file terlihat pada struktur — pendekatan di §4.3 (node --test/Vitest) belum diimplementasikan |
| Phase 7 | Deployment | Varian per shape | Always | [DIJAWAB 2026-08-30] CI/CD dikonfirmasi via Cloudflare Workers Builds (bukan "Cloudflare Pages Git integration"). Simple Mode berlaku sampai traffic mendekati 10.000 pengguna serentak; canary/staged-rollout formal (di luar preview deployment bawaan Workers Builds) baru wajib diterapkan begitu ambang itu terlampaui (lihat §6.1). |

## 10. Open Questions

Tidak ada open question yang tersisa. Keenam item [DECISION NEEDED] dari v1.3.0 sudah dijawab developer pada 2026-08-30, langsung di file ini. Dicatat di sini untuk riwayat (detail & konsekuensi masing-masing sudah disebar ke bagian terkait di atas, ditandai "[DIJAWAB 2026-08-30]"):

1. **Roster game first-party** → Dijawab: keempat game (Ayo Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania) masih aktif. Tindak lanjut kode: `src/index.js` perlu disinkronkan agar `LOCAL_GAMES`-nya mencakup keempatnya, bukan hanya Kicau Mania — dicatat di changelog Task #002.
2. **Nasib `functions/api/games.js`, `functions/api/search.js`, `functions/share/[id].js`** → Dijawab: dihapus (clean code); dicatat di changelog Task #002.
3. **`favicon.svg` vs `.avicon.svg`** → Dijawab: `favicon.svg` yang dipakai sebagai favicon resmi. Tindak lanjut kode: isi filenya saat ini belum cocok dengan desain ikon yang dimaksud dan belum direferensikan di HTML/manifest manapun — perlu diverifikasi & dipasang; `.avicon.svg` jadi kandidat dihapus. Dicatat di changelog Task #002.
4. **CORS wildcard pada `/api/games` & `/api/search`** → Dijawab: hard rule CORS di §8 yang direvisi (wildcard diterima untuk endpoint publik read-only ini), bukan kodenya yang diubah.
5. **Cakupan Task #011** → Dijawab: yang dimaksud adalah unit monetisasi/ad-script terpisah yang memang belum dibangun. Scope & acceptance criteria Task #011 di changelog diperbarui mengikuti jawaban ini.
6. **Mekanisme CI/CD persis** → Dijawab: Cloudflare Workers Builds.

Tidak ada pertanyaan baru yang muncul dari proses menjawab keenam poin di atas. Bila developer menemukan pertanyaan baru pada revisi berikutnya, tuliskan di bagian ini mengikuti format [DECISION NEEDED] seperti sebelumnya.

**Status:** Seluruh keputusan produk/teknis yang tersisa dari audit kode 2026-08-28 sudah dijawab. `knowledge.md` dan `changelog.md` diperbarui paralel (ke v1.2.0) mengikuti jawaban yang sama di dokumen ini, sehingga ketiganya tetap sinkron. Sejumlah tindak lanjut masih berupa PEKERJAAN KODE yang belum dieksekusi (sinkronisasi `LOCAL_GAMES`, penghapusan `functions/*`, verifikasi & pemasangan `favicon.svg`, pembuatan ad-script) — status pekerjaan ini dilacak di `changelog.md`, bukan di sini.

## 11. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0.0 | 2026-08-28 | Banu | Draf awal — PRD retroaktif untuk Gimboot (proyek sudah berjalan), disusun dari brief developer + struktur repo existing |
| 1.1.0 | 2026-08-28 | Banu | Jawaban Open Questions v1.0.0 diintegrasikan: 4 game dikonfirmasi lengkap & live, CI/CD via Cloudflare Pages Git integration, Simple Mode dibatasi berlaku sampai traffic <10.000, `src/index.js` dikonfirmasi aktif, `flow_compatibility` tetap di family tag v1.7. Item [DECISION NEEDED] berisiko rendah lainnya (formatter, linter, response envelope, error format, compliance, metrics, versioning, dll.) diselesaikan sebagai [ASSUMED] dengan default standar. 1 pertanyaan baru diajukan (jadwal audit clean-code). |
| 1.2.0 | 2026-08-28 | Banu | Audit clean-code dikonfirmasi dijalankan di Phase 1 (Foundation), wajib selesai sebelum fitur baru dilanjutkan (lihat §9). Seluruh Open Questions terselesaikan — status dokumen naik ke `ready`, siap dilanjutkan ke Prompt 01 (Knowledge extraction). |
| 1.3.0 | 2026-08-28 | Banu (via audit Claude atas `game-portal-main.zip`) | Audit langsung terhadap source code menemukan beberapa klaim teknis v1.2.0 sudah tidak sesuai kode berjalan: model deploy aktual adalah Cloudflare Worker + static assets (bukan Pages Functions); `functions/api/*`/`functions/share/[id].js` non-aktif; GameMonetize/GamePix juga berperan sebagai sumber katalog live (bukan hanya ad network); rute baru `/play/:id/:slug`, `/game`, `/sitemap.xml` sebelumnya tidak tercatat; CORS wildcard ditemukan di `/api/games`/`/api/search`; roster game first-party tidak konsisten antar `js/config.js` dan `src/index.js`; `js/state.js` tidak menyimpan skor (hanya favorit/recently-played); tidak ditemukan kode install-prompt PWA. Enam item baru ditambahkan ke §10 Open Questions sebagai [DECISION NEEDED]. `knowledge.md` diperbarui paralel ke v1.1.0; `changelog.md` diperbarui ke v1.1.0 dengan koreksi target file pada task-task yang terdampak. |
| 1.4.0 | 2026-08-30 | Banu | Keenam [DECISION NEEDED] dari §10 v1.3.0 dijawab langsung di file PRD: (1) keempat game first-party dikonfirmasi aktif; (2) `functions/api/*`/`functions/share/[id].js` dikonfirmasi dihapus; (3) `favicon.svg` dikonfirmasi sebagai favicon resmi; (4) hard rule CORS di §8 direvisi untuk mengizinkan wildcard pada endpoint publik read-only; (5) Task #011 dikonfirmasi butuh unit monetisasi/ad-script terpisah yang belum dibangun; (6) CI/CD dikonfirmasi Cloudflare Workers Builds. Jawaban disebar ke §1, §4.2, §5, §7, §8, §9; §10 tidak memuat pertanyaan baru. `knowledge.md` diperbarui paralel ke v1.2.0; `changelog.md` diperbarui ke v1.2.0 dengan task-task terkait disesuaikan. |
