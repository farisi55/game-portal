# Load Test — Task #016 (Phase 7)

Two-stage load test for every dynamic route in `src/index.js`
(`/api/games`, `/api/search`, `/share/:id`, `/play/:id/:slug`, `/game`,
`/sitemap.xml`), plus a cache-cold scenario.

## Prerequisites

1. **k6** — <https://k6.io/docs/get-started/installation/>, e.g.:

   ```bash
   winget install k6          # Windows
   # or download k6-vX.Y.Z-windows-amd64.zip from the GitHub releases page
   # and point K6_BIN at the extracted k6.exe
   ```

2. **Node 20+** and `npm install` already run in this repo (wrangler is a
   devDependency — the Worker is booted with `unstable_dev`, the same API the
   Playwright E2E suite uses; the `wrangler dev` CLI is *not* used because its
   file watcher enters a rebuild loop in this environment).

3. Network access to the two upstream catalog feeds (GameMonetize, GamePix) —
   the cache-cold stage exercises them for real.

## Run

```bash
node loadtest/run.mjs smoke      # Stage 1:   10 VU / 60s   (zero errors required)
node loadtest/run.mjs capacity   # Stage 2:  1000 VU / 120s  (P95/P99 + error rate recorded)
node loadtest/run.mjs cold       # Stage 2b:  40 VU / 15s, fresh boot, empty cache
node loadtest/run.mjs all        # all three, in order
```

Each stage boots its **own** Worker instance, so warm stages start with a
warmed catalog cache and the cold stage starts with an empty one. Raw k6
summaries are written to `loadtest/results/<stage>.txt`; the curated numbers
live in `loadtest/RESULTS.md`.

Optional environment variables:

| Variable   | Default                      | Meaning                                    |
| ---------- | ---------------------------- | ------------------------------------------ |
| `K6_BIN`   | `k6` found on `PATH`         | path to the k6 executable                  |
| `SLEEP_MS` | per stage (1000/70000/0 ms)  | per-iteration think time (ms) for each VU  |
| `VUS`      | per stage (10/1000/40)       | VU-count override (diagnostics)            |
| `DURATION` | per stage (60s/120s/15s)     | duration override (diagnostics)            |

The capacity stage de-synchronizes each VU's *first* request over the full
think-time window (`issue_offset_s` in the summary proves the spread), so the
run starts as steady traffic instead of a 1000-request opening burst.

## What is measured

- `route_duration_<route>` — per-route latency trend (p95 / p99 in summary)
- `route_errors_<route>` — per-route error rate (status 0 or >= 400)
- `http_req_failed` / `checks` — thresholds: **0 failures for smoke**, <1% for
  capacity/cold
- `status_*` counters — response classes separated out (2xx / 3xx / 429 / other
  4xx / 5xx / timeout), so rate-limiter rejections and upstream failures are
  distinguishable from transport timeouts
- `issue_offset_s` — when each request was issued relative to scenario start
  (de-spread verification)
- `cold_cache_window_duration` — latency of requests issued in the first 6s of
  the cold stage, i.e. while the 30-minute catalog cache is still empty and the
  GameMonetize + GamePix feeds are being fetched concurrently
- `workerd RSS` before/after each stage plus a 10s-interval sample series
  (workerd, k6, system free memory) appended to `results/<stage>.txt`
  (sampled by `run.mjs`, Windows only)

## Simulated client IPs (why `CF-Connecting-IP` is set)

The Worker enforces 100 requests/minute **per IP** (`RATE_LIMIT_MAX` in
`src/index.js`). Without a per-VU IP every request from this machine would
share one bucket and the test would measure the 429 path instead of the routes.
Each VU therefore sends its own RFC1918 `CF-Connecting-IP` (10.x.x.x).
Production Cloudflare overwrites that header at the edge, so this simulation is
only valid against the local dev server — which is the target used here.

## Scope / limitations

- Target is a **local** `unstable_dev` instance running the real Worker code,
  not the production edge. Absolute latencies differ from production (edge
  cache API, anycast routing, CF-level rate limiting are not in the loop).
- The production dashboard check (memory/CPU growth of the deployed Worker
  under equivalent load) is a manual follow-up: it requires `wrangler login`
  and must be observed on a real deploy — see `loadtest/RESULTS.md`.
- `/api/health` is used as the readiness probe and is not load-tested: it does
  no I/O by design (Task #003).
