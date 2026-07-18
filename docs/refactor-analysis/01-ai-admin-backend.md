# Refactor-Readiness Audit — AI Admin Backend

**Scope:** `backend/src/**` (routes, services, models, integrations, `ai-manager/`, middleware, db, lib, schemas, types) and `backend/test/**` (coverage context only).
**Method:** Full read of all hotspot files + targeted reads/greps across all ~100 backend source files; `npx tsc --noEmit` run for evidence (passes clean, 0 errors); no source edits made.

---

## 1. Executive Summary

The AI Admin backend is **structurally sound but operationally overloaded at the center**. Routes → models → db (`tenantFrom`) → Supabase is a clean, consistently-applied layering across ~20 route files and ~20 model files, type safety is good (TS compiles clean, `any` usage is now down to ~13 real occurrences across the whole `src/` tree — most prior "any" cleanup from `CODE_REVIEW_AND_TEST_PLAN.md` has landed), and security fundamentals (AES-256-GCM credential encryption, SSRF-guarded URL validation, secret sanitization before client responses, tenant-scoped queries via `AsyncLocalStorage`) are all present and used correctly where they're used.

The problems are concentrated, not diffuse:

1. **`backend/src/ai-manager/index.ts` (2,071 lines) is a P0 god-module.** It is simultaneously the job-execution engine, the chat-session orchestrator (open/resume/send/tool-loop/reconnect), the data-source bulk-upload pipeline, and the diagnostics wiring. 21 exported top-level functions live in one file with no internal module boundaries. Any refactor of Cadence's chat integration or of job execution touches this file first, and it currently has **no direct unit tests** (only exercised indirectly through e2e route tests).
2. **RBAC is inconsistently enforced.** `requireRole()` exists, is well-implemented (correctly branches on JWT vs. API-key auth and respects the API key's own assigned role), and is used on exactly **3 of 21** route files (`admin-users.ts`, `widget-health-checks.ts`, `health-checks.ts`). The other 18 — including `providers.ts`, `ai-profiles.ts`, `app-settings.ts`, `processing-jobs.ts`, `workflows.ts` — rely on tenant scoping alone, meaning **any** authenticated member of a workspace (or any API key issued with `member` role) can create/rotate LLM provider credentials, edit AI profiles, or rewrite global app settings for that workspace. This is `CODE_REVIEW_AND_TEST_PLAN.md` finding **AR2**, still fully valid and broader than the doc implies once you check file-by-file.
3. **SSE line-buffering logic is copy-pasted 4×** inside `routes/chat-sessions.ts` alone (lines 148, 487, 813, 959), plus a 5th near-duplicate in `services/v2-stream-events.ts`. This is exactly the kind of logic where a bugfix (e.g. the R1 "chunks split across TCP boundaries" fix already applied) is easy to apply in 4 of 5 places and miss the 5th.
4. **Three other size hotspots** (`routes/chat-sessions.ts` 1,082 lines, `services/formatting-rules.ts` 1,049 lines, `services/widget-health-checker.ts` 542 lines with a single 392-line function) mix HTTP/SSE plumbing, business logic, and (for widget-health-checker) browser automation + incident-state management in one file each.
5. **`types.ts` (505 lines) is an undifferentiated dump of 45 exported types** spanning config, auth, LLM client shapes, and every DB row — low risk to split (pure move, no logic change) but touched by nearly every other file, so it's a good "do first" mechanical win before anything else.

Overall: this is a **refactor-ready** codebase (clean compiles, decent test scaffolding, consistent conventions) — the debt is concentrated in ~6 files, not smeared across hundreds, which makes this a tractable P0/P1 list rather than a rewrite.

---

## 2. File Inventory

Every non-trivial file reviewed (line counts via `Get-ChildItem | Measure-Object -Line`, Jul 2026). Sorted by lines, descending, within each directory group.

### `ai-manager/`

| Path | Lines | Primary role | Flagged? | Priority |
|---|---|---|---|---|
| `ai-manager/index.ts` | 2071 | Job execution, chat session orchestration, tool-loop, data-source upload, diagnostics wiring | Y | **P0** |

### `routes/`

| Path | Lines | Primary role | Flagged? | Priority |
|---|---|---|---|---|
| `routes/chat-sessions.ts` | 1082 | REST + SSE endpoints for chat sessions | Y | **P0** |
| `routes/health-checks.ts` | 485 | Admin CRUD for API health-check config/runs/incidents (has `requireRole`) | Y | P2 |
| `routes/ai-profiles.ts` | 428 | AI profile CRUD, test-chat, tool discovery/OAuth (no `requireRole`) | Y | **P1** |
| `routes/providers.ts` | 393 | LLM provider CRUD, connectivity test, model listing (no `requireRole`) | Y | **P1** |
| `routes/widget-health-checks.ts` | 354 | Widget health-check CRUD + manual trigger (has `requireRole`) | Y | P2 |
| `routes/processing-jobs.ts` | 290 | Processing job CRUD, formatting test, eval, data-source upload (no `requireRole`) | Y | P2 |
| `routes/workflows.ts` | 252 | Workflow + step CRUD, dependency validation (no `requireRole`) | Y | P2 |
| `routes/user-data.ts` | 202 | GDPR/CCPA data purge across tables | Y | **P1** |
| `routes/workspaces.ts` | 173 | Workspace listing, member listing/role update | N | — |
| `routes/ai-matcher.ts` | 163 | AI/profile matching endpoint | N | — |
| `routes/auth.ts` | 158 | Auth bootstrap, user settings | N | — |
| `routes/user-credentials.ts` | 120 | Per-user provider API key management (no `requireRole`, but scoped to own `user_id`) | N | P3 |
| `routes/processing-job-groups.ts` | 104 | Processing job group CRUD | N | — |
| `routes/diagnostic-logs.ts` | 100 | Diagnostic log viewing/stats (no `requireRole`) | Y | P3 |
| `routes/triggers.ts` | 94 | Trigger CRUD | N | — |
| `routes/api-keys.ts` | 82 | API key list/create/delete (custom JWT-only guard, no `requireRole`) | N | P3 (see §4) |
| `routes/calling-applications.ts` | 79 | Calling application CRUD (no `requireRole`) | Y | P3 |
| `routes/admin-users.ts` | 64 | User listing/status update (has `requireRole('owner','admin')`) | N | — |
| `routes/cron.ts` | 61 | Vercel cron tick endpoint for schedulers | N | — |
| `routes/app-settings.ts` | 48 | Global/workspace app settings CRUD (**zero** auth beyond tenant scope) | Y | **P1** |
| `routes/sync.ts` | 27 | Config sync trigger endpoint | N | — |

### `services/`

| Path | Lines | Primary role | Flagged? | Priority |
|---|---|---|---|---|
| `services/formatting-rules.ts` | 1049 | Chain of text-transform rules applied to AI responses + validators | Y | **P1** |
| `services/widget-health-checker.ts` | 542 | Puppeteer-driven widget health checks + incident state | Y | **P1** |
| `services/ai-diagnostics.ts` | 309 | Diagnostic log capture (timings, payloads) for AI calls | N | P2 |
| `services/tool-jobs.ts` | 88 | Exposes processing jobs as model-callable tools | N | — |
| `services/v2-stream-events.ts` | 189 | Shared SSE ingestion for Devs.ai V2 streams | Y | P2 (duplication, see §4/§5) |
| `services/config-sync.ts` | 176 | Syncs `ai-admin.config.json` jobs/profiles into DB | N | — |
| `services/ai-profile-runtime-options.ts` | 170 | Runtime option resolution for AI profiles | N | — |
| `services/health-checker.ts` | 150 | API health-check execution logic | N | — |
| `services/llm-models-seed.ts` | 220 | Seeds default LLM model catalog | N | — |
| `services/session-compaction.ts` | 103 | Summarizes older chat turns for context management | N | P3 |
| `services/attachment-resolver.ts` | 114 | Downloads/validates chat attachments (SSRF-guarded) | N | — |
| `services/job-eval.ts` | 122 | Processing job evaluation harness | N | — |
| `services/expected-schema-validation.ts` | 115 | Validates job output against expected JSON schema | N | — |
| `services/expected-schema-to-json-schema.ts` | 72 | Converts internal schema format to JSON Schema | N | — |
| `services/settings-seed.ts` | 71 | Seeds default app settings | N | — |
| `services/trigger-runner.ts` | 63 | Executes triggers | N | — |
| `services/widget-health-check-scheduler.ts` | 53 | Interval scheduler for widget checks | N | — |
| `services/health-check-scheduler.ts` | 47 | Interval scheduler for API health checks | N | — |
| `services/idempotency.ts` | 48 | Idempotency-key dedup for mutating requests | N | — |
| `services/internal-triggers.ts` | 34 | Internal trigger dispatch | N | — |

### `integrations/`

| Path | Lines | Primary role | Flagged? | Priority |
|---|---|---|---|---|
| `integrations/devs-ai/client.ts` | 532 | Low-level HTTP client for Devs.ai v1 REST API | Y | **P1** |
| `integrations/devs-ai-v2/client.ts` | 300 | Devs.ai v2 client (streaming-first) | Y | P2 |
| `integrations/google-gemini/client.ts` | 279 | Google Gemini API client | N | P2 |
| `integrations/devs-ai-v2/request-builder.ts` | 164 | Builds v2 request payloads | N | — |
| `integrations/devs-ai-v2/sse-transform.ts` | 122 | Transforms v2 SSE chunks | N | (dup risk, see §4) |
| `integrations/client-factory.ts` | 67 | Factory resolving provider → `LlmClient` | N | — |
| `integrations/devs-ai-v2/types.ts` | 38 | v2 client type defs | N | — |

### `models/`

| Path | Lines | Primary role | Flagged? | Priority |
|---|---|---|---|---|
| `models/health-checks.ts` | 384 | CRUD for health-check keys/profiles/checks/runs/incidents + key decryption | Y | P2 |
| `models/chat-sessions.ts` | 249 | Chat session/message CRUD, counters, concurrency lock | Y | P2 (SD1) |
| `models/widget-health-checks.ts` | 245 | Widget health-check CRUD | N | — |
| `models/diagnostic-logs.ts` | 237 | Diagnostic log CRUD/stats | N | — |
| `models/workflows.ts` | 213 | Workflow/step CRUD | N | — |
| `models/profiles.ts` | 163 | User profile CRUD | N | — |
| `models/ai-profiles.ts` | 147 | AI profile CRUD, key hydration, default-profile RPC | N | — |
| `models/processing-jobs.ts` | 110 | Processing job CRUD, deep-merge config | N | P3 (dead-code check) |
| `models/llm-models.ts` | 98 | LLM model catalog CRUD | N | — |
| `models/calling-applications.ts` | 84 | Calling application CRUD | N | — |
| `models/user-provider-credentials.ts` | 78 | Per-user provider credential CRUD | N | — |
| `models/providers.ts` | 66 | Provider CRUD, key encrypt/decrypt | N | — |
| `models/processing-job-groups.ts` | 53 | Job group CRUD | N | — |
| `models/app-settings.ts` | 42 | App settings CRUD (tenant-scoped) | N | — |
| `models/triggers.ts` | 36 | Trigger CRUD | N | — |
| `models/index.ts` | 4 | Re-exports / health check | N | — |

### `middleware/`, `db/`, `lib/`, `schemas/`, top-level

| Path | Lines | Primary role | Flagged? | Priority |
|---|---|---|---|---|
| `types.ts` | 505 | 45 exported types: config, auth, LLM client, all DB rows | Y | P2 |
| `middleware/auth.ts` | 183 | JWT/API-key auth, workspace scoping, `AsyncLocalStorage` context | N | — |
| `app.ts` | 149 | Express app wiring, global middleware, router mounting | N | — |
| `lib/browser.ts` | 144 | Headless Chromium launcher (Puppeteer/`@sparticuz/chromium`) | N | — |
| `lib/entity-validators.ts` | 141 | Reference-existence + workflow-dependency validation | N | — |
| `db/tenant.ts` | 105 | `AsyncLocalStorage`-based tenant scoping, `tenantFrom`/`tenantInsertPayload` | N | — |
| `middleware/require-role.ts` | 53 | RBAC middleware (JWT + API-key role branches) | N | — |
| `lib/pagination.ts` | 71 | Cursor pagination parsing/response building | Y | P2 (under-adopted, see §6) |
| `lib/crypto.ts` | 82 | AES-256-GCM encrypt/decrypt for stored credentials | N | — |
| `lib/url-validator.ts` | 84 | SSRF-guard for outbound URL fetches | N | — |
| `lib/safe-error.ts` | 51 | Error message sanitization for client responses | N | — |
| `lib/sanitize.ts` | 42 | Strips secret-shaped keys before client responses | N | — |
| `config.ts` | 27 | Env-var-backed app config singleton (fail-fast on missing) | N | — |
| `index.ts` | 92 | Process bootstrap, scheduler start/stop, graceful shutdown | N | — |
| `db/service-supabase.ts` | 20 | Service-role Supabase client (bypasses RLS — bootstrap/seeds only) | N | — |
| schemas/*.ts (9 files) | 16–94 | Zod request schemas per route group | N | — |

**Coverage note:** ~100 files scanned; every file >100 lines was opened and read in full or in targeted sections; files <100 lines were scanned via grep for the rubric's red flags (any/!, TODO, missing validation) with no additional findings beyond what's listed.

---

## 3. Cross-Reference to `CODE_REVIEW_AND_TEST_PLAN.md`

| ID | Original finding | Status | Note |
|---|---|---|---|
| C1–C9 | Round-1 security/config fixes (regex injection, prototype pollution, key leakage, race condition, fail-fast env, etc.) | **Already fixed** | Verified in code: `escapeRegex` present in `formatting-rules.ts`; `deepMerge` in `processing-jobs.ts` filters `__proto__`/`constructor`/`prototype`; `config.ts` uses `requireEnv()`; `getAiProfile` vs `getAiProfileWithKeys` split confirmed in `models/ai-profiles.ts`. |
| H1–H12 | Round-1 High fixes (discriminated `RequestAuthContext`, attachment timeout, Gemini key header move, etc.) | **Already fixed** | Confirmed `RequestAuthContext = JwtAuthContext \| ApiKeyAuthContext` in `types.ts:25`; Gemini client uses `x-goog-api-key` header. |
| M1–M17, L1–L12 | Round-1 Medium/Low fixes | **Already fixed** | Spot-checked several (`errorMessage()` utility present and used repo-wide; `_resetServiceSupabaseForTesting()` present in `service-supabase.ts:21`). Not exhaustively re-verified — out of scope depth for this pass. |
| R1–R8 | Round-2 fixes (SSE line-buffering, `api_key` leak via join, malformed-JSON 400, ESLint `.ts` glob, etc.) | **Already fixed, but R1's fix is now itself the duplication problem** | Line-buffering was added in "both" SSE handlers per R1, but there are now **4** buffering blocks in `chat-sessions.ts` (148, 487, 813, 959) plus 1 in `v2-stream-events.ts` — the fix pattern was copy-pasted rather than centralized. This audit's §4/§5 findings supersede R1 by recommending extraction into one shared reader. |
| SD1 | `incrementSessionCounters` retry path uses plain UPDATE, not atomic CAS | **Still valid** | Confirmed at `models/chat-sessions.ts:117-143`: primary path has optimistic-lock `.eq('message_count', ...)`, but the retry-on-conflict fallback (line 139) calls `updateChatSession()` with a plain (non-conditional) update — a second concurrent writer can still lose an increment in the retry path. |
| SD4 | `splitRowsByByteCap` O(n²) for large row sets | **Still valid** | Confirmed at `ai-manager/index.ts:2230-2251` — `payloadBytes(candidate)` re-serializes the whole growing candidate array on every row appended. |
| SD6 | `isPublicPath` uses prefix match | **Still valid** | Confirmed at `middleware/auth.ts:35-37`: `p.startsWith('/api/auth/')` — any future route under `/api/auth/*` is automatically unauthenticated. |
| SD7, SD8 | Provider key masking reveals plaintext chars; `provider.api_key!` non-null assertions in test routes | **Not re-verified this pass** | Noted as still-open by the prior review; not independently re-confirmed with line numbers here — flagged for the supervisor to fold in as-is from the prior doc. |
| SD9 | ~68 remaining `any` in backend | **Substantially fixed** | Current count is **~13** real `any` usages backend-wide (grep for `\bany\b` then manually excluding comment/string false-positives), concentrated in `devs-ai/client.ts`, `url-validator.ts`, `expected-schema-validation.ts`, `entity-validators.ts`, `health-check-scheduler.ts`, `widget-health-check-scheduler.ts`, `client-factory.ts`, `devs-ai-v2/request-builder.ts`, `chat-sessions.ts` (×2). Good progress; recommend finishing the remaining ~13 as a P3 cleanup item rather than re-treating as systemic. |
| SD10, SD11 | `getChatSessionStats` 0-average edge case; rate-limit cache thundering herd | **Not re-verified this pass** | Out of the depth budget for this scope; carry forward as-is. |
| **DM1** | No CI/CD pipeline | **Still valid** | Confirmed: no `.github/workflows/` directory anywhere in the repo. This is the single highest-leverage fix available — every other finding in this report (and the prior doc) becomes safer to act on once `tsc --noEmit` + `eslint` + `vitest run` run on every PR. |
| **DM2, DM4** | Test coverage near zero; no test framework | **Partially fixed, but a critical gap remains** | `vitest` + `supertest` are now the test framework (`package.json` scripts confirm), and `backend/test/` has dozens of files (route-level and service-level tests, several `e2e-*.test.ts`). However, **`ai-manager/index.ts` — the largest and most business-critical file — has no direct unit tests.** Only one test (`json-path.test.ts`) even imports from it, and only to reach an unrelated helper (`extractAndAccumulateOutputs`). All coverage of `executeJob`, `openChatSession`, `resumeChatSession`, `sendChatMessage`, `submitChatToolOutputs`, and `uploadApiDataSourcesChunked` is indirect, via HTTP-level tests against the routes that call them. This is exactly backwards for a refactor: the file most in need of characterization tests before extraction has the least direct coverage. |
| DM3 | `ProcessingJobManager.tsx` 4,077 lines | **Out of scope** | Frontend file — not in this agent's assigned scope; flagged for whichever agent owns `frontend/`. |
| DM5–DM9 | No CONTRIBUTING.md, no Prettier, no pre-commit hooks, type drift FE/BE, legacy `.js` refs | **Not re-verified this pass** | No evidence contradicting the prior doc; carry forward as-is. |
| AR1 | No input validation library — ad-hoc checks | **Substantially fixed, one gap remains** | Zod (`validateBody`/`validateQuery` in `middleware/validate.ts`) is now used across most mutating routes (`ai-profiles.ts`, `providers.ts`, `processing-jobs.ts`, `workflows.ts`, `app-settings.ts`, etc.). Gap: **path params are still validated ad-hoc or not at all** — e.g. `routes/app-settings.ts:23,34,45` use `req.params.key` directly with no format/length check, and several `:id` params across routes are passed straight into Supabase `.eq('id', ...)` without UUID-shape validation (relies on Postgres erroring, not a clean 400). |
| **AR2** | No RBAC enforcement — any workspace member has admin access | **Still valid — confirmed and scoped precisely** | `requireRole()` (`middleware/require-role.ts`) is well-built (correctly handles both JWT-membership-lookup and API-key `apiKeyRole` branches) but is only wired up on **3 of 21** route files: `admin-users.ts`, `widget-health-checks.ts`, `health-checks.ts`. Missing on `providers.ts`, `ai-profiles.ts`, `app-settings.ts`, `processing-jobs.ts`, `workflows.ts`, `calling-applications.ts`, `diagnostic-logs.ts`, `user-credentials.ts` (see §4 for per-file detail; all within-tenant, not cross-tenant, so graded P1 not P0 — see note in §4). |
| AR3 | No pagination — unbounded list queries | **Partially fixed** | `lib/pagination.ts` (cursor-based, `validateCursorParam`) exists and is adopted in `chat-sessions.ts`, `ai-profiles.ts`, `calling-applications.ts`, `diagnostic-logs.ts`, `workflows.ts`, `admin-users.ts`, `providers.ts`, `processing-jobs.ts` (8 files). Still-unbounded plain `.select()` (capped only by a flat `.limit(1000)` per the L8 fix, not true cursor pagination) remain in some model-layer list functions, e.g. `models/app-settings.ts:14` (`.limit(1000)`), `models/health-checks.ts` list functions. Recommend finishing the cursor-pagination rollout to the remaining list endpoints. |
| AR4 | Console-only logging | **Still valid** | No structured logger found anywhere in `backend/src`; every file uses `console.log`/`console.error`/`console.warn` directly. |
| AR5 | No migration tooling | **Still valid, and worse than described** | No `.sql` migration files exist anywhere in the repo (searched `**/*.sql`, zero matches). RLS policies and table DDL are entirely undocumented/unversioned in-repo, which also means **this audit cannot verify tenant-isolation guarantees from source alone** — see §6. |
| AR6 | Analytics O(N) in-memory aggregation | **Not re-verified this pass** | Carry forward as-is (not in the explicitly-named hotspot list; not independently located this pass). |
| AR7 | Vercel SSE duration limits | **Still valid / architectural** | `chat-sessions.ts` and `ai-manager/index.ts` both do long-lived SSE writes; `index.ts:73-81` in the process bootstrap explicitly branches on `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME` to skip in-process interval schedulers, confirming serverless constraints are already partially designed around, but SSE duration limits themselves aren't mitigated in code — architectural, no in-repo fix expected. |
| AR8 | No frontend data-fetching cache | **Out of scope** | Frontend concern. |
| AR9 | JSONB config columns unvalidated | **Still valid** | `WorkflowConfig`, `WorkflowStepConfig`, `ProcessingJobRow.config` (`types.ts:239-250, 172-187`) are typed as loose interfaces/`Record<string, unknown>`-shaped but not Zod-validated on write; validation for job `config` happens ad hoc inside `ai-manager/index.ts` job-execution logic rather than at the API boundary. |
| AR10, AR11 | No API versioning; no OpenAPI spec | **Still valid** | No `/api/v1/` prefix, no OpenAPI generation found. |

---

## 4. Detailed Per-File Refactor Plans (P0/P1/P2)

### P0 — `backend/src/ai-manager/index.ts` (2071 lines)

**Current problems**
- Single file exports 21 top-level async functions spanning 5 distinct responsibilities: job execution (`executeJob` 268-301, `executeJobById` 302-685, `executeRawPrompt` 686-730), chat session lifecycle (`openChatSession` 731-926, `resumeChatSession` 927-1093, `sendChatMessage` 1094-1411, `submitChatToolOutputs`/`submitV2ToolOutputs`/`updateV2ProviderMetadata`/`cancelV2ChatResponse`/`reconnectV2ChatStream` 1412-1610, session CRUD wrappers 1611-1850), bulk data-source upload (`uploadApiDataSourcesChunked` 1851-2083, `splitRowsByByteCap` 2230-2251), tool-call plumbing (`extractAndAccumulateOutputs` 2084-2158, `fulfillPendingToolJobCalls` 2159-2229), and diagnostics wiring threaded through all of the above.
- `splitRowsByByteCap` (2230-2251) is O(n²) — re-serializes the growing chunk on every row (SD4, still valid).
- **No direct unit tests.** Only `test/json-path.test.ts` imports from this module (for an unrelated helper). All 21 exported functions are exercised only transitively via `routes/chat-sessions.ts` and `routes/processing-jobs.ts` HTTP tests — meaning a refactor here has no fast, isolated regression signal.
- High coupling: functions here reach into `models/*`, `integrations/*`, `services/formatting-rules.ts`, `services/ai-diagnostics.ts`, `services/tool-jobs.ts`, `services/v2-stream-events.ts`, and `services/session-compaction.ts` directly, with no facade — every consumer of "AI Manager" (both AI Admin routes and, in-process, Cadence's `@ai-admin/core` boundary) depends on this one file's shape.

**Proposed target design**
Split into a directory `ai-manager/` with a thin `index.ts` barrel re-exporting the current public surface (so `@ai-admin/core` and existing route imports don't break), backed by:
- `ai-manager/job-execution.ts` — `executeJob`, `executeJobById`, `executeRawPrompt` (provider/profile resolution, prompt interpolation, LLM call, formatting, diagnostics for one-shot job runs).
- `ai-manager/chat-session-lifecycle.ts` — `openChatSession`, `resumeChatSession`, `closeChatSession`, `resetChatSession`, `removeChatSession`, `purgeRemoteChatsForUser`, `getChatSessionFiles`, `getChatHistory`, `recordAssistantMessage`.
- `ai-manager/chat-messaging.ts` — `sendChatMessage`, `submitChatToolOutputs`, `submitV2ToolOutputs`, `updateV2ProviderMetadata`, `cancelV2ChatResponse`, `reconnectV2ChatStream`.
- `ai-manager/tool-fulfillment.ts` — `extractAndAccumulateOutputs`, `fulfillPendingToolJobCalls`.
- `ai-manager/data-source-upload.ts` — `uploadApiDataSourcesChunked` and a fixed, streaming (non-O(n²)) `splitRowsByByteCap` that tracks a running byte counter instead of re-serializing the accumulator each iteration.

**Step-by-step migration plan**
1. **Land test coverage first** (see below) against the *current* file, red/green, before moving a single line.
2. Extract `data-source-upload.ts` first (lowest coupling, single call-site family in `routes/processing-jobs.ts`) — fix the O(n²) `splitRowsByByteCap` in the same PR since it's isolated and low-risk once the file is standalone.
3. Extract `tool-fulfillment.ts` next (used by both `chat-messaging.ts` and `routes/chat-sessions.ts`'s internal tool-job loop — extracting it clarifies that shared dependency).
4. Extract `job-execution.ts`.
5. Split the remaining chat-session code into `chat-session-lifecycle.ts` and `chat-messaging.ts` last (highest line count, highest fan-in from `routes/chat-sessions.ts`).
6. Keep `ai-manager/index.ts` as a re-export barrel through all steps so no import site outside this file needs to change until a final cleanup pass.

**Test-first requirements**
- Before any extraction: add direct unit tests (mocking `models/*` and the LLM client via existing test doubles used elsewhere in `backend/test/`) for at minimum `executeJobById`, `openChatSession`, `sendChatMessage`, and `uploadApiDataSourcesChunked` — these are the 4 functions with the most branching and the most external callers.
- After each extraction step: the full existing e2e suite (`e2e-resume-chat.test.ts`, `e2e-session-lifecycle.test.ts`, `e2e-live-provider-chat.test.ts`, `e2e-devs-ai-v2-tools.test.ts`, `e2e-concurrency-lock.test.ts`, `e2e-calling-application.test.ts`, `chat-sessions*.test.ts`) must pass unchanged, plus the new unit tests from step 1.

**Dependencies/blockers:** Must land after (or alongside) DM1 (CI) so regressions are caught automatically, not manually. Should land before any Cadence-side refactor that touches `@ai-admin/core`'s chat surface, since Cadence consumes this in-process.

**Priority / Effort / Risk:** P0 / **L** (needs the 5-step phasing above; each step is roughly M on its own) / **High** (largest blast radius file in the backend; both AI Admin and Cadence depend on its exported shape).

---

### P0-adjacent — `backend/src/routes/chat-sessions.ts` (1082 lines)

**Current problems**
- 4 independent SSE line-buffering blocks doing the same job (accumulate into `lineBuffer`, `split('\n')`, process complete lines, retain partial tail) at lines 148, 487, 813, 959 — each inside a different handler (`runInternalToolJobLoop` at 72-186, and three separate route handlers).
- `authorizeSessionAccess` (187-...) is a reasonable extraction already in place — good pattern, just not applied to the SSE reading logic.
- Route file mixes REST handlers, SSE streaming handlers, and an internal tool-job execution loop (`runInternalToolJobLoop`, 72-186) that arguably belongs closer to `ai-manager/tool-fulfillment.ts` (see above) rather than in the routes layer.
- No `requireRole` — acceptable here specifically, since chat sessions are naturally user/member-scoped rather than admin-scoped, but worth an explicit code comment/test asserting that intentionally.

**Proposed target design**
- Extract a single `services/sse-line-reader.ts` exporting a small reusable reader (e.g. `readSseLines(stream, onLine)` or an async generator `for await (const line of sseLines(stream))`) and replace all 4 in-file occurrences plus the analogous one in `services/v2-stream-events.ts` (see cross-boundary/duplication note below — this is the same bug class as R1).
- Move `runInternalToolJobLoop` into `ai-manager/tool-fulfillment.ts` (from the P0 plan above) so route files stay HTTP-shape-only.

**Step-by-step migration plan**
1. Write characterization tests around the 4 existing SSE handlers' line-buffering behavior (partial-chunk-across-boundary case, matching the R1 regression) if not already covered by `e2e-resume-chat.test.ts`/`e2e-devs-ai-v2-tools.test.ts`.
2. Extract `services/sse-line-reader.ts`, unit-test it directly (feed it deliberately split chunks).
3. Replace the 4 call sites one at a time, running the e2e suite after each.
4. Replace the `v2-stream-events.ts` occurrence in the same pass so there's exactly one implementation.
5. Move `runInternalToolJobLoop` in a follow-up PR once `ai-manager/tool-fulfillment.ts` exists.

**Test-first requirements:** e2e SSE tests must cover a deliberately-chunked-mid-line response before refactor (to prove the R1 regression can't recur); all must still pass after.

**Dependencies/blockers:** Step 4/5 depend on the `ai-manager/index.ts` split landing first (or at least `tool-fulfillment.ts` existing).

**Priority / Effort / Risk:** P1 / M / Medium (well-isolated logic, but SSE correctness bugs are easy to reintroduce without careful testing).

---

### P1 — `backend/src/services/formatting-rules.ts` (1049 lines)

**Current problems**
- Single file holds the rule registry, every individual rule implementation (`removeReasoning`, `trimToOnlyJson`, `repairBrokenJson`, CSV/JSON isolation rules, etc.), and validation helpers. `RULE_REGISTRY` and `applyFormattingRules` are the only two things routes/services actually need; the ~15+ individual rule functions are implementation detail currently living at the same level.
- High cyclomatic complexity concentrated in the JSON-repair rules (`repairBrokenJson` and related "Strategy A/B/C" string-closing logic around line 490) — this is inherently fiddly string-repair code, which is exactly the kind of logic that most benefits from being isolated with a large, fast, table-driven test file (one exists: `formatting-rules.test.ts` — good sign).

**Proposed target design**
- `services/formatting-rules/index.ts` — `RULE_REGISTRY`, `applyFormattingRules` (the public surface).
- `services/formatting-rules/rules/` — one file per rule family (e.g. `json-rules.ts`, `csv-rules.ts`, `reasoning-rules.ts`), each exporting its rule object(s) for registration.
- `services/formatting-rules/validators.ts` — the validation helper functions.

**Step-by-step migration plan**
1. Confirm `formatting-rules.test.ts` coverage is rule-by-rule (not just end-to-end through `applyFormattingRules`) — add missing per-rule tests first if any rule lacks direct coverage.
2. Move rule families out one at a time behind the existing `RULE_REGISTRY` export shape (pure move, no behavior change).
3. Re-run `formatting-rules.test.ts` after each move.

**Test-first requirements:** Every entry in `RULE_REGISTRY` should have at least one direct unit test exercising it in isolation before the split (not just through `applyFormattingRules`'s end-to-end chain), so a moved rule's behavior is independently verifiable.

**Dependencies/blockers:** None — fully independent of the `ai-manager/index.ts` work, can be done in parallel.

**Priority / Effort / Risk:** P1 / M / Low (pure organizational split, strong existing test file reduces risk).

---

### P1 — `backend/src/services/widget-health-checker.ts` (542 lines)

**Current problems**
- `executeWidgetHealthCheck` (168-560) is a single ~392-line function doing browser launch, page navigation, chat-widget interaction, response verification, screenshot capture, and timing/result assembly all inline.
- Mixes Puppeteer orchestration (infrastructure concern) with health-check business logic (pass/fail criteria, incident-state semantics) and screenshot/artifact handling.

**Proposed target design**
- `services/widget-health-checker/browser-session.ts` — launch/navigate/teardown (wraps `lib/browser.ts`).
- `services/widget-health-checker/widget-interaction.ts` — locate widget, send probe message, wait for response.
- `services/widget-health-checker/result-assembly.ts` — build `WidgetHealthCheckResult`, screenshot capture/attach.
- `services/widget-health-checker/index.ts` — orchestrates the three above, keeps `executeWidgetHealthCheck` and `runAndRecordWidgetCheck` as the public surface.

**Step-by-step migration plan**
1. Add/confirm integration-level tests using the existing `probePuppeteer`/`isPuppeteerAvailable` gating (so tests skip gracefully where Chromium isn't available, matching current pattern) covering at least one full pass/fail run.
2. Extract `browser-session.ts` first (least business logic, easiest to verify via a smoke test).
3. Extract `result-assembly.ts`.
4. Extract `widget-interaction.ts` last (most business-logic-dense).

**Test-first requirements:** At least one end-to-end pass and one failure-path test (widget doesn't respond in time) must exist and pass before splitting, since the 392-line function's control flow (timeouts, retries, screenshot-on-failure) is the highest-complexity part of this file.

**Dependencies/blockers:** None.

**Priority / Effort / Risk:** P1 / M / Medium (Puppeteer/browser-timing tests are inherently flakier than pure-logic tests — budget extra time for de-flaking).

---

### P1 — `backend/src/integrations/devs-ai/client.ts` (532 lines)

**Current problems**
- `DevsAiClient` class (42-...) has ~28 methods spanning 5 API surface areas: AI/chat-completion (129-264), chat-session messaging (265-360), tools/OAuth (361-417), tool-output submission (418-472), and files/data-sources (473-565). All on one class.
- Reasonable internally (M10 fix already extracted a shared `callWithClient` helper; M11 already made `_request` generic) — this file has already absorbed several prior-review fixes well. The remaining issue is pure size/cohesion, not correctness.

**Proposed target design**
- Keep `DevsAiClient` as a single class (callers construct one client per provider config — splitting into multiple classes would multiply construction boilerplate for no benefit), but split the **method bodies** into mixins/composed modules if the class keeps growing, or at minimum group methods with `// --- Chat ---` / `// --- Tools ---` / `// --- Files & Data Sources ---` section comments and matching method ordering (low-effort, high-readability win) as an interim step before a full split.
- If a full split is desired: `devs-ai/chat.ts`, `devs-ai/tools.ts`, `devs-ai/files.ts`, `devs-ai/data-sources.ts`, each exporting a set of functions that take the shared `_request` helper as a parameter, composed into `DevsAiClient` via delegation.

**Step-by-step migration plan**
1. Low-risk first step: reorder/section-comment the existing methods by API surface (no logic change) — immediate readability win, zero risk.
2. If further split is warranted after that, extract `files.ts`/`data-sources.ts` methods first (least central to hot paths), leaving `chat.ts` methods (most heavily used, by `ai-manager/index.ts`) for last.

**Test-first requirements:** Existing client tests (check `backend/test/` for a `devs-ai-client.test.ts` equivalent — confirm coverage per-method) should be method-addressable so extraction can be verified incrementally.

**Dependencies/blockers:** None.

**Priority / Effort / Risk:** P1 / S (for the section-comment step) to M (for a full split) / Low.

---

### P1 — RBAC gaps across route files (cross-file finding, treated as one item)

**Current problems** — `requireRole()` (`middleware/require-role.ts`) is correctly implemented but wired into only 3 of 21 route files. Missing on:
- `routes/providers.ts` (all 12 routes, 83-434) — LLM provider credentials (encrypted at rest, but any workspace member can create/rotate/delete them and trigger `/test` connectivity checks that make outbound calls with those credentials).
- `routes/ai-profiles.ts` (all 13 routes, 80-472) — AI profile CRUD, including OAuth token deletion (472).
- `routes/app-settings.ts` (all 4 routes, 13-53) — **zero** auth beyond tenant scope; any member can `PUT`/`DELETE` arbitrary settings keys for the workspace.
- `routes/processing-jobs.ts`, `routes/workflows.ts`, `routes/calling-applications.ts`, `routes/diagnostic-logs.ts`, `routes/user-credentials.ts` — same pattern.
- `routes/api-keys.ts` is a **partial exception**: it blocks API-key-mode callers from managing API keys at all (lines 21-24, 44-47, 81-84 each check `ctx?.mode === 'api_key'` and 403), but any JWT member (regardless of role) can still create an `admin`-role API key or delete another member's key — no `requireRole` gate on the JWT path.

Note on severity: because `db/tenant.ts` scoping is intact everywhere reviewed, these are **within-tenant** privilege-escalation gaps (a low-privilege member acting as admin inside their own workspace), not cross-tenant data leaks — hence P1 rather than P0 under this rubric's scale, but still a real, easily-exploited gap given how sensitive several of these resources are (credentials, global settings).

**Proposed target design:** Add `requireRole('owner', 'admin')` to the mutating routes (POST/PUT/DELETE) in `providers.ts`, `ai-profiles.ts`, `app-settings.ts`, `processing-jobs.ts`, `workflows.ts`, `calling-applications.ts`, `api-keys.ts` (JWT path); consider whether GET/list routes should stay member-readable (likely yes, for most) vs. also gated (e.g. `diagnostic-logs.ts` may contain sensitive prompt/response content — worth a product decision, not just an engineering one).

**Step-by-step migration plan**
1. Enumerate every mutating route (POST/PUT/PATCH/DELETE) across the 8 named files — this list is already fully enumerated above/in §2.
2. Add `requireRole('owner', 'admin')` per-route (not per-router, since some GETs should likely stay member-accessible) — mirror the exact pattern already used in `health-checks.ts`/`widget-health-checks.ts`.
3. Add API-key-mode negative tests confirming a `member`-role key gets 403 on each newly-gated route (the `requireRole` implementation already supports this branch — just needs test coverage and the middleware wired in).
4. Add JWT-mode negative tests confirming a `member`-role user gets 403.

**Test-first requirements:** For each of the 8 files, a test asserting current (gap) behavior should be written first to make the fix's effect visible in the diff (a 200→403 flip for a `member`-role caller), then flipped to assert the fixed 403.

**Dependencies/blockers:** None — fully independent, can be done file-by-file, low risk per file since it's an additive middleware call, not a logic change. Good candidate for the **first** PR out of this entire report, given how cheap and high-value it is.

**Priority / Effort / Risk:** P1 / S (per file) / Low (additive middleware, easy to test, easy to revert).

---

### P2 — `backend/src/types.ts` (505 lines, 45 exported types)

**Current problems:** One file holds config types (29-53), auth types (6-25), LLM client types (81-135), and ~35 DB row interfaces (135-565+). No logical grouping — everything is exported flat.

**Proposed target design:** `types/config.ts`, `types/auth.ts`, `types/llm.ts`, `types/db/*.ts` (grouped by domain: `chat.ts`, `workflows.ts`, `health-checks.ts`, `providers-and-profiles.ts`), with `types.ts` (or `types/index.ts`) becoming a barrel re-export so no import site elsewhere in the codebase needs to change.

**Migration plan:** Pure mechanical move, one domain group at a time, barrel re-export preserved throughout; `tsc --noEmit` after each move is the only verification needed (no runtime behavior involved).

**Test-first requirements:** None beyond `tsc --noEmit` staying clean — this is a type-only file.

**Dependencies/blockers:** None. Good "first PR" candidate alongside the RBAC fix above — cheap, safe, immediately makes the rest of the codebase easier to navigate for the bigger refactors.

**Priority / Effort / Risk:** P2 / S / Low.

---

### P2 — `backend/src/models/health-checks.ts` (384 lines) & `routes/health-checks.ts` (485 lines)

**Current problems:** Both files correctly separate CRUD-by-table (provider keys, profiles, checks, runs, incidents) internally via clearly-named function groups, but each file covers 5 different tables' worth of CRUD in one place. Not urgent — internal organization is already good (functions are short, single-purpose) — but the file-per-table convention used elsewhere (`models/providers.ts`, `models/workflows.ts`, etc.) is broken here for historical reasons (health checks grew incrementally).

**Proposed target design:** Split `models/health-checks.ts` into `models/health-check-provider-keys.ts`, `models/health-check-profiles.ts`, `models/health-checks.ts` (checks+runs), `models/health-check-incidents.ts`; mirror the split in `routes/health-checks.ts` if desired, though the route file's size is less urgent since it already uses `requireRole` correctly and reads cleanly top-to-bottom.

**Migration plan:** Mechanical extraction by table, one at a time; existing `requireRole`-gated routes make this low-risk to test (health-check test files already exist per `backend/test/`).

**Priority / Effort / Risk:** P2 / M / Low.

---

### P2 — `backend/src/routes/ai-profiles.ts` (428) / `routes/providers.ts` (393) / `routes/processing-jobs.ts` (290) / `routes/workflows.ts` (252)

These four are grouped because they share the same shape of problem: each is a reasonably well-organized single-table-CRUD-plus-a-few-special-endpoints route file (test-chat, tool discovery/OAuth for profiles; connectivity test/model sync for providers; formatting-test/eval/upload for jobs; dependency validation for workflows) that's grown past the point where a single file reads quickly, but none currently mix concerns badly enough to need a structural split beyond what's already covered by the RBAC fix (P1, above) and the general Zod/pagination completion work (§6). Recommend revisiting file-splitting for these only after the P0/P1 items land — they're comfortably in "P2, address opportunistically" territory, not blocking.

**Priority / Effort / Risk:** P2 / S each / Low.

---

### P3 — short list (not detailed above)

- `routes/diagnostic-logs.ts`, `routes/calling-applications.ts`, `routes/user-credentials.ts` — same RBAC gap pattern as the P1 item above but lower sensitivity; fold into the same fix pass.
- `models/processing-jobs.ts` `deepMerge` — re-check for genuinely dead branches now that C2's `__proto__` filtering fix has landed; looked clean on inspection but worth a quick dead-code pass.
- `services/session-compaction.ts` — small, single-purpose, fine as-is; noted only because it's adjacent to the `ai-manager/index.ts` split and should get a look-over for whether it should move under `ai-manager/` too.
- `integrations/devs-ai-v2/client.ts` (300) and `integrations/google-gemini/client.ts` (279) — approaching the size where the `devs-ai/client.ts` "section comment" treatment would help; not urgent yet.
- `middleware/auth.ts` `isPublicPath` (SD6, still valid) — swap the `startsWith('/api/auth/')` prefix check for an explicit path allowlist; trivial, low-risk, high-value guardrail against future accidental public routes.
- SD9 residual `any` cleanup (~13 occurrences) — finish as a single small PR.
- AR1 residual gap: add UUID/format validation on path params (`:id`, `:key`) repo-wide via a small `validateParams` middleware mirroring `validateBody`/`validateQuery`.

---

## 5. Cross-Boundary Duplication Flags

For the supervisor/other agents to follow up on — not deep-analyzed here:

- **`backend/src/services/v2-stream-events.ts`** — its SSE line-accumulation logic closely mirrors the pattern duplicated 4× inside `backend/src/routes/chat-sessions.ts` (see §4). If Cadence (`apps/cadence-api`) has its own SSE consumption/parsing logic for streaming chat responses, it should be checked for the same pattern — worth a grep for `split('\n')` / `lineBuffer` in `apps/cadence-api/src/**` by whichever agent owns that scope.
- **`packages/core`** — this package is described (per `CLAUDE.md`) as the in-process interface Cadence uses to consume AI Admin. Given `ai-manager/index.ts` is the primary export surface AI Admin exposes, whoever audits `packages/core` should check whether it wraps/duplicates any of `ai-manager/index.ts`'s chat-session or job-execution logic rather than purely re-exporting it — that would be a strong argument for prioritizing the `ai-manager/index.ts` split (§4) since two consumers would benefit.
- **`frontend/`** — `CODE_REVIEW_AND_TEST_PLAN.md`'s SD2/SD3 findings (frontend `DiagnosticLog`/`CallingApplication` types drifting from backend row shapes) are consistent with what this audit found in `types.ts`: `DiagnosticLogRow` (311-329) and `CallingApplicationRow` (294-301) are the backend source of truth; whoever audits `frontend/` should diff these two interfaces directly against the frontend equivalents named in SD2/SD3 to confirm current drift.
- **`config/ai-admin/ai-admin.config.json`** — `services/config-sync.ts` syncs this file's job/profile definitions into the DB; per `CLAUDE.md`, prompt changes here aren't live until synced via `apps/cadence-api/scripts/sync-jobs.ts` (Cadence-side script reaching into AI Admin's config format). This is a legitimate intentional coupling, not a bug, but it's a real cross-boundary dependency worth noting for whoever touches `services/config-sync.ts` or the sync scripts — the two must stay in lockstep on the config schema shape.

---

## 6. Systemic / Cross-Cutting Recommendations

1. **Ship the RBAC fix (§4) and the CI pipeline (DM1) first, together.** They're both cheap, both high-leverage, and CI is what makes every subsequent refactor in this report safe to land quickly. Concretely: GitHub Actions workflow running `npm run typecheck && npm run lint && npm run test` for both `backend/` and `frontend/` on every PR — the scripts already exist in `package.json`, they're just never invoked automatically today.
2. **Finish the Zod/pagination/param-validation rollout rather than re-adopting from scratch.** AR1 and AR3 are both "mostly done" — the remaining gaps are path-param validation (no `validateParams` equivalent to the existing `validateBody`/`validateQuery`) and a handful of model-layer list functions still capped at a flat `.limit(1000)` instead of true cursor pagination. This is finishing work, not new architecture.
3. **Version-control the database schema and RLS policies.** No `.sql` migration files exist anywhere in this repo (AR5). This isn't just a tooling gap — it means this audit (and any future one) **cannot independently verify tenant-isolation or RLS correctness from source**, which is a real limitation on how much confidence any RBAC/security finding in this report can carry. Adopting the Supabase CLI's migration workflow would let future security reviews actually read the policies instead of inferring behavior from application code alone.
4. **Establish a "shared low-level readers/parsers live in `lib/` or `services/`, never duplicated in `routes/`" convention** and use the SSE line-buffering cleanup (§4) as the first enforcement case. This class of bug (R1) is exactly what recurs when the same fix gets copy-pasted instead of extracted — worth a short note in whatever `CONTRIBUTING.md` eventually gets written (DM5).
5. **Adopt structured logging (AR4) before, not after, the `ai-manager/index.ts` split.** That file's biggest operational risk during refactor is silent behavior change in long-running chat/job flows; `console.log`-based debugging is markedly harder to correlate across the split modules than a structured logger with request/session IDs would be. Pino (as AR4 already recommends) with a `sessionId`/`jobId` field threaded through would pay for itself immediately during the P0 migration.
6. **Treat `types.ts`'s split (§4, P2) as a prerequisite, not an afterthought**, for the `ai-manager/index.ts` split — doing the types reorganization first means the bigger refactor's diffs are pure logic moves, not logic-plus-type-shuffling in the same PR.
