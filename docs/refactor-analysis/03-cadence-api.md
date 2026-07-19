# 03 — Cadence API refactor-readiness audit (`apps/cadence-api/src/**`)

Scope: every file under `apps/cadence-api/src` (61 files, ~4,050 lines). Working tree was clean
at analysis time — the changes described as "uncommitted" in the task brief (`routes/nutrition.ts`,
`services/nutrition-day.ts`, `services/nutrition.ts`, `services/engines.test.ts`) are already
folded into commit `418f3c4` ("Cadence N4: the Visual Today"); this report analyzes that
committed state, which is the current source of truth either way.

Both `npm run typecheck` and `npm run test` (vitest, 50 tests / 1 file) pass cleanly as of this
audit.

---

## 1. Executive summary

This is a **materially healthier codebase** than a typical "mature platform" audit turns up, and
that needs saying plainly before the findings below: no file exceeds 400 lines (largest
production file is `session.ts` at 297), there is not a single `any` in the entire tree, tenant
scoping (`where user_id = $1`) is applied consistently and correctly on every direct-Postgres
query I read, secrets handling matches the `aim_sk_`-never-on-this-path rule (the in-process
`ai/aim.ts` seam correctly uses `api_key` auth-context mode with no key material at all), and the
comments throughout are unusually precise about *why*, not just *what* — this is a codebase
that mostly documents its own trade-offs. Route handlers are consistently thin (auth → call a
service → shape the HTTP response), and business logic is consistently pushed into pure,
dependency-free helper modules (`scheduling.ts`, `capture-normalize.ts`, `nutrition-day.ts`,
`plan-match.ts`, `intake.ts`, `shoe-mileage.ts`, `photo-validate.ts`, `nutrition-summarize.ts`,
`tripwires.ts`, `goal-guardrail.ts`) that are already unit-tested. That is exactly the shape you
want *before* a codebase gets big — this team is building the right muscle early.

That said, three foundational risks are real and worth calling out clearly, because "the code is
clean" and "the system is refactor-safe" are different claims:

1. **Near-zero coverage on everything that touches the database or the AI Admin seam.** The one
   test file (`engines.test.ts`, 387 lines / 50 tests) is excellent, but it exclusively covers
   the ~10 *pure* helper modules. Every service that actually does something to the world —
   `nutrition.ts`, `session.ts`, `plan-synthesis.ts`, `lock.ts`, `replan.ts`, `situation.ts`,
   `capture.ts`, `progress.ts`, `context-pack.ts`, `turn-context.ts`, and `ai/aim.ts` itself — has
   **zero** direct tests. Several of these contain non-trivial, easily-unit-testable pure logic
   (`canonicalMetrics`/`parseLoadKg` in `progress.ts`, `rollingConsistency` in `metrics.ts`,
   `normalizeSession` in `session.ts`) sitting right next to the DB/LLM calls, untested purely
   because nobody extracted-and-tested it yet. This is the single biggest refactor-readiness risk
   in this slice of the repo: today, a regression in plan-commit, nutrition rollup, or the
   consistency math that BRAND.md explicitly promises ("never resets to zero") would be caught by
   *nobody* until a human notices in the product.
2. **The AI Admin seam (`ai/aim.ts`) is the one file every other file in this directory
   ultimately depends on, and it is untested and loosely typed against its own dependency.** It's
   well-designed and well-commented, but `CoachDiag` (line 118) is a hand-rolled structural
   duck-type of `@ai-admin/core`'s real `DiagnosticSession` — if that shape drifts upstream, this
   file fails silently (no compile error, since it's a structural subset) rather than loudly.
   Given PLAN.md's own framing of this as *the* load-bearing seam, it deserves a smoke test
   (even a mocked one) more than any other single file here.
3. **Two duplicated, un-DRY "Broker select → validate → execute → render" pipelines**
   (`context-pack.ts` and `turn-context.ts`) implement almost the same four-step algorithm twice,
   and a third rendering path (`services/dossier.ts`) is dead code that duplicates logic again.
   None of this is *wrong* today, but it's exactly the kind of copy-paste-and-diverge risk that
   turns into a real bug the third time someone tweaks retrieval behavior in one file and forgets
   the other.

No file in this slice meets the P0 bar (no file mixes 3+ responsibilities at >1500 lines, and no
correctness/security defect was found in the direct-Postgres or auth layers). The highest-priority
work here is disciplined **test-first backfill** on the business-critical services, plus a small
amount of **de-duplication** in the retrieval pipeline. The `apps/cadence-api` workspace gap (not
registered as an npm workspace at the repo root, so `npm run ci`/`typecheck`/`lint`/`test` at the
root never touch this code) compounds the coverage problem: even the 50 tests that *do* exist
provide no protection in CI today unless a human remembers to `cd apps/cadence-api && npm test`
locally. That workspace/CI wiring is being tracked by a sibling agent, but every finding below
about "no gate catches this" traces back to that one root cause.

**Counts:** 61 files reviewed · 0 P0 · 8 P1 · 9 P2 · remainder P3/clean · 2 confirmed nomenclature
violations (both prompt/description text, not schema) · 3 pieces of dead/unwired code found
(`services/dossier.ts`, `services/completion.ts`, `services/token-budget.ts`'s only caller being
the test file, `repos/context-pack.ts#getFreshContextPack`).

---

## 2. File inventory

| Path | Lines | Primary role | Flagged? | Priority |
|---|---|---|---|---|
| `services/engines.test.ts` | 387 | Unit tests for all pure helper modules | Y | P3 |
| `services/session.ts` | 297 | Prescribe/Log/weigh-in for occurrences | Y | **P1** |
| `routes/coach.ts` | 273 | Coach session open/message/trace/log routes | Y | **P1** |
| `services/nutrition.ts` | 269 | Meal logging, baseline read, targets | Y | **P1** |
| `services/retrieval/registry.ts` | 260 | Retrieval-function semantic layer | Y | P2 |
| `routes/plan.ts` | 213 | Plan/replan/occurrence routes | Y | P2 |
| `ai/aim.ts` | 190 | **AI Admin in-process seam** | Y | **P1** |
| `services/progress.ts` | 188 | Deterministic progress dashboard | Y | P2 |
| `services/plan-synthesis.ts` | 183 | Synthesize→vet→commit plan pipeline | Y | **P1** |
| `routes/review.ts` | 182 | Goal/equipment/baseline review-wizard routes | Y | P2 |
| `repos/occurrences.ts` | 180 | Occurrence CRUD + session/log/progress queries | Y | P2 |
| `services/context-pack.ts` | 152 | Session-open Broker context pack builder | Y | **P1** |
| `services/capture.ts` | 149 | Persist Broker `capture_extract` output | Y | P2 |
| `services/scheduling.ts` | 143 | RRULE-subset parse/expand/describe | N | clean (tested) |
| `services/replan.ts` | 120 | Manual/weekly re-plan preview+commit | Y | **P1** |
| `services/plan-view.ts` | 119 | "Today/week" plan view assembly | Y | P3 |
| `routes/nutrition.ts` | 113 | Nutrition HTTP routes | Y | P2 |
| `services/turn-context.ts` | 113 | Per-turn just-in-time retrieval | Y | **P1** |
| `services/dossier.ts` | 104 | **Dead code** — unused dossier compiler | Y | P2 |
| `services/capture-normalize.ts` | 101 | Pure baseline/goal-dedup normalization | N | clean (tested) |
| `services/nutrition-day.ts` | 94 | Pure macro sanitize/rollup/left math | N | clean (tested) |
| `services/coach-context.ts` | 88 | Onboarding readiness + intent framing | Y | P3 |
| `config.ts` | 81 | Env loading + config object | N | clean |
| `services/situation.ts` | 71 | Weekly tripwire-gated situation assess | Y | P2 |
| `services/tripwires.ts` | 69 | Pure deterministic tripwire detection | N | clean (tested) |
| `repos/nutrition.ts` | 66 | Nutrition log CRUD | N | clean |
| `services/lock.ts` | 63 | First-lock preview/commit | Y | **P1** |
| `repos/goals.ts` | 61 | Goal CRUD | N | clean |
| `repos/users.ts` | 58 | User/baseline/targets/proposal CRUD | N | clean |
| `services/meal-photos.ts` | 57 | Meal photo storage (Supabase Storage) | N | clean |
| `auth/middleware.ts` | 55 | Dev + real Supabase JWT auth | N | clean |
| `services/goal-assess.ts` | 55 | Coach realism read on one goal | Y | P3 |
| `services/goal-guardrail.ts` | 54 | Weighted-load focus-budget gate | N | clean (tested) |
| `services/dev-trace.ts` | 51 | In-memory dev X-ray trace | N | clean |
| `services/nutrition-summarize.ts` | 49 | Pure nutrition observe-phase summary | N | clean (tested) |
| `repos/equipment.ts` | 49 | Equipment CRUD + wear update | N | clean |
| `repos/conversations.ts` | 47 | Conversation↔AI-session mapping | N | clean |
| `services/metrics.ts` | 47 | Consistency window + rolling-consistency | Y | P2 |
| `services/ai-log.ts` | 44 | Durable AI-call audit log | N | clean |
| `repos/context-pack.ts` | 42 | Context-pack persistence | Y | P3 |
| `services/retrieval/catalog.ts` | 38 | Retrieval catalog doc for the Broker | Y | P3 |
| `routes/progress.ts` | 38 | Progress dashboard + manual event routes | N | clean |
| `services/dev-reset.ts` | 37 | Dev/start-over data wipe | N | clean |
| `services/date-context.ts` | 34 | Per-session date-stamp injection | N | clean |
| `repos/plans.ts` | 34 | Plan CRUD | N | clean |
| `services/plan-horizon.ts` | 32 | Rolling-horizon occurrence materialization | N | clean |
| `services/intake.ts` | 32 | Pure starting-point-gap detection | N | clean (tested) |
| `routes/me.ts` | 31 | "Start over" (self-service data wipe) route | N | clean |
| `routes/dev.ts` | 28 | Dev-only reset route | N | clean |
| `repos/goal-events.ts` | 28 | Goal-event CRUD + completion counts | N | clean |
| `services/plan-match.ts` | 28 | Pure goal-title matching | N | clean (tested) |
| `db/supabase.ts` | 28 | Supabase clients (auth + service-role) | N | clean |
| `repos/activities.ts` | 26 | Activity CRUD | Y | P3 |
| `services/photo-validate.ts` | 24 | Pure photo data-URL validation | N | clean (tested) |
| `app.ts` | 22 | Express app assembly | N | clean |
| `db/sql.ts` | 18 | Postgres client + jsonb helper | N | clean |
| `services/completion.ts` | 17 | **Dead/unwired** — shoe mileage on completion | Y | P2 |
| `services/shoe-mileage.ts` | 15 | Pure shoe wear-status math | N | clean (tested) |
| `services/token-budget.ts` | 11 | **Dead/unwired** — budget tier calc | Y | P2 |
| `index.ts` | 7 | Process entry point | N | clean |
| `routes/health.ts` | 6 | Health check | N | clean |

---

## 3. Detailed per-file refactor plans (P0/P1/P2)

### P1 cluster A — the plan commit pipeline: `services/plan-synthesis.ts`, `services/lock.ts`, `services/replan.ts`

**Current problems**

- `plan-synthesis.ts` `synthesizeAndVet` (`76-137`) and `commitActivities` (`145-170`) are the
  single choke point through which *every* plan change in the product flows (first lock, manual
  re-plan, weekly-proposal accept) — three call sites (`lock.ts:31`, `replan.ts:78/82`,
  `replan.ts:101`) all funnel through here. Zero tests exercise any of it.
- `commitActivities` (`145-170`) does five sequential awaited steps (`getActivePlan` →
  `supersedeActivePlans` → `insertPlan` → `insertActivities` → `deleteFuturePendingOccurrences` →
  `ensureHorizon`) with **no transaction**. A crash between `supersedeActivePlans` (line 163) and
  `insertPlan` (line 164) leaves a user with *no* active plan at all until they retry. Given
  `postgres` (porsager) supports `sql.begin(...)`, this is a real correctness gap, not just a
  style nit — worth a P1 rather than P2 despite being contained in ~25 lines.
- `lock.ts`/`replan.ts` both implement the identical "self-sufficient: run preview inline if
  nothing is on file" fallback (`lock.ts:50-55` vs `replan.ts:119-124`) — copy-pasted, not shared.
- Naming drift: the *code* (function/route names `previewLock`/`confirmLock`/`dismissLock`,
  `POST /plan/lock`, file `services/lock.ts`) still says **"lock"** everywhere, while the goal
  status enum it flips into has already migrated to **`committed`** (`lock.ts:64`,
  `goals.ts:setGoalStatus`). Not a live nomenclature violation (no user-facing copy involved, and
  "lock" isn't on the banned list), but it's the kind of half-completed rename that will confuse
  the next engineer who greps for "commit" and finds "lock", or vice versa. Flagged in §4 too.

**Proposed target design**

- Wrap `commitActivities` in `sql.begin()` so supersede→insert→delete is atomic; `ensureHorizon`
  (a separate idempotent top-up) can stay outside the transaction since it's safe to retry.
- Extract the shared "load pending, run preview if absent, then commit" skeleton into one
  generic helper (`services/plan-commit-flow.ts`) parameterized by the preview function, used by
  both `lock.ts` and `replan.ts`.
- Either rename `lock.ts` → `services/plan-lock.ts` functions to `preview/confirm/dismissCommit`
  for internal consistency, or explicitly document (single comment at the top of `lock.ts`) that
  "lock" is the deliberately-retained internal verb for the commit action and is not a
  nomenclature violation — pick one and stop the drift either way.

**Step-by-step migration plan**

1. Add integration tests first (see Test-first requirements) against the *current* behavior —
   this is the highest-risk file to touch blind.
2. Wrap `commitActivities`'s five DB calls in `sql.begin()`; add a test that simulates a mid-flight
   failure (e.g. throw inside a mocked `insertActivities`) and asserts the active plan is *not*
   left superseded-with-nothing.
3. Extract the shared preview-fallback skeleton; migrate `lock.ts` and `replan.ts` onto it one at
   a time, re-running the new tests after each.
4. Resolve the lock/committed naming drift (rename or document — see above).

**Test-first requirements**

- Given there are currently zero tests on this path, before any refactor: write integration tests
  (using a disposable Postgres schema or a light DB fixture — see §6 for the harness
  recommendation) covering: first lock happy path, lock with `exceedsHardCap` → `needs_focus`,
  re-plan preview→dismiss→preview again (no double-commit), re-plan commit when nothing was
  previewed (self-sufficient path), and a plan_vet rejection (`vetoed`) leaving the DB untouched.
- Unit-test `normalizeActivity` (`plan-synthesis.ts:14-23`) directly — it's pure and untested
  despite being the app-side contract assertion the whole spec leans on.

**Dependencies/blockers:** none external; can proceed independently. The transaction wrap should
land before or alongside any other change to this file to avoid re-introducing the gap.

**Priority/Effort/Risk:** P1 / M / Medium (the transaction fix touches the write path for every
plan commit in the product — needs careful review, but is well-contained).

---

### P1 — `services/session.ts` (297 lines)

**Current problems**

- Three genuinely distinct responsibilities share one file: session **generation**
  (`generateSession`/`coachingPhase`/`normalizeSession`, `44-183`), **weigh-in** capture
  (`recordWeighIn`, `194-224`), and post-session **log parsing** (`logOccurrence`/
  `normalizeLogItems`, `226-326`). They share almost no code (only `str`/`num` helpers, `40-42`).
  This is the single largest production file in the directory and the best split candidate.
- `normalizeSession` (`50-87`) is a pure, easily-testable app-side contract assertion (same
  pattern as `plan-synthesis.ts#normalizeActivity`) but has zero tests, despite bounding
  model-controlled input (`MAX_BLOCKS`, `MAX_ITEMS`, the `video_query` de-URLing regex at line 72)
  that is explicitly a security/UX backstop against a model inventing a clickable URL.
- The in-memory `inflight` single-flight map (`115`) is per-process — in a multi-instance deploy
  this only dedupes within one instance, not across instances (fine today at Cadence's scale, but
  worth a one-line comment so nobody assumes it's cluster-safe later).

**Proposed target design**

- Split into `services/session-generate.ts` (session generation + `normalizeSession` +
  `coachingPhase`), `services/session-log.ts` (`logOccurrence` + `normalizeLogItems`), and either
  fold `recordWeighIn` into a small `services/weigh-in.ts` or leave it in a slimmed `session.ts`
  since it's the smallest and most self-contained of the three.

**Step-by-step migration plan**

1. Move `normalizeSession` + its helpers to a standalone module first (no behavior change) and
   backfill unit tests immediately — it's pure, so this is nearly free and de-risks the rest.
2. Split the file along the three responsibilities; update the two import sites
   (`routes/plan.ts:5,7`).
3. Add the one-line multi-instance caveat comment on `inflight`.

**Test-first requirements**

- Unit-test `normalizeSession`: bounds enforcement (>6 blocks / >12 items truncated), the
  `video_query` URL-stripping regex (a model-supplied `https://youtube.com/...` must come back
  `null`), and the "no usable blocks → null" fallback.
- Unit-test `coachingPhase` (trivial, but it's the driver of prompt behavior — a one-line change
  to the thresholds should be caught by a test, not discovered in the product).
- Integration-test `recordWeighIn`'s plausibility clamp (20–500kg) and the "not a weigh-in
  occurrence" 404 path, and `logOccurrence`'s fallback-never-loses-the-user's-words guarantee
  (simulate a Broker JSON parse failure and assert `raw_text` still lands).

**Dependencies/blockers:** none.

**Priority/Effort/Risk:** P1 / M / Low (splitting is mechanical; the risk is entirely in the
*absence* of tests today, not in the split itself).

---

### P1 — `routes/coach.ts` (273 lines)

**Current problems**

- The SSE-relay loop (`152-211`) — reading the upstream stream, buffering partial lines,
  parsing `data:` frames, accumulating `content`/`usage`/`model`/`responseId` across two different
  upstream event shapes (OpenAI-style deltas vs `message.complete` v2 frames) — is genuinely
  intricate parsing logic embedded directly in an Express route handler. It is completely
  untested, and it is the kind of code (byte-buffering, line-splitting, dual-schema branching)
  that is exactly where subtle off-by-one/edge-case bugs hide, and exactly the kind of logic the
  rubric's "routes vs services" separation exists to protect.
- `captureWindow` (`14-26`) is defined *between* two import blocks (line 27's imports come after
  the function, split across `3-11` and `27-28`) — a stylistic oddity that will surprise the next
  editor and violates the "imports at top of file" convention used everywhere else in this
  directory.

**Proposed target design**

- Extract the SSE-relay-and-accumulate loop into a standalone, unit-testable function in a new
  `services/coach-stream.ts` (e.g. `relayAndAccumulate(response: Response, upstream: ReadableStream): Promise<{content, promptTokens, completionTokens, model, responseId}>` plus a
  writer callback for the client-relay side), so the byte/line parsing can be tested with a fake
  `ReadableStream` and no Express/HTTP involved at all.
- Move `captureWindow` down with the other route-local helpers or into `services/coach-context.ts`
  (it's a context-assembly concern, not routing), and fix the import ordering.

**Step-by-step migration plan**

1. Write characterization tests against the *current* SSE parsing behavior using a synthetic
   `ReadableStream` (both frame shapes: OpenAI delta and `message.complete`).
2. Extract `relayAndAccumulate` with no behavior change; re-run the tests.
3. Move `captureWindow`; fix import order.

**Test-first requirements:** as above — this is the top test-coverage priority in `routes/`,
since it's the one route with real logic beyond "call a service, shape the response."

**Dependencies/blockers:** none.

**Priority/Effort/Risk:** P1 / M / Medium (touching the live coach-streaming path always carries
some risk; characterization tests before extraction are the mitigation).

---

### P1 — `services/nutrition.ts` (269 lines)

**Current problems**

- `logMeal` (`38-123`) mixes photo upload, vision-job invocation, app-side parse validation, DB
  insert, and a best-effort side-effect (ticking the "Food log" occurrence) in one function. Not
  unreasonable given the brand's "never lose their words" requirement demands the try/catch
  shape it has, but it means the function has no unit-testable core — every test would need to
  mock the AI Admin job call and the photo pipeline.
- `getBaselineRead` (`229-279`) is the second-most business-critical function in the file (it
  decides *when* the coach is allowed to propose macro targets — `wantsTargets`, `210-219`, is
  pure and untested) and is also completely untested end-to-end.
- The pure helpers this file leans on (`sanitizeMacros`, `sumDay`, `computeLeft`,
  `sanitizeTargets` in `nutrition-day.ts`) **are** well tested — this file is a good example of
  "the pure math is tested, the orchestration around it isn't," which is the pattern repeating
  across this whole audit.

**Proposed target design**

- No structural split needed (the file is already single-purpose: "the nutrition module's
  service layer"). The fix here is purely test-first backfill, plus extracting `wantsTargets`
  (`210-219`) and the parse-result-shaping block inside `logMeal` (`67-90`) into named, pure
  functions so they can be unit-tested without mocking the AI Admin call.

**Step-by-step migration plan**

1. Extract the "shape a parsed `parse-meal` JSON blob into `{meal, items, flags, confidence,
   macros}`" logic (currently inlined at `66-87`) into a pure `parseMealResult(raw: string,
   explicitMeal?: MealKind): {...}` function; unit-test it directly (valid JSON, malformed JSON,
   partial fields, confidence clamping).
2. Unit-test `wantsTargets` (pure, 5 lines, currently invisible to the test suite).
3. Integration-test `logMeal`'s fallback guarantee (parse throws → raw text still persisted,
   `items: []`) and the provisional-below-threshold gating.
4. Integration-test `getBaselineRead`'s day-count gate (`< OBSERVE_DAYS_NEEDED` → `ready: false`
   with no LLM call at all — this is a cost-control gate worth pinning down with a test) and the
   `propose` gating logic (targets only proposed when `wantsTargets` AND none already set).

**Test-first requirements:** as above.

**Dependencies/blockers:** none.

**Priority/Effort/Risk:** P1 / M / Low.

---

### P1 — `ai/aim.ts` (190 lines) — the AI Admin seam

**Current problems**

- Zero tests on the one file every other AI-touching module in this directory depends on
  (`runJob`, `runJobBySlug`, `openCoachSession`, `sendCoachMessage`, `recordCoachReply`,
  `injectCoachContext` are imported by 9+ other files).
- `CoachDiag` (`117-121`) is a hand-written structural interface standing in for
  `@ai-admin/core`'s real `DiagnosticSession` return type. If the engine's diagnostic API adds a
  required parameter or renames a method, TypeScript will happily keep compiling this file (a
  structural subset still satisfies a structural subset) while `recordCoachReply` silently stops
  recording something real. This is the single spot in this codebase where the "no `any`, strong
  types everywhere" story has a soft edge — it's not unsafe casting, but it *is* an unpinned
  contract with an external package.
- `clockVars()` (`51-59`) — the "every job gets today/day_of_week for free" mechanism — is pure
  and trivial but untested; a UTC-boundary regression here would be the kind of bug that only
  shows up for a few hours a day near midnight UTC, which is exactly the kind of bug a two-line
  test prevents forever.

**Proposed target design**

- Add a thin runtime narrowing check (or at minimum a comment pointing at the exact
  `@ai-admin/core` version/export whose shape `CoachDiag` mirrors) so a future engine upgrade that
  breaks this contract is at least *searchable*, if not compile-time-caught.
- No structural change needed otherwise — this file's design (one auth-context helper + a set of
  thin, well-named wrappers) is exactly right for a seam module.

**Step-by-step migration plan**

1. Add a smoke test that mocks `@ai-admin/core`'s exports and asserts `withAim`/`runJob`/
   `runJobBySlug` construct the expected `RequestAuthContext` (`workspaceId`, sentinel
   `apiKeyId`, `forwardedUserId`) — this is the one test that would catch an accidental regression
   in "how Cadence authenticates to AI Admin," which is worth protecting given it's flagged as
   the load-bearing seam.
2. Unit-test `clockVars()` with a fixed system clock (both fields derived from the same UTC day).
3. Add the `CoachDiag` provenance comment.

**Test-first requirements:** as above; this is a smaller lift than the other P1s (mocked-dependency
unit tests, no DB needed) and should be quick to land.

**Dependencies/blockers:** none.

**Priority/Effort/Risk:** P1 / S / Low (small, isolated, high leverage given how many other files
depend on this one being correct).

---

### P1 cluster B — the Broker retrieval pipeline: `services/context-pack.ts` + `services/turn-context.ts`

**Current problems**

- Both files implement the identical four-step algorithm — **(1)** render the catalog doc, **(2)**
  call a Broker job (`pack-select` vs `context-select`) to choose retrieval functions, **(3)**
  validate each chosen function name against `RETRIEVAL_FUNCTIONS` and coerce `params`, **(4)**
  execute the validated calls and collect `{fn, params, rows, at}` provenance — with the
  validation/coercion block copy-pasted nearly verbatim:
  `context-pack.ts:57-59` vs `turn-context.ts:43-48`. A future change to the validation rule (e.g.
  tightening what counts as a valid `params` shape) has to be remembered in two places.
  `context-pack.ts`'s step 2 additionally re-implements the execute loop inline (`119-129`) that
  is *also* duplicated, slightly differently, in `turn-context.ts:89-100`.
- Neither file has a single test. This is the retrieval "semantic layer" — the one place the spec
  explicitly calls out as the boundary preventing the model from ever running free SQL — and it's
  entirely unverified by automated tests today.

**Proposed target design**

- Extract a shared `services/retrieval/select-and-run.ts` exporting: `validateCalls(raw: unknown):
  FnCall[]` (the filter/map/validate step) and `executeCalls(userId, calls): Promise<{results,
  provenance}>` (the execute-and-collect-provenance loop). Both `context-pack.ts` and
  `turn-context.ts` become thin callers: render catalog → call their respective Broker job →
  `validateCalls` → `executeCalls` → their own summarize/render/inject step (which *should* stay
  separate, since session-open summarization and per-turn injection genuinely differ).

**Step-by-step migration plan**

1. Extract `validateCalls`/`executeCalls` with no behavior change (these are the exact-same
   bodies, just given names and moved).
2. Backfill unit tests on `validateCalls` (unknown function names dropped, malformed `params`
   coerced to `{}`, non-array `calls` → `[]`) — this is pure and trivial to test once extracted.
3. Migrate `context-pack.ts` and `turn-context.ts` onto the shared helper one at a time.
4. Add an integration test for `buildContextPack`'s three-way fallback (`broker-curated` /
   `broker-partial` / `deterministic` mode selection, `context-pack.ts:138-143`) — this is the
   resilience contract ("the coach never breaks") and deserves a test that actually forces the
   Broker call to fail and asserts the deterministic path still produces a usable pack.

**Test-first requirements:** as above.

**Dependencies/blockers:** none; can proceed independently of the plan-commit cluster.

**Priority/Effort/Risk:** P1 / M / Low.

---

### P2 — `services/dossier.ts` (104 lines) — dead code

`compileDossier` is exported and fully implemented but has **no callers anywhere in the app**
(confirmed via repo-wide search — the only other reference is its own mention in `PLAN.md`). It
duplicates rendering logic that now lives, in a more structured form, across
`services/retrieval/registry.ts` (`get_objectives`, `get_active_plan`, `get_equipment`,
`get_weight` renderers) — e.g. the equipment-with-wear-status line format is written twice
(`dossier.ts:67-71` vs `registry.ts:216-224`), and if one is ever updated to reflect a schema
change, the other silently goes stale. **Recommendation: delete the file.** If it's being kept
as a stepping stone toward a future non-Broker fallback path, replace it with a one-line comment
in `context-pack.ts` pointing at git history instead of 104 lines of live, duplicated, dead code.
Priority/Effort/Risk: P2 / S / Low (deletion; verify no external script imports it first).

### P2 — `services/completion.ts` (17 lines) + `services/token-budget.ts` (11 lines) — unwired features

- `addRunMileage` (`completion.ts:12-18`) is fully implemented (adds a run's distance to the
  user's active shoe, flags `retire_soon`) but is **never called** from any route or service —
  `logOccurrence` (`session.ts:259-326`), the actual place a run completion is recorded, does not
  invoke it. The spec comment at the top of the file (`§5.3, §6.4`) describes intended behavior
  that isn't wired up. Either wire it into `logOccurrence` (extract run distance from
  `canonicalMetrics`/`metricsFromItems`-equivalent logic and call `addRunMileage`) or remove it
  and track the gap in `PLAN.md`'s backlog instead of leaving dead, spec-referencing code in
  `src/`.
- `budgetTier` (`token-budget.ts`) is only ever imported by `engines.test.ts` — no production code
  calls it. This represents the "amber/red → trigger summarize-and-roll" mechanism that
  `MEMORY-ARCHITECTURE.md` describes as core to the context/memory design, but it is not actually
  enforced anywhere yet (no code tracks `usedTokens`/`maxTokens` for a conversation and calls
  this). Not a bug — just worth flagging so "we have token-budget tiers" isn't assumed to be a
  shipped guarantee when reading the code. Recommend either wiring it into
  `services/turn-context.ts`/`coach.ts` when that work is picked up, or adding a `// not yet wired
  — see PLAN.md backlog` comment so it isn't mistaken for live enforcement.

Priority/Effort/Risk (both): P2 / S (wire-up or remove) / Low.

### P2 — `services/metrics.ts` (47 lines) — untested despite brand-critical + reused 4x

`rollingConsistency` (`34-51`) is pure, has zero tests, and is the concrete implementation of one
of BRAND.md's most explicit promises ("a missed day lowers the ratio, it never resets progress to
zero"). It's called from four different places (`progress.ts:162`, `replan.ts:24`,
`plan-view.ts:107`, and transitively via those) — each call site casts its input with `as never`
(see next paragraph) rather than a clean type. Given how central "never a streak" is to the
brand, and how cheap this would be to test (pure function, date math, no mocks), this is worth
promoting above its line count would otherwise suggest. Also note: the repeated `as never` cast
(`progress.ts:162`, `replan.ts:24`, `plan-view.ts:107`) exists because `listOccurrences`
(`repos/occurrences.ts:33-37`) selects a column subset that doesn't structurally satisfy the full
`Occurrence` type `rollingConsistency` expects — see the `repos/occurrences.ts` note below for the
proposed fix (a narrower return type would let all three call sites drop the cast).

Test-first requirement: unit-test `rollingConsistency` directly — feed it a fixed `today`, occurrences
on some days, and assert `kept`/`window` match, including the "date arrives as a JS Date object
from the driver, not a string" case the code already defends against (line 42) but never tests.

Priority/Effort/Risk: P2 / S / Low.

### P2 — `repos/occurrences.ts` (180 lines)

**Current problems:** largest repo file, spanning four distinct concerns: basic occurrence CRUD
(`upsertOccurrences`, `listOccurrences`, `setOccurrenceStatus`), the session-detail join +
single-flight cache write (`getOccurrenceWithActivity`, `setOccurrenceSessionIfEmpty`), plan-commit
cleanup (`deleteFuturePendingOccurrences`), and progress-feed queries
(`listLoggedForProgress`, `listRecentLogged`, `listRecentLogsByTitle`). Not unreasonable to keep
together (they're all "queries against the occurrences table"), but as the progress/session
features grow this is the repo file most likely to become the next 300+-line file in the
directory. Separately: `listOccurrences`'s explicit column list (`33-37`, intentionally excluding
`session`/`log`) returns a type that TypeScript's structural checker doesn't consider assignable
to the full `Occurrence` type, forcing the `as never` casts noted under `metrics.ts` above.

**Proposed target design:** split into `repos/occurrences.ts` (CRUD + status) and
`repos/occurrence-progress.ts` (the three progress/history read queries) when the file next grows;
not urgent today. Independently: give `listOccurrences` its own return type (e.g. `OccurrenceSlim
= Pick<Occurrence, 'occurrence_id'|'activity_id'|'date'|'status'|'value'|'provenance'|'weather'>`)
and change `rollingConsistency`'s parameter type to accept `Pick<Occurrence, 'date'|'status'>` —
the narrowest shape it actually needs — which removes all three `as never` casts with zero
runtime change.

**Priority/Effort/Risk:** P2 / S (the type fix) + M (the eventual split, not urgent) / Low.

### P2 — `services/retrieval/registry.ts` (260 lines)

Core semantic layer for the memory architecture; well-designed (one dictionary of `{name,
description, domains, run, render, rows}`), but every `render`/`rows` function is pure and
untested — these are exactly the functions where a description/formatting change could
regress silently in what the coach actually sees (e.g. `get_goal_progress`'s render at
`165-178`, `get_food_log`'s at `259-266`). Recommend unit tests per function using small fixture
inputs (no DB) rather than a structural split — the file's shape (one function per retrieval
capability) is appropriate and shouldn't be broken up as it grows; it should grow with each new
function bringing its own test. Also carries the `description: '...locked goals...'` nomenclature
issue at line 59 — see §4.

Priority/Effort/Risk: P2 / M (writing ~10 small render tests) / Low.

### P2 — routes with manual, ad-hoc body validation (`routes/nutrition.ts`, `routes/plan.ts`, `routes/review.ts`, `routes/progress.ts`)

Each route does its own inline `typeof req.body?.x === 'string'` / enum-membership checks (e.g.
`nutrition.ts:14-17`, `review.ts:57-58,100-103,150-152`, `plan.ts:151,165,169`). This is
consistent and defensively written (nothing here is unsafe — every check fails closed with a 400),
so it's not a correctness problem, but it is duplicated validation boilerplate across 6 routers
with no shared schema, and zero of it is tested (route-level tests don't exist at all). See §6 for
the Zod recommendation. Priority/Effort/Risk: P2 / L (touches every route file) / Low — this is a
"when you have bandwidth" improvement, not urgent, since the current approach is safe, just
repetitive and untested.

### P2 — `services/capture.ts` (149 lines)

`runCaptureExtract` mixes Broker-job invocation, JSON parsing, name/goal/equipment/baseline
persistence, and legacy-shape coercion (`coerceArea`, `36-52`) in one function. The coercion
logic and the dedup logic it depends on (`selectCapturedGoals` in `capture-normalize.ts`) are
already well tested; the orchestration wrapping them (persisting goals/equipment/baseline,
`113-152`) is not. Given this is the ambient-capture path that runs on every coach turn (fired
from `routes/coach.ts:247-250`), an integration test covering "capture returns two near-duplicate
goals → one persisted row" and "capture returns an out-of-enum area → coerced + logged, never
dropped" (the brand promise: "nothing you say is lost") would directly protect that promise at the
integration seam, not just in the pure helper it calls. Priority/Effort/Risk: P2 / M / Low.

### P2 — `services/situation.ts` (71 lines)

`assessIfDue`'s weekly gate (`55-84`) is the sole trigger for the situation-assess Broker call and
for storing a `pending_proposal` a user will see on their next plan view — a bug here either spams
Broker calls (cost) or silently stops proposing re-plans (product regression), and there is no
test on the interval gate, the "one proposal outstanding at a time" guard (`58`), or
`buildSnapshot`'s tripwire-input assembly. `detectTripwires` itself (in `tripwires.ts`) is well
tested; the gate that decides *whether to call it with real data* is not. Priority/Effort/Risk:
P2 / S / Low.

---

## 4. Nomenclature audit

Checked against the canonical-vs-user-facing table in `CLAUDE.md` / `docs/cadence/BRAND.md`.

**Confirmed violations (prompt/description text, not schema):**

1. **`apps/cadence-api/src/services/retrieval/registry.ts:59`** —
   `description: 'Active high-level objectives (captured/confirmed/locked goals) with measure + status.'`
   This description string is fed directly to the Broker as part of the retrieval catalog
   (`renderCatalogDoc` → `pack-select`/`context-select` prompts). It says **"locked"**, but the
   actual `GoalStatus` enum (`packages/cadence-shared/src/index.ts:82-88`) has no `'locked'` value
   — it's `captured | confirmed | committed | parked | completed | abandoned`. This is stale
   copy from before the `locked → committed` rename and should read `captured/confirmed/committed`.
2. **`apps/cadence-api/src/services/coach-context.ts:58`** —
   `` (equipment.length ? have : need).push(`tools/equipment (${equipment.length})`); ``
   This string becomes part of the deterministic onboarding-readiness text injected into the
   coach's context. `CLAUDE.md` bans `tools` as a field name / schema-and-prompt term ("never
   `tools` in schema/prompts") — this line pairs it with `equipment` rather than using
   `equipment` alone. The identical phrase also appears in the `pack-summarize` prompt template
   in `config/ai-admin/ai-admin.config.json:327` ("...what they're working around, tools/equipment,
   tracked measures...") — that file is outside this agent's scope but is worth flagging to
   whichever agent covers `config/ai-admin/`, since it looks like the same copy was written once
   and reused in both places.

**Checked and clean (no violation found):**

- `constraints`/`plan_around` used consistently everywhere (`review.ts:180-186`,
  `capture-normalize.ts:48-69`, `registry.ts:185-206`) — including correct handling of the legacy
  `injuries` shape, mapped in and never stored under the old name.
- `area: movement|nourishment|mind|practice` used consistently as the goal-domain field; `Activity.category`
  and `Equipment.category` are a *different*, legitimate field (activity/equipment classification,
  e.g. `'footwear'|'cardio'|...`) — not the banned goal-`category`→`area` rename, so these are not
  violations despite matching the word "category" (`repos/equipment.ts`, `repos/activities.ts`,
  `routes/review.ts`). `capture.ts:116-117` explicitly and correctly maps a stale prompt's legacy
  `category` key on a *goal* payload to `area`.
- Goal status `committed` (not `locked`) used correctly in all persistence code
  (`goals.ts:setGoalStatus`, `lock.ts:64`, `review.ts:22,30`) — only the retrieval-catalog
  *description* string (finding #1 above) missed the rename.
- `consistency`/`rollingConsistency` used throughout, replacing `adherence` — the only occurrences
  of the word "adherence" are in a code comment explicitly noting the rename
  (`metrics.ts:18`, `dossier.ts:19` — the latter in dead code, see §3).
- No occurrences of `beats`, `instruments`, `tempo changes`, `resources`/`limits`-for-constraints,
  or streak-reset language anywhere in `src/`.
- `Broker` is used extensively in code/comments — this is **correct**: `CLAUDE.md`'s table says
  `Scribe` replaces `Broker` in the **UI only**, "internal only" for the code name — so `Broker`
  throughout `context-pack.ts`, `turn-context.ts`, `capture.ts`, `situation.ts`, `aim.ts` comments
  is exactly right and not flagged.

**Related, lower-severity naming drift (not a nomenclature-table violation, but worth tracking):**

- `services/lock.ts` / `previewLock`/`confirmLock`/`dismissLock` / `POST /plan/lock` all still say
  "lock" while the data model they operate on already uses `committed` (see §3, P1 cluster A).
  Not banned by the table (no user-facing copy involved), but it's the same *kind* of drift the
  table exists to prevent, just at the API/internal-function-naming layer instead of schema/prompt
  layer. Recommend a decision (rename to "commit" verbs, or explicitly document "lock" as a
  retained internal verb) rather than leaving it ambiguous.

---

## 5. Cross-boundary duplication flags

- **`apps/cadence-web` type duplication (low severity):** `apps/cadence-web/src/lib/api.ts:266-296`
  defines its own `MealMacros`, `MealKind`, `Meal`, and `NutritionDayData` types that structurally
  mirror `@cadence/shared`'s `Macros` (`packages/cadence-shared/src/index.ts:352-359`), `MealKind`
  (`:361`), and `NutritionLog` (`:363-377`) instead of importing them. `cadence-web` *does* import
  `@cadence/shared` for `Goal`, `Equipment`, `Baseline`, `OccurrenceSession`/`Log`, `ProgressData`,
  etc., so this looks like an oversight on the nutrition DTOs specifically rather than a systemic
  choice. Low risk today (the shapes are still identical), but any future field change to
  `Macros`/`NutritionLog` on the API side has no compiler-enforced signal that the web DTOs need
  updating too.
- **No business-logic duplication found** between `apps/cadence-api` and `apps/cadence-web` for
  recurrence math, macro/day-rollup math, goal-guardrail weighting, or shoe-wear-status math — the
  web app correctly treats the API as the source of truth and only renders precomputed values
  (e.g. `cadence`/`recurrence` display strings, `left`/`totals` from `GET /nutrition/day`). This is
  the right shape and should be preserved as new features land.
- **No AI Admin / Postgres boundary violations found** in `apps/cadence-web` — it talks to the API
  over HTTP only, uses Supabase strictly for auth (not app data), and no `aim_sk_` secret appears
  in its source, `.env.example`, or Vite config.
- **No duplication found** against `backend/` or `packages/core` — the Cadence-specific
  deterministic engines (scheduling, guardrail, tripwires, shoe-mileage, nutrition math) have no
  equivalent in the AI Admin platform code, which is correct given they're domain logic unique to
  Cadence.
- **Internal duplication** (within `apps/cadence-api` itself): the `context-pack.ts`/
  `turn-context.ts` retrieval-pipeline duplication and the `dossier.ts`/`registry.ts` rendering
  duplication are covered in §3 (P1 cluster B and the `dossier.ts` P2 item respectively) — flagging
  again here since "duplication across engines/services" is explicitly in the rubric.

---

## 6. Systemic / cross-cutting recommendations

1. **Stand up a test harness for DB-touching code, then backfill tests top-down by business
   criticality**, in roughly this order: plan-commit pipeline (`plan-synthesis.ts`/`lock.ts`/
   `replan.ts`) → nutrition service (`nutrition.ts`) → session service (`session.ts`) → the
   retrieval pipeline (`context-pack.ts`/`turn-context.ts`) → `ai/aim.ts` → routes (`coach.ts`'s
   SSE logic first). The pure-function layer is already in great shape (`engines.test.ts`); the
   gap is entirely in the orchestration layer around it. A lightweight option that fits this
   codebase's style (real Postgres via `postgres`, tagged SQL, no ORM): a disposable test schema
   or a Testcontainers-style ephemeral Postgres, seeded via the same `resetUserData`/`ensureUser`
   helpers already in `dev-reset.ts` — that machinery already exists for dev accounts and could
   double as test fixtures with minimal new code.
2. **Fix the CI blind spot at the root**, tracked by the sibling workspace/CI agent — but worth
   restating here because every P1 in this report is *currently unprotected by any automated
   gate*. Registering `apps/cadence-api` as an npm workspace and wiring its `typecheck`/`test`
   into root `npm run ci`/`prepush` is the single highest-leverage change available, independent
   of any of the per-file work above — it turns "50 passing tests that a human has to remember to
   run" into a real safety net.
3. **Add an ESLint config for `apps/cadence-api` (and `packages/cadence-shared`)** — `backend/`
   and `frontend/` both have `eslint.config.js`; this directory has none, and the root
   `lint-staged` globs don't cover `apps/**` either. Given the code is already unusually
   consistent by hand, a lint config mostly locks in habits already present (no `any`, consistent
   error handling, import ordering) rather than fixing existing violations — cheap insurance for
   a codebase that's about to grow.
4. **Adopt Zod (or a similarly lightweight schema validator) at two boundaries, not everywhere:**
   (a) route-level request body validation, replacing the repeated inline `typeof`/enum checks
   across `nutrition.ts`/`plan.ts`/`review.ts`/`progress.ts` with declared schemas — mechanical,
   low-risk, and would let route tests assert against the schema instead of re-deriving the
   validation rules; and (b) Broker/Coach job JSON-response parsing, which today is a
   `JSON.parse` + manual field-by-field type-checking pattern repeated with slight variations
   across `nutrition.ts`, `session.ts`, `plan-synthesis.ts`, `goal-assess.ts`, `situation.ts`,
   `context-pack.ts`, and `turn-context.ts`. This second boundary is the more valuable one: it's
   validating *untrusted LLM output*, which is exactly where a declarative schema (with
   `.safeParse()` returning a typed result instead of a hand-rolled `parseJson` + optional-chaining
   dance) earns its keep, and it would collapse ~7 near-identical hand-written parsers into one
   pattern.
5. **Engines/services boundary is already appropriate for this app's current size — don't
   over-abstract it preemptively.** The rubric asks whether clearer boundaries are needed as the
   app grows; today's shape (one file per capability, routes thin, pure math extracted and
   tested) is the right foundation. The one real structural risk is the retrieval-pipeline
   duplication (§3/§5) — fix that now, before a third retrieval entry point (a plausible next
   feature, given `pack-select`/`context-select` already exist as two) copies the pattern a third
   time.
6. **Consider a lightweight decision log for the `lock`→`committed` naming drift** (and any future
   similar rename) — a one-line note in `CLAUDE.md`'s engineering-conventions section ("internal
   verb X is retained for Y; don't rename without also updating Z") would have prevented needing
   to flag it here, and would help the *next* rename land fully rather than partially.
