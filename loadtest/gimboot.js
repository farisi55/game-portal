// ==========================================================================
// loadtest/gimboot.js — k6 load-test scenarios for the Gimboot Worker
// (src/index.js). Task #016, Phase 7 (Deployment).
//
// Stages (selected with -e STAGE=...):
//   smoke    — 10 VU / 60s    — Stage 1 gate: zero errors expected
//   capacity — 1000 VU / 120s — Stage 2 gate: P95/P99 + error rate recorded
//                                (1.000 VU = 10% of the 6-month target of
//                                10.000+ concurrent users, per @knowledge §1)
//   cold     — 40 VU / 15s    — Stage 2b: cache-cold herd. run.mjs boots a
//                                FRESH worker (no warm-up) and every VU fires
//                                immediately, so the run opens as a genuine
//                                thundering herd — every request misses the
//                                30-minute catalog cache and triggers the
//                                GameMonetize + GamePix upstream fetches
//                                concurrently. Latency of that window is
//                                captured separately as
//                                `cold_cache_window_duration` (first 6s).
//
// Routes under test — every dynamic route in src/index.js:
//   /api/games, /api/search, /share/:id, /play/:id/:slug, /game, /sitemap.xml
// /api/health is deliberately NOT load-tested: it does no I/O by design and is
// used by loadtest/run.mjs as the pre-stage readiness probe instead.
//
// Simulated client IP: every VU sends a unique CF-Connecting-IP (RFC1918
// 10.x.x.x). The Worker enforces 100 requests/minute per IP (src/index.js
// RATE_LIMIT_MAX); a single-machine test without per-VU IPs would exhaust one
// bucket within a second and measure the 429 path instead of the routes. In
// production Cloudflare overwrites CF-Connecting-IP at the edge, so this
// simulation only works against a local dev server — which is exactly where
// this suite runs (see loadtest/README.md).
//
// Run directly (server must already be listening):
//   k6 run -e STAGE=smoke -e BASE_URL=http://127.0.0.1:8787 loadtest/gimboot.js
// Recommended — boots the Worker, warms the catalog cache, runs a stage, and
// writes the raw summary to loadtest/results/<stage>.txt:
//   node loadtest/run.mjs smoke|capacity|cold|all
// ==========================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const STAGE = (__ENV.STAGE || 'smoke').toLowerCase();
const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const COLD_WINDOW_MS = Number(__ENV.COLD_WINDOW_MS || 6000);
// Optional overrides for diagnostic runs (e.g. finding the concurrency knee):
//   k6 run -e STAGE=capacity -e VUS=100 -e DURATION=60s loadtest/gimboot.js
const VUS_OVERRIDE = Number(__ENV.VUS);
const DURATION_OVERRIDE = __ENV.DURATION;

const STAGE_CONFIG = {
  smoke: {
    vus: 10,
    duration: '60s',
    sleepMs: 1000,
    description: 'Stage 1 — smoke, 10 VU / 60s',
  },
  capacity: {
    vus: 1000,
    duration: '120s',
    // Think time of 70s = one dynamic-route request per concurrent user every
    // ~70s — what a portal player actually generates (long stretches of game
    // play happen inside iframes against STATIC assets, not our routes). The
    // attempt-1 run at 1000ms think time offered ~1000 rps against a measured
    // local-stack ceiling of ~19 rps and collapsed (32% errors, p50 34s);
    // see loadtest/results/capacity-attempt1-failed.txt.
    sleepMs: 70000,
    // Spread the VUs' initial requests over the think-time window so the run
    // starts as steady traffic instead of a 1000-request opening burst that
    // would queue behind the local ceiling for ~60s.
    desync: true,
    description: 'Stage 2 — capacity, 1000 VU / 120s / 70s think time',
  },
  cold: {
    vus: 40,
    duration: '15s',
    // No think time: every VU fires immediately so the run opens as a genuine
    // thundering herd against an EMPTY catalog cache (run.mjs boots a fresh
    // Worker with no warm-up). Upstream feed fetches stay bounded to roughly
    // this herd size — after the first response repopulates the 30-minute
    // cache, the remaining iterations are cache hits.
    sleepMs: 0,
    description: 'Stage 2b — cache-cold herd, 40 VU / 15s, fresh boot',
  },
};

if (!STAGE_CONFIG[STAGE]) {
  throw new Error(
    `Unknown STAGE "${STAGE}" — expected one of: ${Object.keys(STAGE_CONFIG).join(', ')}`
  );
}

const cfg = STAGE_CONFIG[STAGE];
// Explicit SLEEP_MS env var wins; otherwise the stage's think-time default.
const SLEEP_MS = Number(__ENV.SLEEP_MS ?? cfg.sleepMs);
if (!Number.isFinite(SLEEP_MS) || SLEEP_MS < 0) {
  throw new Error(`Invalid SLEEP_MS "${__ENV.SLEEP_MS}" — must be a non-negative number`);
}

// weight = relative share of total requests (sums to 100). feedDependent
// routes call getCombinedGames() and are therefore the routes whose latency
// changes between warm-cache and cache-cold runs.
const ROUTES = [
  { name: 'api_games', path: '/api/games', kind: 'json', weight: 35, feedDependent: true },
  { name: 'api_search', path: '/api/search?q=racing', kind: 'json', weight: 15, feedDependent: true },
  { name: 'share', path: '/share/local-kicau-mania', kind: 'html', weight: 12, feedDependent: true },
  { name: 'play', path: '/play/local-kicau-mania/kicau-mania', kind: 'html', weight: 28, feedDependent: true },
  { name: 'game', path: '/game', kind: 'html', weight: 5, feedDependent: false },
  { name: 'sitemap', path: '/sitemap.xml', kind: 'xml', weight: 5, feedDependent: true },
];

// Per-route custom metrics so the end-of-test summary always carries an
// explicit p95/p99 per route (default k6 summaries only show overall trends).
const routeDuration = {};
const routeErrors = {};
for (const route of ROUTES) {
  routeDuration[route.name] = new Trend(`route_duration_${route.name}`, true);
  routeErrors[route.name] = new Rate(`route_errors_${route.name}`);
}
// Cache-cold window: only requests issued within COLD_WINDOW_MS of scenario
// start (before the catalog cache is repopulated) are recorded here.
const coldWindowDuration = new Trend('cold_cache_window_duration', true);
// Milliseconds elapsed when a request is ISSUED (trend is time-typed, so the
// value is recorded in ms). If the de-spread sleep worked, capacity
// percentiles span ~0–70s; if they pile up near 0, every VU fired at once
// and the run degenerated into an opening burst.
const issueOffset = new Trend('issue_offset_s', true);

// Response-status distribution — separates transport failures (timeout /
// connection reset), rate-limiter rejections, and upstream-driven 5xx, which
// the aggregate http_req_failed rate cannot tell apart.
const statusCounters = {
  timeout: new Counter('status_timeout'),
  s2xx: new Counter('status_2xx'),
  s3xx: new Counter('status_3xx'),
  rate_limited: new Counter('status_429'),
  s4xx_other: new Counter('status_4xx_other'),
  s5xx: new Counter('status_5xx'),
};

// Captured during VU init — every VU initializes within the first moments of
// the run, so this tracks scenario start closely enough for a 6s window.
const SCENARIO_START = Date.now();

// Per-VU first-iteration flag used by the de-sync logic in the default
// function (each VU owns its own JS runtime, so this never leaks across VUs).
let isFirstIteration = true;

export const options = {
  vus: Number.isFinite(VUS_OVERRIDE) && VUS_OVERRIDE > 0 ? VUS_OVERRIDE : cfg.vus,
  duration: DURATION_OVERRIDE || cfg.duration,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
  thresholds: {
    // Stage 1 must complete with zero errors; Stage 2/2b record the rate but
    // fail the run if more than 1% of requests error out.
    http_req_failed: [STAGE === 'smoke' ? 'rate===0' : 'rate<0.01'],
    checks: [STAGE === 'smoke' ? 'rate===1' : 'rate>0.99'],
  },
};

/**
 * Unique simulated client IP per VU (10.<vu/250>.<vu%250+1>.7) so each
 * virtual user lands in its own per-IP rate-limit bucket.
 * @param {number} vu - k6 virtual user id
 * @returns {string} RFC1918 private IPv4 address
 */
function simulatedClientIp(vu) {
  const secondOctet = Math.floor(vu / 250) % 254;
  const thirdOctet = (vu % 250) + 1;
  return `10.${secondOctet}.${thirdOctet}.7`;
}

/**
 * Weighted-random route picker; the cache-cold stage only picks routes that
 * actually depend on the upstream catalog cache.
 * @param {string} stage - active stage name
 * @returns {object} route descriptor from ROUTES
 */
function pickRoute(stage) {
  const pool = stage === 'cold' ? ROUTES.filter((r) => r.feedDependent) : ROUTES;
  let roll = Math.random() * pool.reduce((sum, r) => sum + r.weight, 0);
  for (const route of pool) {
    roll -= route.weight;
    if (roll <= 0) return route;
  }
  return pool[pool.length - 1];
}

/**
 * Content-type assertion per route kind — catches a 200 whose body is an
 * unexpected error document rather than the route's real payload.
 * @param {object} response - k6 response object
 * @param {string} kind - 'json' | 'html' | 'xml'
 * @returns {boolean} whether the response content-type matches the route
 */
function contentTypeMatches(response, kind) {
  const contentType = (response.headers['Content-Type'] || response.headers['content-type'] || '')
    .toLowerCase()
    .trim();
  if (kind === 'json') return contentType.includes('json');
  if (kind === 'xml') return contentType.includes('xml');
  return contentType.includes('text/html');
}

export default function () {
  // De-spread the opening burst: each VU sleeps a random slice of the think
  // time before its first request, so 1000 VUs start as steady traffic
  // instead of one 1000-request herd. k6 gives every VU its own JS runtime,
  // so this flag is per-VU across iterations.
  if (cfg.desync && isFirstIteration) {
    isFirstIteration = false;
    sleep((SLEEP_MS / 1000) * Math.random());
  }

  const route = pickRoute(STAGE);
  issueOffset.add(Date.now() - SCENARIO_START);
  const response = http.get(`${BASE_URL}${route.path}`, {
    headers: {
      'CF-Connecting-IP': simulatedClientIp(__VU),
      'User-Agent': 'GimbootLoadTest/1.0 (k6)',
      Accept: route.kind === 'xml' ? 'application/xml' : route.kind === 'json' ? 'application/json' : 'text/html',
    },
    tags: { name: route.name },
    timeout: '60s',
  });

  const isError = response.status === 0 || response.status >= 400;
  check(
    response,
    {
      [`${route.name} returns 200`]: (r) => r.status === 200,
      [`${route.name} content-type matches route`]: (r) => contentTypeMatches(r, route.kind),
      [`${route.name} body non-empty`]: (r) => r.body !== null && r.body.length > 0,
    },
    { route: route.name }
  );

  routeDuration[route.name].add(response.timings.duration);
  routeErrors[route.name].add(isError ? 1 : 0);
  recordStatus(response.status);

  if (STAGE === 'cold' && Date.now() - SCENARIO_START <= COLD_WINDOW_MS) {
    coldWindowDuration.add(response.timings.duration);
  }

  sleep(SLEEP_MS / 1000);
}

/**
 * Buckets a response status into the statusCounters metrics.
 * @param {number} status - HTTP status (0 = transport failure / timeout)
 */
function recordStatus(status) {
  if (status === 0) statusCounters.timeout.add(1);
  else if (status === 429) statusCounters.rate_limited.add(1);
  else if (status >= 500) statusCounters.s5xx.add(1);
  else if (status >= 400) statusCounters.s4xx_other.add(1);
  else if (status >= 300) statusCounters.s3xx.add(1);
  else statusCounters.s2xx.add(1);
}
