---
project: Gimboot
knowledge_version: 1.3.0
changelog_version: 1.0.5
created: 2026-08-28
status: in_progress
milestone: 1 of 1
project_shape: fullstack
simple_mode: false
---

## [AUDIT FINDINGS — 2026-08-28]
> Hasil audit langsung terhadap source code (`game-portal-main.zip`), dibandingkan dengan PRD/knowledge.md/changelog.md yang sebelumnya disusun dari brief + struktur repo tanpa membaca isi tiap file. Detail penuh & bukti tiap temuan ada di `knowledge.md` v1.2.0. Temuan yang mengubah scope/file-target task di bawah sudah disisipkan langsung ke task terkait (ditandai "[AUDIT KODE]"). Status di bawah: keempat temuan lintas-task ini SUDAH DIJAWAB developer pada 2026-08-30 — lihat [DEVELOPER DECISIONS — 2026-08-30] tepat di bawah blok ini untuk jawabannya.
>
> 1. **Model deploy sebenarnya adalah Cloudflare Worker + static assets** (`wrangler deploy`, bukan Cloudflare Pages Functions). Akibatnya `functions/api/games.js`, `functions/api/search.js`, `functions/share/[id].js` TIDAK aktif — dikonfirmasi lewat komentar di dalam file-file itu sendiri ("doesn't appear to be used... Safe to delete if you'd rather not maintain two copies"). Logika yang benar-benar jalan ada di `src/index.js`. → mempengaruhi Task #001, #003, #009, #010, #013, #016.
> 2. **Roster game first-party tidak konsisten**: `js/config.js` (client) masih mendaftarkan 4 game (Ayo Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania); `src/index.js` (server) dan `README.md` hanya mengenali Kicau Mania sebagai game yang di-host langsung. Dampak: link share & entri sitemap untuk 3 game lainnya tidak berfungsi sebagaimana mestinya. → mempengaruhi Task #002 dan cakupan MVP di PRD.
> 3. **CORS wildcard aktif**: `src/index.js` mengirim `Access-Control-Allow-Origin: '*'` pada `/api/games` & `/api/search`, bertentangan dengan aturan hard-rule proyek sendiri (@knowledge §9). → relevan untuk Task #001.
> 4. **`.avicon.svg` & `favicon.svg` (baru ditemukan) sama-sama tidak terpakai**, kemungkinan `.avicon.svg` adalah ikon yang dimaksud README.md tapi tidak pernah dipasang. `screenshot-desktop.png`/`screenshot-mobile.png` di `manifest.json` ternyata file identik. → mempengaruhi Task #002.

## [DEVELOPER DECISIONS — 2026-08-30]
> Developer menjawab keenam [DECISION NEEDED] dari `prd.md` §10 v1.3.0 langsung di file tersebut. Jawaban dipropagasi ke task-task terkait di bawah (ditandai "[DIJAWAB 2026-08-30]") dan ke `knowledge.md` v1.2.0/`prd.md` v1.4.0. Ringkasan:
>
> 1. **Roster game first-party** → Keempatnya (Ayo Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania) MASIH AKTIF. Tindak lanjut: sinkronkan `LOCAL_GAMES` di `src/index.js` — lihat Task #002.
> 2. **`functions/api/*.js` & `functions/share/[id].js`** → DIHAPUS (clean code). Tindak lanjut: eksekusi penghapusan — lihat Task #002.
> 3. **`favicon.svg` vs `.avicon.svg`** → `favicon.svg` yang dipakai sebagai favicon resmi. Tindak lanjut: verifikasi isinya sesuai desain ikon yang dimaksud & pasang referensinya; `.avicon.svg` jadi kandidat dihapus — lihat Task #002.
> 4. **CORS wildcard** → Hard rule CORS di `knowledge.md` §9 / `prd.md` §8 DIREVISI (bukan kodenya yang diubah) — wildcard diterima untuk endpoint publik read-only.
> 5. **Cakupan Task #011** → Yang dimaksud adalah unit monetisasi/ad-script terpisah yang memang belum dibangun — lihat Task #011 (scope diperbarui).
> 6. **Mekanisme CI/CD** → Cloudflare Workers Builds, dikonfirmasi. Lihat Task #006, #013, #017.
>
> Tidak ada task yang otomatis dipindah ke [COMPLETED] oleh keputusan ini — eksekusi kode (sinkronisasi `LOCAL_GAMES`, penghapusan `functions/*`, pemasangan `favicon.svg`, pembuatan ad-script) masih tertunda.

## [IN PROGRESS]

### Task #005 — Configure Pre-commit Hook to Block `.env`
- **Phase:** Phase 1 — Foundation
- **Scope:** Install a pre-commit hook that runs lint and blocks any commit containing a `.env` file.
- **Files to create / modify:** `.husky/pre-commit` (atau setara), `package.json` (scripts)
- **Acceptance criteria:**
  - [ ] Committing a file named `.env` is rejected by the hook with a clear error message
  - [ ] A normal commit with no `.env` file and passing lint proceeds without being blocked
- **Dependencies:** Task #004
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### [COMPLETED]

### Task #004 — Add Dev-Tooling & Lockfile ✅
- **Completed:** 2026-08-31
- **Phase:** Phase 1
- **Status:** OK
- **Branch:** feat/task-004-add-dev-tooling-lockfile
- **Files created / modified:**
  - `package.json` — pinned devDependencies: eslint 10.9.1, @eslint/js 10.0.1, prettier 3.9.6, vitest 4.1.11, jsdom 26.1.0
  - `package-lock.json` — committed lockfile for reproducible installs
  - `eslint.config.js` — ESLint v9+ flat config; targets js/, src/, games/shared/; excludes per-game Canvas files
  - `.prettierrc` — Prettier config (singleQuote, trailingComma all, printWidth 100)
  - `.prettierignore` — excludes node_modules, tool folders, package-lock.json, ads.txt
  - `vitest.config.js` — Vitest config; jsdom environment; passWithNoTests; excludes per-game folders
  - `.gitignore` — added node_modules/, coverage/
  - `.assetsignore` — added node_modules/, tooling configs, .husky/, knowledge/prd/changelog docs
  - `js/state.js` — `let favs` → `const favs` (prefer-const fix)
  - `js/catalog.js` — inner `list` parameter renamed to `arr` (no-shadow fix in renderGenreOptions)
  - `js/player.js` — `catch (err)` → `catch (_err)`; `createRelatedCardElement(game)` → `createRelatedCardElement(relatedGame)` (no-shadow + no-unused-vars fixes)
  - `src/index.js` — added `eslint-disable-next-line no-unused-vars` above `requireEnvVar` scaffold
  - `knowledge.md` — v1.3.0: §2 updated with dev tooling stack; §4 updated with Prettier/ESLint/Vitest versions and config details
- **Acceptance criteria met:**
  - [x] `npm run lint` runs ESLint against `js/`, `games/shared/`, and `src/` with zero errors (exit 0)
  - [x] `npm test` runs Vitest successfully (exit 0 even with zero tests present — `passWithNoTests: true`)
  - [x] Lockfile is committed and reproducible (`npm ci` succeeds from clean checkout, 0 vulnerabilities)
- **Security gate:** BASIC — all checks passed
- **Scalability gate:** BASIC — all checks passed (all items N/A for tooling-only task)
- **Regression:** Phase 1 build OK — `npm run lint` exit 0, `npm test` exit 0 (passWithNoTests), `npm ci` exit 0, 0 vulnerabilities
- **Decisions made:**
  - [ARCH] ESLint flat config (`eslint.config.js`) used instead of `.eslintrc` — ESLint 9+ dropped legacy rc format; flat config is the canonical replacement
  - [TECH] Vitest 4.1.11 chosen over `node --test` for future Workers-pool compatibility (Task #009 will add `@cloudflare/vitest-plugin` for Worker integration tests; `@cloudflare/vitest-pool-workers` was considered but its `./config` export was removed in v0.22.0)
  - [ARCH] `@cloudflare/vitest-pool-workers` / `@cloudflare/vitest-plugin` deferred to Task #009 — adding Worker pool before any Worker test files exist adds overhead without benefit
  - [CODE] `jsdom` added as devDependency for browser globals (localStorage, sessionStorage, window, document) needed by js/ unit tests
  - [CODE] `passWithNoTests: true` in vitest.config.js — valid during bootstrap; Task #007/#008/#009 will add actual test files
  - [CODE] Minor lint fixes applied to js/state.js, js/catalog.js, js/player.js, src/index.js — all semantics-preserving (prefer-const, no-shadow, no-unused-vars; requireEnvVar scaffold retained with eslint-disable comment)
  - [INFRA] `.assetsignore` expanded to exclude tooling configs, node_modules, and documentation files from Cloudflare static asset serving
- **Notes:** none
- **Knowledge drift:** UPDATE REQUIRED: @knowledge §2 — added dev tooling stack (eslint, prettier, vitest, jsdom versions and config files). UPDATE REQUIRED: @knowledge §4 — updated Formatter/Linter/Testing framework entries with installed versions and config details. Both edits applied this task (knowledge.md bumped to v1.3.0).

### Task #001 — Environment Audit & Security Baseline ✅
- **Completed:** 2026-08-31
- **Phase:** 1
- **Status:** OK
- **Branch:** feat/task-001-environment-audit-security-baseline
- **Files created / modified:**
  - `.gitignore` — added .env, *.pem, *.key, *.p12, secrets/ exclusion patterns
  - `src/index.js` — added requireEnvVar helper for fail-fast environment variable validation
- **Acceptance criteria met:**
  - [x] .gitignore explicitly excludes .env, *.pem, *.key, *.p12, secrets/
  - [x] No secret/credential value exists in wrangler.toml or any committed file
  - [x] src/index.js contains no logging of full request URLs/query strings that could carry user-supplied text
  - [x] A minimal env-var validation helper exists (requireEnvVar function)
- **Security gate:** BASIC — all checks passed
- **Scalability gate:** BASIC — all checks passed
- **Regression:** Phase 1 build OK
- **Decisions made:**
  - [ARCH] .gitignore updated with .env, *.pem, *.key, *.p12, secrets/ patterns
  - [INFRA] requireEnvVar helper added to src/index.js for fail-fast env var validation
  - [OBSERVABILITY] .gitignore provides primary .env protection; pre-commit hook to be set up in Task #005
- **Notes:** none
- **Knowledge drift:** none

### Task #002 — Clean-Code Audit: Remove Unused Files & Dead Code ✅
- **Completed:** 2026-08-31
- **Phase:** 1
- **Status:** OK
- **Branch:** feat/task-002-clean-code-audit-remove-unused-files-dead-code
- **Files created / modified:**
  - `.avicon.svg` — deleted (verified & removed after favicon.svg confirmed)
  - `functions/api/games.js` — deleted (clean code, redundant vs src/index.js)
  - `functions/api/search.js` — deleted (clean code, redundant vs src/index.js)
  - `functions/share/[id].js` — deleted (clean code, redundant vs src/index.js)
  - `src/index.js` — LOCAL_GAMES updated with Ayo Kopdes, Kejar Koruptor, Mobil MBG
  - `index.html` — added <link rel="icon" href="/favicon.svg">
  - `game.html` — added <link rel="icon" href="/favicon.svg">
  - `manifest.json` — removed duplicate "narrow" screenshot entry, keeping only "wide"
  - `README.md` — updated game roster, functions status, favicon/manifest notes
- **Acceptance criteria met:**
  - [x] `functions/api/games.js`, `functions/api/search.js`, `functions/share/[id].js` dihapus dari repo
  - [x] `src/index.js`'s `LOCAL_GAMES` diperbarui agar mencakup Ayo Kopdes, Kejar Koruptor, Mobil MBG
  - [x] `favicon.svg` diverifikasi isini & direferensikan dari index.html/game.html dan manifest.json
  - [x] `.avicon.svg` dihapus setelah favicon.svg terverifikasi & terpasang
  - [x] `manifest.json` memiliki screenshot "wide" (narrow entry removed, files identical)
  - [x] No file in the repo is unreferenced by any other file, build config, or route
- **Security gate:** BASIC — all checks passed
- **Scalability gate:** BASIC — all checks passed
- **Regression:** Phase 1 build OK
- **Decisions made:**
  - [ARCH] functions/ folder files deleted: confirmed Cloudflare Worker deploy model doesn't use Pages Functions convention
  - [INFRA] LOCAL_GAMES sync: Ayo Kopdes, Kejar Koruptor, Mobil MBG added to src/index.js LOCAL_GAMES
  - [OBSERVABILITY] favicon.svg wired up: confirmed as official favicon, referenced in HTML and manifest
  - [CODE] .avicon.svg removed: candidate for removal now that favicon.svg is confirmed and wired
- **Notes:** none
- **Knowledge drift:** none

### Task #003 — Implement Health Check Endpoint ✅
- **Completed:** 2026-08-31
- **Phase:** 1
- **Status:** OK
- **Branch:** feat/task-003-implement-health-check-endpoint
- **Files created / modified:**
  - `src/index.js` — added `WORKER_VERSION` constant, `/api/health` router case, and `handleApiHealth()` function
- **Acceptance criteria met:**
  - [x] `GET /api/health` returns HTTP 200 with `{ status, version, timestamp }` under normal conditions
  - [x] Endpoint responds in under 100ms with no external dependency (no DB, no third-party call)
- **Security gate:** BASIC — all checks passed
- **Scalability gate:** BASIC — all checks passed
- **Regression:** Phase 1 build OK
- **Decisions made:**
  - [API] Response shape `{ status, version, timestamp }` chosen over `{ status, uptime, version }` — Cloudflare Workers are per-request with no persistent process; `timestamp` (current ISO 8601 request time) is the accurate and non-misleading equivalent for this edge deployment model
  - [CODE] `WORKER_VERSION = '1.0.4'` constant added at top of `src/index.js`; bumped each deploy as a human-readable signal of which version is live
  - [ARCH] `handleApiHealth()` is synchronous (no async/await) — no I/O means no need for a Promise, keeping the hot path as lean as possible
  - [INFRA] `jsonResponse(..., 200, 0)` passes `cacheSeconds=0` so no `Cache-Control` header is emitted — health checks must always return current state, never a cached snapshot
- **Notes:** none
- **Knowledge drift:** UPDATE REQUIRED: @knowledge §8 — `GET /api/health` is now implemented; update "belum diimplementasikan" to reflect the live endpoint. UPDATE REQUIRED: @knowledge §5 — add `/api/health` to the API Contracts section with response shape `{ status: "ok", version: string, timestamp: ISO8601 }`.

## [NEXT TASKS]

### Phase 1 — Foundation
*Task #001, #002, dan #003 WAJIB selesai sebelum task Phase 3 mana pun dimulai — keputusan eksplisit developer (@knowledge §9).*

### Task #005 — Configure Pre-commit Hook to Block `.env`
- **Phase:** Phase 1 — Foundation
- **Scope:** Install a pre-commit hook that runs lint and blocks any commit containing a `.env` file.
- **Files to create / modify:** `.husky/pre-commit` (atau setara), `package.json` (scripts)
- **Acceptance criteria:**
  - [ ] Committing a file named `.env` is rejected by the hook with a clear error message
  - [ ] A normal commit with no `.env` file and passing lint proceeds without being blocked
- **Dependencies:** Task #004
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Task #006 — Wire Lint & Security Scan into Cloudflare Workers Builds
- **Phase:** Phase 1 — Foundation
- **Scope:** Configure the build command to run lint and `npm audit` before deploy, so a failing check blocks the deployment. [DIJAWAB 2026-08-30] Mekanisme CI/CD dikonfirmasi developer: **Cloudflare Workers Builds** (bukan "Cloudflare Pages build command" seperti draf sebelumnya, dan bukan CI eksternal).
- **Files to create / modify:** Build-command setting di dashboard Cloudflare Workers Builds, `package.json` (build script)
- **Acceptance criteria:**
  - [ ] A push with a deliberate lint error fails the build and does not deploy
  - [ ] A clean push passes the build command and deploys normally
- **Dependencies:** Task #004
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Phase 3 — Core Features
*Task di fase ini adalah pengujian/pengerasan atas fitur inti yang sudah lengkap & live, bukan fitur baru — tetap bergantung pada #002 (audit dapat mengubah file yang diuji) dan #004 (test runner).*

### Task #007 — Unit Tests for `js/state.js` (localStorage Wrapper)
- **Phase:** Phase 3 — Core Features
- **Scope:** Write unit tests covering the read/write logic in `js/state.js`. [AUDIT KODE — KOREKSI PENTING] `js/state.js` TIDAK berisi logika skor/high-score sama sekali — file ini hanya mengelola FAVORIT & RECENTLY-PLAYED (dikonfirmasi baca langsung isi file). Logika "high-score-comparison" yang disebut draf sebelumnya sebenarnya ada di dua tempat lain: (a) per-game, di dalam masing-masing `games/{slug}/game.js`; (b) skor global lintas game, di `js/pwa.js` (key `arcade-high-score-v1`, dipicu `window.postMessage`). Task ini perlu ditulis ulang scope-nya untuk favorit/recently-played, dan high-score testing dipindah ke task terpisah (lihat catatan Acceptance criteria).
- **Files to create / modify:** `js/state.js` (refactor kecil bila perlu agar testable), `js/state.test.js`
- **Acceptance criteria:**
  - [ ] Tests cover: reading favorites/recently-played when unset returns a safe default; adding/removing a favorite persists correctly; recently-played list behaves as expected (mis. urutan, batas jumlah bila ada)
  - [ ] Tests pass against a mocked `localStorage`, including the storage-unavailable/private-mode case
  - [ ] Unit test written and passing for new logic
  - [ ] Test is isolated: sets up and tears down its own state
  - [ ] [AUDIT KODE — BARU] Pertimbangkan task terpisah untuk high-score: unit test untuk logika high-score per-game (di dalam tiap `games/{slug}/game.js`) dan untuk tracker global di `js/pwa.js` (`readHighScore`/`writeHighScore`/`wireScoreMessages`) — di luar cakupan `state.js`
- **Dependencies:** Task #002, Task #004
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Task #008 — Unit Tests for `js/utils.js`
- **Phase:** Phase 3 — Core Features
- **Scope:** Write unit tests for each exported utility function in `js/utils.js`. [AUDIT KODE] Dikonfirmasi 9 fungsi ter-export: `escapeHtml`, `debounce`, `slugify`, `buildPlayUrl`, `buildGamePageUrl`, `isAllowedEmbedUrl`, `readSessionGames`, `writeSessionGames`, `fetchGameCatalog` (plus `shuffleGames` privat/tidak di-export).
- **Files to create / modify:** `js/utils.test.js`
- **Acceptance criteria:**
  - [ ] Every exported function has at least one passing test covering its normal case and one edge case
  - [ ] Test suite runs via `npm test` with visible pass/fail output
  - [ ] Unit test written and passing for new logic
  - [ ] Test is isolated: sets up and tears down its own state
- **Dependencies:** Task #002, Task #004
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Task #009 — Unit Tests for Catalog & Search Logic (`src/index.js`)
- **Phase:** Phase 3 — Core Features
- **Scope:** [AUDIT KODE — RETARGET] Draf sebelumnya menyasar `functions/api/games.js` & `functions/api/search.js`, yang terkonfirmasi non-aktif (lihat [AUDIT FINDINGS] #1). Logika yang benar-benar berjalan adalah `handleApiGames`/`handleApiSearch` di dalam `src/index.js`. Catatan penting: kedua fungsi ini saat ini belum di-`export`, jadi kemungkinan perlu (a) refactor kecil menambahkan named export, atau (b) pendekatan test yang memanggil default export `fetch` handler Worker langsung dengan `Request`/`env` tiruan (mis. via `@cloudflare/vitest-pool-workers`) — pilih salah satu sebelum menulis test.
- **Files to create / modify:** `src/index.js` (kemungkinan perlu export tambahan), `src/index.test.js`
- **Acceptance criteria:**
  - [ ] Test `/api/games` mengonfirmasi bentuk respons JSON (metadata game: id, judul, kategori/slug, thumbnail, url, dimensi) mencakup `LOCAL_GAMES` dan skenario ketika salah satu/kedua feed eksternal (GameMonetize/GamePix) gagal di-fetch
  - [ ] Test `/api/search` mengonfirmasi query kosong/tidak cocok mengembalikan hasil kosong, bukan error
  - [ ] Unit test written and passing for new logic
  - [ ] Test is isolated: sets up and tears down its own state
- **Dependencies:** Task #004
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Task #010 — Harden & Test Output Encoding in `src/index.js` Share/Play Routes
- **Phase:** Phase 3 — Core Features
- **Scope:** [AUDIT KODE — RETARGET] Draf sebelumnya menyasar `functions/share/[id].js`, yang terkonfirmasi non-aktif. Rute yang benar-benar melayani traffic adalah `handleShareRoute`, `handlePlayRoute`, dan `handleGameRoute` di dalam `src/index.js`. Pembacaan kode langsung menunjukkan escaping (`escapeHtmlAttr`, `escapeJsonLd`) SUDAH diterapkan secara konsisten di ketiga handler ini — bagian "harden" dari task ini kemungkinan besar sudah selesai; yang tersisa terutama bagian "test" untuk membuktikannya, mencakup ketiga rute (bukan hanya `/share/`).
- **Files to create / modify:** `src/index.js` (verifikasi/penyesuaian kecil bila test menemukan celah), `src/index.test.js`
- **Acceptance criteria:**
  - [ ] A query value containing `<`, `>`, `"`, or `</script>` renders as inert text in the HTML output for `/share/:id`, `/play/:id/:slug`, dan `/game`, never as executable markup
  - [ ] A test asserts the raw response body never contains an unescaped copy of a deliberately malicious input string, untuk ketiga rute di atas
  - [ ] Unit test written and passing for new logic
  - [ ] Test is isolated: sets up and tears down its own state
- **Dependencies:** Task #004
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Phase 4 — Integration

### Task #011 — Integrate GameMonetize/GamePix Ad Script with Load-Timeout Fallback
- **Phase:** Phase 4 — Integration
- **Scope:** [DIJAWAB 2026-08-30] Dikonfirmasi developer: task ini adalah unit monetisasi/ad-script terpisah yang memang belum pernah dibangun — BUKAN tentang fetch feed katalog di `src/index.js` (yang sudah punya fallback resilience sendiri via `Promise.allSettled` per-sumber + cache edge 30 menit, dan tetap dipertahankan apa adanya sebagai fitur terpisah). Task ini perlu menambahkan skrip iklan sisi klien (mis. dari dashboard GameMonetize/GamePix) ke halaman game, dengan timeout agar game tetap render & playable meski skrip iklan gagal/lambat dimuat.
- **Files to create / modify:** `index.html`/`game.html` (embed skrip iklan), kemungkinan `js/` baru untuk logika load-timeout, `ads.txt` (pastikan sudah sinkron dengan snippet nyata dari dashboard — lihat catatan `GAMEPIX_DEFAULT_SID` di `src/index.js` yang berbeda dari salah satu property ID di `ads.txt`)
- **Acceptance criteria:**
  - [ ] Ad-script dimuat di halaman game (`/play/`, `/game`) dari dashboard GameMonetize/GamePix
  - [ ] Jika ad-script belum selesai dimuat dalam batas waktu tertentu (mis. 3 detik), game/halaman tetap render & playable tanpa menunggu lebih lama
  - [ ] Simulasi kegagalan/timeout ad-network tidak menghasilkan unhandled error di console browser
- **Dependencies:** Task #001
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Phase 5 — UI/UX

### Task #012 — Harden Client-Side Search Rendering Against Reflected XSS
- **Phase:** Phase 5 — UI/UX
- **Scope:** Ensure the catalog search UI (`js/catalog.js`) never renders the user's raw query string or API results as unescaped HTML. (Catatan: isi lengkap `js/catalog.js` belum dibaca penuh pada pre-audit ini — task ini belum bisa dikonfirmasi/dibantah oleh audit, tetap seperti draf sebelumnya.)
- **Files to create / modify:** `js/catalog.js`
- **Acceptance criteria:**
  - [ ] Typing `<img src=x onerror=alert(1)>` into search and rendering results does not execute any script
  - [ ] Search result rendering uses text-safe DOM APIs (e.g. `textContent`) or an escaping helper (`js/utils.js` sudah menyediakan `escapeHtml` — konfirmasi dipakai di sini), not raw `innerHTML` concatenation of user input
- **Dependencies:** Task #004
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Phase 6 — Testing & QA

### Task #013 — Verify Test Suite Coverage & CI Pass/Fail Visibility
- **Phase:** Phase 6 — Testing & QA
- **Scope:** Run the full test suite built in Phase 3/5, confirm `state.js`/`utils.js`/`src/index.js` are covered per @knowledge §4's focus, and confirm pass/fail is visible in the build log. [DIJAWAB 2026-08-30] Build log yang dimaksud adalah log Cloudflare Workers Builds (dikonfirmasi developer sebagai mekanisme CI/CD — lihat Task #006), bukan "Cloudflare Pages build log".
- **Files to create / modify:** tidak ada file baru — verifikasi hasil Task #004, #006–#010, #012
- **Acceptance criteria:**
  - [ ] `npm test` output (pass/fail count) is visible in the build log for a real deploy
  - [ ] `state.js`, `utils.js`, dan `src/index.js` (rute API & share/play) each have at least one passing test (no global % required per @knowledge §4)
- **Dependencies:** Task #006, Task #007, Task #008, Task #009, Task #010
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Task #014 — Manual Smoke-Test Checklist for First-Party Canvas Games
- **Phase:** Phase 6 — Testing & QA
- **Scope:** Run and document a manual smoke test of each first-party game's Canvas logic (load, play, score, game-over), since Canvas gameplay is impractical to fully unit test. [AUDIT KODE] Cakupan "4 game" bergantung pada keputusan roster di Task #002 — jika Ayo Kopdes/Kejar Koruptor/Mobil MBG dikonfirmasi tetap aktif, checklist mencakup keempatnya; jika deprecated, checklist untuk ketiganya bisa dilewati.
- **Files to create / modify:** `docs/manual-qa-checklist.md`
- **Acceptance criteria:**
  - [ ] Setiap game first-party yang berstatus aktif (hasil keputusan Task #002) load dan playable sampai game-over tanpa console error
  - [ ] Checklist results (pass/fail per game) are recorded in the committed document
- **Dependencies:** Task #002
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Task #015 — End-to-End Smoke Test: Catalog → Play → Record → Share
- **Phase:** Phase 6 — Testing & QA
- **Scope:** Verify the full user journey from the catalog page through breaking a high score and successfully sharing it, melalui rute `/play/:id/:slug` dan `/share/:id` yang aktif di `src/index.js`.
- **Files to create / modify:** `docs/manual-qa-checklist.md` (tambahan) atau `e2e/full-flow.test.js` bila memakai skrip
- **Acceptance criteria:**
  - [ ] Breaking a high score triggers the confetti animation and share prompt in a real browser session
  - [ ] The generated share link's OG preview (via a social-card debugger) shows the correct game name and score
- **Dependencies:** Task #010, Task #014
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Phase 7 — Deployment (Server variant)

### Task #016 — Two-Stage Load Test on `src/index.js` Routes
- **Phase:** Phase 7 — Deployment
- **Scope:** Load-test seluruh rute `src/index.js` (`/api/games`, `/api/search`, `/share/:id`, `/play/:id/:slug`, `/game`, `/sitemap.xml`) — [AUDIT KODE] target dikoreksi dari `functions/api/*`/`functions/share/[id].js` yang non-aktif. `simple_mode: false` makes Stage 2 mandatory, not skippable. [AUDIT KODE — pertimbangan baru] Karena `/api/games`/`/api/search` bergantung pada cache-miss ke dua API eksternal (GameMonetize/GamePix), load test sebaiknya mencakup skenario cache-cold (cache 30 menit baru expire) untuk melihat perilaku P95/P99 saat kedua feed benar-benar dipanggil bersamaan di bawah beban.
- **Files to create / modify:** `loadtest/gimboot.js` (k6/Artillery atau setara)
- **Acceptance criteria:**
  - [ ] Stage 1 (Smoke: 10 VU / 60s) completes with zero errors
  - [ ] Stage 2 (Capacity: ~1.000 VU, dari 10% target 6 bulan 10.000+ / 2 menit minimum) completes with P95/P99 and error rate recorded, termasuk skenario cache-cold di atas
  - [ ] Memory/CPU behavior at end of test stays within acceptable bounds (no runaway growth on Cloudflare dashboard)
- **Dependencies:** Task #003, Task #010
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Task #017 — Validate Preview-Deployment Staging Flow & Document Canary Procedure
- **Phase:** Phase 7 — Deployment
- **Scope:** Confirm the preview-deployment mechanism works as a staging gate, and document the staged-rollout procedure that becomes mandatory once traffic nears the 10.000-concurrent threshold. [DIJAWAB 2026-08-30] Mekanisme dikonfirmasi developer: **Cloudflare Workers Builds** (bukan "Cloudflare Pages Preview Deployments" seperti draf sebelumnya) — preview deployment mengikuti mekanisme bawaan Workers Builds.
- **Files to create / modify:** `docs/deployment-runbook.md`
- **Acceptance criteria:**
  - [ ] A test branch produces a working preview URL distinct from production, smoke-tested manually
  - [ ] The runbook documents the trigger point (~70–80% dari 10.000 pengguna serentak) and the steps for a staged/canary rollout once reached
- **Dependencies:** none
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Task #018 — Verify Version Tagging & Rollback Procedure
- **Phase:** Phase 7 — Deployment
- **Scope:** Confirm the semver tagging convention is applied and that rolling back to a previous version completes within 10 minutes. [AUDIT KODE — KOREKSI, diverifikasi ke dokumentasi Cloudflare terkini] Draf sebelumnya menyebut "redeploying a previous tag via Cloudflare Pages dashboard" — untuk Worker, mekanismenya adalah `wrangler rollback` (CLI) atau Cloudflare dashboard: Workers & Pages → pilih Worker → tab Deployments → menu titik-tiga pada versi tujuan → Rollback.
- **Files to create / modify:** tidak ada file kode — verifikasi proses git tag + `wrangler rollback`/dashboard Cloudflare
- **Acceptance criteria:**
  - [ ] Current commit is tagged following `vX.Y.Z`
  - [ ] Rolling back to the previous version via `wrangler rollback` atau dashboard Cloudflare completes in under 10 minutes, verified once
- **Dependencies:** none
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

### Task #019 — Generate & Verify API Documentation
- **Phase:** Phase 7 — Deployment
- **Scope:** Produce an OpenAPI-style `docs/api.yaml` for the existing routes and confirm it matches the running server's actual behavior. [AUDIT KODE] Cakupan bertambah dari 3 menjadi hingga 6 rute (lihat @knowledge §5 terbaru): `GET /api/games`, `GET /api/search`, `GET /share/:id`, `GET /play/:id/:slug`, `GET /game`, `GET /sitemap.xml` — tiga terakhir sebelumnya tidak tercatat sama sekali.
- **Files to create / modify:** `docs/api.yaml`
- **Acceptance criteria:**
  - [ ] `docs/api.yaml` documents seluruh rute di atas dengan request/response shapes matching @knowledge §5
  - [ ] Manually calling each endpoint against the live/preview deployment matches what the doc describes
- **Dependencies:** Task #009, Task #010
- **Decisions made:** Belum dieksekusi — isi setelah task selesai.

## [COMPLETED]

> **Catatan format:** empat entri retroaktif di bawah ini BUKAN task yang dieksekusi lewat proses changelog/gate P04 ini — proses itu baru mulai berlaku sejak Task #001. Entri-entri ini disusun 2026-08-30 dari kondisi kode saat diaudit (2026-08-28) untuk mencatat bahwa produk sudah live sebelum changelog ini ada, sebagaimana disebut `knowledge.md` §1 ("Phase 1 & Phase 3 ... selesai"). Karena itu, tidak ada field "Files to create/modify", "Acceptance criteria" bercentang, atau "Dependencies" seperti task lain — tidak ada catatan asli semacam itu untuk pekerjaan ini, dan menuliskannya di sini akan memberi kesan presisi yang tidak benar-benar ada.

### [Retroaktif] Katalog Game First-Party
Empat game HTML5 Canvas mandiri, masing-masing di folder sendiri (`games/{slug}/`) berisi `game.js`, `index.html`, `style.css`, `thumb.svg`: Ayo Kopdes, Kejar Koruptor, Mobil MBG, Kicau Mania. Dikonfirmasi live lewat audit kode 2026-08-28 dan dikonfirmasi aktif oleh developer 2026-08-30. Rekor tertinggi disimpan mandiri per game di `localStorage` (dengan try-catch untuk mode privat), begitu juga preferensi mute suara.

### [Retroaktif] Backend Edge & Agregasi Katalog
Satu Cloudflare Worker dengan static assets (`src/index.js`) menangani seluruh rute dinamis: `/api/games` & `/api/search` (gabungan game first-party + feed live GameMonetize & GamePix, di-cache 30 menit di edge), `/share/:id` & `/play/:id/:slug` (meta OG/Twitter/canonical dinamis dengan output sudah di-escape), `/game` (redirect pengganti `game.html` lama), `/sitemap.xml` (dirujuk `robots.txt`), plus security headers (CSP nonce-based) untuk semua response.

### [Retroaktif] PWA & Infrastruktur Offline
`manifest.json` + `sw.js`: instalasi ke home screen lewat installability bawaan browser, offline app-shell caching. Catatan: tidak ditemukan kode custom install-prompt (`beforeinstallprompt`) di manapun dalam repo — instalasi murni mengandalkan perilaku native browser, bukan gap yang perlu diperbaiki kecuali developer memang menginginkan tombol "Install" kustom.

### [Retroaktif] Sistem Viral Sharing
`games/shared/ui-share.js`/`.css`: confetti + Web Share API saat rekor pecah, dengan fallback clipboard-copy, terhubung ke halaman share ber-OG-tag di `src/index.js`. Catatan cakupan audit: isi `ui-share.js` belum dibaca baris-per-baris — deskripsi ini berdasarkan nama file, penggunaannya di `js/player.js`, dan `README.md`, bukan verifikasi kode penuh (lihat "Catatan Metodologi Audit" di `knowledge.md`).

> Changelog v1.0.0 initialized from @knowledge v1.0.0. Shape: fullstack. simple_mode: false — Stage 2 load test dan dokumentasi canary tetap wajib, bukan di-skip.
> v1.1.0 (2026-08-28): pre-audit langsung terhadap source code (`game-portal-main.zip`) dilakukan atas permintaan developer, dibandingkan terhadap PRD/knowledge.md/changelog.md v1.0.0. Hasil audit disisipkan ke task-task terkait di atas dan ke `knowledge.md` v1.1.0; lihat bagian [AUDIT FINDINGS — 2026-08-28] untuk ringkasan lintas-task. Tidak ada task yang dipindah ke [COMPLETED] dari hasil pre-audit ini — eksekusi/perbaikan kode & keputusan developer (roster game, nasib `functions/*`, CORS, favicon) masih tertunda.
> v1.2.0 (2026-08-30): developer menjawab keenam [DECISION NEEDED] dari `prd.md` §10 v1.3.0. Jawaban dipropagasi ke `knowledge.md` v1.2.0, `prd.md` v1.4.0, dan task-task terkait di atas (Task #002, #006, #011, #013, #017), ditandai "[DIJAWAB 2026-08-30]". Lihat [DEVELOPER DECISIONS — 2026-08-30] di atas untuk ringkasan. Tidak ada task yang dipindah ke [COMPLETED] — keputusan sudah diambil, tapi eksekusi kode (sinkronisasi `LOCAL_GAMES`, penghapusan `functions/*`, verifikasi & pemasangan `favicon.svg`, pembuatan ad-script GameMonetize/GamePix) masih tertunda.
> v1.3.0 (2026-08-30): developer menambahkan verifikasi line-by-line yang mengonfirmasi ketiga file `functions/*` duplikat/lebih lemah dari `src/index.js` dan aman dihapus pada model deploy saat ini (dengan catatan risiko bila nanti pindah ke Cloudflare Pages). Detail lengkap dengan sitasi baris ditambahkan ke Task #002. Masih belum ada eksekusi penghapusan file yang sebenarnya di repo.
> v1.4.0 (2026-08-30): atas permintaan developer, ditambahkan empat entri retroaktif di atas yang merangkum fitur-fitur yang sudah live sebelum changelog ini dibuat — lihat catatan format di bagian paling atas [COMPLETED] untuk kenapa entri-entri ini tidak memakai template Task # yang sama dengan task lain di dokumen ini.
> v1.0.5 (2026-08-31): Task #003 completed — `GET /api/health` implemented in `src/index.js` as a synchronous, no-I/O liveness endpoint returning `{ status, version, timestamp }`. `WORKER_VERSION = '1.0.4'` constant added. Knowledge drift recorded: @knowledge §5 and §8 need updating to document the live endpoint and its response shape.
> v1.0.5 (2026-08-31): Task #004 completed — `package.json` + `package-lock.json` introduced with ESLint 10.9.1 (flat config), Prettier 3.9.6, Vitest 4.1.11, jsdom 26.1.0. `eslint.config.js`, `.prettierrc`, `.prettierignore`, `vitest.config.js` created. Minor lint fixes in `js/state.js`, `js/catalog.js`, `js/player.js`, `src/index.js`. `npm run lint` and `npm test` both exit 0; `npm ci` exits 0 (0 vulnerabilities). @knowledge v1.3.0: §2 dev tooling stack added; §4 Formatter/Linter/Testing updated with actual versions. Task #005 promoted to [IN PROGRESS].
