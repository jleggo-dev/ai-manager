# AI Admin

Standalone AI administration tool for managing LLM providers, AI profiles, processing jobs, and diagnostics.

## Quick Start

```bash
cp backend/.env.example backend/.env
# Fill in your Supabase and Devs.ai credentials

npm install
npm run dev
```

Backend runs on `http://localhost:3001`, frontend on `http://localhost:5173`.

### Sign-in (Google only)

The admin UI uses **Supabase Auth with Google**. In the [Supabase dashboard](https://supabase.com/dashboard) for your project:

1. **Authentication → Providers → Google** — turn on and add your Google OAuth client ID and secret.
2. **Authentication → URL configuration** — add your site URL and redirect URLs, e.g. `http://localhost:5173` and `http://localhost:5173/` for local development, plus your production URL when deployed.

Disable or do not rely on email/password for this app; the UI only offers Google.

### Workspaces, roles, and `user_settings`

AI Admin SQL migrations live under `migrations/` starting at **`006_profiles_auth_approval.sql`**
through `012_…` (apply in order via the Supabase SQL editor today). Files `001`–`005` are
**missing from git** (historical gap — see [`docs/infra/MIGRATION-TOOLING.md`](docs/infra/MIGRATION-TOOLING.md));
do not look for `005_user_settings_display_name.sql` on disk. Fresh environments need a baseline
dump or an already-provisioned project until that reconstruction lands. Cadence migrations are
separate under `migrations/cadence/`.

**Workspace roles** live on `workspace_members.role` (not on `user_settings`):

| Role | Meaning |
|------|--------|
| `owner` | Full workspace control; use for billing / ultimate admin (enforce “at least one owner” in app logic if needed). |
| `admin` | Can manage providers, AI profiles, LLM models, settings, API keys, and diagnostic logs — plus everything `member` can do. |
| `member` | Can use AI features, manage processing jobs, workflows, and job groups. Cannot manage providers, profiles, or settings. |

API keys also carry a `role` (`owner`, `admin`, or `member`). The same RBAC rules apply. Use `member` for Lovable/external integrations (least privilege). The default role for new keys is `admin`.

Constants: `backend/src/constants/workspace-roles.ts` (`WORKSPACE_ROLES`, `WORKSPACE_ADMIN_ROLES`).

## Health Monitoring

AI Admin includes a built-in health monitoring system for your AI providers and embedded chat widgets.

- **API Health Checks** — Periodically send a test message to each AI model/agent and verify a valid response. Configurable cadence with faster probing during outages.
- **API Health Checks** — Continuously verify AI providers and profiles with scheduled probes, incident tracking, and uptime dashboards.
- **Incident Tracking** — Automatic outage detection with a state machine that opens an incident on first failure and resolves it on recovery. Tracks duration and failure counts.
- **Dashboard & Analytics** — Per-check health status (healthy / degraded / down / unknown), uptime heatmaps over 365 days, and failure pattern analysis grouped by error message and hour of day.

Health monitoring endpoints require `owner` or `admin` role. See [docs/CONCEPTS.md](./docs/CONCEPTS.md#health-monitoring) for the full domain model.

## Integrating other apps (Lovable, internal tools)

Teams can call the same HTTP API the admin UI uses. Use a **workspace API key** (`aim_sk_…`) from a **server-side** proxy or backend—do not put the key in a public frontend bundle.

In the app sidebar, open **Connect Lovable** for a step-by-step setup (downloadable Supabase function + copy-paste instructions).

Technical reference: **[docs/INTEGRATION.md](./docs/INTEGRATION.md)** (base URLs, auth, **ai-matcher**, processing jobs, chat SSE).

## Architecture

```
ai-admin/
├── api/index.js          # Legacy single-function Vercel entry (optional if using Services)
├── backend/              # Node.js + Express API (ESM)
├── frontend/             # React + Vite + Mantine UI
├── vercel.json           # experimentalServices: frontend + backend route prefixes
└── migrations/           # Database schema (Supabase SQL)
```

## Environment Variables

| Variable | Description |
|---|---|
| `AI_MANAGER_SUPABASE_URL` | Supabase project URL |
| `AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `CREDENTIAL_ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM encryption of provider API keys at rest. **Required** in all non-development environments. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DEVS_AI_BASE_URL` | Devs.ai API base URL (default: `https://devs.ai`) |
| `DEVS_AI_API_KEY` | Devs.ai API key |

## Deployment (Vercel Services)

The repo includes `vercel.json` with **`experimentalServices`**: Vite frontend at `/` and Express backend at **`/_/backend`**. In the Vercel project, set the framework / product mode to **Services** when linking (see [Vercel Services](https://vercel.com/docs/services)).

### Frontend build command (fixes `cd frontend` failures)

Vercel often sets **Root Directory** to `frontend` for the frontend service. In that case **`cd frontend` fails** (there is no `frontend/frontend` folder).

| Root Directory | Build command to use |
|----------------|---------------------|
| **`frontend`** | `npm run vercel:build` **or** `npm run lint && npm run build` |
| **Repository root** | `npm run vercel:build:frontend` **or** `npm run lint && npm run build --workspace=frontend` |

Do **not** use `npm run lint && cd frontend && npm run build` when Root Directory is already `frontend`.

1. **Environment variables** — Add `AI_MANAGER_SUPABASE_*`, `DEVS_AI_*`, etc. in Project Settings. The **backend** needs the service role key at runtime. The **frontend** build must also see `AI_MANAGER_SUPABASE_URL` and `AI_MANAGER_SUPABASE_ANON_KEY` (project-wide “All Environments” is fine). If your dashboard can scope vars per service, attach those two to the **frontend** service as well, or duplicate them as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

2. **Frontend API prefix** — So the browser calls the mounted backend, set on the **frontend** service/build:

   `VITE_API_PATH_PREFIX=/_/backend`

   Leave it **unset** for local `npm run dev` (Vite proxies `/api` to the API on port 3001).

3. **Supabase in the browser** — The Vite build reads `AI_MANAGER_SUPABASE_URL` and `AI_MANAGER_SUPABASE_ANON_KEY` from the environment and maps them to `VITE_SUPABASE_*` (see `frontend/vite.config.js`). Ensure those two variables are available when the **frontend** service builds (not only the backend). You can instead set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` explicitly on the frontend if you prefer.

4. **Google OAuth** — Add your production URL and redirect URLs in Supabase (e.g. `https://<project>.vercel.app` and `https://<project>.vercel.app/`).

5. **Legacy deploy** — The root `api/index.js` handler + old `rewrites` flow is optional; multi-service deploy uses the `backend` entrypoint from `vercel.json` instead.
