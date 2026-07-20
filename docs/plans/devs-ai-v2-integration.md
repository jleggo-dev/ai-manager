# Devs.ai API v2 Provider Integration Plan

**Status:** Implemented (Phase A–C)  
**Goal:** Add `devs-ai-v2` as a **separate** provider type alongside existing `devs-ai` (v1). Do not replace v1. Leverage Responses API v2 capabilities, especially native structured JSON output.

---

## Architecture review summary (Opus 4.8)

**Verdict:** APPROVE WITH CHANGES

Key revisions incorporated below:

1. **Adapter-first design** — `DevsAiV2Client implements LlmClient`; avoid parallel `provider.type === 'devs-ai-v2'` branches in `executeJobById` / `sendChatMessage` where the adapter suffices.
2. **`expectedSchema` converter required** — job `config.expectedSchema.fields` is AI Admin's custom format, NOT JSON Schema; must convert before `text.format.json_schema`.
3. **Basic v2 chat is nearly free** — `sendChatMessage` model path (`chatCompletionStream` at line ~1043) works once the adapter re-emits SSE shapes the route already parses.
4. **Tool loop is Phase B, not trivial** — v2 uses `POST /responses/{id}/resume` with camelCase `toolOutputs: [{ toolCallId, status, output }]` (not snake_case `tool_outputs` / OpenAI `function_call_output`); v1 uses `/tool-outputs` + `systemMessageId`. Parallel implementation required.
5. **Lazy thread open** — no remote call at `openChatSession` for v2; create thread on first message.
6. **`provider_metadata jsonb`** on `chat_sessions` for `previous_response_id`, `conversation_id`, `last_sequence` (Phase B+).
7. **Revised estimate:** Phase A 3–4d, Phase B 5–7d (tool loop), Phase C 3–4d → **~11–15 days total**.

---

## 1. Executive summary

Devs.ai's **Responses API v2** (`POST /api/v2/responses`) is OpenAI Responses–compatible and adds:

- Native `text.format` with `json_schema` (provider-enforced structured output)
- Threaded + stateless execution via `previous_response_id` / `conversation`
- Stream reconnect (`GET .../stream?lastSequence=`)
- Lifecycle: pause / resume / cancel
- Built-in tools: `python`, `web_search`, `mcp_server`, `image_generation`, `deep_research`, etc.
- `chat_mode`: `execute` | `chat` | `plan`
- `thread_mode`: `collect` | `steer` | `interrupt` | `force`
- `selection_metadata` (routing/failover visibility)

AI Admin today uses v1 exclusively (`/api/v1/chat/completions` + `/api/v1/chats/*`). JSON reliability depends on prompt + post-hoc build rules (`trim-to-json`, `assert-json-schema`, etc.). v2 lets us push schema enforcement to the provider and simplify job config for v2 profiles.

---

## 2. Design principles

| Principle | Decision |
|-----------|----------|
| No v1 replacement | `devs-ai` unchanged; all existing profiles/sessions/jobs keep working |
| Explicit provider type | `devs-ai-v2` — never fall through `|| !type` default to v1 |
| Shared abstractions where possible | Extend `LlmClient` or add `ResponsesClient` interface; reuse auth, timeout, diagnostics |
| Profile-level structured output | v2 profiles/jobs carry `responseFormat` / JSON schema in config, not only build rules |
| Build rules remain | Optional fallback for v2; required for v1; UI de-emphasizes JSON rules on v2 |
| Incremental delivery | Phase A: completions + structured output → Phase B: threaded chat → Phase C: stream reconnect + lifecycle |

---

## 3. Provider type: `devs-ai-v2`

### 3.1 Schema & validation

- `backend/src/schemas/providers.ts` — add `'devs-ai-v2'` to `createProviderSchema.type` enum
- `frontend/src/components/molecules/ProviderForm.tsx` — add option with label "Devs.ai (API v2)", default base URL `https://devs.ai`
- No DB migration required (`providers.type` is `text`)

### 3.2 New client module

**Path:** `backend/src/integrations/devs-ai-v2/client.ts`

**Class:** `DevsAiV2Client implements LlmClient` (adapter-first — primary contract)

```typescript
// LlmClient — used by executeJobById + sendChatMessage without new branches
chatCompletion(model, messages, options): Promise<ChatCompletionResponse>;
  // → POST /api/v2/responses { stream: false }
  // → map ResponseObject.usage → ChatCompletionUsage
  // → map output[] text → choices[0].message.content

chatCompletionStream(model, messages, options): Promise<Response>;
  // → POST /api/v2/responses { stream: true }
  // → re-emit SSE as shapes chat-sessions.ts already parses:
  //    choices[0].delta.content + synthetic message.complete with usage

// v2-native — Phase B/C only (tool loop, lifecycle)
createResponse / getResponse / reconnectStream / cancel / pause / resume(toolOutputs)
```

**Do NOT** introduce a separate `ResponsesClient` interface that forces call-site branching. Extend `client-factory` return unions: `DevsAiClient | GoogleGeminiClient | DevsAiV2Client`.

### 3.3 Client factory

`backend/src/integrations/client-factory.ts`:

```typescript
if (type === 'devs-ai-v2') return new DevsAiV2Client(baseUrl, apiKey);
if (type === 'devs-ai' || !type) return new DevsAiClient(...); // unchanged
```

Add `createDevsAiV2ClientForUser()` mirroring v1 pattern for user credentials.

### 3.4 SSE event parser

**Path:** `backend/src/integrations/devs-ai-v2/sse-parser.ts`

Parse OpenAI Responses streaming events:

- `response.output_text.delta` / `response.output_text.done`
- `response.output_item.added`
- `response.completed` / `response.failed`
- `response.server_tool_call.*` (devs.ai extensions)
- `sequence_number` on every event
- Terminal `[DONE]`

Map to AI Admin's existing SSE proxy shape where possible (`message.complete`, deltas) so frontend changes are minimal in Phase A.

---

## 4. Runtime options (v2-specific)

**Extend** `backend/src/services/ai-profile-runtime-options.ts`:

```typescript
interface NormalisedRuntimeOptions {
  devs_ai: { ... };           // v1 only
  devs_ai_v2: {
    built_in_tools: string[];  // v2 tool types: function, web_search, python, mcp_server, ...
    parallel_tool_calls: boolean;
    chat_mode: 'execute' | 'chat' | 'plan';
    thread_mode: 'collect' | 'steer' | 'interrupt' | 'force';
    reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  };
  google_gemini: { ... };
}
```

**`buildProviderV2Options(runtimeOptions, jobConfig?)`** returns v2 request body fragments:

- `tools` from built_in_tools + job function tools
- `parallel_tool_calls`
- `chat_mode`, `thread_mode`
- `text.format` from job `expectedSchema` or profile `config.responseFormat`

**Frontend:** `frontend/src/lib/runtime-options.ts` — parallel `devs_ai_v2` section in profile editor when provider type is `devs-ai-v2`.

---

## 5. Structured output (native JSON)

### 5.1 Config sources (priority order)

1. **Job `config.expectedSchema.fields`** (existing UI — **AI Admin custom format**, NOT JSON Schema) → convert via `expectedSchemaFieldsToJsonSchema()` → v2 `text.format`:
   ```json
   {
     "format": {
       "type": "json_schema",
       "name": "job_output",
       "schema": { ... },
       "strict": true
     }
   }
   ```
   Converter must set `additionalProperties: false` and mark all properties `required` for OpenAI strict mode.
2. **Profile `config.responseFormat`** (new, optional) — default schema for all jobs on that profile
3. **Build rules** — skipped when native schema sent AND `!job.config.applyFormattingRules`; otherwise optional fallback

**Formatting rule skip** at `ai-manager/index.ts` ~line 473:
```typescript
if (provider.type === 'devs-ai-v2' && nativeSchemaSent && !jobConfig.applyFormattingRules) {
  // skip applyFormattingRules — provider enforced JSON
}
```

### 5.2 Job execution path changes

`executeJobById` — **no v2 branch needed** if adapter implements `LlmClient`:

- Existing flow: `createLlmClientForProvider` → `chatCompletion` → `applyFormattingRules`
- v2 changes: extend `buildProviderChatOptions` with `devs-ai-v2` branch (returns `tools`, `text`, `chat_mode` fragments); adapter maps to v2 body
- Add formatting-rule skip (§5.1) and `expectedSchemaFieldsToJsonSchema` in request builder

### 5.3 Assertion / eval

- `POST /api/processing-jobs/:id/eval` — v2 jobs should pass when provider returns valid JSON matching schema without `trim-to-json`
- Add eval cases in tests with strict schema jobs

---

## 6. Chat sessions

### Phase A — Basic chat (adapter-only, no new branches)

`sendChatMessage` already falls through to `client.chatCompletionStream` when no `external_chat_id` (line ~1043). A v2 `LlmClient` adapter that replays local history works immediately — **verify in live E2E, don't rebuild**.

`openChatSession` for v2: **no remote call at open** (unlike v1 agent chat). Leave `external_chat_id = null`; thread created lazily on first message.

### Phase B — Threading + jobs-as-tools

**Migration:** `chat_sessions.provider_metadata jsonb` for `{ previous_response_id, conversation_id, last_sequence }`.

**Threading optimization:** switch from full-history replay to `previous_response_id` to reduce token cost.

**Tool loop (high risk — parallel to v1, not reuse):**

| v1 | v2 |
|----|-----|
| SSE `tool.call` + `systemMessageId` | `function_call` events |
| `POST /api/v1/chats/{id}/tool-outputs` | `POST /api/v2/responses/{id}/resume` |
| `submitChatToolOutputs` in ai-manager | New `submitV2ToolOutputs` + branch in `chat-sessions.ts` SSE proxy |

Reuse `buildToolDefinitions()` from `tool-jobs.ts` for tool schemas; fulfillment still via `executeJobById`.

### Phase C — Lifecycle

- Stream reconnect: `GET /api/v2/responses/{id}/stream?lastSequence=` — **`last_sequence` persisted in DB**, not client memory
- pause / cancel / resume routes
- `resumeChatSession`: validate via `GET /api/v2/responses/{id}`

---

## 7. AI profile & frontend changes

### 7.1 Provider form

- Add `devs-ai-v2` to `PROVIDER_TYPES`
- Test provider endpoint: v2 health check = `POST /api/v2/responses` minimal stateless ping or list models if available

### 7.2 AiProfileManager

When selected provider is `devs-ai-v2`:

- Show v2 runtime options panel (tools, chat_mode, thread_mode, reasoning_effort)
- **Structured output section:** JSON schema editor or link to job-level schema
- Hide or collapse v1-only MCP tools panel until Phase C
- `profile_type` / `mode` semantics unchanged (agent vs model, completion vs chat)

### 7.3 ProcessingJobManager (Build Rules tab)

When job's AI profile uses `devs-ai-v2`:

- Banner: "Structured output is enforced by the provider when Expected Schema is set. JSON build rules are optional."
- Auto-disable suggestion of `trim-to-json` / `repair-json` when native schema active
- Keep assertion rules as optional validation layer

### 7.4 Diagnostics

- Log `selection_metadata`, `response.id`, `sequence_number` ranges in diagnostic sessions
- New diagnostic step: `v2-response-create`, `v2-stream-reconnect`

---

## 8. Routes & API surface

### 8.1 New/updated backend routes

| Route | Change |
|-------|--------|
| `POST /api/providers` | Accept `devs-ai-v2` |
| `POST /api/providers/:id/test` | v2 branch: minimal createResponse |
| `POST /api/ai-profiles/:id/test-chat` | v2 branch |
| `POST /api/processing-jobs/:id/test` | Uses executeJob → v2 path automatically |
| `POST /api/chat-sessions` | v2 open branch |
| `POST /api/chat-sessions/:id/messages` | v2 send branch |

### 8.2 Optional new endpoints (Phase C)

- `POST /api/chat-sessions/:id/reconnect-stream` — wrapper for v2 stream reconnect
- `POST /api/chat-sessions/:id/cancel` — v2 cancel

### 8.3 Config sync / ai-admin.config.json

- Support `providerType: "devs-ai-v2"` in sync manifest
- Cadence jobs can target v2 profiles with `expectedSchema` and reduced formattingRules

---

## 9. Testing strategy

### 9.1 Unit tests (new files)

| File | Coverage |
|------|----------|
| `backend/test/devs-ai-v2-client.test.ts` | Request building, SSE parser, error mapping (mock fetch) |
| `backend/test/devs-ai-v2-runtime-options.test.ts` | normalise + buildProviderV2Options |
| `backend/test/devs-ai-v2-structured-output.test.ts` | Schema → text.format mapping |
| `backend/test/devs-ai-v2-sse-parser.test.ts` | Event accumulation, sequence numbers |

### 9.2 Integration tests (mocked provider)

- `executeJobById` with v2 provider + expectedSchema → verifies `text.format` in request body
- Formatting rules skipped when native schema enabled

### 9.3 Live E2E tests (require API key)

Extend `e2e-live-provider-chat.test.ts` or add `e2e-devs-ai-v2.test.ts`:

1. Create `devs-ai-v2` provider + model profile
2. **Completion:** job with `expectedSchema` → response parses as JSON, keys present
3. **Chat:** open session → send message → non-empty streamed reply
4. **Tools:** job-as-tool on v2 chat profile → tool call fulfilled → continuation
5. **Assert:** `selection_metadata` present in diagnostics (if logged)

### 9.4 Regression

- All existing v1 tests must pass unchanged
- `npm run test --workspace=backend` full suite green
- Frontend typecheck + lint

---

## 10. Implementation phases (revised per architecture review)

### Phase A — Adapter + structured output + basic chat (MVP)

**Estimate:** 3–4 days

- [ ] `DevsAiV2Client implements LlmClient` (chatCompletion + chatCompletionStream with SSE re-emit)
- [ ] `expectedSchemaFieldsToJsonSchema()` converter
- [ ] Provider type enum + ProviderForm + factory union updates
- [ ] Extend `buildProviderChatOptions` with `devs-ai-v2` branch (not separate `buildProviderV2Options`)
- [ ] Formatting-rule skip at executeJobById ~line 473
- [ ] Provider `/test` branch (v2 may not have listModels — use minimal ping or models endpoint)
- [ ] Unit tests: usage mapping, skip-rules, SSE shape compatibility with chat-sessions route
- [ ] Live E2E: v2 completion with JSON schema + v2 chat round-trip (via model path)

### Phase B — Threading + jobs-as-tools

**Estimate:** 5–7 days (tool loop is protocol-divergent — highest risk)

- [ ] Migration: `chat_sessions.provider_metadata jsonb`
- [ ] `previous_response_id` threading
- [ ] v2 tool loop: parallel path in `chat-sessions.ts` + `submitV2ToolOutputs`
- [ ] Live E2E: jobs-as-tools on v2 chat profile

### Phase C — Lifecycle + polish

**Estimate:** 3–4 days

- [ ] Stream reconnect with DB-persisted `last_sequence`
- [ ] pause / cancel / resume routes
- [ ] Full v2 runtime options UI
- [ ] MCP via v2 `mcp_server` tool evaluation
- [ ] Docs (API.md, INTEGRATION.md, skills)

**Total revised estimate: ~11–15 days.** A-only slice (jobs + basic chat) delivers core value in ~5–6 days if tool loop deferred.

---

## 11. Files to create/modify (checklist)

### New files

- `backend/src/integrations/devs-ai-v2/client.ts`
- `backend/src/integrations/devs-ai-v2/types.ts`
- `backend/src/integrations/devs-ai-v2/sse-parser.ts`
- `backend/src/integrations/devs-ai-v2/request-builder.ts`
- `backend/test/devs-ai-v2-*.test.ts` (3–4 files)
- `backend/test/e2e-devs-ai-v2.test.ts`

### Modified files

- `backend/src/schemas/providers.ts`
- `backend/src/integrations/client-factory.ts`
- `backend/src/services/ai-profile-runtime-options.ts`
- `backend/src/ai-manager/index.ts` (executeJob, openChat, sendMessage, resume)
- `backend/src/routes/providers.ts` (test, model sync)
- `backend/src/routes/ai-profiles.ts` (test-chat)
- `backend/src/routes/chat-sessions.ts` (SSE handling if needed)
- `frontend/src/components/molecules/ProviderForm.tsx`
- `frontend/src/lib/runtime-options.ts`
- `frontend/src/components/organisms/AiProfileManager.tsx`
- `frontend/src/components/organisms/ProcessingJobManager.tsx`
- `docs/API.md` (v2 provider section)

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| v2 API drift from OpenAI spec | Pin to documented spec; integration tests against live API |
| Duplicate code v1/v2 | Shared `_request` helper, separate path prefixes |
| `external_chat_id` semantic overload | Document; `provider_type` disambiguates |
| Stream event format breaks UI | Adapter layer normalizes to existing SSE events |
| Encrypted provider keys (recent bug) | Always `hydrateAiProfileProviderKeys` on all paths |
| Hobby Vercel cron unrelated | No change |

---

## 13. Success criteria

- [ ] Can create `devs-ai-v2` provider in UI
- [ ] Processing job on v2 profile returns **valid JSON** matching `expectedSchema` without `trim-to-json` rule
- [ ] Chat session on v2 profile streams assistant reply
- [ ] Jobs-as-tools work on v2 chat (Phase B)
- [ ] All v1 tests still pass
- [ ] Live E2E suite includes v2 provider type
- [ ] PR reviewed and merged

---

## 14. Out of scope (v1)

- Migrating existing v1 profiles to v2
- Removing build rules for v1 providers
- Devs.ai v2 `deep_research` / `plan` mode UI (future)
- Replacing Google Gemini path
