# Cadence — Deployment

Cadence deploys **separately from AI Admin**, on Vercel. AI Admin keeps its own deploy (root
`vercel.json`, `experimentalServices` → `frontend/` + `backend/`); nothing here touches it. The
invariant holds: dependencies flow one way (Cadence → AI Admin), so AI Admin deploys and runs
with Cadence absent. See [project_ai_manager_monorepo] memory / CLAUDE.md for the boundary rule.

## Two pieces, and why they differ

| Piece | What | Build/run context |
|---|---|---|
| **cadence-web** | React/Vite PWA (static bundle) | `apps/cadence-web` (workspace install from repo root) |
| **cadence-api** | Node/Express server; embeds the AI Admin engine in-process via `@ai-admin/core` | **repo root** — it imports `backend/src/*` + `packages/*`, so the whole monorepo must be present at build & runtime |

That asymmetry is the whole story: the web app is an ordinary static SPA, but the API is a
long-running Node server that carries the AI Admin engine with it **and streams SSE** for coach chat.

## cadence-web (config ready)

Config: `apps/cadence-web/vercel.json`. Create a Vercel **project**:

- **Root Directory:** `apps/cadence-web`. Keep *"Include files outside the root directory"* ON so
  the workspace dep `@cadence/shared` resolves against the repo-root lockfile.
- Framework auto-detects as Vite → build `npm run build`, output `dist`. The SPA rewrite in the
  config sends non-asset, non-`/api` paths to `index.html`.
- **Env (build-time; client-public only — NEVER a server secret):**
  - `VITE_CADENCE_SUPABASE_URL`
  - `VITE_CADENCE_SUPABASE_ANON_KEY` (publishable key — safe client-side)
  - `VITE_CADENCE_API_BASE` — where the browser reaches the API. Two ways:
    - **Same-origin (recommended):** set `/api`, and add a rewrite to this vercel.json proxying
      `/api/:p*` → `https://<cadence-api-host>/:p*`. No CORS; the Supabase JWT rides same-origin.
    - **Cross-origin:** set the absolute API URL; then cadence-api must emit CORS headers for the
      web origin.

## cadence-api (hosting decision needed)

cadence-api fits Vercel's *classic serverless functions* poorly because it: (a) holds a
`postgres.js` connection pool (serverless instances exhaust DB connections); (b) streams SSE for
coach chat (a function's `maxDuration` caps the stream); (c) cold-loads the whole embedded AI Admin
engine. AI Admin's own backend sidesteps all three by running as a **long-running service**
(`experimentalServices`).

Options:

- **A — Vercel, mirror AI Admin (`experimentalServices`).** Same proven long-running mechanism; SSE
  and pooling behave. Snag to resolve: `experimentalServices` config lives at the repo root, which
  AI Admin's `vercel.json` already occupies — so a separate Cadence project needs a topology call
  (its own root config vs. a shared one).
- **B — a long-running Node host** (Railway / Render / Fly) for the API; cadence-web stays on
  Vercel. Cleanest fit for a streaming, pooled, engine-embedding server — "install the monorepo,
  run `apps/cadence-api`" is trivial. Cost: two platforms.
- **C — Vercel serverless-function wrapper** (`apps/cadence-api/api/index.ts` exporting the Express
  app). Standard Express-on-Vercel, but the pooling + SSE-duration caveats above apply; viable only
  if turns stay under the plan's `maxDuration` and the DB client is swapped for a serverless-
  friendly pooling mode.

**Env (server-side — real secrets; set in the host's env, never committed):**
`CADENCE_SUPABASE_SERVICE_ROLE_KEY`, `CADENCE_DB_PASSWORD` (or `CADENCE_DATABASE_URL`),
`AIM_WORKSPACE_ID` + the `AIM_*` profile/job ids, and the AI Admin engine secrets
(`AI_MANAGER_SUPABASE_*`, `CREDENTIAL_ENCRYPTION_KEY`, `DEVS_AI_*`) that today live in
`backend/.env`. Leave `CADENCE_DEV_USER_ID` **unset in production** so no dev-account bypass ships.

## Notes

- Vercel deploys from the connected branch (usually `main`). `feat/cadence` must merge to `main`
  before a production deploy tracks it.
- Cadence's data is the `cadence` schema in the shared Supabase project (reused from Spartan
  Tracker); migrations in `migrations/cadence/` apply via `apps/cadence-api/scripts/apply-migration-*.ts`.
