# Cadence — Deployment

Cadence deploys **separately from AI Admin**, on Vercel. AI Admin keeps its own deploy (root
`vercel.json`, `experimentalServices` → `frontend/` + `backend/`); nothing here touches it. The
invariant holds: dependencies flow one way (Cadence → AI Admin), so AI Admin deploys and runs
with Cadence absent. See [project_ai_manager_monorepo] memory / CLAUDE.md for the boundary rule.

> **INFRA-P2 (2026-07-20):** Report 06 §4.6 asked whether Cadence Vercel config was aspirational.
> It is **not** — both app configs exist and the web rewrite already points at a live API host.
> This doc is the source of truth; `docs/cadence/PLAN.md` §11 defers here for compute model.

## Live Vercel targets (config-as-code)

| Product                      | Vercel project role                  | Root Directory     | Config file                                                                       | Compute                                         |
| ---------------------------- | ------------------------------------ | ------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| **AI Admin** (monorepo root) | Combined frontend + backend Services | `./` (repo root)   | [`vercel.json`](../../vercel.json) (`experimentalServices`)                       | Vite SPA + long-running backend at `/_/backend` |
| **cadence-web**              | Static SPA (+ `/api` rewrite)        | `apps/cadence-web` | [`apps/cadence-web/vercel.json`](../../apps/cadence-web/vercel.json)              | Vite static                                     |
| **cadence-api**              | Long-running Express Service         | `apps/cadence-api` | [`apps/cadence-api/vercel.json`](../../apps/cadence-api/vercel.json) (`services`) | Express Service (not classic serverless)        |

**cadence-web → API rewrite (checked into config):** `/api/:path*` →
`https://ai-manager-cadence-api-2f4j.vercel.app/:path*` (update this host in
`apps/cadence-web/vercel.json` if the API project domain changes).

**Do not** put Cadence into the repo-root `experimentalServices` block — new Vercel projects
reject that key, and AI Admin already owns the root project.

## Two pieces, and why they differ

| Piece           | What                                                                            | Build/run context                                                                                                   |
| --------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **cadence-web** | React/Vite PWA (static bundle)                                                  | `apps/cadence-web` (workspace install from repo root)                                                               |
| **cadence-api** | Node/Express server; embeds the AI Admin engine in-process via `@ai-admin/core` | **repo root** — it imports `backend/src/*` + `packages/*`, so the whole monorepo must be present at build & runtime |

That asymmetry is the whole story: the web app is an ordinary static SPA, but the API is a
long-running Node server that carries the AI Admin engine with it **and streams SSE** for coach chat.

## cadence-web (config ready)

Config: `apps/cadence-web/vercel.json`. Create a Vercel **project**:

- **Root Directory:** `apps/cadence-web`. Keep _"Include files outside the root directory"_ ON so
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

## cadence-api (decided: Vercel Services, its own project)

cadence-api runs as a **long-running Vercel Service** (not a classic serverless function) — the same
compute model AI Admin's backend uses. That matters because serverless would break it three ways:
(a) it holds a `postgres.js` connection pool (serverless instances exhaust DB connections); (b) it
streams SSE for coach chat (a function's `maxDuration` caps the stream); (c) it cold-loads the whole
embedded AI Admin engine. A long-running Service keeps the pool warm, the stream open, and the engine
resident.

**Topology — two Vercel projects, each rooted in its own app folder.** AI Admin's
`experimentalServices` manifest already owns the repo-root `vercel.json`, and Vercel reads one
config per project Root Directory — so rather than fight that collision with a shared multi-service
manifest, Cadence deploys as two single-purpose projects. Same Services mechanism, genuinely
separate, no root-config contention.

**Vercel project: `cadence-api`**

- **Root Directory:** `apps/cadence-api`. Config: `apps/cadence-api/vercel.json` (new `services`
  key — required for new Vercel projects; do **not** rely on the repo-root
  `experimentalServices` manifest, which AI Admin owns and new projects reject).
- Install from the monorepo root (`npm install --prefix ../..` in that vercel.json) so
  `@ai-admin/core`, `@cadence/shared`, and `backend/` resolve. The in-process engine imports
  `../../../backend/src/*`.
- **Product mode:** Services / Express. Start command is the package's `npm start`
  (`node --import tsx src/index.ts`) — there is no separate build step.
- Serves routes at the domain root (`/coach`, `/plan`, `/progress`, `/me`, …), so unlike AI Admin's
  `/_/backend` service it needs **no** prefix-stripping middleware.

**Web → API wiring.** The browser calls `/api/...` and the dev Vite proxy strips `/api` before
hitting cadence-api (which serves at `/`). Reproduce that in prod with a rewrite in
`apps/cadence-web/vercel.json`, added once the API domain exists, **above** the SPA rewrite:

```json
{ "source": "/api/:path*", "destination": "https://<cadence-api-domain>/:path*" }
```

Same-origin from the browser → no CORS, and keep `VITE_CADENCE_API_BASE=/api`. (Alternative: point
`VITE_CADENCE_API_BASE` at the absolute API URL and add CORS to cadence-api — the rewrite is cleaner
and matches dev.)

> **Services note:** New Vercel projects require the stable `services` key (see
> `apps/cadence-api/vercel.json`). The root `experimentalServices` block is AI Admin–only and will
> error if a Cadence project accidentally uses Root Directory `./`.

**Env (server-side — real secrets; set in the host's env, never committed):**
`CADENCE_SUPABASE_SERVICE_ROLE_KEY`, `CADENCE_DB_PASSWORD` (or `CADENCE_DATABASE_URL`),
`AIM_WORKSPACE_ID` + the `AIM_*` profile/job ids, and the AI Admin engine secrets
(`AI_MANAGER_SUPABASE_*`, `CREDENTIAL_ENCRYPTION_KEY`, `DEVS_AI_*`) that today live in
`backend/.env`. Leave `CADENCE_DEV_USER_ID` **unset in production** so no dev-account bypass ships.

**Open Food Facts (Req 5 Phase 3):** the **browser** calls OFF product-by-barcode directly
(`GET …/api/v3/product/{barcode}` with `X-User-Agent: Cadence/1.0 (…)`) and POSTs the mapped food to
cadence-api (`/nutrition/foods/import-off`) for shared cache. Do **not** proxy OFF through cadence-api
(one egress IP → shared ban risk). Prefer DB cache (`GET /nutrition/foods/by-off/:offId`) before OFF.
Before production volume: fill the [OFF API usage form](https://openfoodfacts.org/api) and keep a real
contact in the User-Agent. Attribution: product data © Open Food Facts contributors — **ODbL**.
No OFF API key / secret is required; never put OFF credentials in `VITE_*`.

**USDA FoodData Central (Req 5 Phase 3):** set `USDA_API_KEY` on the **cadence-api** host only
(`apps/cadence-api/.env` locally; Vercel env for the cadence-api project — never the web project,
never `VITE_*`). Free key via [api.data.gov](https://api.data.gov/signup/). The API caches every
successful FDC lookup into `cadence.foods` (`source='usda'`, `fdc_id`) so repeat traffic hits the
DB; on 429 the server backs off and does not stampede. Without the key, local food search/resolve
still work; USDA enrich is skipped with a polite 503 on the explicit USDA routes.

## Notes

- Vercel deploys from the connected branch (usually `main`). `feat/cadence` must merge to `main`
  before a production deploy tracks it.
- Cadence's data is the `cadence` schema in the shared Supabase project (reused from Spartan
  Tracker); migrations in `migrations/cadence/` apply via `apps/cadence-api/scripts/apply-migration-*.ts`
  today. Consolidation plan (Supabase CLI, retire one-offs): [`docs/infra/MIGRATION-TOOLING.md`](../infra/MIGRATION-TOOLING.md).
- Config-as-code drift (scheduled dry-run, no PR secrets): [`docs/infra/CONFIG-DRIFT.md`](../infra/CONFIG-DRIFT.md).
