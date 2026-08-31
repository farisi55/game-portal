---
project: Gimboot
version: 1.3.0
source: prd
last_updated: 2026-08-30
project_shape: fullstack
simple_mode: false
---
# simple_mode: false — PRD §6.1 6-month target adalah 10.000+ pengguna serentak (di atas ambang ≤100), sehingga syarat pertama tidak terpenuhi meski §6.4 Compliance = none
# v1.1.0 — direvisi berdasarkan audit langsung terhadap source code (game-portal-main.zip) tanggal 2026-08-28, dibandingkan dengan v1.0.0 yang disusun dari brief/struktur repo tanpa membaca isi tiap file. Semua koreksi ditandai "[AUDIT KODE]"; item yang masih perlu keputusan developer ditandai "[AUDIT KODE — PERLU KONFIRMASI]".
# v1.2.0 — developer menjawab keenam item [PERLU KONFIRMASI]/[DECISION NEEDED] dari v1.1.0 pada 2026-08-30 (lewat §10 Open Questions di prd.md). Jawaban ditandai "[DIJAWAB 2026-08-30]" di seluruh dokumen ini. Ringkasan lengkap ada di changelog.md bagian [COMPLETED].

## 1. Project Identity
- Nama: Gimboot (Game Portal) — portal PWA katalog game HTML5, SEO-optimized, dengan modul viral sharing terpusat. [AUDIT KODE] Katalog live adalah GABUNGAN: (a) game first-party buatan sendiri, dan (b) katalog yang di-fetch & digabung secara real-time dari dua feed pihak ketiga (GameMonetize + GamePix) — bukan murni "katalog mini-game bertema lokal" seperti draf sebelumnya. Lihat §2 dan §3.
- Primary users: gamer kasual (mobile-first) mencari hiburan cepat via browser; pengguna media sosial yang menyukai tantangan skor tinggi.
- Project Shape: fullstack (varian edge/serverless — tanpa server persisten). [AUDIT KODE] Backend BUKAN Cloudflare Pages Functions — backend aktual adalah satu Cloudflare Worker (`src/index.js`) dengan static assets, di-deploy dengan `wrangler deploy`. Detail lengkap di §2, §3, §8. Per Phase Applicability Matrix (PRD §9): seluruh 7 phase berlaku KECUALI Phase 2 (Domain & Data), di-skip karena Database = none.
- External API consumers: none — seluruh endpoint Gimboot hanya dikonsumsi frontend Gimboot sendiri. [AUDIT KODE] Arah sebaliknya juga berlaku dan belum tercatat sebelumnya: Gimboot sendiri adalah CONSUMER dari dua API pihak ketiga (feed katalog GameMonetize & GamePix) — lihat §2.
- Status implementasi saat ini (dari PRD §9, diperbarui hasil audit kode): Phase 1 (Foundation) & Phase 3 (Core Features) berjalan dengan cakupan lebih luas dari draf sebelumnya — termasuk 3 route SEO (`/play/:id/:slug`, `/game`, `/sitemap.xml`) yang sebelumnya tidak tercatat sama sekali. PWA dan sharing module sudah ada. Health endpoint, unit test, dan ad-script front-end (lihat §9) masih belum ada. [DIJAWAB 2026-08-30] Keempat game first-party (Ayo Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania) dikonfirmasi developer masih aktif — lihat §7 untuk detail & tindak lanjut kode yang masih perlu dieksekusi (sinkronisasi `LOCAL_GAMES` di `src/index.js`).

## 2. Tech Stack
- Bahasa & runtime: Vanilla JavaScript (ES2022+), HTML5 Canvas API (untuk game first-party), CSS3; edge runtime Cloudflare Workers.
- Framework: tanpa framework reaktif untuk game; Tailwind CSS (via CDN, utility-only, tanpa build step penuh) untuk shell portal.
- Database/storage: none — localStorage sisi klien. [AUDIT KODE] Bukan satu wrapper tunggal — lihat §3 "State management" untuk pembagian tanggung jawabnya yang sebenarnya.
- Infrastructure/deployment: [AUDIT KODE — KOREKSI] BUKAN "Cloudflare Pages (static hosting) + Cloudflare Pages Functions" seperti draf sebelumnya. Arsitektur aktual per `wrangler.toml`: satu Cloudflare Worker dengan static assets (`main = "./src/index.js"`, `[assets] directory = "."`, `run_worker_first = ["/*"]` — seluruh request lewat Worker dulu), di-deploy dengan `npx wrangler deploy`. `wrangler.toml` sendiri berisi komentar eksplisit bahwa `wrangler pages deploy` "tidak berlaku untuk konfigurasi build ini". Direktori `functions/api/*` dan `functions/share/[id].js` mengikuti konvensi Cloudflare Pages Functions yang TIDAK aktif pada model deploy ini — lihat §3 untuk status filenya.
- Container orchestration: none.
- Key third-party services: GameMonetize/GamePix — [AUDIT KODE] perannya ganda dan sebelumnya hanya tercatat sebagian: (1) ad network, diverifikasi lewat `ads.txt`; DAN (2) sumber katalog game LIVE yang di-fetch server-side oleh `src/index.js` (GameMonetize via `feed.php`, GamePix via `feeds.gamepix.com/v2/json`), digabung, lalu di-cache 30 menit di edge (Cache API). Peran (2) ini sebelumnya tidak tercatat sama sekali di knowledge.md maupun PRD.
- Webhook providers: none. [AUDIT KODE] Catatan terkait: `js/pwa.js` menerima pesan skor via `window.postMessage` (dari game lokal dan dari game GamePix yang di-embed) — ini komunikasi in-browser, bukan webhook server-to-server, jadi baris ini tetap akurat, hanya dicatat karena berkaitan.
- Dev tooling (Task #004, ditambahkan 2026-08-31): `package.json` + committed lockfile (`package-lock.json`) diperkenalkan. Paket devDependencies yang di-pin dengan versi eksak: `eslint@10.9.1`, `@eslint/js@10.0.1` (flat config ESLint 9+ — file `eslint.config.js`, bukan `.eslintrc`), `prettier@3.9.6` (config `.prettierrc`), `vitest@4.1.11` (test runner, config `vitest.config.js`, environment jsdom), `jsdom@26.1.0` (browser-globals shim untuk unit test `js/` files). `@cloudflare/vitest-pool-workers` untuk Worker-integration tests dipertimbangkan tapi ditunda ke Task #009 saat test `src/index.js` ditulis; saat itu paket akan diganti dengan `@cloudflare/vitest-plugin` (API saat ini per dokumentasi Cloudflare).

## 3. Architecture
- Folder/module structure (diperbarui & diverifikasi terhadap isi repo aktual, 2026-08-28):
```
game-portal/
├── css/style.css                 # global portal shell styles
├── functions/                    # [AUDIT KODE] Konvensi Cloudflare Pages Functions — TIDAK dijalankan pada model deploy Worker-with-assets saat ini (dikonfirmasi wrangler.toml + .assetsignore mengecualikan folder ini dari static assets). File di dalamnya berkomentar eksplisit bahwa mereka disimpan sebagai salinan referensi manual, bukan kode yang jalan — lihat catatan "Keputusan yang diperlukan" di bawah.
│   ├── api/games.js              # non-aktif — logika yang jalan ada di src/index.js (handleApiGames)
│   ├── api/search.js             # non-aktif — logika yang jalan ada di src/index.js (handleApiSearch)
│   └── share/[id].js             # non-aktif — logika yang jalan ada di src/index.js (handleShareRoute)
├── games/
│   ├── ayo-kopdes/{game.js,index.html,style.css,thumb.svg}
│   ├── kejar-koruptor/{...}      # struktur sama; status "live" perlu konfirmasi ulang — lihat §7
│   ├── kicau-mania/{...}         # struktur sama; satu-satunya game first-party yang dikenali src/index.js saat ini
│   ├── mobil-mbg/{...}           # struktur sama; status "live" perlu konfirmasi ulang — lihat §7
│   └── shared/{ui-share.css,ui-share.js}   # modul share/confetti (TIDAK menyimpan skor — lihat §3 "State management")
├── js/
│   ├── catalog.js                # render/manajemen katalog halaman utama
│   ├── config.js                 # konfigurasi/konstanta aplikasi, termasuk LOCAL_GAMES sisi klien (lihat §7)
│   ├── player.js                 # [AUDIT KODE] controller halaman player lengkap: resolve game dari SSR meta / query param, favorit, recently-played, fullscreen, native share/clipboard, related-games, lazy iframe load, allow-attribute per sumber game — BUKAN sekadar "loader game + kontrol audio"; tidak ada logika audio di file ini
│   ├── pwa.js                    # [AUDIT KODE] registrasi service worker + tracker skor tertinggi GLOBAL lintas game via window.postMessage (key `arcade-high-score-v1`, menerima pesan dari game lokal dan dari game GamePix ter-embed) — TIDAK ada kode install-prompt (`beforeinstallprompt` dsb.) di file ini maupun di seluruh repo
│   ├── state.js                  # [AUDIT KODE] wrapper localStorage untuk FAVORIT & RECENTLY-PLAYED saja — TIDAK berisi logika skor/high-score sama sekali (lihat §3 "State management")
│   ├── tailwind-config.js        # konfigurasi Tailwind tanpa build step penuh
│   └── utils.js                  # escapeHtml, debounce, slugify, buildPlayUrl, buildGamePageUrl, isAllowedEmbedUrl, readSessionGames/writeSessionGames, fetchGameCatalog
├── src/index.js                  # [AUDIT KODE] RESOLVED — ini adalah satu-satunya entry point Worker yang aktif (dikonfirmasi via wrangler.toml). Menangani: static-asset fallback (env.ASSETS), /api/games, /api/search, /share/:id, /play/:id/:slug (baru, SEO canonical, injeksi meta/JSON-LD via HTMLRewriter), /game (redirect target, menggantikan game.html lama), /sitemap.xml (baru, dirujuk oleh robots.txt), plus header keamanan (CSP nonce-based) untuk SEMUA response. Fungsi-fungsi handler-nya (handleApiGames, handleApiSearch, dll.) belum di-export — jadi belum bisa di-unit-test tanpa refactor kecil (relevan untuk Task #009 di changelog).
├── _headers                      # [AUDIT KODE] fallback saja — komentar di src/index.js menyatakan Worker-with-assets tidak konsisten menerapkan _headers ke semua response, sehingga src/index.js menegakkan CSP nonce-based-nya sendiri di level Worker; _headers berisi CSP default `script-src 'none'` sebagai jaring pengaman
├── .avicon.svg                   # [DIJAWAB 2026-08-30] developer memutuskan `favicon.svg` (bukan file ini) sebagai favicon resmi — file ini jadi kandidat dihapus, lihat §9 & changelog Task #002.
├── favicon.svg                   # [DIJAWAB 2026-08-30] dikonfirmasi developer sebagai favicon resmi. Isinya saat ini (742 KB, hasil trace/vektorisasi kompleks) belum cocok dengan deskripsi ikon pixel-art di README, dan belum direferensikan di HTML/manifest manapun — perlu diverifikasi & dipasang, lihat §9 & changelog Task #002.
├── icon-192.png / icon-512.png   # [AUDIT KODE — BARU DITEMUKAN] ikon PWA aktif, direferensikan di index.html, game.html, manifest.json, sw.js (precache), dan src/index.js (fallback OG image)
├── screenshot-desktop.png / screenshot-mobile.png  # [AUDIT KODE — BARU DITEMUKAN] dirujuk di manifest.json sebagai screenshot "wide" & "narrow" — TERNYATA file yang identik (checksum sama, sama-sama 1254×1254px persegi), bukan dua screenshot berbeda
├── .assetsignore                 # [AUDIT KODE — BARU DITEMUKAN] mengecualikan src/, functions/, .git/, .wrangler/, .claude/, README.md, wrangler.toml dari static assets
├── .gitignore                    # [AUDIT KODE — BARU DITEMUKAN] saat ini hanya mengecualikan folder tool AI (.claude/, .wrangler/, .kilo/, .serena/) — BELUM ada pola .env/*.pem/*.key/*.p12/secrets/ (relevan untuk Task #001)
├── README.md                     # [AUDIT KODE — BARU DITEMUKAN] dokumentasi developer-facing yang sudah cukup mutakhir; jadi salah satu sumber utama audit ini. Catatan: nilai run_worker_first yang disebut README (["/api/*","/play/*","/sitemap.xml"]) sudah tidak sama dengan wrangler.toml aktual (["/*"]) — README sendiri sedikit tertinggal di titik ini.
├── robots.txt                    # [AUDIT KODE — BARU DITEMUKAN] mengarah ke /sitemap.xml — mengonfirmasi route sitemap dinamis di src/index.js memang disengaja & live
├── ads.txt                       # verifikasi GameMonetize/GamePix
├── game.html                     # shell lama; link ke game.html kini di-301-redirect ke /game oleh src/index.js
├── index.html                    # landing page katalog
├── manifest.json / sw.js         # PWA manifest + service worker
└── wrangler.toml                 # [AUDIT KODE] konfigurasi Cloudflare Worker + static assets — BUKAN konfigurasi Cloudflare Pages/Functions
```
- Layer responsibilities: `js/*` = logic shell portal (katalog, player, PWA/skor global); `games/{slug}/` = game mandiri (Canvas logic + skor per-game + preferensi suara, self-contained per game); `games/shared/` = modul share/confetti; `src/index.js` = satu-satunya edge backend aktif (katalog/search API, generator meta share & play, sitemap, security headers); `functions/` = salinan referensi non-aktif dari sebagian logika `src/index.js` (lihat catatan di atas).
- Design patterns: Module pattern per file JS (tanpa bundler wajib); Adapter pattern pada `state.js` (wrapper localStorage — cakupannya favorit & recently-played, [AUDIT KODE] bukan skor); isolasi ala-Strategy per game (folder mandiri per game, termasuk state skor & preferensi suaranya sendiri).
- State management: [AUDIT KODE — KOREKSI] Bukan satu wrapper tunggal `js/state.js` untuk semua state. Pembagian sebenarnya, seluruhnya client-side via `localStorage`:
  - `js/state.js` → favorit & recently-played (dipakai `js/player.js`).
  - Setiap `games/{slug}/game.js` → high score PER-GAME miliknya sendiri (key sendiri-sendiri) + preferensi mute suara, masing-masing dengan try-catch untuk mode privat/incognito.
  - `js/pwa.js` → high score GLOBAL lintas game (key `arcade-high-score-v1`), diperbarui lewat `window.postMessage` dari game lokal maupun game GamePix ter-embed (GamePix mengirim event `update_score` secara native; game GameMonetize ter-embed tidak punya listener yang sepadan).
  - Tidak ada state management library.
- Data flow: [AUDIT KODE — diperbarui menyesuaikan route baru] Browser → `index.html` (`js/catalog.js` memanggil `/api/games` ke `src/index.js`, yang menggabungkan `LOCAL_GAMES` + hasil fetch GameMonetize & GamePix, cache 30 menit) → pilih game → `/play/{id}/{slug}` (canonical, SEO meta/JSON-LD di-inject `src/index.js` via HTMLRewriter) atau fallback `/game?...` → `js/player.js` resolve data game → iframe dimuat setelah tombol "Play Now" ditekan → untuk game first-party: skor ditulis ke `localStorage` per-game (`games/{slug}/game.js`) dan (jika di-post-message) ke tracker global (`js/pwa.js`) → `ui-share.js` memicu confetti + Web Share API → tautan share (opsional) → `/share/{id}` di `src/index.js` men-generate OG meta dinamis (sudah menerapkan escaping, lihat §9).
- Key architectural decisions:
  1. Vanilla JS + HTML5 Canvas dibanding game engine (Phaser/PixiJS) untuk game first-party — menjaga ukuran bundel sekecil mungkin demi kecepatan muat mobile.
  2. `localStorage` dibanding database terpusat untuk skor/state pemain — menghilangkan kebutuhan backend stateful/auth untuk data pemain, meski katalog sendiri kini bergantung pada dua feed eksternal (lihat poin 6 di bawah).
  3. [AUDIT KODE — KOREKSI] Cloudflare Worker dengan static assets (`wrangler deploy`) dibanding Cloudflare Pages tradisional ATAU server Node/Express — deploy global instan, auto-scaling bawaan, satu titik kontrol untuk security headers di semua response (lihat §9), cocok untuk solo developer.
  4. Meta tag dinamis via Worker (`src/index.js`, bukan `functions/share/[id].js` yang non-aktif) dibanding halaman HTML statis terpisah per game — menghindari duplikasi N halaman sambil tetap dapat OG tag/canonical link presisi per game/rute.
  5. Tailwind CSS utility-first (via CDN) dibanding framework SPA (React/Vue) untuk shell portal — bundel tetap tipis, konsisten dengan constraint "tanpa reactive framework" pada game.
  6. [AUDIT KODE — BARU, sebelumnya tidak tercatat] Agregasi katalog live dari GameMonetize + GamePix (bukan hanya game first-party) dibanding kurasi manual murni — memperbesar jumlah judul yang bisa ditawarkan ("hundreds of free browser games" per tagline manifest.json) tanpa menambah beban development per game, dengan trade-off: ketergantungan pada uptime dua API eksternal (dimitigasi `Promise.allSettled` per-sumber + cache edge 30 menit, tapi belum diuji beban — lihat Task #016 di changelog).

## 4. Code Standards
- Naming: file kebab-case; fungsi camelCase; class/type PascalCase.
- Error handling: [AUDIT KODE — target file dikoreksi] try-catch di boundary route handler `src/index.js` (bukan `functions/api/*`/`functions/share/*` yang non-aktif) dengan fallback response terstruktur; try-catch di sekitar setiap akses `localStorage` sisi klien (dikonfirmasi ada di tiap `games/{slug}/game.js` dan `js/pwa.js` — antisipasi private/incognito mode).
- Formatter: Prettier 3.9.6 (config `.prettierrc`; ignore file `.prettierignore`). [Diperbarui Task #004 — 2026-08-31]
- Linter: ESLint 10.9.1 dengan flat config (`eslint.config.js`, bukan `.eslintrc`). Preset `eslint:recommended` via `@eslint/js@10.0.1`. Scope: `js/`, `src/`, `games/shared/`. Rules tambahan: `no-unused-vars` (dengan `argsIgnorePattern`/`caughtErrorsIgnorePattern` `^_`), `no-shadow`, `prefer-const`, `semi`. Per-game Canvas files (`games/{slug}/`) dikecualikan dari lint pass bersama (standalone apps). [Diperbarui Task #004 — 2026-08-31]
- Testing framework: **Vitest 4.1.11** (dipilih atas `node --test` karena kompatibilitas dengan Workers pool yang akan dibutuhkan Task #009). Config: `vitest.config.js`, environment `jsdom` (via `jsdom@26.1.0`), `passWithNoTests: true`. `@cloudflare/vitest-pool-workers` ditunda ke Task #009 — saat itu paket yang tepat adalah `@cloudflare/vitest-plugin` (API Cloudflare terkini). Target uji: `js/state.js` (favorit/recently-played, BUKAN high-score — lihat §3), `js/utils.js`, dan logika di `src/index.js` (handleApiGames/handleApiSearch/handleShareRoute/dll. — catatan: fungsi-fungsi ini belum di-export, kemungkinan perlu refactor kecil supaya testable). Smoke-test checklist manual tetap untuk logika Canvas per game. [Diperbarui Task #004 — 2026-08-31]
- Coverage target: tidak ada persentase global — fokus pada `state.js`, `js/utils.js`, dan `src/index.js` (modul bernilai tinggi & — setelah `src/index.js` di-refactor agar handler-nya bisa di-import — mudah diuji); wajib ada test command yang terlihat + hasil pass/fail per task (syarat gate P04 Vibe Coding Flow).

## 5. API & Data Contracts
- Base URL/endpoint pattern: `/api/games`, `/api/search?q=` (katalog & pencarian, gabungan LOCAL_GAMES + GameMonetize + GamePix); `/share/:id` (meta dinamis untuk share link). [AUDIT KODE — BARU, belum tercatat di draf sebelumnya] `/play/:id/:slug` (halaman pemutaran game canonical, SEO meta & JSON-LD di-inject server-side); `/game` (redirect target pengganti `game.html`); `/sitemap.xml` (sitemap dinamis, dirujuk `robots.txt`). Seluruhnya ditangani satu Worker `src/index.js`.
- API versioning/backward-compat: tidak ada versioning (tanpa consumer eksternal); additive-only disarankan secara internal.
- Rate limiting store: none — mengandalkan Cloudflare WAF/rate limiting bawaan edge.
- Auth/authz: none — seluruh endpoint publik & read-only, tanpa akun/login.
- Webhook inbound verification: none — tidak ada webhook masuk.
- Request/response schemas: `/api/games` & `/api/search` → metadata game (id, judul, slug/kategori, thumbnail, url embed, dimensi) dalam JSON; `/share/:id` & `/play/:id/:slug` → HTML dengan meta tag OG/Twitter/JSON-LD dinamis, nilai dari URL/parameter di-escape (lihat §9).
- Error response format: `{ code, message }` — TANPA `request_id` (keputusan eksplisit PRD untuk skala kecil tanpa tracing terdistribusi).
- Pagination: [AUDIT KODE] tidak eksplisit, tapi `/api/games` & `/api/search` membatasi jumlah hasil (default beberapa lusin, maksimum ~200 gabungan LOCAL_GAMES + eksternal) — bukan lagi "katalog hanya 4 judul" seperti draf sebelumnya.
- [DIJAWAB 2026-08-30] CORS: response JSON dari `/api/games` dan `/api/search` di `src/index.js` mengirim `Access-Control-Allow-Origin: '*'` (wildcard). Developer memutuskan ini DITERIMA sebagai kebijakan yang sah untuk endpoint publik read-only ini — hard rule CORS di §9 sudah direvisi mengikuti keputusan ini (bukan kodenya yang diubah). Wildcard tetap dilarang untuk endpoint apa pun di masa depan yang butuh otentikasi atau menulis state.

## 6. UI / UX Constraints
- Component library/design system: Tailwind CSS utility classes saja; tidak ada component library/design system formal disebutkan.
- Layout: grid/list katalog responsif, mobile-first.
- Accessibility: WCAG 2.1 AA disarankan, bukan prioritas wajib untuk MVP saat ini.
- Forbidden UI pattern: tidak boleh memutar audio (Web Audio API/BGM) tanpa interaksi pengguna eksplisit terlebih dahulu (kebijakan autoplay browser).
- Output encoding: seluruh meta tag/HTML dinamis wajib di-escape/disanitasi sebelum diinjeksi — mencegah XSS dari parameter URL. [AUDIT KODE] Target aktualnya adalah `src/index.js` (handleShareRoute/handlePlayRoute/handleGameRoute — bukan `functions/share/[id].js` yang non-aktif); pembacaan kode menunjukkan escaping (`escapeHtmlAttr`, `escapeJsonLd`) SUDAH diterapkan secara konsisten di jalur ini, tapi belum ada test otomatis yang membuktikannya — lihat Task #010 di changelog.

## 7. Business Logic & Domain Rules

### Domain Rules & Behavior
- Setiap game mandiri dalam folder sendiri (`games/{slug}/`) berisi minimal `game.js`, `index.html`, `style.css`, `thumb.svg`; pola ini konsisten di keempat folder game yang ada di repo.
- [DIJAWAB 2026-08-30] Jumlah & status game first-party sempat TIDAK konsisten antar tiga sumber dalam repo yang sama:
  - `js/config.js` (client-side, menentukan apa yang tampil di grid katalog `index.html`) mendaftarkan 4 game sebagai "Buatan Sendiri": Ayo Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania.
  - `src/index.js` (server-side, konstanta `LOCAL_GAMES`, menentukan hasil `/share/:id`, `/play/:id/:slug`, dan isi `/sitemap.xml`) HANYA mengenali 1 game: Kicau Mania. Komentar di dalam kode ini sendiri menyatakan konstanta ini seharusnya "mirror `js/config.js`'s LOCAL_GAMES exactly" — tapi saat ini tidak.
  - `README.md` proyek menyebut game yang di-host langsung "currently: Kicau Mania" (tunggal).
  - **Keputusan developer (2026-08-30): keempat game MASIH AKTIF.** `js/config.js` sudah benar; `src/index.js` yang perlu diperbarui — tambahkan Ayo Kopdes, Kejar Koruptor, Mobil MBG ke `LOCAL_GAMES` di `src/index.js` supaya link share, `/play/`, dan `sitemap.xml` juga berfungsi untuk ketiganya (belum dieksekusi — dilacak di changelog Task #002; `README.md` juga perlu diperbarui menyusul).
- Rekor tertinggi PER-GAME disimpan terpisah di `localStorage` oleh masing-masing `game.js` (bukan oleh `js/state.js` — lihat §3); tidak ada validasi skor sisi server — skor berpotensi dimanipulasi klien, diterima sebagai batasan produk yang disengaja (bukan bug). [AUDIT KODE — BARU] Selain rekor per-game, ada pula rekor GLOBAL lintas-game (`arcade-high-score-v1`, dikelola `js/pwa.js` via `window.postMessage`) yang sebelumnya tidak tercatat di dokumen manapun.
- Routing game via clean URL menuju halaman player dinamis — [AUDIT KODE] rute canonical saat ini adalah `/play/{id}/{slug}` (baru); `game.html` lama kini 301-redirect ke `/game`.
- Update service worker wajib pakai strategi cache-busting/versioning agar pengguna tidak terjebak aset game versi lama setelah deploy baru.
- Input validation: parameter URL/query pada rute dinamis `src/index.js` (`/share/:id`, `/play/:id/:slug`, `/game`) wajib divalidasi & di-escape sebelum dipakai dalam response HTML — mencegah reflected XSS. [AUDIT KODE] Sudah diimplementasikan di kode saat ini (lihat §6); perlu test otomatis untuk membuktikannya (Task #010).
- Idempotency: seluruh route GET pada `src/index.js` read-only & stateless — idempoten by design, tanpa penanganan khusus tambahan.
- Application versioning: Semver (MAJOR.MINOR.PATCH); format tag `vX.Y.Z`.

## 8. Environment & Configuration
- Required env vars: belum ada secret aktif; env var baru (mis. site ID GameMonetize) ditambahkan via Cloudflare dashboard begitu dibutuhkan.
- Feature flags: none.
- Observability: logging via Cloudflare Workers Logs (bawaan), level ERROR & WARN di production; error tracking = Browser Console (klien) + Cloudflare Dashboard (Worker), tanpa Sentry/pihak ketiga; PII scrubbing — pastikan Workers Logs tidak mencatat parameter URL yang memuat data pengguna; metrics via Cloudflare Analytics bawaan; alerting via Cloudflare standard uptime/error-rate alerts (opsional); tambahan disarankan: early-warning monitoring di ~7.000–8.000 pengguna serentak (70–80% dari ambang 10.000).
- Health check endpoint: single, non-orchestrated — `GET /api/health` disarankan, belum diimplementasikan. [AUDIT KODE] Karena `functions/` tidak aktif pada model deploy saat ini, endpoint ini seharusnya ditambahkan sebagai route baru di dalam `src/index.js`, BUKAN sebagai file baru `functions/api/health.js` — lihat Task #003 di changelog.
- Build pipeline/deployment: [DIJAWAB 2026-08-30] **Cloudflare Workers Builds** — dikonfirmasi developer sebagai mekanisme CI/CD, BUKAN "Cloudflare Pages Git integration". Perintah deploy definitif & manual, dikonfirmasi `wrangler.toml`: `npx wrangler deploy` (bukan `wrangler pages deploy`, yang menurut komentar di file itu sendiri "tidak berlaku untuk konfigurasi build ini").
- Multi-environment: dev (`wrangler dev` lokal) / preview & prod — [DIJAWAB 2026-08-30] preview deployment mengikuti mekanisme bawaan Cloudflare Workers Builds (bukan "Cloudflare Pages Preview Deployment" seperti draf sebelumnya).
- Rollback/update-channel: [AUDIT KODE — KOREKSI, diverifikasi ke dokumentasi Cloudflare terkini] BUKAN "via Cloudflare Pages dashboard". Untuk Worker, rollback dilakukan lewat `wrangler rollback` (CLI, ke deployment/version sebelumnya) atau via Cloudflare dashboard: Workers & Pages → pilih Worker → tab Deployments → menu titik-tiga pada versi tujuan → Rollback.
- Canary/staged-rollout: target 6 bulan (10.000+) > 1.000 → berlaku. Untuk saat ini, preview deployment + rollback instan (lihat di atas) sudah cukup (Simple Mode secara operasional); canary/staged-rollout formal wajib begitu traffic actual mendekati/melewati 10.000 pengguna serentak.

## 9. Constraints & Anti-patterns
- **Sequencing constraint (prioritas tertinggi):** audit clean-code (hapus file/kode tidak terpakai, verifikasi `.avicon.svg`) WAJIB selesai di Phase 1 SEBELUM fitur baru apa pun dikerjakan — keputusan eksplisit developer. [DIJAWAB 2026-08-30] Keputusan atas unknown Task #002 sudah lengkap: `.avicon.svg` → kandidat dihapus (favicon resmi adalah `favicon.svg`); `functions/api/*`/`functions/share/[id].js` → dihapus; roster game first-party → keempatnya aktif, `src/index.js` perlu disinkronkan. Eksekusi ketiganya (plus duplikasi screenshot di `manifest.json`) masih tertunda — dilacak di changelog.md Task #002.
- Out of scope (jangan dibangun): multiplayer online real-time; penyimpanan cloud/login-otentikasi untuk progres pengguna; aset atau rendering 3D kompleks (hanya 2D/pseudo-3D).
- Tidak boleh memakai library game engine eksternal (Phaser, PixiJS, dll.) untuk game first-party.
- Tidak boleh ada dependency ke database/ORM apa pun.
- Tidak boleh menginjeksi parameter URL/query ke HTML/meta tag response tanpa escaping (risiko XSS). [AUDIT KODE] Rute yang relevan saat ini: `src/index.js` (`/share/:id`, `/play/:id/:slug`, `/game`) — bukan lagi `functions/share/[id].js` yang non-aktif; sudah diimplementasikan di kode, perlu test otomatis (Task #010).
- Tidak boleh memutar audio (Web Audio API) tanpa interaksi pengguna eksplisit.
- Tidak boleh menambah library/aset yang signifikan menambah ukuran bundel tanpa evaluasi dampak performa. [AUDIT KODE] `favicon.svg` (742 KB, tidak terpakai) berpotensi melanggar prinsip ini jika suatu saat tanpa sengaja ter-link — lihat §3 & catatan di bawah.
- Tidak boleh menyimpan kredensial/API key pihak ketiga di source code — gunakan Cloudflare environment variables.
- Tidak boleh mengandalkan `localStorage` sebagai sumber kebenaran terverifikasi untuk fitur kompetitif publik (leaderboard global) di masa depan.
- CORS: boleh wildcard (`*`) HANYA pada endpoint publik, read-only, tanpa otentikasi. [DIJAWAB 2026-08-30] Direvisi dari larangan total sebelumnya — developer memutuskan wildcard pada `/api/games`/`/api/search` (`src/index.js`) DITERIMA karena keduanya publik & read-only. Wildcard tetap dilarang untuk endpoint apa pun di masa depan yang butuh otentikasi atau menulis state.
- API stability: internal-only tanpa consumer eksternal, tapi additive-only tetap disarankan agar frontend tidak break saat endpoint berubah.
- CI/CD secret policy: seluruh secret (jika ada API key pihak ketiga di masa depan) dikelola via Cloudflare environment variables, tidak pernah di-hardcode/commit ke source.
- Performance constraints: P95 < 200ms untuk edge function; First Contentful Paint katalog < 1.5 detik pada koneksi 4G.
- Security hard rules: tidak ada secret di source code ([AUDIT KODE] dikonfirmasi — `.gitignore` saat ini belum punya pola `.env`/`*.pem`/`*.key`/`*.p12`/`secrets/`, jadi aturan ini belum ditegakkan secara teknis, lihat Task #001); CORS boleh wildcard hanya pada endpoint publik read-only tanpa otentikasi ([DIJAWAB 2026-08-30] direvisi — lihat rule di atas); seluruh output dinamis wajib output encoding/sanitasi sebelum dikembalikan sebagai HTML (sudah diimplementasikan di `src/index.js`, lihat §6).
- Known technical limitations: GameMonetize sempat menolak pengajuan portal ini sebelumnya (jadi alasan penambahan game first-party seperti Kicau Mania) — pastikan rasio konten orisinal tetap memadai saat menambah game baru/resubmit; rate limit spesifik GameMonetize/GamePix belum terdokumentasi — cek dokumentasi resmi sebelum integrasi lanjutan. [AUDIT KODE — catatan tambahan, bukan dari knowledge.md/PRD tapi ditemukan saat audit] `ads.txt` mencantumkan dua GamePix property ID berbeda dalam komentarnya (`985I2` dan `30W77`); konstanta `GAMEPIX_DEFAULT_SID` di `src/index.js` memakai `985I2`. Sebaiknya dicocokkan langsung ke dashboard GamePix untuk memastikan tidak ada site ID yang keliru/basi.
- [DIJAWAB 2026-08-30] `.avicon.svg` (kecil, tema joystick) dan `favicon.svg` (742 KB, hasil trace kompleks) sama-sama TIDAK direferensikan di manapun. Developer memutuskan `favicon.svg` sebagai favicon resmi. Tindak lanjut kode yang masih tertunda: verifikasi isi `favicon.svg` sesuai desain ikon pixel-art yang dimaksud README, pasang via `<link rel="icon">` + referensi di `manifest.json`, lalu hapus `.avicon.svg` — dilacak di changelog Task #002.
- [AUDIT KODE — TEMUAN] `screenshot-desktop.png` dan `screenshot-mobile.png` yang dirujuk `manifest.json` sebagai form_factor "wide" & "narrow" ternyata file identik (checksum sama) — mengurangi manfaat preview-instalasi PWA yang seharusnya menampilkan tampilan desktop & mobile yang berbeda.
- Compliance: tidak ada requirement regulasi (tanpa PII/akun); WCAG 2.1 AA disarankan namun tidak wajib untuk MVP; tidak ada requirement pentest.

## Catatan Metodologi Audit (2026-08-28, diperbarui 2026-08-30)
- File yang dibaca penuh & diverifikasi langsung (2026-08-28): `wrangler.toml`, `src/index.js` (seluruh isi), `.assetsignore`, `.gitignore`, `ads.txt`, `robots.txt`, `_headers`, `manifest.json`, `js/config.js`, `js/state.js`, `js/pwa.js`, `js/player.js`, `js/utils.js` (daftar ekspor), `sw.js` (sebagian), `README.md`, `functions/api/games.js` & `functions/share/[id].js` (komentar header), `favicon.svg` & `.avicon.svg` (dibandingkan visual/isi), `screenshot-*.png` & `icon-*.png` (checksum/dimensi), serta hasil `grep`/`find` menyeluruh atas seluruh repo untuk referensi silang.
- File yang BELUM dibaca penuh (hanya diketahui lewat referensi/README, cross-check lanjutan disarankan bila diperlukan): isi lengkap `games/shared/ui-share.js`, `js/catalog.js`, `index.html`/`game.html` secara utuh, dan isi lengkap masing-masing `games/{slug}/game.js` (hanya baris localStorage-nya yang diperiksa).
- 2026-08-30: developer menjawab keenam item [PERLU KONFIRMASI] langsung di `prd.md` §10 (bukan lewat pembacaan kode tambahan) — jawaban tersebut yang menjadi dasar seluruh baris "[DIJAWAB 2026-08-30]" di dokumen ini. Kode itu sendiri (repo) belum dibaca ulang pada tanggal ini; tindak lanjut kode yang masih tertunda (sinkronisasi `LOCAL_GAMES`, penghapusan `functions/*`, pemasangan `favicon.svg`, pembuatan ad-script) belum diverifikasi eksekusinya — status pekerjaan ada di `changelog.md`.
- Tidak ada riwayat Git di dalam zip (nama folder `game-portal-main` konsisten dengan unduhan zip GitHub tanpa `.git/`), sehingga klaim soal "kapan" suatu perubahan terjadi (mis. riwayat migrasi ke Worker-with-assets) didasarkan pada komentar di dalam kode & README, bukan riwayat commit.
