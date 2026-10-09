# Deployment Runbook — Staging Previews & Staged Rollout

- **Task:** #017 — Validate Preview-Deployment Staging Flow & Document Canary Procedure
- **Created:** 2026-10-09
- **Owner:** solo developer
- **Scope:** Cloudflare Workers deployment model only (Worker with static assets — see README "Deployment model", `wrangler.toml`)
- **Related:** `changelog.md` Task #006 (build command), Task #016 (load-test capacity baselines), Task #018 (rollback, upcoming), `docs/manual-qa-checklist.md`

## 1. Environments

| Environment | Trigger | URL | Notes |
| --- | --- | --- | --- |
| Production | push/merge to `main` (Workers Builds production branch) | `https://games.farisi55.workers.dev` | Serves all real traffic |
| Staging (preview) | any **non-`main`** branch: `npx wrangler preview` from the branch (or automatic preview builds when *Enable Preview Builds* is on) | `https://<version-prefix>-games.farisi55.workers.dev` (Preview URL) | Isolated deployment per branch/version, never receives production traffic |
| Local | `npx wrangler dev` | `http://localhost:8787` | Full Worker runtime locally |

Worker account facts (verified via Cloudflare API, 2026-10-09):

- Account subdomain: `farisi55` → production host `games.farisi55.workers.dev`
- `workers.dev` route for the Worker: **enabled**
- Worker **Preview URLs: enabled** (`previews_enabled: true`)
- Latest production deployment: version promoted by Workers Builds build on `main` (2026-09-24)

## 2. Preview-deployment mechanism (Cloudflare Workers Builds)

The staging gate is the **Cloudflare Workers Builds** preview mechanism (confirmed `[DIJAWAB 2026-08-30]` — not Pages Preview Deployments).

How it works:

1. The GitHub repository `farisi55/game-portal` is connected to Workers Builds.
2. **Branch control** (Cloudflare dashboard → Workers & Pages → `games` → Settings → Build → Branch control):
   - Production branch = `main` → build command `npm run build` → deploy command (promotes a new version to 100%).
   - **Enable Preview Builds** checkbox → builds for every branch that is not `main`. The non-production deploy command produces a **Preview URL** (`npx wrangler versions upload` model or `npx wrangler preview` Worker-Previews model, depending on project setup).
3. Every triggered build posts a **GitHub check run** named `Workers Builds: games` on the pushed commit (green check = build succeeded).
4. For pull requests, the GitHub integration can post the **Preview URL as a PR comment** (branch-stable and per-commit variants).
5. Preview URLs are version-scoped and serve the **latest deployment of that Preview**; they are never routed by production traffic.

Ways to obtain the Preview URL after a branch push:

- Cloudflare dashboard → Worker → Deployments/Previews section
- GitHub: check run `Workers Builds: games` → Details (build page), or the PR comment
- API: list Worker versions (`GET /accounts/{account_id}/workers/scripts/games/versions`) and read each version's `urls`
- CLI: `npx wrangler versions list` / `npx wrangler versions view <version-id>`

> Note: preview builds are gated by the **Enable Preview Builds** checkbox. If a pushed branch produces **no** `Workers Builds: games` check run, preview builds are disabled — enable them in Branch control before relying on this staging gate (see Validation log for the state observed on 2026-10-09).

## 3. Staging-gate procedure (use before any production deploy)

1. Create a branch from `dev` (naming: `feat/task-NNN-…` or `staging/…`). Never push feature work directly to `main`.
2. Push the branch: `git push -u origin <branch>`.
3. Ensure a Preview exists for the branch:
   - If the *Enable Preview Builds* checkbox is on: wait for the `Workers Builds: games` check run on the pushed commit to turn green and take the Preview URL from the check run / PR comment.
   - If no check run appears (preview builds off — state observed 2026-10-09): create it from the branch checkout:
     `npx wrangler preview` → prints `Preview URL: https://<branch>-games.farisi55.workers.dev`
4. Smoke-test the Preview URL manually:

   ```bash
   curl -s https://<preview-host>/api/health     # expect {"status":"ok",...}
   curl -s -o /dev/null -w "%{http_code}\n" https://<preview-host>/   # expect 200
   ```

5. Run the relevant subset of `docs/manual-qa-checklist.md` against the Preview URL (catalog → play → share path).
6. Only after the preview passes: merge to `dev`, then merge `dev` → `main` to release (production build deploys automatically).

Preview URLs are public. Do not put secrets or non-production-only data behind them; a Preview serves the same Worker code as production for the branch it represents.

## 4. Trigger point for staged rollout

PRD target: **10.000 concurrent users**. Staged/canary rollout becomes **mandatory when sustained traffic reaches ~70–80% of that target = 7.000–8.000 concurrent users** (or earlier if any error-budget signal fires).

Detection signals (any one triggers the procedure):

- Real-user concurrency (or requests/sec extrapolated from analytics) sustained ≥ 7.000 for 5 minutes
- Load-test re-run (`node loadtest/run.mjs capacity`, see `loadtest/RESULTS.md`) showing p95 approaching the agreed budget or the error rate leaving 0.00%
- Worker resource pressure (CPU/RSS plateau per Task #016 baseline: RSS plateaued ≈ 500 MB at 1.000 VU local test)

Below the trigger point, normal direct deploys (`wrangler deploy` / merge to `main`) remain acceptable.

## 5. Staged / canary rollout procedure

Once the trigger point is reached, every production release follows this sequence.

### 5.1 Prepare the version without deploying it

```bash
npx wrangler versions upload     # creates a new version, zero traffic change
npx wrangler versions list       # note the new Version ID
```

### 5.2 Canary: 10% of traffic

```bash
npx wrangler versions deploy <NEW_VERSION_ID>@10% <CURRENT_VERSION_ID>@90% -y
```

Observe for at least 5 minutes:

- `/api/health` on production returns `{"status":"ok"}`
- Error rate and p95 latency (dashboard Workers → Analytics / observability tooling) stay within the Task #016 baseline (capacity test: p95 ≈ 222 ms, error rate 0.00% under load)
- No new exceptions in logs (`npx wrangler tail games`)

### 5.3 Expand: 50% of traffic

```bash
npx wrangler versions deploy <NEW_VERSION_ID>@50% <CURRENT_VERSION_ID>@50% -y
```

Observe again (same signals, ≥ 5 minutes).

### 5.4 Complete: 100%

```bash
npx wrangler versions deploy <NEW_VERSION_ID>@100% -y
```

Post-rollout verification:

- `curl https://games.farisi55.workers.dev/api/health` → `status: ok`
- Homepage 200 + catalog/play/share smoke (manual-qa checklist subset)
- `npx wrangler deployments list` shows the intended deployment as active

### 5.5 Abort criteria & rollback

Abort (any of: elevated error rate vs baseline, failed health checks, visible regression) → immediately route 100% back to the previous version:

```bash
npx wrangler rollback <PREVIOUS_VERSION_ID>
```

Full rollback runbook: `changelog.md` Task #018 (upcoming — README "Rolling back a bad deploy" documents the current steps).

### Notes

- Each request is routed independently by percentage; use version affinity if a user must stay on one version during the canary window.
- Only the last 100 uploaded versions can be used in a deployment.
- Preview URLs never participate in production traffic-splitting; canary is a **production** mechanism performed with `wrangler versions deploy`.

## 6. Validation log (Task #017)

- **Date:** 2026-10-09
- **Test branch:** `feat/task-017-preview-staging-flow` (from `dev` @ `c104497`; content commit `6e09d6d` pushed twice)
- **Automated preview-build state:** after both pushes no `Workers Builds: games` check run appeared (observed over ~7 minutes) → **Enable Preview Builds is OFF** for this project (dashboard → Worker → Settings → Build → Branch control). Production builds on `main` are unaffected (last production check run: success, 2026-09-24). Until the checkbox is enabled, Section 3 step 3 uses the manual CLI path.
- **Preview created from the test branch:**

  ```text
  $ npx wrangler preview
  Preview: feat/task-017-preview-staging-flow (updated)
  Preview URL: https://feat-task-017-preview-staging-flow-games.farisi55.workers.dev
  Unique Deployment URL: https://2174b419-games.farisi55.workers.dev
  ```

  `wrangler preview` requires the `[previews]` block in `wrangler.toml` (added by this task; empty block, no production deploy behavior change).

- **Manual smoke results:**

| Check | Preview | Production |
| --- | --- | --- |
| `GET /` | 200 | 200 |
| `GET /api/health` | 200 `{"status":"ok","version":"1.0.4","timestamp":"2026-10-09T07:17:37.872Z"}` | 200 `{"status":"ok","version":"1.0.4",...}` |
| `GET /api/games?limit=1` | 200 | 200 |
| `GET /game.html` | 301 → `…/game` (host-relative) | 301 → `…/game` (host-relative) |
| `GET /` body sha256 | `feb8fb68…` (branch build) | `8a1d2d74…` (main build) — **distinct** |

- **Result: PASS** — the test branch produced a working preview URL distinct from production and was smoke-tested manually. Distinctness is proven by the separate hostname and the different served body: the preview serves the `dev`-based branch build (worker code newer than production, whose active deployment builds `main` @ `770e907`).
- **Follow-up (optional, dashboard):** enable *Enable Preview Builds* in Branch control so every non-`main` push builds automatically and posts the Preview URL (check run + PR comment); the manual `npx wrangler preview` path above remains valid either way.
