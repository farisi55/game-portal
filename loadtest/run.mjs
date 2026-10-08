#!/usr/bin/env node
// ==========================================================================
// loadtest/run.mjs — orchestrates Task #016's load-test stages against a
// locally booted Gimboot Worker (src/index.js via wrangler's unstable_dev).
//
// Why unstable_dev instead of `wrangler dev`:
//   The CLI dev server watches the project and, in this environment, enters a
//   rebuild loop (every reload rewrites .wrangler/tmp, which re-triggers the
//   watcher) that makes requests hang indefinitely. unstable_dev — the same
//   API the Playwright E2E suite (e2e/full-flow.test.js) already uses — boots
//   with file-watching disabled and serves requests normally.
//
// Stages (each invocation boots its own Worker so warm/cold state is exact):
//   smoke     boot → warm catalog cache → k6 10 VU / 60s   → results/smoke.txt
//   capacity  boot → warm catalog cache → k6 1000 VU / 120s → results/capacity.txt
//             (70s think time per VU ≈ 14 rps, de-synchronized first wave)
//   cold      boot (NO warm-up — cache is empty) → k6 40 VU / 15s herd → results/cold.txt
//   all       runs the three stages in order
//
// Usage:
//   node loadtest/run.mjs [smoke|capacity|cold|all]
// Env:
//   K6_BIN    path to the k6 binary (default: `k6` found on PATH)
//   SLEEP_MS  per-iteration think time passed through to k6 (default 1000)
//
// Exits non-zero if any stage's k6 thresholds fail (see loadtest/gimboot.js).
// ==========================================================================

import { execFileSync, execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { unstable_dev } = require('wrangler');

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS_DIR = join(REPO_ROOT, 'loadtest', 'results');
const K6_SCRIPT = join(REPO_ROOT, 'loadtest', 'gimboot.js');

const STAGE_ORDER = ['smoke', 'capacity', 'cold'];

/** Health payload must be ok before any stage starts (no cache touched). */
const READINESS_PATH = '/api/health';

/** Requests that populate the 30-minute catalog cache before warm stages. */
const WARMUP_PATHS = [
  '/api/games',
  '/api/search?q=racing',
  '/game',
  '/sitemap.xml',
  '/play/local-kicau-mania/kicau-mania',
  '/share/local-kicau-mania',
];

/**
 * Resolves the k6 binary: K6_BIN env var wins, otherwise PATH lookup.
 * @returns {string} absolute or PATH-resolvable k6 executable
 */
function resolveK6() {
  if (process.env.K6_BIN) return process.env.K6_BIN;
  try {
    const out =
      process.platform === 'win32'
        ? execSync('where k6', { encoding: 'utf8' })
        : execSync('command -v k6', { encoding: 'utf8' });
    const first = out.trim().split(/\r?\n/)[0];
    if (first) return first;
  } catch {
    // fall through to the error below
  }
  throw new Error(
    'k6 not found. Install it (see loadtest/README.md) or set K6_BIN=/path/to/k6'
  );
}

/**
 * Total working-set memory (MB) of all workerd processes, or null when the
 * platform has no PowerShell (measurement is Windows-only, per project env).
 * @returns {Promise<number|null>} memory in MB, rounded to 1 decimal
 */
async function workerdRssMb() {
  if (process.platform !== 'win32') return null;
  try {
    const script =
      "$m = Get-Process workerd -ErrorAction SilentlyContinue | " +
      'Measure-Object -Property WorkingSet64 -Sum; ' +
      'if ($m.Sum) { [math]::Round($m.Sum/1MB,1) }';
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
    }).trim();
    const value = Number.parseFloat(out);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Boots the Worker with file-watching disabled (see header comment).
 * @returns {Promise<object>} unstable_dev server handle
 */
async function bootWorker() {
  return unstable_dev('./src/index.js', {
    config: './wrangler.toml',
    localProtocol: 'http',
    persist: false,
    logLevel: 'error',
  });
}

/**
 * GET a path and assert the expected success status.
 * @param {string} baseUrl - e.g. http://127.0.0.1:8787
 * @param {string} path - request path
 * @returns {Promise<number>} HTTP status
 */
async function get(baseUrl, path) {
  const response = await fetch(baseUrl + path, {
    headers: { 'CF-Connecting-IP': `10.9.${Math.floor(Math.random() * 250) + 1}.7` },
  });
  return response.status;
}

/**
 * Readiness probe + optional catalog-cache warm-up before a k6 stage.
 * @param {string} baseUrl - local server origin
 * @param {boolean} warm - true for warm stages (populate catalog cache)
 */
async function prepare(baseUrl, warm) {
  const healthStatus = await get(baseUrl, READINESS_PATH);
  if (healthStatus !== 200) {
    throw new Error(`Readiness probe failed: GET ${READINESS_PATH} -> ${healthStatus}`);
  }
  if (!warm) return;
  for (const path of [...WARMUP_PATHS, '/api/games']) {
    const status = await get(baseUrl, path);
    if (status >= 400) {
      throw new Error(
        `Warm-up failed: GET ${path} -> ${status}. Is a third-party feed reachable?`
      );
    }
  }
}

/**
 * One-point resource snapshot: workerd RSS, k6 RSS, and free/total system
 * memory in MB. Returns null when PowerShell is unavailable.
 * @param {number|null} k6Pid - PID of the running k6 process (may be null)
 * @returns {Promise<string|null>} formatted sample line or null
 */
async function resourceSample(k6Pid) {
  if (process.platform !== 'win32') return null;
  try {
    const script =
      `$w=(Get-Process workerd -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum; ` +
      `$k=if (${k6Pid ?? 0}) { (Get-Process -Id ${k6Pid ?? 0} -ErrorAction SilentlyContinue).WorkingSet64 } else { 0 }; ` +
      `$o=Get-CimInstance Win32_OperatingSystem; ` +
      `"workerd=$([math]::Round($w/1MB)) k6=$([math]::Round($k/1MB)) sysFree=$([math]::Round($o.FreePhysicalMemory/1KB)) sysTotal=$([math]::Round($o.TotalVisibleMemorySize/1KB))"`;
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Runs one k6 stage, streaming output to the console and to
 * loadtest/results/<stage>.txt, sampling process/system memory every 10s.
 * @param {string} stage - stage name (smoke | capacity | cold)
 * @param {string} baseUrl - local server origin
 * @param {string} k6Bin - resolved k6 executable
 * @returns {Promise<number>} k6 exit code (0 = thresholds passed)
 */
function runK6(stage, baseUrl, k6Bin) {
  const args = ['run', '-e', `STAGE=${stage}`, '-e', `BASE_URL=${baseUrl}`];
  if (process.env.SLEEP_MS) args.push('-e', `SLEEP_MS=${process.env.SLEEP_MS}`);
  if (process.env.VUS) args.push('-e', `VUS=${process.env.VUS}`);
  if (process.env.DURATION) args.push('-e', `DURATION=${process.env.DURATION}`);
  args.push(K6_SCRIPT);

  return new Promise((resolvePromise) => {
    const chunks = [];
    const samples = [];
    let sampling = false;
    let sampleTimer = null;
    const child = spawn(k6Bin, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const t0 = Date.now();
    sampleTimer = setInterval(async () => {
      if (sampling) return; // skip a tick if the previous PowerShell call lags
      sampling = true;
      try {
        const snapshot = await resourceSample(child.pid);
        if (snapshot) {
          samples.push(`t=${Math.round((Date.now() - t0) / 1000)}s ${snapshot}`);
        }
      } finally {
        sampling = false;
      }
    }, 10_000);
    const capture = (data) => {
      chunks.push(data);
      process.stdout.write(data);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (err) => {
      clearInterval(sampleTimer);
      chunks.push(Buffer.from(`\n[k6 spawn failed] ${err.message}\n`));
      resolvePromise(1);
    });
    child.on('close', async (code) => {
      clearInterval(sampleTimer);
      if (samples.length > 0) {
        chunks.push(
          Buffer.from(`\n--- resource samples (every 10s) ---\n${samples.join('\n')}\n`)
        );
      }
      mkdirSync(RESULTS_DIR, { recursive: true });
      writeFileSync(join(RESULTS_DIR, `${stage}.txt`), Buffer.concat(chunks));
      resolvePromise(code === null ? 1 : code);
    });
  });
}

/**
 * Boots, prepares, measures, runs k6, and tears down one stage.
 * @param {string} stage - stage name
 * @param {string} k6Bin - resolved k6 executable
 * @returns {Promise<{stage: string, exitCode: number, rssBefore: number|null, rssAfter: number|null}>}
 */
async function runStage(stage, k6Bin) {
  const warm = stage !== 'cold'; // cold stage must start with an empty cache
  console.log(`\n=== [${stage}] booting worker (warm-up: ${warm ? 'yes' : 'NO — cache cold'}) ===`);
  const worker = await bootWorker();
  const baseUrl = `http://127.0.0.1:${worker.port}`;
  let rssBefore = null;
  let rssAfter = null;
  let exitCode = 1;
  try {
    await prepare(baseUrl, warm);
    rssBefore = await workerdRssMb();
    console.log(`=== [${stage}] k6 against ${baseUrl} (workerd RSS ${rssBefore ?? '?'} MB) ===`);
    exitCode = await runK6(stage, baseUrl, k6Bin);
    rssAfter = await workerdRssMb();
  } finally {
    await worker.stop();
  }
  console.log(
    `=== [${stage}] done — k6 exit ${exitCode}, workerd RSS ` +
      `${rssBefore ?? '?'} MB -> ${rssAfter ?? '?'} MB ===`
  );
  return { stage, exitCode, rssBefore, rssAfter };
}

const requested = (process.argv[2] || 'all').toLowerCase();
const stages = requested === 'all' ? STAGE_ORDER : [requested];
for (const stage of stages) {
  if (!STAGE_ORDER.includes(stage)) {
    console.error(`Unknown stage "${stage}" — expected one of: ${STAGE_ORDER.join(', ')}, all`);
    process.exit(2);
  }
}

const k6Bin = resolveK6();
console.log(`k6: ${k6Bin}`);
console.log(`stages: ${stages.join(', ')}`);

const results = [];
for (const stage of stages) {
  results.push(await runStage(stage, k6Bin));
}

console.log('\n=== summary ===');
for (const r of results) {
  console.log(
    `  ${r.stage.padEnd(9)} exit=${r.exitCode} workerd RSS ` +
      `${r.rssBefore ?? '?'} -> ${r.rssAfter ?? '?'} MB`
  );
}
process.exit(results.some((r) => r.exitCode !== 0) ? 1 : 0);
