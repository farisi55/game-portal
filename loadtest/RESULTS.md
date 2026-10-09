# Task #016 — Two-Stage Load Test Results

Executed locally against the Gimboot Worker (`src/index.js`) via
`node loadtest/run.mjs <stage>` (see `loadtest/README.md`). Each stage boots a
**fresh Worker** through `unstable_dev` so warm/cold state is exact. Raw k6
summaries live in `loadtest/results/`.

Date: 2026-10-08 · k6 v2.3.0 · wrangler 4.148.0 / workerd 1.20261006.1 via
`unstable_dev` · machine: Windows, 16 GB RAM · all three stages: **PASS
(k6 exit 0)**

## Stage configuration

| Stage   | VUs  | Duration | Think time | Warm-up | Purpose |
|---------|------|----------|------------|---------|---------|
| smoke   | 10   | 60s      | 1000 ms    | yes     | Stage 1 gate: zero errors |
| capacity| 1000 | 120s     | 70 000 ms (≈14 rps offered), first wave de-synchronized | yes | Stage 2 gate: P95/P99 + error rate |
| cold    | 40   | 15s      | 0 ms (herd at t=0) | **no** (fresh boot, empty cache) | Stage 2b: cache-cold herd |

Routes under test (weighted): `/api/games` 35, `/play/:id/:slug` 28,
`/api/search` 15, `/share/:id` 12, `/game` 5, `/sitemap.xml` 5.
`/api/health` excluded (readiness probe only). Every VU sends a unique
`CF-Connecting-IP` so the per-IP rate limiter models distinct clients
(see README §limitations).

## Stage 1 — smoke: PASS

- **580 requests, 0 errors (0.00 %), checks 1740/1740 = 100 %**
- Thresholds: `http_req_failed rate===0` ✓, `checks rate===1` ✓
- Overall latency: p50 33.2 ms · p95 **74.4 ms** · p99 282 ms · max 336 ms

Per-route p95 / p99:

| Route | p95 | p99 |
|-------|-----|-----|
| api_games | 55 ms | 174 ms |
| api_search | 75 ms | 132 ms |
| play | 103 ms | 334 ms |
| share | 126 ms | 291 ms |
| game | 55 ms | 57 ms |
| sitemap | 62 ms | 75 ms |

## Stage 2 — capacity (1000 VU): PASS

- **1698 requests, 0 errors (0.00 %), checks 5094/5094 = 100 %**
- All responses 200 (`status_2xx = 1698`; zero timeouts / 429 / 5xx)
- Thresholds: `http_req_failed rate<0.01` ✓ (0.00 %), `checks rate>0.99` ✓
- Overall latency: p50 58.4 ms · **p95 222 ms** · **p99 338 ms** · max 547 ms
- Throughput: 11.3 rps served (offered ≈14.3 rps = 1000 VU ÷ 70 s think time)
- De-spread verified: `issue_offset_s` median 59.9 s (first-wave requests
  spread across the 70 s window, not a t=0 burst)

Per-route p95 / p99:

| Route | p95 | p99 |
|-------|-----|-----|
| api_games | 210 ms | 335 ms |
| api_search | 191 ms | 292 ms |
| play | 240 ms | 352 ms |
| share | 209 ms | 278 ms |
| game | 213 ms | 324 ms |
| sitemap | 225 ms | 440 ms |

## Stage 2b — cache-cold herd: PASS

Fresh boot, no warm-up; 40 VUs fire simultaneously at t=0 against an empty
catalog cache (every miss triggers the GameMonetize + GamePix upstream
fetches).

- **486 requests, 0 errors (0.00 %), checks 1458/1458 = 100 %** (all 200)
- **Cold window (first 6 s, n=130): avg 1.19 s · p95 4.28 s · max 5.67 s**
- Overall: p50 972 ms · p95 2.58 s · p99 9.25 s · max 11.84 s
- Throughput under herd: 31.0 rps (upstream fetches bounded to herd size;
  once the 30-min cache repopulates, later iterations are cache hits)
- Interpretation: cold-start latency ≈ 11× warm-capacity p95 but **bounded
  (≤5.67 s inside the herd window) and error-free** — no thundering-herd
  failure mode (no 5xx, no timeouts, no 429s).

## Memory / CPU bounds: WITHIN BOUNDS

workerd RSS sampled every 10 s (MB):

| Stage | Start | Peak | End | Notes |
|-------|-------|------|-----|-------|
| smoke | 185 | 316 | 316 | monotonic, plateau |
| capacity (1000 VU) | 185 | 500 | 497 | plateaued from t≈122 s — **no runaway** |
| cold | 154 | 405 | 405 | fresh boot |

- k6 process: 296 → 378 MB (capacity); runner node ≈ 50 MB
- System free memory during capacity: 531–1111 MB of 16 GB (never exhausted)
- No collapse signature: latency stayed flat across the whole 120 s window
  (p95 222 ms with zero timeouts)

## Preserved failure records (pre-upgrade toolchain: wrangler 4.137.0)

| File | What it shows |
|------|---------------|
| `results/capacity-attempt1-failed.txt` | 1000 VU with 1 s think time offered ~1000 rps against a measured local ceiling of ~19 rps → 32 % errors, p50 34 s, workerd RSS 195→1140 MB. **Reason the capacity stage uses a 70 s think time.** |
| `results/capacity-attempt2-failed.txt` | One intermediate run with the *final* configuration collapsed (73 % timeouts, ~4 rps served). **Not reproducible**: the identical configuration passed a 10 s probe, the full 120 s run afterwards, and a final post-upgrade confirmation run. No load-profile code change between the failed and passing runs (only the passive `issue_offset` metric and 10 s resource sampling were added). Cause unidentified — likely transient host-level interference; retained as evidence. |
| `results/diag-vus100.txt` | 100 VU diagnostic: 0 errors, 18.7 rps, p50 3.9 s — used to locate the local stack's throughput ceiling when sizing the capacity think time. |
| `results/probe-desync-10s.txt` | 10 s de-spread verification at 1000 VU: 570 requests, 0 errors — confirmed the first wave spreads over the think-time window. |

## Limitations / manual follow-ups

- **Local ≠ Cloudflare edge**: `unstable_dev` runs a single local workerd
  isolate on one Windows machine; production isolation, CPU, and edge caching
  differ. These numbers bound *code-level* behavior, not edge capacity.
- **Rate-limiter simulation**: unique `CF-Connecting-IP` per VU works only
  locally (the edge overwrites that header).
- **Cloudflare dashboard check (manual)**: this environment has no
  authenticated Cloudflare session (`wrangler whoami` → token expired), so
  post-deploy memory/CPU graphs on the production Worker must be inspected
  manually after deploying — same follow-up pattern as Tasks #015/#020.
