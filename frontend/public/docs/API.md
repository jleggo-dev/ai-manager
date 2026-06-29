# AI Admin — API Reference

> **Source of truth for field-level detail**: `backend/src/schemas/*.ts` (Zod) and `backend/src/models/*.ts`.
> This document is the human-readable overview. Keep it in sync when routes change.

## Table of contents

| Section | When you need it |
|---------|------------------|
| [API Stability Contract](#api-stability-contract) | Versioning and error conventions |
| [Global Conventions](#global-conventions) | Auth, pagination, rate limits |
| [Validation Errors](#validation-errors) | Structured 400 response shape |
| [Health / Auth / Workspaces](#health) | Bootstrap and team management |
| [API Keys / Providers / AI Profiles](#api-keys) | Core resource CRUD |
| [Processing Jobs / Groups](#processing-jobs) | Templated prompts and test execution |
| [Chat Sessions](#chat-sessions) | Streaming SSE, workflows, rule sets |
| [AI Matcher](#ai-matcher) | One-shot `run-slot` |
| [Workflows](#workflows) | Multi-step pipelines and variable mappings |
| [User Data / Health Checks / Widget Checks](#user-data-deletion-gdpr--ccpa) | Compliance and monitoring |

## API Stability Contract

> **Summary:** SemVer via `X-API-Version` header; tolerant consumers; sanitized errors; structured validation details.

- Every response includes an `X-API-Version` header matching the root `package.json` version (SemVer).
- New optional fields may be added to responses at any time (minor version bump). Consumers must tolerate unknown keys.
- Existing response fields are never removed or renamed without a deprecation cycle and major version bump.
- Error responses always use `{ "error": "..." }`. Error messages are sanitized — they never expose internal database details, constraint names, or stack traces. Branch on HTTP status codes, not error message text.
- **Validation errors** (HTTP 400) return a structured `details` array alongside the `error` string. See **Validation Errors** section below.
- Create/update responses may include a `warnings` array of non-blocking advisory strings.
- See `CHANGELOG.md` for version history and the `manifest.json` at `/docs/manifest.json` for machine-readable discovery.

## Global Conventions

> **Summary:** Bearer auth (JWT or `aim_sk_`), workspace scoping, forwarded user identity, cursor pagination.

| Item | Detail |
|------|--------|
| **Auth** | `Authorization: Bearer <token>` — Supabase JWT or `aim_sk_*` API key |
| **Workspace scope** | JWT: `X-Workspace-Id: <UUID>` required (except `GET /api/workspaces`). API key: workspace from key row; optional header must match |
| **Forwarded identity** | API keys: optional `X-Forwarded-User-Id: <UUID>` for per-user operations (credentials, session ownership) |
| **Pagination** | `cursor` (timestamp), `limit` (default 50, max 200), `direction` (`next` \| `prev`) — response: `{ data, pagination: { next_cursor, prev_cursor, has_more, limit } }` |
| **Rate limits** | Global limiter on all routes; stricter LLM-oriented limits on `/api/chat-sessions` and `/api/ai-matcher` |

---

## Validation Errors

> **Summary:** HTTP 400 returns `{ error, details[], warnings[] }` from Zod + semantic validators.

All endpoints validate request bodies with Zod schemas (structural) and semantic validators (referential integrity, cross-field rules). When validation fails, the response uses HTTP 400 with a structured body:

```json
{
  "error": "Validation failed",
  "details": [
    { "path": "ai_profile_id", "message": "AI profile not found" },
    { "path": "config.inputVariables.0.name", "message": "Variable name is required" }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `error` | `string` | Always `"Validation failed"` for validation errors |
| `details` | `array` | One entry per field that failed validation |
| `details[].path` | `string` | Dot-path to the offending field (e.g. `"steps.0.depends_on"`) |
| `details[].message` | `string` | Human-readable description of the issue |

**Semantic validation** (ref checks) runs after Zod parsing. Examples:
- `ai_profile_id` must reference an existing AI profile within the workspace
- `processing_job_id` on workflow steps must reference an existing processing job
- Widget health check URLs are validated for safety (HTTPS, no private IPs)
- Workflow step `depends_on` values must reference existing step keys with no cycles

**Warnings**: Successful create/update responses may include a `"warnings"` array of non-blocking advisory strings (e.g. `"Multiple steps share sort_order 1"`).

---

## Health

> **Summary:** Unauthenticated liveness check at `GET /api/health`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | None | Liveness/readiness check with DB connectivity |

**Response**: `{ status: "ok" | "degraded", version: "1.2.0" }`

---

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/bootstrap` | JWT | Post sign-in bootstrap — ensures membership, user_settings, default workspace |

**Response**: `{ user: { id, email, display_name }, workspaces: [...], bootstrapped }`

---

## Workspaces

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/workspaces` | JWT | List workspaces the user belongs to |
| GET | `/api/workspaces/:workspaceId/members` | JWT | List members with display names and last login |
| PATCH | `/api/workspaces/:workspaceId/members/:memberUserId` | JWT (admin/owner via RLS) | Change a member's role |

### GET /api/workspaces
**Response**: `{ workspaces: [{ workspace_id, role, workspace: { id, slug, name, created_at } }] }`

### GET .../members
**Response**: `{ members: [{ user_id, role, created_at, display_name, last_sign_in_at }] }`

### PATCH .../members/:memberUserId
**Body**: `{ role: "owner" | "admin" | "member" }`
**Restrictions**: Cannot change own role (400). Requires admin/owner (RLS-enforced).

---

## API Keys

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/api-keys` | JWT | List key metadata (no secrets) |
| POST | `/api/api-keys` | JWT | Create key — secret returned once |
| DELETE | `/api/api-keys/:id` | JWT | Revoke key |

### POST /api/api-keys
**Body**: `{ name: string, role?: "owner" | "admin" | "member" }` (default role: `admin`)
**Response** (201): `{ apiKey: { id, name, key_prefix, role, created_at }, secret: "aim_sk_..." }`

---

## Providers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/providers` | JWT/Key | Paginated list (api_key sanitized) |
| POST | `/api/providers` | JWT/Key | Create provider |
| GET | `/api/providers/:id` | JWT/Key | Get one provider |
| PUT | `/api/providers/:id` | JWT/Key | Update provider |
| DELETE | `/api/providers/:id` | JWT/Key | Delete (409 if profiles depend on it) |
| POST | `/api/providers/:id/test` | JWT/Key | Connectivity test |
| GET | `/api/providers/:id/ais` | JWT/Key | List remote AIs (Devs.ai) |
| GET | `/api/providers/:id/models` | JWT/Key | List LLM models for provider |
| POST | `/api/providers/:id/models/sync` | JWT/Key | Discover/sync models |
| POST | `/api/providers/:id/models` | JWT/Key | Add model(s) |
| PUT | `/api/providers/:providerId/models/:modelId` | JWT/Key | Update model |
| DELETE | `/api/providers/:providerId/models/:modelId` | JWT/Key | Delete model |

### POST /api/providers
**Body**: `{ name, type, base_url, api_key?, is_active?, request_timeout_ms? }`

### POST .../models
**Body**: `{ models: [{ external_ai_id, display_name?, category?, is_active? }] }` (1–100 items)

---

## AI Profiles

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/ai-profiles` | JWT/Key | Paginated list (optional `?provider_id=`) |
| POST | `/api/ai-profiles` | JWT/Key | Create profile |
| GET | `/api/ai-profiles/default` | JWT/Key | Current default profile |
| GET | `/api/ai-profiles/:id` | JWT/Key | Get profile (secrets stripped) |
| PUT | `/api/ai-profiles/:id` | JWT/Key | Update profile |
| DELETE | `/api/ai-profiles/:id` | JWT/Key | Delete (409 if jobs depend on it) |
| POST | `/api/ai-profiles/:id/test-chat` | JWT/Key | Test completion call |
| GET | `/api/ai-profiles/:id/tools` | JWT/Key | List tools (Devs.ai) |
| GET | `/api/ai-profiles/:id/tools/mcp` | JWT/Key | MCP tools |
| GET | `/api/ai-profiles/:id/tools/auth-status` | JWT/Key | Tool OAuth status |
| GET | `/api/ai-profiles/:id/tools/:toolId/oauth-status` | JWT/Key | Single tool OAuth status |
| POST | `/api/ai-profiles/:id/tools/:toolId/oauth-initiate` | JWT/Key | Start OAuth flow |
| DELETE | `/api/ai-profiles/:id/tools/:toolId/oauth-token` | JWT/Key | Remove OAuth token |

### POST /api/ai-profiles
**Body**: `{ name, provider_id (UUID), external_ai_id, description?, is_active?, profile_type?, mode?, runtime_options?, failover_provider_id?, failover_external_ai_id?, failover_runtime_options? }`

### POST .../test-chat
**Body**: `{ message, systemPrompt? }`
**Response**: `{ content, durationMs, model, failoverUsed, usage?, finishReason? }`

---

## Processing Jobs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/processing-jobs/formatting-rules` | JWT/Key | List built-in formatting rule types |
| POST | `/api/processing-jobs/apply-formatting` | JWT/Key | Stateless text + rules demo |
| GET | `/api/processing-jobs` | JWT/Key | Paginated job list |
| POST | `/api/processing-jobs` | JWT/Key | Create job |
| PATCH | `/api/processing-jobs/batch` | JWT/Key | Bulk update jobs (1–100) |
| GET | `/api/processing-jobs/:id` | JWT/Key | Get job |
| PUT | `/api/processing-jobs/:id` | JWT/Key | Update job |
| DELETE | `/api/processing-jobs/:id` | JWT/Key | Delete job |
| POST | `/api/processing-jobs/:id/test` | JWT/Key | Execute job (test) |
| POST | `/api/processing-jobs/:id/datasources` | JWT/Key | Upload rows as Devs.ai datasources |

### POST /api/processing-jobs
**Body**: `{ name, slug (lowercase-hyphen), description?, ai_profile_id?, is_active?, config?, calling_application_id?, requires_user_credentials? }`

`requires_user_credentials` (boolean, default `false`) — when enabled, users must store a personal provider API key to run this job. Required for tasks that invoke MCP tools scoped to individual user accounts (Gmail, Drive, etc.).

### POST .../test
**Body**: `{ message, variables?, ruleSetKey?, callingApplication?, promptOverride?, attachments? }`
**Response**: `{ messageSent, raw, formatted, formattingSteps?, durationMs, model, usage, finishReason?, diagnostics }`

### POST .../datasources
**Body**: `{ rows: Record[] (max 1000), namePrefix?, maxChunkBytes?, callingApplication? }`

---

## Processing Job Groups

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/processing-job-groups` | JWT/Key | List groups (optional `?appId=`) |
| POST | `/api/processing-job-groups` | JWT/Key | Create group |
| PUT | `/api/processing-job-groups/:id` | JWT/Key | Update group |
| DELETE | `/api/processing-job-groups/:id` | JWT/Key | Delete group |

### POST /api/processing-job-groups
**Body**: `{ name, description?, app_id?, slug?, sort_order? }`

---

## Chat Sessions

> **Summary:** Stateful streaming conversations — open session, send messages (SSE), tool outputs, list/get.

| Method | Path | Auth | Write restriction |Description |
|--------|------|------|-------------------|------------|
| POST | `/api/chat-sessions` | JWT/Key | — | Create session |
| POST | `/api/chat-sessions/resume` | JWT/Key | JWT: own session only | Resume a prior session by `sessionId` or `externalChatId` |
| POST | `/api/chat-sessions/:id/messages` | JWT/Key | JWT: own session only | Send message — **SSE stream** |
| POST | `/api/chat-sessions/:id/tool-outputs` | JWT/Key | JWT: own session only | Submit tool outputs — **SSE stream** |
| GET | `/api/chat-sessions` | JWT/Key | — | Paginated session list with filters |
| GET | `/api/chat-sessions/:id` | JWT/Key | — | Session detail + stats + history |
| GET | `/api/chat-sessions/:id/messages` | JWT/Key | — | Message history (`?fromProvider=true`) |
| PUT | `/api/chat-sessions/:id/reset` | JWT/Key | JWT: own session only | Reset conversation |
| PUT | `/api/chat-sessions/:id/close` | JWT/Key | JWT: own session only | Close session (preserves remote chat for resume) |
| DELETE | `/api/chat-sessions/:id` | JWT/Key | — | Delete session (any member, for remediation) |
| GET | `/api/chat-sessions/:id/diagnostics` | JWT/Key | — | Diagnostic summary |
| GET | `/api/chat-sessions/:id/files` | JWT/Key | — | List session files |
| GET | `/api/chat-sessions/analytics/by-profile/:aiProfileId` | JWT/Key | — | Aggregate session stats per profile |

**Write restriction note:** JWT callers can only send messages, submit tool outputs, reset, resume, or close sessions they own (`session.user_id === JWT userId`). API-key callers have workspace-wide write access. GET and DELETE are allowed for any authenticated workspace member (cross-user read for troubleshooting, delete for sensitive content remediation).

**Lifecycle note:** `close` marks a session `closed` but **preserves** the provider's remote chat so it can be resumed later via `POST /api/chat-sessions/resume`. `reset` clears history (and the remote chat where supported); `DELETE` removes the session and best-effort purges the remote chat. The user-data deletion endpoints (`DELETE /api/user-data/:userId[/sessions]`) also best-effort purge remote chats before dropping rows, so closed-but-retained chats are not orphaned.

### POST /api/chat-sessions
**Body**: `{ userId, jobSlug?, jobId?, aiProfileId?, workflowSlug?, workflowId?, callingApplication?, systemPrompt? }`
**Note**: JWT callers use `ctx.userId` (body `userId` ignored for JWT). API keys require `callingApplication`.

### POST /api/chat-sessions/resume
Continue a previously opened **streaming chat** session (there is nothing to resume for one-shot completion jobs).
**Body**: `{ sessionId? , externalChatId?, fallbackToLocal? }` — provide `sessionId` (AI Admin id) **or** `externalChatId` (provider chat id, e.g. Devs.ai). `fallbackToLocal` (default `false`): if the provider's remote chat is gone, drop `external_chat_id` and continue with local history replay instead of failing.
**Response**: `{ sessionId, externalChatId, providerType, status, workflowId, steps, ruleSets, completedSteps, workflowVariables, aiProfileId, aiProfileName, messages }` — `messages` is the restored local history; `completedSteps` and `workflowVariables` restore mid-workflow pipeline state.
**Behavior**: Closed sessions are reactivated (idempotent if already active). For Devs.ai, the remote chat is validated via "get a chat session" first. Lookups are tenant-scoped, so cross-tenant ids resolve to `404`.
**Errors**: `400` (neither id provided), `403` (session uses personal credentials but no user identity), `404` (not found / cross-tenant), `409` (remote chat no longer available and `fallbackToLocal` not set). Continue the conversation by calling `POST /:id/messages` with the returned `sessionId`.

### POST .../messages
**Body**: `{ message?, stepKey?, ruleSetKey?, variables?, attachments? }`
**Response**: SSE stream (`text/event-stream`). Events: data chunks, `formatted_response` (if post-stream formatting applied), `[DONE]`.

### POST .../tool-outputs
**Body**: `{ outputs: [{ ... }] (1–50), systemMessageId? }`
**Response**: SSE stream.

### GET /api/chat-sessions (list)
**Query**: `userId`, `aiProfileId`, `workflowId`, `status`, `callingApplication`, `externalChatId`, pagination params.

---

## AI Matcher

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/ai-matcher/run-slot` | JWT/Key | Run one profile or adhoc slot |

### POST /api/ai-matcher/run-slot
**Body**: `{ prompt, slot: { type, profileId?, providerId?, externalAiId?, runtimeOptions? }, formattingRules?, attachments?, variables?, slotIndex?, callingApplication? }`
**Response**: `{ slotIndex, status, raw, formatted, formattingSteps?, durationMs, model, provider, profileName, usage?, finishReason?, error }`

---

## App Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings` | JWT/Key | List all settings |
| GET | `/api/settings/:key` | JWT/Key | Get one setting |
| PUT | `/api/settings/:key` | JWT/Key | Upsert setting |
| DELETE | `/api/settings/:key` | JWT/Key | Delete setting |

### PUT /api/settings/:key
**Body**: `{ value: any, description?: string }`

---

## Calling Applications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/calling-applications` | JWT/Key | Paginated list |
| POST | `/api/calling-applications` | JWT/Key | Create/upsert application |
| GET | `/api/calling-applications/:id` | JWT/Key | Get one |
| PUT | `/api/calling-applications/:id` | JWT/Key | Update (display_name only) |
| DELETE | `/api/calling-applications/:id` | JWT/Key | Delete (204) |

### POST /api/calling-applications
**Body**: `{ id, display_name }`

---

## User Credentials

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/user-credentials` | JWT/Key+User | List masked credentials for current user |
| POST | `/api/user-credentials` | JWT/Key+User | Upsert personal provider API key |
| DELETE | `/api/user-credentials/:id` | JWT/Key+User | Delete own credential (403 if not owner) |

**Note**: API key callers must include `X-Forwarded-User-Id` for all credential operations.

### POST /api/user-credentials
**Body**: `{ providerId: UUID, apiKey: string (8-500 chars), label? }`

---

## Diagnostic Logs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/diagnostic-logs` | JWT/Key | Paginated filtered list |
| GET | `/api/diagnostic-logs/token-stats` | JWT/Key | Aggregated token usage |
| GET | `/api/diagnostic-logs/:id` | JWT/Key | Single log entry |
| DELETE | `/api/diagnostic-logs/:id` | JWT/Key | Delete one entry |
| DELETE | `/api/diagnostic-logs/job/:jobId` | JWT/Key | Clear all logs for a job |

### GET /api/diagnostic-logs (list)
**Query**: `processingJobId`, `chatSessionId`, `callingApplication`, `status`, `userId`, `authMode`, pagination params.

### GET .../token-stats
**Query**: `processingJobId`, `callingApplication`, `limit` (1–5000, default 1000).

---

## Workflows

> **Summary:** Multi-step chat pipelines with inline steps, variable mappings, and dependency enforcement.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/workflows` | JWT/Key | Paginated workflow list |
| POST | `/api/workflows` | JWT/Key | Create workflow (optional inline steps) |
| GET | `/api/workflows/:id` | JWT/Key | Full workflow with steps |
| PUT | `/api/workflows/:id` | JWT/Key | Update workflow (optional steps replacement) |
| DELETE | `/api/workflows/:id` | JWT/Key | Delete workflow (204) |
| GET | `/api/workflows/:id/steps` | JWT/Key | List steps |
| POST | `/api/workflows/:id/steps` | JWT/Key | Add one step |
| PUT | `/api/workflows/:wid/steps/:sid` | JWT/Key | Update step |
| DELETE | `/api/workflows/:wid/steps/:sid` | JWT/Key | Delete step (204) |

### POST /api/workflows

Creates a workflow. You can include steps inline or add them individually afterwards.

**Body**:

```json
{
  "name": "Data Analysis Pipeline",
  "slug": "data-analysis-pipeline",
  "description": "Two-step workflow: analyze then report",
  "ai_profile_id": "<uuid>",
  "is_active": true,
  "config": {
    "inputVariables": [
      { "name": "companyName", "label": "Company Name", "required": true },
      { "name": "dataSet", "label": "Data Set", "description": "Raw data to analyze" }
    ],
    "systemPrompt": "You are a data analyst..."
  },
  "steps": [
    {
      "processing_job_id": "<uuid>",
      "step_key": "analyze",
      "name": "Analyze Data",
      "sort_order": 1,
      "is_required": true,
      "config": {
        "inputMappings": {
          "company": "companyName",
          "rawData": "dataSet"
        },
        "outputMappings": {
          "strengths": "analysis_strengths",
          "risks": "analysis_risks"
        }
      }
    },
    {
      "processing_job_id": "<uuid>",
      "step_key": "report",
      "name": "Generate Report",
      "sort_order": 2,
      "is_required": true,
      "depends_on": ["analyze"],
      "config": {
        "inputMappings": {
          "strengths": "analysis_strengths",
          "risks": "analysis_risks",
          "priorAnalysis": "analyze.response"
        },
        "outputMappings": {
          "report": "final_report"
        }
      }
    }
  ]
}
```

**409** on slug conflict.

### Workflow `config` object

| Field | Type | Description |
|---|---|---|
| `inputVariables` | `Array<{ name, label?, description?, required? }>` | Variables the calling app provides at session start. Available to all steps. |
| `systemPrompt` | `string` | Optional system prompt prepended to the chat session. |

### Step `config` object

| Field | Type | Description |
|---|---|---|
| `inputMappings` | `Record<string, string>` | Maps **job template placeholders** (keys) to **workflow variable names** (values). AI Admin loads accumulated variables from earlier steps and injects them into the job's `{{placeholder}}` slots before sending to the LLM. |
| `outputMappings` | `Record<string, string>` | Maps **JSON response fields** (keys) to **workflow variable names** (values). After the LLM responds, AI Admin parses the response as JSON and stores extracted fields in the session's `workflow_variables` for later steps. |

### Variable pipeline (automatic)

In addition to explicit `outputMappings`, AI Admin automatically captures two variables after every step:

- `{stepKey}.prompt` — the fully interpolated prompt that was sent to the LLM
- `{stepKey}.response` — the complete assistant response

These are available to subsequent steps via `inputMappings` without any configuration. For example, step 2 can reference `"priorAnalysis": "analyze.response"` in its `inputMappings` to include step 1's full response in its prompt.

### POST /api/workflows/:id/steps

Add a single step to an existing workflow.

**Body**: `{ processing_job_id (UUID), step_key, name, sort_order?, is_required?, depends_on?, config? }`

The `config` object accepts `inputMappings` and `outputMappings` as described above.

### PUT /api/workflows/:id

Update workflow fields. If a `steps` array is provided, it **replaces all existing steps** atomically.

---

## User Data Deletion (GDPR / CCPA)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| DELETE | `/api/user-data/:userId` | JWT/Key | Full purge — sessions, diagnostic logs, credentials |
| DELETE | `/api/user-data/:userId/sessions` | JWT/Key | Delete chat sessions + messages only |
| DELETE | `/api/user-data/:userId/diagnostic-logs` | JWT/Key | Delete diagnostic logs only |
| DELETE | `/api/user-data/:userId/credentials` | JWT/Key | Delete provider credentials only |

All endpoints require a confirmation body:

**Body**: `{ "confirm": "DELETE_USER_DATA" }`

Missing or incorrect `confirm` returns 400. The `:userId` parameter must be a valid UUID.

### RBAC

| Endpoint | Who can call |
|----------|-------------|
| `DELETE .../sessions` | Any workspace member |
| `DELETE .../diagnostic-logs` | Any workspace member |
| `DELETE .../credentials` | Self, or admin/owner targeting another member |
| `DELETE .../:userId` (full purge) | Self, or admin/owner targeting another member |

A non-admin member attempting to delete another user's credentials or perform a full purge receives **403**.

### DELETE /api/user-data/:userId (full purge)
**Response**: `{ deleted: { sessions: number, diagnosticLogs: number, credentials: number } }`

### Selective endpoints
**Response**: `{ deleted: { <resource>: number } }` — only the targeted resource count is returned.

---

## Health Checks (API)

Admin-only endpoints for provider health monitoring: provider keys, profiles, check configs, manual runs, run history, and dashboard.

All endpoints require `Authorization: Bearer <token>` and `X-Workspace-Id: <UUID>`.
All endpoints require **owner** or **admin** role.
All `:id` parameters are validated as UUID (400 on invalid format).

### Provider Keys

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health-checks/provider-keys` | List provider keys (secrets stripped) |
| POST | `/api/health-checks/provider-keys` | Create provider key |
| PUT | `/api/health-checks/provider-keys/:id` | Update provider key |
| DELETE | `/api/health-checks/provider-keys/:id` | Delete provider key |

#### POST /api/health-checks/provider-keys
**Body**:
```json
{
  "provider_id": "<UUID>",
  "name": "string (1-200 chars)",
  "api_key": "string (min 1 char)",
  "is_active": true
}
```
**Response** (201): Provider key object (api_key stripped).

#### PUT /api/health-checks/provider-keys/:id
**Body** (all optional):
```json
{
  "name": "string (1-200 chars)",
  "api_key": "string (min 1 char)",
  "is_active": true
}
```
**Response**: Updated provider key object (api_key stripped).

#### DELETE /api/health-checks/provider-keys/:id
**Response**: `{ "success": true }`

---

### Health Check Profiles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health-checks/profiles` | List all HC profiles |
| POST | `/api/health-checks/profiles` | Create profile (auto-creates linked health check) |
| PUT | `/api/health-checks/profiles/:id` | Update profile (syncs name/is_active to linked check) |
| DELETE | `/api/health-checks/profiles/:id` | Delete profile |
| POST | `/api/health-checks/profiles/backfill-checks` | Create missing auto-checks for all profiles |

#### GET /api/health-checks/profiles
**Response**: `{ "data": [ProfileRow, ...] }`

#### POST /api/health-checks/profiles
**Body**:
```json
{
  "provider_id": "<UUID>",
  "hc_provider_key_id": "<UUID>",
  "external_ai_id": "string (1-200 chars)",
  "name": "string (1-200 chars)",
  "description": "string (max 1000, optional)",
  "mode": "completion | chat (optional)",
  "profile_type": "agent | model (optional)",
  "runtime_options": { ... },
  "is_active": true
}
```
**Response** (201): Created profile object.
**Side effect**: Automatically creates a linked health check with default settings (5-min cadence, 2-min outage cadence).

#### PUT /api/health-checks/profiles/:id
**Body** (all optional): Same fields as create (except `provider_id` and `hc_provider_key_id`).
**Response**: Updated profile object.
**Side effect**: If `name` or `is_active` changed, syncs to the linked health check.

#### DELETE /api/health-checks/profiles/:id
**Response**: `{ "success": true }`

#### POST /api/health-checks/profiles/backfill-checks
Creates health checks for any profiles that don't have one.
**Response**: `{ "success": true, "created": 2, "total_profiles": 5 }`

---

### Health Checks (CRUD)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health-checks/` | List all checks (enriched with computed healthStatus) |
| POST | `/api/health-checks/` | Create health check (auto-runs first check) |
| PUT | `/api/health-checks/:id` | Update health check (syncs name/is_active to linked profile) |
| DELETE | `/api/health-checks/:id` | Delete health check (optional cascade to profile) |

#### GET /api/health-checks/
**Response**:
```json
{
  "data": [
    {
      "id": "<UUID>",
      "name": "My Check",
      "health_check_profile_id": "<UUID>",
      "test_message": "Hello...",
      "cadence_minutes": 5,
      "outage_cadence_minutes": 2,
      "is_active": true,
      "last_run_at": "2026-01-01T00:00:00Z",
      "healthStatus": "healthy | degraded | down | unknown"
    }
  ]
}
```

#### POST /api/health-checks/
**Body**:
```json
{
  "health_check_profile_id": "<UUID>",
  "name": "string (1-200 chars)",
  "test_message": "string (1-2000 chars, optional)",
  "cadence_minutes": 5,
  "outage_cadence_minutes": 2,
  "is_active": true
}
```
**Response** (201): Created health check object.
**Side effect**: Triggers an initial run asynchronously after creation.

#### PUT /api/health-checks/:id
**Body** (all optional):
```json
{
  "name": "string (1-200 chars)",
  "test_message": "string (1-2000 chars)",
  "cadence_minutes": 1-1440,
  "outage_cadence_minutes": 1-1440,
  "is_active": true
}
```
**Response**: Updated health check object.
**Side effect**: If `name` or `is_active` changed, syncs to the linked profile.

#### DELETE /api/health-checks/:id
**Query**: `?deleteProfile=true` (optional) — cascades delete to linked profile.
**Response**: `{ "success": true }`

---

### Manual Run

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/health-checks/:id/run` | Trigger a manual health check run |

#### POST /api/health-checks/:id/run
Executes the health check immediately and records the result.
**Response**: Run result object with status, latency, response data.
**Errors**: 400 if profile not found.

---

### Run History & Incidents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health-checks/:id/runs` | Paginated run history with filters |
| GET | `/api/health-checks/:id/incidents` | List incidents for a check |
| GET | `/api/health-checks/:id/failure-patterns` | Failure pattern analysis |

#### GET /api/health-checks/:id/runs
**Query params**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 50 | Max results (1–200) |
| `offset` | int | 0 | Skip N results |
| `status` | string | — | Comma-separated: `pass,fail,timeout,error` |
| `from` | string | — | ISO datetime or `YYYY-MM-DD` |
| `to` | string | — | ISO datetime or `YYYY-MM-DD` |

**Response**:
```json
{
  "data": [
    {
      "id": "<UUID>",
      "health_check_id": "<UUID>",
      "status": "pass | fail | timeout | error",
      "latency_ms": 1200,
      "response_text": "...",
      "error_message": null,
      "created_at": "2026-01-01T00:05:00Z"
    }
  ],
  "total": 142
}
```

#### GET /api/health-checks/:id/incidents
**Query**: `?limit=20` (max 100, default 20)
**Response**: `{ "data": [IncidentRow, ...] }`

#### GET /api/health-checks/:id/failure-patterns
**Query params**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | string | 30 days ago | Start date (`YYYY-MM-DD` or ISO datetime) |
| `to` | string | today | End date (`YYYY-MM-DD` or ISO datetime) |

**Response**: Failure pattern analysis object (grouped error messages, frequency, etc.).

---

### Dashboard & Uptime

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health-checks/dashboard` | Dashboard overview with semaphore status |
| GET | `/api/health-checks/uptime-history` | Daily uptime statistics |

#### GET /api/health-checks/dashboard
Returns all checks with semaphore status, last run, recent runs, and active incidents.
**Response**:
```json
{
  "data": [
    {
      "id": "<UUID>",
      "name": "My Check",
      "profileName": "GPT-4o",
      "providerName": "OpenAI",
      "cadenceMinutes": 5,
      "outageCadenceMinutes": 2,
      "isActive": true,
      "lastRunAt": "2026-01-01T00:05:00Z",
      "semaphore": "green | yellow | red | gray",
      "lastRun": { ... },
      "recentRuns": [ ... ],
      "activeIncident": null
    }
  ]
}
```

**Semaphore logic**:
- `gray` — no runs recorded yet
- `red` — last run failed OR active incident open
- `yellow` — last run passed but previous run failed (recovering)
- `green` — last two runs passed, no active incident

#### GET /api/health-checks/uptime-history
**Query**: `?days=365` (1–365, default 365)
**Response**:
```json
{
  "data": [
    {
      "checkId": "<UUID>",
      "checkName": "My Check",
      "checkType": "api",
      "uptimePercent": 99.85,
      "totals": { "pass": 8500, "fail": 10, "timeout": 3, "error": 0 },
      "dailyStats": [
        {
          "date": "2026-01-01",
          "totalRuns": 288,
          "passCount": 287,
          "failCount": 1,
          "timeoutCount": 0,
          "errorCount": 0
        }
      ]
    }
  ]
}
```

---

## Widget Health Checks

Admin-only endpoints for widget-based (Puppeteer/browser) health checks. Operates on embedded chat widgets via headless browser automation.

All endpoints require `Authorization: Bearer <token>` and `X-Workspace-Id: <UUID>`.
All endpoints require **owner** or **admin** role.
All `:id` parameters are validated as UUID (400 on invalid format).

### Widget Checks (CRUD)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/widget-health-checks/` | List all widget checks (enriched with healthStatus) |
| POST | `/api/widget-health-checks/` | Create widget check (auto-runs if Puppeteer available) |
| GET | `/api/widget-health-checks/:id` | Get single widget check |
| PUT | `/api/widget-health-checks/:id` | Update widget check |
| DELETE | `/api/widget-health-checks/:id` | Delete widget check (204) |

#### GET /api/widget-health-checks/
**Response**:
```json
{
  "data": [
    {
      "id": "<UUID>",
      "name": "Support Widget",
      "url": "https://example.com/support",
      "cadence_minutes": 10,
      "is_active": true,
      "healthStatus": "healthy | degraded | down | unknown"
    }
  ]
}
```

#### POST /api/widget-health-checks/
**Body**:
```json
{
  "name": "string (1-200 chars)",
  "url": "valid URL (max 2000 chars)",
  "test_message": "string (1-2000 chars, optional)",
  "cadence_minutes": 10,
  "outage_cadence_minutes": 5,
  "is_active": true,
  "max_retries": 2,
  "shadow_host_selector": "CSS selector (max 500, optional)",
  "launcher_selector": "CSS selector (max 500, optional)",
  "iframe_selector": "CSS selector (max 500, optional)",
  "input_selector": "CSS selector (max 500, optional)",
  "send_selector": "CSS selector (max 500, optional)",
  "response_selector": "CSS selector (max 500, optional)",
  "error_patterns": ["string (max 200)", "..."],
  "page_load_timeout_ms": 60000,
  "widget_load_timeout_ms": 30000,
  "response_timeout_ms": 60000,
  "capture_screenshot": true
}
```
**Response** (201): Created widget check object.
**Side effect**: Triggers an initial run asynchronously if Puppeteer is available.

#### GET /api/widget-health-checks/:id
**Response**: Full widget check object.

#### PUT /api/widget-health-checks/:id
**Body** (all optional): Same fields as create body.
**Response**: Updated widget check object.

#### DELETE /api/widget-health-checks/:id
**Response**: 204 No Content.

---

### Manual Run

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/widget-health-checks/:id/run` | Trigger a manual widget health check |

#### POST /api/widget-health-checks/:id/run
Launches a headless browser, navigates to the widget URL, sends the test message, and records the result.
**Response**: Run result object (screenshot stripped from response body).
**Errors**: 503 if Puppeteer is not available in the current environment.

---

### Run History & Screenshots

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/widget-health-checks/:id/runs` | Paginated run history (screenshots stripped) |
| GET | `/api/widget-health-checks/runs/:runId/screenshot` | Get screenshot for a specific run |
| GET | `/api/widget-health-checks/:id/incidents` | List incidents for a widget check |
| GET | `/api/widget-health-checks/:id/failure-patterns` | Failure pattern analysis |

#### GET /api/widget-health-checks/:id/runs
**Query params**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 50 | Max results (1–200) |
| `offset` | int | 0 | Skip N results |
| `status` | string | — | Comma-separated: `pass,fail,timeout,error` |
| `from` | string | — | ISO datetime or `YYYY-MM-DD` |
| `to` | string | — | ISO datetime or `YYYY-MM-DD` |

**Response**:
```json
{
  "data": [
    {
      "id": "<UUID>",
      "widget_health_check_id": "<UUID>",
      "status": "pass | fail | timeout | error",
      "latency_ms": 4500,
      "response_text": "...",
      "error_message": null,
      "created_at": "2026-01-01T00:10:00Z"
    }
  ],
  "total": 87
}
```
**Note**: Screenshot data is stripped from list responses. Each run includes a `has_screenshot: boolean` flag. Use the dedicated screenshot endpoint below to retrieve the image.

#### GET /api/widget-health-checks/runs/:runId/screenshot
Returns the screenshot captured during a widget check run.

Returns a **signed URL** (valid 5 minutes) for the screenshot stored in Supabase Storage.
**Response**:
```json
{ "url": "https://…/storage/v1/object/sign/widget-hc-screenshots/…?token=…" }
```
**Errors**: 404 if no screenshot is available for the run.

#### GET /api/widget-health-checks/:id/incidents
**Query**: `?limit=20` (max 100, default 20)
**Response**: `{ "data": [IncidentRow, ...] }`

#### GET /api/widget-health-checks/:id/failure-patterns
**Query params**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | string | 30 days ago | Start date (`YYYY-MM-DD` or ISO datetime) |
| `to` | string | today | End date (`YYYY-MM-DD` or ISO datetime) |

**Response**: Failure pattern analysis object.

---

### Dashboard & Uptime

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/widget-health-checks/dashboard` | Dashboard overview with semaphore status |
| GET | `/api/widget-health-checks/uptime-history` | Daily uptime statistics |

#### GET /api/widget-health-checks/dashboard
Returns all widget checks with semaphore status, last run, recent runs, and active incidents.
**Response**:
```json
{
  "data": [
    {
      "id": "<UUID>",
      "name": "Support Widget",
      "url": "https://example.com/support",
      "cadenceMinutes": 10,
      "outageCadenceMinutes": 5,
      "isActive": true,
      "lastRunAt": "2026-01-01T00:10:00Z",
      "semaphore": "green | yellow | red | gray",
      "lastRun": { ... },
      "recentRuns": [ ... ],
      "activeIncident": null
    }
  ]
}
```

**Semaphore logic**: Same as API health checks (green/yellow/red/gray).

#### GET /api/widget-health-checks/uptime-history
**Query**: `?days=365` (1–365, default 365)
**Response**:
```json
{
  "data": [
    {
      "checkId": "<UUID>",
      "checkName": "Support Widget",
      "checkType": "widget",
      "uptimePercent": 98.50,
      "totals": { "pass": 4200, "fail": 50, "timeout": 15, "error": 5 },
      "dailyStats": [
        {
          "date": "2026-01-01",
          "totalRuns": 144,
          "passCount": 142,
          "failCount": 1,
          "timeoutCount": 1,
          "errorCount": 0
        }
      ]
    }
  ]
}
```

---

## JWT-Only Endpoints

These endpoints reject API key auth with 403:

| Path | Reason |
|------|--------|
| `GET /api/workspaces` | User membership lookup |
| `GET/PATCH .../members` | Team management |
| `GET/POST/DELETE /api/api-keys` | Key lifecycle |
