---
name: ai-admin-integration
description: Integrates external apps with AI Admin via API or Supabase Edge Function proxy. Use when adding AI features, calling AI Admin APIs, building Lovable/Supabase integrations, streaming chat, processing jobs, workflows, Edge Functions, or when the user mentions aim_sk_, callingApplication, or AI Admin.
---

# AI Admin Integration

Guide for wiring AI into applications using the AI Admin HTTP API (via server-side proxy).

## Quick start

1. Read [docs/manifest.json](../../docs/manifest.json) — use `sections[]` to fetch only relevant doc parts.
2. Choose an integration pattern (decision tree below).
3. Never expose `aim_sk_` API keys in browser code — use Edge Function secrets or another server proxy.
4. Set `callingApplication` to `platform:project-name` on every job/chat call.

## Decision tree — which pattern?

```
User needs AI in their app
│
├─ Single prompt, no saved template?
│   └─ POST /api/ai-matcher/run-slot (one-shot completion)
│
├─ Repeatable templated task (extract, classify, summarize)?
│   └─ POST /api/processing-jobs/:id/test (templated job)
│
├─ Interactive back-and-forth chat with streaming?
│   └─ Chat sessions: POST /api/chat-sessions → POST .../messages (SSE)
│
├─ User returning to a past conversation?
│   └─ POST /api/chat-sessions/resume (by sessionId or externalChatId) → then POST .../messages
│
├─ Multi-step pipeline where step N needs step N-1 output?
│   └─ Workflow: create jobs + workflow via API, open session with workflowSlug,
│      trigger steps by stepKey, read workflow_variables when done
│
├─ Scheduled or event-driven job/workflow (cron, webhook)?
│   └─ Triggers: POST /api/triggers (CRUD) + POST /api/triggers/:slug/run
│
├─ Version-controlled config (profiles, jobs, workflows in git)?
│   └─ POST /api/sync (upsert by slug) or backend/scripts/ai-admin-sync.mjs
│
├─ CI golden tests for a prompt before deploy?
│   └─ POST /api/processing-jobs/:id/eval or backend/scripts/eval-job.mjs
│
└─ User described a feature in natural language?
    └─ Read docs/integration/WORKFLOW_BUILDER_PROMPT.md — decompose into jobs/workflow first
```

## MUST / NEVER rules

| Rule | Detail |
|------|--------|
| **MUST** | Store `aim_sk_` only in server secrets (Supabase Edge Function `AI_ADMIN_API_KEY`) |
| **NEVER** | Put API keys in frontend, `VITE_*` env, or committed `.env` |
| **MUST** | Validate Supabase JWT via `supabase.auth.getUser()` in every Edge Function mode |
| **MUST** | Include `X-Forwarded-User-Id: <user.id>` for user-context calls (credentials, sessions) |
| **MUST** | Use `fetch()` + `ReadableStream` for SSE — not `supabase.functions.invoke()` |
| **MUST** | Set `callingApplication: "platform:project-name"` on job/chat calls (400 if missing) |
| **MUST** | Wait for SSE `data: [DONE]` before sending next message (409 if concurrent) |

## Base URL normalization

Vercel deployments need `/_/backend` suffix. Normalize in Edge Function:

```typescript
const rawBase = Deno.env.get("AI_ADMIN_BASE_URL") ?? "";
const AI_ADMIN_BASE_URL = rawBase.includes("/_/backend")
  ? rawBase.replace(/\/+$/, "")
  : rawBase.includes("localhost")
    ? rawBase.replace(/\/+$/, "")
    : rawBase.replace(/\/+$/, "") + "/_/backend";
```

## Auth headers

```http
Authorization: Bearer aim_sk_...
Content-Type: application/json
X-Forwarded-User-Id: <end-user-uuid>   # when acting on behalf of a user
```

## Common API calls

**One-shot completion:**
```json
POST /api/ai-matcher/run-slot
{ "prompt": "...", "slot": { "type": "profile", "profileId": "<uuid>" } }
```

**Templated job:**
```json
POST /api/processing-jobs/:id/test
{ "variables": { "companyName": "Acme" }, "callingApplication": "cursor:my-app" }
```
Optional header: `Idempotency-Key: <unique-id>` for safe retries (24h cache).

**Job eval (CI):**
```
POST /api/processing-jobs/:id/eval  → { total, passed, failed, cases[] }
```

**Config sync:**
```
POST /api/sync  → { profiles?, jobs?, workflows?, dryRun? }
```

**Streaming chat:**
```
POST /api/chat-sessions  → { workflowSlug, userId, callingApplication }
POST /api/chat-sessions/:id/messages  → SSE stream until [DONE]
```

**Resume a prior chat:**
```
POST /api/chat-sessions/resume  → { sessionId }  (or { externalChatId })
  → reactivates closed session, returns restored messages + completedSteps + workflowVariables
POST /api/chat-sessions/:id/messages  → continue (SSE)
```
Closing a session preserves its remote provider chat so it can be resumed. Use `fallbackToLocal: true` to continue via local history if the remote chat is gone.

## Workflow decomposition (intent → infrastructure)

When a user describes an AI feature:

1. **Plan** — break into 2–5 steps with dependencies; present plan; wait for confirmation.
2. **Build** — create processing jobs (prompt templates), then workflow with `inputMappings`/`outputMappings`.
3. **Wire** — open chat session with `workflowSlug`, trigger steps by `stepKey`, read `workflow_variables`.

See [docs/integration/WORKFLOW_BUILDER_PROMPT.md](../../docs/integration/WORKFLOW_BUILDER_PROMPT.md).

## Variable pipeline essentials

- `inputMappings`: job template `{{placeholder}}` → workflow variable name
- `outputMappings`: JSON path in LLM response → workflow variable name (top-level keys or dot/bracket paths like `"analysis.score"`)
- Auto-captured: `{stepKey}.prompt` and `{stepKey}.response` always available to later steps

## v1.4+ features (see API.md / CONCEPTS.md)

| Feature | When |
|---------|------|
| **Jobs-as-tools** | `ai_profiles.config.toolJobs[]` — UI: AI Profiles → **Jobs as tools**; v1 `tool.call`, v2 `function_call` |
| **devs-ai-v2** | Separate provider type: native JSON schema, cancel/reconnect Edge modes, `provider_metadata` threading |
| **Structured output** | Job `expectedSchema` — native on v2; build rules + optional `applyFormattingRules` on v2 |
| **Session compaction** | `chat_sessions.config.summarizer` — auto-summarize when context exceeds threshold |
| **Triggers** | Cron/event-driven job or workflow execution |
| **Config sync** | Git-managed slugs → `POST /api/sync` |
| **Assertion rules** | `require-keys`, `assert-json-schema`, `coerce-types`, `constrain-enum` on job output |
| **SDK** | `@ai-admin/client` in `packages/client` for typed server-side calls |

## Edge Function modes (Lovable / Supabase)

Reference implementation: [docs/integration/ai-admin-supabase-edge-function.ts](../../docs/integration/ai-admin-supabase-edge-function.ts)

| Mode | Use |
|------|-----|
| `ask-ai-profile` | One-shot completion |
| `run-processing-job` | Templated job |
| `open-chat-session` | Start streaming session |
| `resume-chat-session` | Continue a prior session (by `sessionId` or `externalChatId`) |
| `send-chat-message-stream` | Send message (SSE via fetch) |
| `submit-tool-outputs` | Resume after MCP/user tool action (SSE) |
| `cancel-chat-session` | Stop in-flight generation (**devs-ai-v2** only) |
| `reconnect-chat-stream` | Resume v2 SSE after disconnect (**devs-ai-v2** only) |
| `list-chat-sessions` | List the user's sessions (filter by `status`, `externalChatId`, …) |
| `get-chat-session` | Read session + workflow_variables |
| `store-user-credential` | Per-user provider API key |

Full mode catalog: [docs/integration/AI_ADMIN_LOVABLE_INTEGRATION.md §4](../../docs/integration/AI_ADMIN_LOVABLE_INTEGRATION.md#4-edge-function-modes-reference-implementation)

## Common pitfalls

- **409 Conflict** — only one in-flight message per session; disable send UI during stream
- **Snake_case on PUT** — use `ai_profile_id`, not `aiProfileId` (except inside `config` JSONB)
- **Rule sets** — identified by `key` string, not UUID; PUT replaces entire `ruleSets` array
- **No CORS** — browser must go through proxy, never call AI Admin directly

## Reference docs (read on demand)

| Doc | When |
|-----|------|
| [docs/INTEGRATION.md](../../docs/INTEGRATION.md) | Patterns, auth, pitfalls, TAM example |
| [docs/API.md](../../docs/API.md) | Endpoint contracts |
| [docs/CONCEPTS.md](../../docs/CONCEPTS.md) | Entity model, job vs workflow |
| [docs/integration/AI_ADMIN_LOVABLE_INTEGRATION.md](../../docs/integration/AI_ADMIN_LOVABLE_INTEGRATION.md) | Full handbook — SSE, MCP, attachments |
| [docs/integration/WORKFLOW_BUILDER_PROMPT.md](../../docs/integration/WORKFLOW_BUILDER_PROMPT.md) | Intent decomposition |
| [docs/manifest.json](../../docs/manifest.json) | Section-level navigation index |
