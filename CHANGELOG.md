# Changelog

All notable changes to AI Admin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Health check crons run hourly (`0 * * * *`) due to Vercel Hobby plan limits. After upgrading to Pro, change both schedules in `vercel.json` to `* * * * *` for per-minute checks.

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
