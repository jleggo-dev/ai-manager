# Shared Packages & the AI Admin ↔ Cadence Seam — Refactoring Readiness Audit

Scope: `packages/core`, `packages/cadence-shared`, `packages/client`, `packages/edge`, `packages/types`, and the in-process seam (`apps/cadence-api/src/ai/aim.ts` + its callers). Analysis-only; no source was modified. Verified against actual file contents, `npm ls`/`npm install --dry-run` output, and git history — not against `PLAN.md`'s narrative alone.

---

## 1. Executive summary

**No — the intended architecture in `docs/cadence/PLAN.md` is only partially reflected in the code, and the single biggest gap is a verified, install-breaking one, not a cosmetic one.**

Top findings, most important first:

1. **P0 — root `package.json` `workspaces` never includes `packages/core`, `packages/cadence-shared`, or `apps/*`, contradicting `PLAN.md` §3 ("Root `package.json` workspaces updated to `["backend","frontend","packages/*","apps/*"]`") and `docs/cadence/DEPLOY.md`'s explicit assumption that `@cadence/shared`/`@ai-admin/core` "resolve against the repo-root lockfile."** Today's `workspaces` array is `["backend","frontend","packages/types","packages/client","packages/edge"]` — i.e. exactly the three packages that have **zero** in-repo consumers, and *not* the two packages (`core`, `cadence-shared`) that `apps/cadence-api` and `apps/cadence-web` depend on at runtime. Verified live with `npm install --dry-run`, which reports `@ai-admin/core`, `@cadence/shared`, `@cadence/api`, `@cadence/web`, and the `postgres` dependency as **extraneous** and slated for removal. The only reason the repo works today is a set of stale symlinks left in `node_modules` from an earlier (and since-reverted) edit of the `workspaces` field. A clean clone, a `npm ci`, or a Vercel cold build — exactly what `DEPLOY.md` describes for both `cadence-api` and `cadence-web` Vercel projects — will not resolve these imports. This is a live, verified bug, not a hypothetical one.
2. **P0 (secondary, same root cause) — `package-lock.json` is stale relative to `package.json`.** The committed lockfile still shows `version: 1.2.0` and `workspaces: ["backend","frontend"]` — it predates even the `packages/types|client|edge` addition, let alone `core`/`cadence-shared`/`apps/*`. `npm ci` (what CI/Vercel should use for reproducible installs) would not even see the extra workspaces as installable at all.
3. **P1 — `packages/core`'s API surface is broader than `PLAN.md` describes and includes at least one unused, high-privilege export.** `PLAN.md` §2 describes the surface as `runWithAuth(ctx) → openChatSession / sendChatMessage / executeJobById`. The real file re-exports 20 symbols across 6 groups, including `getServiceSupabase` (AI Admin's service-role Supabase client factory — bypasses RLS) and `createChatMessage` (a raw model-layer DB writer), neither of which is mentioned in the plan and neither of which is actually imported anywhere in `apps/cadence-api` today except `createChatMessage` (used once, directly, bypassing the higher-level chat engine). This is a "leaking internals" pattern, not a thin re-export, and it silently grows Cadence's blast radius against AI Admin's internals.
4. **P1 — `packages/cadence-shared/src/index.ts` is a single 565-line file (grew from ~497 lines in the time since the prior line-count pass — ~13% growth), and it holds 11 clearly distinct concern groups.** It is *not* undifferentiated — each group is already delimited by a `§`-numbered banner comment mirroring the spec — but there is no file-level separation, so IDE navigation, review diffs, and ownership all funnel through one file that is growing at a fast clip.
5. **P2 — confirmed, still-open type drift between AI Admin's `backend/src/types.ts` (569 lines) and `frontend/src/types/api.ts` (534 lines)**, exactly matching `CODE_REVIEW_AND_TEST_PLAN.md`'s SD2/SD3/DM8 findings — both files have grown (+64, +58 lines) since that review without the drift being fixed. Cadence's `@cadence/shared` model (one canonical package, no duplication) is the right target shape for AI Admin too, but AI Admin should fix item 1/2 above first — don't add a third package to a workspace graph that can't currently resolve the two it already has.
6. **P3 — `packages/client`, `packages/edge`, `packages/types` are correctly-functioning, versioned, and properly registered as workspaces — but have zero in-repo consumers.** They are deliberate reference/example code for *external* third-party integrators (Lovable, Supabase Edge Function proxies), not shared libraries in the Cadence sense. AI Admin's own test suite (`backend/test/ai-admin-client.test.ts`) explicitly inlines copies of their logic rather than importing them, to avoid a cross-workspace import — which is itself a small tell that even the maintainer doesn't fully trust the workspace graph.

---

## 2. Package-by-package inventory

### `packages/core` (`@ai-admin/core`, v1.4.0)

- **Contents:** `package.json` + `src/index.ts` (69 lines). Confirmed — nothing else in the directory.
- **Role:** The in-process re-export surface for the AI Admin engine, consumed only by `apps/cadence-api` (never by `apps/cadence-web` — correctly kept server-only).
- **What it actually re-exports** (`packages/core/src/index.ts`):
  - Broker: `executeJob`, `executeJobById`, `executeRawPrompt`, `uploadApiDataSourcesChunked` (lines 19–24)
  - Coach/lifecycle: `openChatSession`, `resumeChatSession`, `sendChatMessage`, `submitChatToolOutputs`, `recordAssistantMessage`, `extractAndAccumulateOutputs`, `fulfillPendingToolJobCalls`, `getToolJobsFromProfile`, `getChatHistory`, `getChatSessionFiles`, `closeChatSession`, `resetChatSession`, `removeChatSession`, `purgeRemoteChatsForUser` (lines 27–42)
  - AI profiles: `getAiProfile`, `getAiProfileBySlug`, `updateAiProfile` (line 45)
  - Processing jobs: `createProcessingJob`, `updateProcessingJob`, `getProcessingJob`, `getProcessingJobBySlug` (lines 48–53)
  - Chat messages: `createChatMessage` (line 56)
  - Tenant/auth: `runWithAuth`, `getAuthContext`, `effectiveUserId`, `tenantFrom`, `tenantClient` (lines 59–65)
  - `getServiceSupabase` (line 67) — service-role Supabase client factory
  - `RequestAuthContext` type (line 69)
- **Health assessment:** Mostly clean, well-commented (the file's own header comment, lines 1–16, is a genuinely good explanation of the runtime contract). But it is **materially wider** than `PLAN.md`'s stated surface, and two exports stand out as scope creep:
  - `getServiceSupabase` — grep across `apps/cadence-api/src` finds **zero** call sites. It is exported "just in case" and gives any future Cadence code a way to fully bypass `runWithAuth`'s tenant scoping and read/write AI Admin's Supabase project with the service role. Dead-but-dangerous surface.
  - `createChatMessage` — used exactly once, in `apps/cadence-api/src/ai/aim.ts:184`, to inject the dossier context turn. It is a model-layer function (`backend/src/models/chat-sessions.ts`), not an engine-layer function — Cadence reaches one layer deeper into AI Admin than everything else in the file does, which means AI Admin can't safely change `createChatMessage`'s signature/side effects without checking Cadence first, even though nothing in `PLAN.md` calls this out as part of the seam contract.
  - The AI-profile and processing-job CRUD exports (`updateAiProfile`, `createProcessingJob`, etc.) are used only by one-off provisioning scripts (`apps/cadence-api/scripts/set-coach-v2.ts`, `set-broker-v2.ts`, `set-coach-persona.ts`, `provision-pack-jobs.ts`), never by the runtime request path. Reasonable for config-as-code tooling, but it means "the seam" is really two seams of different criticality (hot-path chat/job execution vs. cold-path provisioning) bundled into one undifferentiated export list.
- **Versioning/publishing hygiene:** `version: 1.4.0`, `main`/`types` both point at `./src/index.ts` (no build step, no `dist`, no `exports` map). `private: true` correctly prevents accidental npm publish. Version is pinned to match the *root* `ai-admin` package version (1.4.0), not `backend`'s own version (1.0.0) — there is no real versioning discipline here, which is fine for an in-repo-only consumption model but should be documented as intentional (e.g. "version tracks the root release, not semver for this package") rather than left implicit.

### `packages/cadence-shared` (`@cadence/shared`, v0.1.0)

- **Contents:** `package.json` + `src/index.ts` (565 lines — up from ~497 lines noted in a prior pass, confirmed via `Get-Content | Measure`). Nothing else in the directory.
- **Role:** Domain types (spec §5) + Broker job contract shapes (spec §C4), shared between `apps/cadence-api` and `apps/cadence-web`. Confirmed real consumers in both (25 files under `apps/cadence-api` and `apps/cadence-web` import from it).
- **Health assessment:** The file is **already internally well-organized** — it is not "one undifferentiated blob." It has 11 clearly bounded, banner-commented sections (see §4.1 below for exact line ranges) that map directly onto spec section numbers (§5.1–§5.7, §C6, §C4) plus a trailing tripwires block. The problem is purely one of **file-level granularity**: a single 565-line file means every unrelated change (adding a nutrition field vs. adding a broker contract) touches the same file, diffs are noisy, and the file's own comments already tell you exactly where the natural module boundaries are — they're just not realized as actual files yet. Growth rate (+68 lines / ~13% since the last count) suggests this will keep compounding.
- **Versioning:** `0.1.0`, no build step, `main`/`types` → `./src/index.ts`. Consistent with `packages/core`'s no-build model. No `exports` map (not currently a problem since nothing subpaths into it, but worth adding before any subpath imports are attempted).

### `packages/client` (`@ai-admin/client`, v1.3.0)

- **Contents:** `package.json` + `src/index.ts` (117 lines) — a real, functioning typed HTTP client (`AiAdminClient` class) with SSE parsing (`parseSseText`), idempotency-key support, and Vercel base-URL normalization.
- **Role:** Reference SDK for **external** consumers of the AI Admin HTTP API (Lovable apps, third-party integrations) — not used by Cadence (which bypasses HTTP entirely via `packages/core`) and not used anywhere inside `backend/` or `frontend/`.
- **Consumers found:** None in-repo. `backend/test/ai-admin-client.test.ts` explicitly re-implements `normalizeAiAdminBaseUrl` inline "for unit testing without cross-workspace imports" (test file line 3) rather than importing the real package — i.e. even the team's own tests don't trust/use this workspace dependency.
- **Health assessment:** The code itself is fine (typed, reasonable error handling). Its problem is positioning: it's registered as an npm workspace and versioned like a real internal package, but functions purely as documentation-as-code for third parties, referenced from `docs/INTEGRATION.md:708` as one of the "Monorepo SDK packages."

### `packages/edge` (`@ai-admin/edge`, v1.3.0)

- **Contents:** `package.json` + `src/index.ts` (33 lines) — `EDGE_FUNCTION_MODES` union, `normalizeAiAdminBaseUrl` helper, and a string pointer (`EDGE_FUNCTION_REFERENCE_PATH`) at the *actual* reference implementation living in `docs/integration/ai-admin-supabase-edge-function.ts`.
- **Role:** Same external-reference purpose as `packages/client` — a companion to the Supabase Edge Function proxy pattern described in `docs/integration/AI_ADMIN_LOVABLE_INTEGRATION.md`.
- **Consumers found:** None in-repo (same duplication pattern in `backend/test/ai-admin-client.test.ts`).
- **Health assessment:** Smallest and least risky of the three "orphan" packages — it's essentially a typed constant + a pointer to a doc file, not real runtime logic.

### `packages/types` (`@ai-admin/types`, v1.3.0)

- **Contents:** `package.json` + `src/index.ts` (30 lines) — re-exports Zod schemas (`createChatSessionSchema`, `sendMessageSchema`, `createProcessingJobSchema`, `createWorkflowSchema`, `createAiProfileSchema`, `runSlotSchema`, etc.) directly from `backend/src/schemas/*`.
- **Role:** Intended as the type-safety counterpart to `packages/client` for external consumers — "here are the exact Zod schemas the API validates against."
- **Consumers found:** None in-repo. Same status as `client`/`edge`.
- **Health assessment:** Structurally this is the most interesting of the three: it's a *thin, correct* re-export pattern (exactly what `packages/core` should look more like) — but pointed at `backend/src/schemas/*`, one directory deeper than the HTTP API boundary it's meant to describe. If AI Admin's schema module paths change, this silently breaks despite having no test coverage to catch it (it isn't imported by anything that would fail loudly).

---

## 3. The in-process seam deep-dive

**File reviewed:** `apps/cadence-api/src/ai/aim.ts` (205 lines) — the sole adapter file; nothing else under `apps/cadence-api/src/ai/` needed review (the directory contains only this file). Also reviewed the primary caller, `apps/cadence-api/src/routes/coach.ts` (291 lines), and the auth-context plumbing in `backend/src/db/tenant.ts`.

### Current design

- **Auth-context construction** (`aim.ts:26-36`, `aimContext()`): builds a `RequestAuthContext` in `api_key` mode per call, scoped to `cadenceConfig.aim.workspaceId` (env `AIM_WORKSPACE_ID`), with a **sentinel** `apiKeyId: '00000000-0000-0000-0000-000000000000'` (there's no real API-key row for in-process calls) and `forwardedUserId: cadenceUserId`. This is a deliberate, well-commented design (lines 6-9, 29-31) and correctly avoids putting any `aim_sk_` secret on Cadence's runtime path — confirmed by grep: no `aim_sk_`/provider-key handling anywhere under `apps/cadence-api/src`.
- **Context propagation** (`aim.ts:39-41`, `withAim()`): every engine call is wrapped in `runWithAuth(aimContext(cadenceUserId), fn)`, which relies on `AsyncLocalStorage` (`backend/src/db/tenant.ts:9`) to make `getAuthContext()`/`tenantFrom()` resolve correctly for the duration of the async call chain. This is the same mechanism AI Admin's own Express middleware uses for real HTTP requests, so the seam is exercising a well-tested code path rather than a bespoke one — a genuine strength.
- **Workspace scoping is fail-closed, not fail-open**: `cadenceConfig.aim.workspaceId` defaults to `''` (empty string) when `AIM_WORKSPACE_ID` is unset (`apps/cadence-api/src/config.ts:72`). Downstream, `requireWorkspaceId()` (`backend/src/db/tenant.ts:21-25`) throws on a falsy `workspaceId` rather than silently scoping to "no workspace." Good: a misconfigured deploy throws instead of leaking cross-tenant data.
- **Timeouts**: not handled in the seam at all — and that's actually correct, because AI Admin's own engine (`backend/src/ai-manager/index.ts`) already resolves an effective per-call timeout (`resolveTimeoutMs`, referenced at lines 454, 1121, 1444, 1482, 1592) from job config → provider config → global setting, and applies it via `AbortController` internally. The seam inherits this for free; it does not need — and should not add — a second, competing timeout layer.
- **Error handling**: the seam itself (`aim.ts`) does **no** try/catch — every exported function is a bare `withAim(...)` call that either resolves or throws. All error handling happens one layer up, in the route handlers (`coach.ts:58-61, 105-108, 251-259, 271-275, 284-286`), which is a defensible layering choice (the adapter stays a pure pass-through; the route decides HTTP semantics). But it means the adapter provides **no** typed error surface — every route independently does `catch (err) { console.error(...); res.status(500)... }` with `err: unknown`, so there's no way to distinguish "AI Admin config error" from "upstream Devs.ai timeout" from "not-found" without re-deriving that from an untyped error at every call site. This is inconsistent with `CODE_REVIEW_AND_TEST_PLAN.md`'s AI Admin finding M7 (shared `errorMessage()` utility) — Cadence hasn't yet needed the same but will as call-site count grows (already 12 files import from `aim.ts`).
- **Direct model-layer reach-through**: `injectCoachContext` (`aim.ts:172-186`) calls `createChatMessage` directly (imported from `@ai-admin/core`, ultimately `backend/src/models/chat-sessions.ts`) instead of going through the higher-level chat engine used by every other function in the file. The comment at lines 164-171 explains *why* (it must not trigger the model, only record history), but this means one function in the seam operates one architectural layer below all the others — a coupling asymmetry worth flagging even though the current behavior is correct.
- **Streaming boundary**: `sendCoachMessage` (`aim.ts:113-115`) returns the engine's raw fetch `Response`; `coach.ts:161-211` reads `response.body.getReader()` directly and re-serializes SSE `data:` lines itself (including a hand-rolled line-buffer at `coach.ts:160,181-183` to avoid the TCP-chunk-splitting bug AI Admin itself hit and fixed as R1 in `CODE_REVIEW_AND_TEST_PLAN.md`). This duplicates SSE-parsing logic that already exists in `packages/client`'s `parseSseText` (`packages/client/src/index.ts:84-115`) — a real, if minor, missed-reuse opportunity, and a second implementation of the same line-buffering fix that could drift out of sync with the original if the upstream format changes.

### Coupling & blast-radius assessment

- **Would extraction to an HTTP boundary (if ever needed) be painful?** Moderately. The *shape* of the seam (a handful of exported functions taking `cadenceUserId` + typed args) is HTTP-extraction-friendly — each function could become a fetch call with minimal signature change. The pain points would be: (a) `sendCoachMessage`'s raw `Response`/`ReadableStream` return, which assumes an in-process fetch Response and would need to become a proper SSE-over-HTTP relay (extra hop, extra latency — the exact cost `PLAN.md`'s Decision Record §1 says the in-process model exists to avoid); (b) the direct `createChatMessage` model-layer call, which has no HTTP equivalent today and would need a new AI Admin endpoint; (c) the provisioning scripts' direct use of `updateAiProfile`/`createProcessingJob`, which would need to move to existing `/api/ai-profiles`/`/api/processing-jobs` REST endpoints (straightforward, since those endpoints already exist).
- **Auth-context isolation**: correctly isolated — `aimContext()` is the single place a `RequestAuthContext` is constructed for Cadence, and every engine call funnels through `withAim()`. There is no path in `aim.ts` where a call escapes `runWithAuth`. The one soft spot is `getServiceSupabase` being exported from `packages/core` at all (see §2) — it's not called from the seam today, but if a future contributor reaches for it as a shortcut, it bypasses this isolation entirely and silently.

---

## 4. Detailed refactor plans (P0/P1/P2)

### 4.1 [P0] Register `packages/core`, `packages/cadence-shared`, and `apps/*` as real npm workspaces

**Current problem:** Root `package.json` `workspaces` = `["backend","frontend","packages/types","packages/client","packages/edge"]`. `PLAN.md` §3 and `docs/cadence/DEPLOY.md` both assume `packages/*` + `apps/*` are workspaces. `npm install --dry-run` (run live during this audit) confirms npm would delete the currently-working `@ai-admin/core`, `@cadence/shared`, `@cadence/api`, `@cadence/web` symlinks and the `postgres` dependency as extraneous. `package-lock.json` is even further behind (`workspaces: ["backend","frontend"]`, version `1.2.0`). This currently "works" only because of stale `node_modules` symlinks dated before the last `package.json` edit — i.e. it works on exactly one developer's machine, right now, and will not survive a clean checkout, `npm ci`, or the Vercel builds `DEPLOY.md` describes for both `cadence-api` (root-directory install, "Include files outside the root directory" ON) and `cadence-web`.

**Proposed target design:** `"workspaces": ["backend", "frontend", "packages/*", "apps/*"]`, matching `PLAN.md` §3 literally (a glob covers all five `packages/*` and both `apps/*` — one line change, no need to enumerate).

**Step-by-step migration plan:**
1. Update `package.json` `workspaces` to `["backend", "frontend", "packages/*", "apps/*"]`.
2. Delete `node_modules` and `package-lock.json` (or run `npm install` and inspect the diff carefully — given the lockfile is already two generations behind, a clean regenerate is safer than trying to reconcile it incrementally).
3. Run `npm install` from repo root; confirm `npm ls --workspaces --depth=0` shows `@ai-admin/core`, `@cadence/shared`, `@cadence/api`, `@cadence/web` as **linked, non-extraneous** workspace packages.
4. Run `npm install --dry-run` again post-fix as a regression check (should report zero removals).
5. Smoke-test: `npm run typecheck --workspace=@cadence/api` and start `apps/cadence-api`'s dev server (`npm run dev --workspace=@cadence/api` or the app's own script) to confirm `@ai-admin/core` and `@cadence/shared` resolve at runtime, not just at typecheck time.
6. Update root `scripts` if desired (e.g. add `dev:cadence-api`/`dev:cadence-web` convenience scripts analogous to the existing `dev:backend`/`dev:frontend` — currently absent, meaning Cadence apps have no root-level `npm run` entry point at all, a related but lower-severity gap).
7. Commit the regenerated lockfile.

**Test-first requirement:** Before merging, add a CI step (even a minimal one, since `DM1` in `CODE_REVIEW_AND_TEST_PLAN.md` already flags "no CI/CD pipeline" as Critical) that runs `npm ci && npm ls --workspaces` on a clean runner image — this is the only way to prevent this exact regression from recurring, since it is invisible on any machine that already has the stale symlinks.

**Dependencies/blockers:** None technical. This should be the first change made, before any of the other refactors below, since several of them (e.g. the `cadence-shared` split) will otherwise be validated against a workspace graph that doesn't actually resolve on a clean machine.

**Priority: P0. Effort: S (~1-2 hours: edit + reinstall + verify + fix any typecheck fallout from a truly clean `node_modules`). Risk: Low** (the fix is additive and matches documented intent; the main risk is uncovering *other* latent issues that were being masked by the stale symlinks, which is itself valuable to surface now rather than at a production deploy).

### 4.2 [P0] Regenerate/reconcile `package-lock.json`

**Current problem:** Lockfile records `version: 1.2.0`, `workspaces: ["backend","frontend"]` — stale by at least two `package.json` generations. `npm ci` (the reproducible-install command any real CI/Vercel pipeline should use) would not install the current workspace set at all.

**Proposed target design:** Lockfile in sync with current `package.json` across all workspaces, checked in.

**Step-by-step migration plan:** Folded into 4.1 steps 2-3 and 7 above — this is one fix, not two, but called out separately because it's independently verifiable (`git diff package-lock.json` should show the full workspace set appear) and because lockfile drift is exactly the kind of silent issue that reappears if 4.1 is done via manual `node_modules` surgery instead of a full reinstall.

**Priority: P0 (same root cause as 4.1). Effort: S. Risk: Low.**

### 4.3 [P1] Narrow `packages/core`'s export surface; remove or gate `getServiceSupabase`

**Current problem:** `packages/core/src/index.ts` exports `getServiceSupabase` (line 67) with zero in-repo call sites — a live grenade that gives any future Cadence contributor a one-line way to bypass `runWithAuth` tenant scoping and hit AI Admin's Supabase project with the service role. The file also mixes hot-path chat/job exports with cold-path provisioning exports (AI-profile/processing-job CRUD) with no naming or module convention distinguishing them, and exposes `createChatMessage`, a model-layer function one level below the rest of the surface.

**Proposed target design:**
- Remove `getServiceSupabase` from the public re-export list. If a genuine future need exists (there is none today), require it to go through a narrower, purpose-built export (e.g. a function that takes an explicit justification/audit-log parameter) rather than a bare client handle.
- Split the file into two logical export groups even if it stays one physical file for now: a `/* hot path */` section (chat, jobs, tenant/auth — everything the request path touches) and a `/* provisioning (cold path, scripts only) */` section (AI-profile/processing-job CRUD), each with a banner comment stating who's allowed to import from it. This mirrors the section-banner convention already used successfully in `cadence-shared`.
- Add a one-line doc-comment above `createChatMessage` explaining it is intentionally model-layer (already partially done in `aim.ts:164-171`, but the *reason* belongs next to the export itself in `packages/core`, not just at the one call site).

**Step-by-step migration plan:**
1. Grep-confirm (already done in this audit) zero call sites for `getServiceSupabase` in `apps/cadence-api`.
2. Remove the export from `packages/core/src/index.ts`; run `apps/cadence-api`'s typecheck to confirm nothing breaks.
3. Reorganize the remaining exports into commented groups (hot path vs. provisioning) — no behavior change, pure readability/governance.
4. Update `PLAN.md` §2/§3 to list the *actual* export surface (or a link to it) instead of the abbreviated `runWithAuth(ctx) → openChatSession / sendChatMessage / executeJobById` summary, so the doc stays accurate as the surface evolves.

**Test-first requirement:** Typecheck both `apps/cadence-api` and any provisioning scripts after removal — this is a pure-removal change with no runtime test needed beyond that, since nothing calls the removed export.

**Dependencies/blockers:** Should land after 4.1 (needs a working workspace graph to typecheck against).

**Priority: P1. Effort: S (<1 day). Risk: Low** (removing an unused export cannot regress anything; the only risk is if some undiscovered consumer exists — mitigated by the grep already run and by a full typecheck pass).

### 4.4 [P1] Split `packages/cadence-shared/src/index.ts` into cohesive modules

**Current problem:** 565 lines, 11 concern groups, one file. Already well-commented internally (this is not a "rewrite the types" refactor — it's a "move code to files that match the comments that already exist" refactor), but growing ~13% between the last known count and now, and every consumer (25 files across both Cadence apps) imports from the single barrel, so the file will keep absorbing unrelated growth.

**Proposed target design** (grouping based on the actual banner comments and type boundaries found in the file, with real line citations from `packages/cadence-shared/src/index.ts`):

| New file | Types moved | Source lines (current file) |
|---|---|---|
| `src/types/baseline.ts` | `GoalArea`, `Constraint`, `WeightTrend`, `Baseline`, `Connection`, `SteerBack`, `UserProfile` | 9–75 |
| `src/types/goals.ts` | `GoalType`, `GoalStatus`, `GoalMeasure`, `Timeframe`, `GoalMilestone`, `Goal`, `GoalAssessment` | 77–136 |
| `src/types/equipment.ts` | `EquipmentCategory`, `EquipmentWear`, `Equipment` | 138–169 |
| `src/types/plan.ts` | `Plan`, `ActivitySchedule`, `ActivityTarget`, `Activity` | 171–212 |
| `src/types/occurrence.ts` | `OccurrenceStatus`, `Provenance`, `OccurrenceWeather`, `SessionItem`, `SessionBlock`, `OccurrenceSession`, `OccurrenceLogItem`, `OccurrenceLog`, `Occurrence` | 214–283, 336–346 |
| `src/types/progress.ts` | `SeriesPoint`, `ProgressCard`, `ProgressTrend`, `HistoryEntry`, `ProgressData`, `GoalEvent` | 285–334 |
| `src/types/nutrition.ts` | `Macros`, `MealKind`, `NutritionLog`, `NutritionSummary`, `MacroTargets`, `Recipe`, `ShoppingListItem`, `MealPlan` | 348–422 |
| `src/types/episode.ts` | `EpisodeOverride`, `DisruptedEpisode` | 424–459 |
| `src/types/conversation.ts` | `Conversation` | 461–474 |
| `src/types/broker-contracts.ts` | `CaptureExtractResult`, `PlanVetResult`, `ParsedSessionLog`, `SituationAssessResult`, `PendingProposal`, `PendingPlanActivity`, `PendingPlan`, `ContextSelectResult` | 476–552 |
| `src/types/tripwires.ts` | `Tripwire` | 554–565 |
| `src/index.ts` (barrel) | `export * from './types/baseline.ts'` etc., in the same order, plus the file's existing top-of-file doc comment (lines 1-7) | — |

Note: `Equipment` (equipment.ts) is referenced by `DisruptedEpisode.available_equipment` (episode.ts) and `Activity` (plan.ts) is referenced by nothing cross-file that isn't already covered by TS's normal cross-module type resolution — no circular-import risk was found; every cross-reference flows in one direction (episode → equipment/activity, occurrence → session types, broker-contracts → domain types), consistent with the file's own top-to-bottom ordering.

**Step-by-step migration plan:**
1. Create `src/types/` directory with the 11 files above, moving code verbatim (no type changes) per the line ranges in the table.
2. Replace `src/index.ts` with a barrel that re-exports every file in the same order the types currently appear, preserving the existing top-of-file doc comment.
3. Run `tsc --noEmit` in both `apps/cadence-api` and `apps/cadence-web` (the only two consumers) — a pure move-and-barrel refactor should produce zero type errors if done correctly, since all 25 consumer files import from `@cadence/shared` (the package name), not from `@cadence/shared/src/index.ts` directly, so the public import path doesn't change.
4. Grep all 25 consumer files for any deep-path imports (e.g. `@cadence/shared/dist/...`) to confirm none exist — none were found during this audit, but re-verify at execution time since this determines whether the barrel-only approach is sufficient.
5. Optional follow-up (not required for this refactor): add an `exports` map to `package.json` if/when consumers want subpath imports (e.g. `@cadence/shared/tripwires`) instead of the barrel — not needed today since the barrel is cheap (types have zero runtime cost).

**Test-first requirement:** No new tests needed for a pure type-relocation refactor (types have no runtime behavior to test); the "test" here is a clean `tsc --noEmit` across both consumer workspaces plus `apps/cadence-api`'s existing `engines.test.ts` suite (12/12 per `PLAN.md`) passing unchanged, confirming no accidental type-shape change during the move.

**Dependencies/blockers:** Should land after 4.1 (needs a working workspace install to typecheck against). Independent of 4.3.

**Priority: P1. Effort: M (0.5-1 day — mechanical but touches 25 consumer files' worth of type resolution to verify, even though the files themselves aren't edited). Risk: Low** (pure move, no logic change, TS will catch any mistake immediately as a compile error rather than a runtime bug).

### 4.5 [P2] Give the seam (`aim.ts`) a typed error boundary

**Current problem:** No typed error surface; every route independently does `catch (err) { ...; res.status(500)... }` with `err: unknown` (`coach.ts:58, 105, 251, 271, 284`). As more routes are added on top of `aim.ts` (already 12 files import from it), this pattern will replicate rather than centralize, mirroring the exact problem AI Admin itself already fixed once (`CODE_REVIEW_AND_TEST_PLAN.md` M7: shared `errorMessage()` utility).

**Proposed target design:** A small `AimError` class (or a discriminated result type) thrown/returned by `withAim()` on failure, wrapping the underlying error with a `kind: 'config' | 'upstream' | 'not_found' | 'unknown'` tag, so route handlers can map to HTTP status codes declaratively instead of defaulting everything to 500.

**Step-by-step migration plan:**
1. Add an `errorMessage()`-style helper to `apps/cadence-api` (or import AI Admin's, if `packages/core` exposes it — currently it doesn't) for consistent `unknown`-to-string handling as a first, minimal step.
2. Wrap `withAim`'s promise rejection path to classify known error shapes (e.g. AI Admin's own `Error` subtypes, if any exist — needs a quick audit of what `backend/src/ai-manager/index.ts` actually throws) before route handlers see them.
3. Update the 5 `catch` sites in `coach.ts` (and any equivalent in other route files importing from `aim.ts`) to branch on the classified error kind.

**Test-first requirement:** Add a unit test that calls each `aim.ts` export with a broken/missing `AIM_WORKSPACE_ID` and asserts the classified error kind, before implementing the classification logic (there is currently no test coverage for `aim.ts` at all).

**Dependencies/blockers:** None blocking; independent of 4.1-4.4. Lower urgency than the P0/P1 items since current behavior (log + 500) is safe, just not informative.

**Priority: P2. Effort: S (<0.5 day for the minimal version). Risk: Low.**

### 4.6 [P2] Reuse `packages/client`'s `parseSseText` instead of re-implementing SSE parsing in `coach.ts`

**Current problem:** `apps/cadence-api/src/routes/coach.ts:160-209` hand-rolls SSE line-buffering and JSON-event parsing that functionally duplicates `packages/client/src/index.ts:84-115`'s `AiAdminClient.parseSseText`. Both implementations independently guard against the same TCP-chunk-splitting bug AI Admin fixed as R1 — a second place that bug fix has to be remembered if the upstream SSE format ever changes.

**Proposed target design:** Either (a) have `apps/cadence-api` depend on `@ai-admin/client` and call `parseSseText` (once 4.1 makes it a resolvable workspace dependency), refactored slightly to support incremental/streaming parsing rather than its current whole-text-at-once signature, or (b) extract a shared `parseSseChunk`-style incremental parser into `packages/core` (since that's the package Cadence already depends on for AI Admin integration) and have both `coach.ts` and `packages/client` call it.

**Step-by-step migration plan:**
1. Decide (a) vs (b) — (b) is likely cleaner since `packages/client` is external-facing reference code and Cadence's route needs an incremental (chunk-by-chunk) parser, not `parseSseText`'s current whole-string signature.
2. Extract an incremental SSE line-buffer + event-parser utility into `packages/core` (or a new tiny `packages/core/src/sse.ts` submodule).
3. Replace `coach.ts:160-209`'s inline logic with a call to the extracted utility; keep the route responsible only for `res.write()` relay and metric bookkeeping.
4. Add a unit test replaying a chunk-split SSE payload (reproducing the original R1 bug scenario) against the extracted utility.

**Priority: P2. Effort: M (0.5-1 day, including the incremental-vs-batch API redesign). Risk: Low** (streaming behavior is easy to regression-test with recorded fixtures).

### 4.7 [P3] Reposition `packages/client`/`packages/edge`/`packages/types` as explicit "reference SDK," or relocate under `docs/integration/`

**Current problem:** These are correctly-versioned, correctly-registered, zero-consumer workspaces. They aren't broken, but their framing as `packages/*` (implying "shared internal library") is misleading — nothing in the actual product imports them, and the team's own test file goes out of its way to avoid importing them.

**Proposed target design:** Two acceptable options (either is fine; pick based on team preference for "keep as installable reference" vs. "docs are enough"):
- **(a) Keep, but rename/relabel intent.** Add a top-of-README note (currently no README exists in any of the three) stating explicitly: "This package has no in-repo consumers. It exists as copy-paste-able reference code for external integrators. It is exercised only by `docs/INTEGRATION.md` narrative and manual QA, not by automated tests against real consumers." This makes the current, actually-fine state self-documenting instead of looking like abandoned scaffolding.
- **(b) Relocate.** Move `packages/client` and `packages/edge`'s `src/index.ts` content into `docs/integration/` alongside the existing `docs/integration/ai-admin-supabase-edge-function.ts`, and delete the workspace registration entirely. This removes them from the npm install graph altogether (slightly faster installs, one less thing for 4.1's fix to have to account for) at the cost of losing "these are real, typecheckable TS files" for anyone copy-pasting them.

**Recommendation: (a).** These files are more valuable as typechecked, lintable TS (catching drift against `backend/src/schemas/*` for `packages/types` in particular) than as inert doc snippets. The fix is a documentation-only change, not a code move.

**Priority: P3. Effort: S (<0.5 day — three README files). Risk: Low.**

---

## 5. Type-drift recommendation

**Should AI Admin adopt a shared-types package similar to `cadence-shared`? Not yet — fix the workspace graph first (§4.1/4.2), then yes, but scoped narrowly.**

Evidence the drift is real and still open, re-verified against current file contents (not just re-citing the old review):

- `backend/src/types.ts` is now **569 lines** (up from ~505 at the time of `CODE_REVIEW_AND_TEST_PLAN.md`'s review — +64 lines / +13%).
- `frontend/src/types/api.ts` is now **534 lines** (up from ~476 — +58 lines / +12%).
- **SD3 (phantom fields) is still present and unchanged:** `backend/src/types.ts:294-300`'s `CallingApplicationRow` has only `id`, `display_name`, `workspace_id`, `created_at`, `updated_at?` — but `frontend/src/types/api.ts:131-140`'s `CallingApplication` additionally declares `name`, `slug`, `description?`, `is_active`, none of which exist on the backend row type shown.
- **SD2 (shape mismatch) is still present and unchanged:** `backend/src/types.ts:311-328`'s `DiagnosticLogRow` has `input_text`, `output_text`, `formatted_text`, `auth_mode`, `metadata` — none of which appear on `frontend/src/types/api.ts:190-202`'s `DiagnosticLog`, which instead has `request_payload`, `supabase_timing`, `llm_request`, `formatting_timing`, none of which appear on the backend row type. These two types describe the same database row with almost entirely non-overlapping field names — the frontend type was very likely hand-written against an earlier, since-changed backend shape and never reconciled.
- **DM8 ("Frontend/backend types defined separately — can drift") is architecturally confirmed by the above**, and the drift has grown, not shrunk, since the finding was logged.

**Concrete proposal, phased:**

1. **Phase 0 (blocking):** Do §4.1/4.2 first. Don't introduce a third shared-types package into a workspace graph two existing shared packages can't currently resolve on a clean install — that would compound the existing problem rather than fix anything.
2. **Phase 1 (low-risk, high-value):** Create `packages/admin-shared` (or reuse `packages/types`'s existing slot if repositioned — see §4.7 option (b) as an alternative use for that workspace name) containing **only** the DB-row-shaped types AI Admin's own backend already defines in `backend/src/types.ts` (the `*Row` interfaces — `CallingApplicationRow`, `DiagnosticLogRow`, `ProcessingJobGroupRow`, `UserProviderCredentialRow`, etc., added per `CODE_REVIEW_AND_TEST_PLAN.md` M9). These are already the canonical shapes; the fix is having the frontend import them instead of hand-maintaining parallel interfaces.
3. **Phase 2:** Update `frontend/src/types/api.ts` to import the row types from the new shared package for API-response shapes that mirror DB rows 1:1 (many of `frontend/src/types/api.ts`'s 534 lines are legitimately frontend-only view-model shapes that should stay in `frontend/` — this is not a "delete the whole file" move, it's "stop redeclaring the subset that's supposed to be identical to backend").
4. **Phase 3:** Add a lightweight CI check (a small script diffing declared field names between paired backend/frontend types, or simply relying on the shared-import removing the possibility of drift for the migrated subset) to prevent regression for the types that were migrated.

**Should Cadence's `@cadence/shared` approach itself be revisited?** No — it's the right pattern (verified: zero duplicate type declarations were found between `apps/cadence-api` and `apps/cadence-web`; both import the same interfaces from the one package). The only changes it needs are the workspace-registration fix (§4.1) and the file-split (§4.4) — the *strategy* is sound, only its packaging and its host repo's `workspaces` config need fixing.

---

## 6. Vestigial package disposition

| Package | Empty/vestigial? | Disposition | Rationale |
|---|---|---|---|
| `packages/core` | **No — critical, not vestigial.** Small (69 lines) but load-bearing; every Cadence AI call flows through it. | **Fix workspace registration (§4.1); narrow export surface (§4.3).** Do not remove or treat as scaffolding. | It's the seam. The fact that it's *unregistered* as a workspace (§4.1) makes it look broken/experimental when inspected superficially — it isn't; it's simply mis-wired. |
| `packages/cadence-shared` | **No — critical, not vestigial.** 565 lines, 25 real consumers across both Cadence apps. | **Fix workspace registration (§4.1); split into modules (§4.4).** Do not remove. | Same mis-wiring issue as `core` — looks orphaned in `npm ls` output today, isn't. |
| `packages/client` | **Functionally yes (zero consumers), but not accidental scaffolding — intentional external reference code.** | **Keep as placeholder, with the documentation fix in §4.7.** Do not populate with new internal consumers (that would recreate the "reach around packages/core" anti-pattern); do not silently remove (it's linked from `docs/INTEGRATION.md:708` as part of the documented external-integration story). | Real, working, versioned, correctly registered as a workspace — its only issue is that "package" framing implies internal reuse that doesn't exist. |
| `packages/edge` | **Functionally yes (zero consumers), same category as `client`.** | **Keep as placeholder, with the documentation fix in §4.7.** | Same rationale as `client`; smaller and lower-risk (33 lines, mostly constants). |
| `packages/types` | **Functionally yes (zero consumers) — but structurally the most interesting: it's a correct thin re-export of `backend/src/schemas/*`, i.e. exactly the pattern §5's Phase 1 proposal wants for AI Admin's row types.** | **Keep, and consider as the literal vehicle for §5 Phase 1** (either alongside its current Zod-schema re-exports, or renamed/repurposed if the team prefers one package per concern). Do not remove. | Removing it would delete a working example of the exact re-export pattern the type-drift fix (§5) should replicate for `*Row` types. |

**Bottom line on "vestigial":** none of the five packages are dead scaffolding that should simply be deleted. Three (`client`, `edge`, `types`) are correctly-functioning but internally-unconsumed reference code that just needs a one-line documentation clarification of intent. The other two (`core`, `cadence-shared`) are the opposite of vestigial — they are the most load-bearing code in the entire Cadence integration — and their apparent fragility (showing up as "extraneous" in `npm ls`) is entirely a workspace-configuration bug (§4.1), not a sign they should be removed or are unused.
