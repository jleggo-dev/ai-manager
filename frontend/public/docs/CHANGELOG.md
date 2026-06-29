# Changelog

All notable changes to AI Admin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-06-29

### Added
- **Deterministic assertion build rules** — `require-keys`, `assert-json-schema`, `coerce-types`, `constrain-enum` emit `{ verified: false, reason: ... }` on contract failure.
- **Nested outputMappings** — dot/bracket paths (e.g. `"analysis.score"`, `"items[0].title"`) in workflow step output extraction.
- **Jobs-as-tools** — `ai_profiles.config.toolJobs[]` exposes processing jobs as Devs.ai callable tools; AI Admin fulfills matching `tool.call` events server-side.
- **Triggers** — `POST /api/triggers/:slug/run` (external-clock), internal event triggers on `session.message.created` / `workflow.step.completed`, CRUD at `/api/triggers`.
- **Session compaction** — `chat_sessions.config.summarizer` runs a summarizer job when token threshold exceeded; `session_summary` prepended on subsequent calls.
- **Job eval** — `POST /api/processing-jobs/:id/eval` runs golden test cases; CLI `backend/scripts/eval-job.mjs`.
- **Idempotency-Key** — safe retries on `POST .../test` via `idempotency_keys` table.
- **Per-user token stats** — `byUser` bucket and `userId` filter on `GET /api/diagnostic-logs/token-stats`; soft budget warnings via `app_settings.token_budgets`.
- **Config-as-code** — `POST /api/sync` idempotent upsert-by-slug; CLI `backend/scripts/ai-admin-sync.mjs`; AI profile slugs.
- **SDK packages** — `@ai-admin/types`, `@ai-admin/client`, `@ai-admin/edge` in `packages/`.

### Changed
- Health check crons in `vercel.json` set to hourly (`0 * * * *`).
- Docs: streaming-safe build rules caveat and Vercel cron endpoints documented in `API.md`; scheduler behavior clarified in `CONCEPTS.md`.

## [1.3.0] - 2026-06-28

### Added
- **Resume chat sessions** — `POST /api/chat-sessions/resume` continues a previously opened streaming chat by AI Admin `sessionId` or provider `externalChatId` (e.g. a Devs.ai chat id). Reactivates closed sessions (idempotent), validates the provider's remote chat, and returns restored local `messages`, `completedSteps`, and `workflowVariables` for mid-workflow resume. Opt-in `fallbackToLocal` continues via local-history replay when the remote chat is gone.
- `externalChatId` filter on `GET /api/chat-sessions` (and `list-chat-sessions` Edge Function mode) to find the session for a given provider chat id.
- `resume-chat-session` Edge Function mode in the reference proxy and Lovable handbook.
- Model helpers `getChatSessionByExternalChatId` and `reactivateChatSession`; `resumeChatSessionSchema` request validation.

### Changed
- **`PUT /api/chat-sessions/:id/close` now preserves the provider's remote chat** instead of deleting it, so closed conversations can be resumed later. Remote cleanup still happens on `reset` (history) and `DELETE` (full removal).

### Security / Compliance
- User-data deletion endpoints (`DELETE /api/user-data/:userId` and `/:userId/sessions`) now best-effort **purge provider remote chats** before dropping rows (reported as `remoteChatsPurged`), preventing orphaned remote chats from closed-but-retained sessions.

## [1.1.0] - 2026-05-13

### Known Limitations
- Health check crons are configured in `vercel.json` at `0 0 * * *` (once daily at 00:00 UTC). On Vercel Hobby, cron frequency is limited; after upgrading to Pro, increase cadence (e.g. `0 * * * *` hourly or `*/5 * * * *` every 5 minutes) to match check `cadence_minutes`. Until then, use `POST /api/health-checks/:id/run` for manual runs or rely on the daily tick.

### Added
- `p_workspace_id` parameter on `merge_workflow_variables`, `hc_daily_run_summary`, and `widget_hc_daily_run_summary` RPCs for tenant isolation (backward compatible — defaults to NULL)
- `safeClientError()` and `safeStatusError()` utilities for sanitized error responses
- RBAC on user-data deletion: credentials and full purge require self or admin/owner; sessions and diagnostic logs remain deletable by any workspace member
- `workspace_id` guard on widget health check screenshot updates
- Public documentation manifest at `/docs/manifest.json` and `/llms.txt` for LLM tool discovery
- `X-API-Version` response header on all API responses
- `CHANGELOG.md` (this file)

### Changed
- Error responses on all routes now use sanitized messages — no constraint names, table names, or stack traces in HTTP bodies (raw errors logged server-side only)
- `calling_applications` upsert conflict target changed from `'id'` to `'workspace_id,id'` to match composite unique constraint

### Fixed
- RPC functions (`merge_workflow_variables`, `hc_daily_run_summary`, `widget_hc_daily_run_summary`) now enforce workspace isolation when called via service role

### Security
- Error disclosure hardening: internal database details no longer leak through 4xx/5xx responses
- User credential deletion restricted to self or admin/owner (previously any workspace member)

## [1.0.0] - 2026-04-01

### Added
- Workspace-based multi-tenant architecture with Supabase RLS
- Provider management (OpenAI, Devs.ai, Google Gemini) with encrypted API keys
- AI Profile CRUD with failover configuration and runtime options
- Processing jobs with formatting rules and rule sets
- Workflow engine with step sequencing, variable pipeline, and dependency resolution
- Chat sessions with SSE streaming, concurrency locking, and tool outputs
- Health check system (API + widget/Puppeteer) with incident state machine
- API key authentication with RBAC (owner, admin, member)
- User provider credentials with per-user encryption
- Calling application registry with auto-population
- Diagnostic logging with token analytics
- GDPR/CCPA user data deletion endpoints
- Supabase Edge Function reference implementation for Lovable integration
