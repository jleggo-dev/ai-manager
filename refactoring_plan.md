# AI Manager Monorepo — Refactoring Plan

**Status:** Draft for review · **Owner:** whoever runs the orchestrator role (see §6) · **Last synthesized:** Jul 19, 2026

This is the master, living refactoring plan for the `ai-manager` monorepo (AI Admin + Cadence).
It was built by six independent audit agents, each assigned one area of the codebase, each
applying the same rubric (§1), each cross-referencing the pre-existing
[`CODE_REVIEW_AND_TEST_PLAN.md`](CODE_REVIEW_AND_TEST_PLAN.md). Their full, per-file, line-cited
reports live in [`docs/refactor-analysis/`](docs/refactor-analysis/) — **this document is the
supervisor's synthesis, prioritized master backlog, and execution/orchestration plan**, not a
replacement for that detail. Every backlog item below links back to the exact section of the
source report that contains the full current-problem/target-design/migration-steps write-up.

| # | Area | Report |
|---|---|---|
| 01 | AI Admin backend (`backend/src/**`) | [`docs/refactor-analysis/01-ai-admin-backend.md`](docs/refactor-analysis/01-ai-admin-backend.md) |
| 02 | AI Admin frontend (`frontend/src/**`) | [`docs/refactor-analysis/02-ai-admin-frontend.md`](docs/refactor-analysis/02-ai-admin-frontend.md) |
| 03 | Cadence API (`apps/cadence-api/src/**`) | [`docs/refactor-analysis/03-cadence-api.md`](docs/refactor-analysis/03-cadence-api.md) |
| 04 | Cadence web (`apps/cadence-web/src/**`) | [`docs/refactor-analysis/04-cadence-web.md`](docs/refactor-analysis/04-cadence-web.md) |
| 05 | Shared packages & the AI Admin↔Cadence seam (`packages/*`) | [`docs/refactor-analysis/05-shared-packages-and-seam.md`](docs/refactor-analysis/05-shared-packages-and-seam.md) |
| 06 | Build/CI/test/workspace infrastructure (repo-wide) | [`docs/refactor-analysis/06-build-ci-test-infra.md`](docs/refactor-analysis/06-build-ci-test-infra.md) |

---

## 0. TL;DR for anyone about to start work

1. **Nothing in this repo is on fire.** Phase 0 (workspaces + CI + lint/hooks) and Phase 1 P0s
   (BE-01 / FE-01 / FE-02) are merged. Most Phase 2 P1s through batches 3–6 are also Done
   (see §4.2 progress). Remaining P1 work is concentrated in Cadence web + a few cross-cuts.
2. **Safety net exists, but is still report-only.** INFRA-01…05 landed (PRs #3–#5). Path-filtered
   CI runs on every PR; treat red jobs as merge blockers even though branch protection may not
   yet *require* the check. **INFRA-08** (repo-wide `max-lines` gates) lands via PR #23.
3. **Still-open product risk:** frontend/backend type drift (SD2/SD3 → **FE-10**). The old
   monoliths and RBAC gap are gone (splits + BE-03 Done).
4. **Cadence coverage is improving but uneven.** `apps/cadence-api` now has real suites (plan
   commit, nutrition, coach-stream, aim seam). `apps/cadence-web` still has almost no feature
   tests — WEB-01…04 are the remaining Phase 2 web P1s.
5. Read §4.2 for the accurate remaining backlog, §5 for durable goals, §6 for multi-agent
   orchestration.
6. **CI gate between batches:** do not start the next parallel batch (and do not merge) while
   integration-branch / PR CI is red. INFRA-02 "report-only" means GitHub branch protection may
   not yet *require* the check — orchestrators and supervisors must still treat failing jobs as
   blockers (or quarantine them with an explicit human action item). Ship process:
   [`.cursor/skills/development-workflow/SKILL.md`](.cursor/skills/development-workflow/SKILL.md).

---

## 1. Methodology & Rubric

Six `generalPurpose` agents worked in parallel, each scoped to one non-overlapping directory tree,
each given the identical rubric below so findings are comparable across areas, and each required
to (a) read real files and cite real line numbers — no inference from file names alone — and (b)
cross-reference every relevant finding in `CODE_REVIEW_AND_TEST_PLAN.md` (absorbed / still valid /
already fixed) so this plan doesn't re-litigate solved problems. All six wrote analysis-only
reports; no source was modified during the audit.

**Evaluation dimensions:** Single Responsibility / separation of concerns, DRY vs. needless
abstraction, coupling & cohesion, file/function size & cyclomatic complexity, type safety, security
(secrets, RBAC, tenant scoping, injection), performance (N+1, unbounded queries, O(n²)),
testability & actual test coverage, and (for Cadence) brand/nomenclature compliance against
`docs/cadence/BRAND.md`.

**Severity scale (used identically in every backlog item below):**

| Priority | Meaning |
|---|---|
| **P0** | Security/correctness risk, install/CI-breaking, or >1,500 lines mixing 3+ responsibilities |
| **P1** | 500-1,500 lines mixed responsibilities, cross-file duplication, missing tests on business-critical logic, unsafe types in public interfaces |
| **P2** | 250-500 lines that could be split, moderate duplication, inconsistent patterns |
| **P3** | Naming drift, dead code, minor style, docs gaps |

**Effort:** S (<0.5 day) · M (0.5-2 days) · L (>2 days, needs phasing). **Risk:** Low/Medium/High
(blast radius / likelihood of behavior change during the refactor).

---

## 2. Corrections & Reconciliation

Two claims made by one agent were independently corrected by a later agent with direct evidence.
This plan uses the **corrected** version throughout:

| Original claim | Correction | Source |
|---|---|---|
| "Zero `.sql` migration files exist for AI Admin" | **False.** 20 tracked migration files exist (7 AI Admin, 13 Cadence). The real gap is AI Admin's `001`-`005` are referenced in `README.md` but missing from the repo, and there's no generic apply/rollback tool — not "no history at all." | Report 06 §0 |
| "Standardize on vitest since cadence-api already uses it — migration cost for backend's ~65 test files" | **No migration needed.** `backend`, `frontend`, and `apps/cadence-api` are *already* uniformly on `vitest@^4.1.5`. The actual gap is zero test infrastructure in `apps/cadence-web`, `packages/core`, `packages/cadence-shared` — an extension, not a migration. | Report 06 §0 |

One more reconciliation, not a correction but worth surfacing: the workspace-wiring P0 was
discovered **independently** by both the shared-packages agent (05) and the infra agent (06), via
two different methods (`npm install --dry-run` vs. direct config reading) — both arrived at the
identical root cause and fix. This plan merges them into one item, **INFRA-01**, since it's the
same bug, not two.

Also: the Cadence-API agent (03) noted that the "uncommitted" nutrition files flagged in its task
brief were already committed (`418f3c4`, "Cadence N4: the Visual Today") by the time it ran its
analysis — the working tree had moved between task assignment and audit execution. This plan
reflects the current committed state; if `git status` shows different uncommitted changes when
execution starts, re-run a quick diff against report 03's inventory before trusting its line
numbers verbatim.

---

## 3. Cross-Cutting Findings (span 2+ areas — call these out explicitly so no implementer re-derives them in isolation)

| Finding | Where it shows up | Consolidated as | Status |
|---|---|---|---|
| **Root `package.json` workspaces exclude all of Cadence; `npm install` would delete Cadence's linked packages** | Reports 05 §1, 06 §1 (independently confirmed) | **INFRA-01** | ✅ Done (PR #3) |
| **Frontend/backend type drift (`CallingApplication`/`DiagnosticLog` vs. their `*Row` counterparts)** — SD2/SD3 | Reports 01 §5, 02 §3/§5, 05 §5 | **FE-10** | **Still open** |
| **`Broker` → `Scribe` rename (exported DevTrace field names + shared contracts module)** | Report 03/04/05 | **CROSS-01** | ✅ Done (PR #30) |
| **SSE line-buffering/parsing logic independently reimplemented 3+ times** | Reports 01/03/05 | **CROSS-02** | ✅ Done (BE-02 #18 + API-03 #25) |
| **Template-interpolation logic reimplemented independently** instead of using canonical helpers | Report 02 §1.4/§4.1 (3× inside frontend) | FE-01/FE-03 sub-tasks | ✅ Done with those items |
| **No data-fetching cache layer anywhere React is used** — hand-rolled `useState`+`useEffect`+manual error notification, duplicated fetches | Report 02 §6 (AI Admin frontend), Report 04 §6 (Cadence web) | **CROSS-03** | Still open (pilot with WEB-04) |
| **Zero automated test coverage exactly where business/security risk is highest** | All six reports | pervasive theme | Partially closed (API-01/04/05, FE-09, …); Cadence web still thin |
| **Two-Supabase-projects architecture** has implications for CI secret-scoping | Report 06 §4.4 | folded into **INFRA-02** | ✅ Done (path-filtered jobs) |

---

## 4. Master Priority Backlog

Every item has an ID, so status can be tracked over time (see §6.5 for the status legend). **P0
and P1 items are detailed inline** (current problem, target design, migration steps, test-first
requirement, dependencies) since these carry the most execution risk and benefit from being
self-contained here. **P2/P3 items are condensed with a direct pointer** to the exhaustive
per-file plan already written in the area report — do not re-derive these from scratch, they're
already fully specified.

### 4.0 Phase 0 — Foundational infrastructure (must land before Phase 1 is trustworthy)

All five sibling application-code agents independently arrived at the same conclusion the infra
agent's own report states directly: **every subsequent item in this backlog is currently
unprotected by any automated gate.** These items are not optional preamble — they are what makes
"the tests still pass after this refactor" a true statement instead of a hope.

| ID | Item | Priority | Effort | Risk | Depends on | Status |
|---|---|---|---|---|---|---|
| **INFRA-01** | Fix root `workspaces` array + regenerate `package-lock.json` | **P0** | S | Medium | — | **Done** (PR #3, merged to `feat/cadence`) |
| **INFRA-02** | Add GitHub Actions CI (path-filtered, report-only rollout first) | **P0** | M | Medium | INFRA-01 | **Done** (PR #4, merged to `feat/cadence`) |
| **INFRA-03** | Extend root scripts (`--workspaces --if-present`) + add vitest to `apps/cadence-web`, `packages/core`, `packages/cadence-shared` | P1 | S per workspace | Low | INFRA-01 | **Done** (PR #4, merged to `feat/cadence`) |
| **INFRA-04** | Add ESLint configs to `apps/*`/`packages/*`; align ESLint major versions; add `.prettierrc.json`; expand format globs | P1 | M | Low | INFRA-01 | **Done** (PR #5, merged to `feat/cadence`) |
| **INFRA-05** | Fix pre-commit hooks — commit an actual `.husky/pre-commit`, expand `lint-staged` globs to cover Cadence | P1 | S | Low | INFRA-04 | **Done** (PR #5, merged to `feat/cadence`) |
| **INFRA-08** | Repo-wide code-size gates — generalize FE-01's `max-lines` to all 6 workspaces (`eslint.config.sizes.mjs`: file 500 / fn 150, fn on `.ts` only) + per-workspace allowlist-as-backlog + `CLAUDE.md` convention. Fulfills §5.1. | P1 | S | Low | INFRA-04 | **Done** (PR #23) — offenders after merge onto main: backend 4, frontend 10, cadence-web 2; cadence-api + packages exception-free. Widget-health allowlist entries deleted with the feature. `complexity` deferred (noisy). |

#### INFRA-01 — Fix workspace wiring [P0]

**Current problem:** Root `package.json` (`:5-11`) lists `["backend","frontend","packages/types","packages/client","packages/edge"]` — the exact three packages with **zero** in-repo consumers, and not `packages/core`/`packages/cadence-shared`/`apps/cadence-api`/`apps/cadence-web`, which real code depends on. Verified live via `npm install --dry-run`: npm reports `@ai-admin/core`, `@cadence/shared`, `@cadence/api`, `@cadence/web` as extraneous and would delete them. The repo only works today because of stale `node_modules` symlinks predating the current config. `package-lock.json` is separately stale (`version: 1.2.0`, `workspaces: ["backend","frontend"]` — doesn't even include the three orphan packages). `docs/cadence/PLAN.md:66` incorrectly claims this was already done.

**Target state:**
```json
"workspaces": [
  "backend", "frontend",
  "packages/types", "packages/client", "packages/edge",
  "packages/core", "packages/cadence-shared",
  "apps/cadence-api", "apps/cadence-web"
]
```

**Migration steps:** (1) edit the array; (2) regenerate `node_modules` + `package-lock.json` from a **clean** checkout, not a machine with pre-existing symlinks; (3) `npm ls --workspaces` shows all 9 with no `extraneous`/`invalid`; (4) smoke-test `apps/cadence-api`'s dev server actually resolves `@ai-admin/core`/`@cadence/shared` at runtime, not just at typecheck time; (5) update `docs/cadence/PLAN.md:66` and its stale risk note at `:381-383` in the same PR; (6) commit the regenerated lockfile in the *same* PR as the array change, never as a follow-up.

**Test-first requirement:** none needed beyond the verification steps above — this is config, not logic.

**Risk note:** the edit itself is trivial; the real risk is that `apps/cadence-api`/`apps/cadence-web` likely have latent `tsc`/lint failures that have *never* been checked by anything, since nothing has ever installed them cleanly. Expect this PR to surface a backlog of small breakages — budget for that (see INFRA-02's report-only rollout, designed for exactly this).

*Full detail: reports 05 §4.1/§4.2, 06 §4.1.*

#### INFRA-02 — Add GitHub Actions CI [P0]

**Current problem:** `.github/workflows` does not exist at all (DM1 from `CODE_REVIEW_AND_TEST_PLAN.md`, still fully unresolved). Every quality gate that exists (`typecheck`/`lint`/`test`/`build`/`ci`/`prepush`) only runs if a human remembers to run it locally.

**Target state:** a path-filtered workflow with two independent jobs (`ai-admin`, `cadence`) so a Cadence-only PR never needs AI Admin's Supabase secrets and vice versa — the two products use **separate Supabase projects**. See report 06 §4.4 for a complete, ready-to-adapt workflow YAML (change-detection job via `dorny/paths-filter`, matrix over workspaces, secrets scoped per job).

**Migration steps:** (1) land after INFRA-01/INFRA-03; (2) land the workflow in **report-only mode** first (no required-status-check) to inventory real failures across all 9 workspaces without blocking anyone; (3) fix what surfaces; (4) flip to required once green.

**Report-only vs. merge/batch gate:** "report-only" means the check is **not yet required for
GitHub branch protection**. It does **not** mean "ignore red and keep merging." Orchestrators and
supervisors MUST still treat failing CI jobs as blockers for merge and for starting the next
parallel batch, unless remaining failures are **explicitly quarantined** with a human action item
(e.g. key rotation). Intentionally skipped jobs need a documented reason; leaving jobs red and
moving on is forbidden. See §6.3 and
[`.cursor/skills/development-workflow/SKILL.md`](.cursor/skills/development-workflow/SKILL.md).

**Test-first requirement:** open one throwaway PR touching only `apps/cadence-web/` and confirm the `ai-admin` job is skipped; one touching only `backend/` and confirm the reverse.

**Risk note:** Medium — not because the workflow is risky, but because turning on CI for the first time against a 5-year-old, never-collectively-checked codebase will surface a real backlog. The report-only rollout is the mitigation, not optional polish.

*Full detail: report 06 §4.4.*

#### INFRA-03 through INFRA-05 — condensed

- **INFRA-03** [P1/S+M]: switch root scripts to `--workspaces --if-present`; add `vitest` + a `test` script + at least one smoke test to the three zero-coverage workspaces. *Full detail: report 06 §4.2.*
- **INFRA-04** [P1/M]: add `eslint.config.js` to `apps/cadence-api` (Node template) and `apps/cadence-web` (React template) and a trimmed config for `packages/core`/`packages/cadence-shared`; align on ESLint `^10` repo-wide (frontend is currently on `^9`); add `.prettierrc.json` (verify zero-diff against current defaults before pinning); expand `format`/`format:check` globs. *Full detail: report 06 §4.3.*
- **INFRA-05** [P1/S]: `.husky/pre-commit` doesn't exist as a tracked file — `lint-staged` silently never runs today. Create it; expand `lint-staged` globs to `apps/cadence-api`, `apps/cadence-web`, `packages/{core,cadence-shared}`; add `.husky/_` to `.gitignore`. *Full detail: report 06 §4.5.*

---

### 4.1 Phase 1 — P0 application-code items — **complete** (BE-01 PR #9, FE-01 PR #8, FE-02 PR #7)

These are the highest-severity, highest-blast-radius items. They can start **in parallel** with
each other (BE-01, FE-01, FE-02 touch entirely different files/products) as soon as Phase 0's
report-only CI exists — they should not wait for Phase 0 to be fully "required," but they must not
merge until INFRA-01 has landed, since none of these are safely verifiable without it. Report-only
still requires green (or quarantined) CI before merge and before the next batch — see §6.3.

| ID | Item | Area | Priority | Effort | Risk | Depends on | Status |
|---|---|---|---|---|---|---|---|
| **BE-01** | Split `backend/src/ai-manager/index.ts` (2,071 lines, 21 exported fns, 5 responsibilities, no direct tests) | Backend | P0 | L (phased, 5 steps) | High | Test-first step; should land before/alongside INFRA-02 | **Done** (PR #9, merged to `feat/cadence`) |
| **FE-01** | Split `ProcessingJobManager.tsx` (5,497 lines, 14 components) **and** add a max-file-line lint rule so it can't regrow | Frontend | P0 | L (7 phased steps, ~1-2 weeks) | High | Test-first step | **Done** (PR #8, merged to `feat/cadence`) |
| **FE-02** | Split `AiProfileManager.tsx` (2,466 lines, 2 components incl. an embedded chat client) | Frontend | P0 | L (~1 week) | Medium | Test-first step; independent of FE-01 | **Done** (PR #7, merged to `feat/cadence`) |

#### BE-01 — Split `ai-manager/index.ts` [P0] — **Done** (PR #9)

**Current problem:** One file exports 21 top-level async functions spanning 5 distinct
responsibilities: job execution (`executeJob`/`executeJobById`/`executeRawPrompt`), chat-session
lifecycle (`openChatSession`/`resumeChatSession`/`sendChatMessage`/...), bulk data-source upload
(`uploadApiDataSourcesChunked`), tool-call plumbing (`extractAndAccumulateOutputs`/
`fulfillPendingToolJobCalls`), and diagnostics wiring threaded through all of the above. **No
direct unit tests** — every function is exercised only transitively via HTTP-level route tests.
`splitRowsByByteCap` inside it is O(n²) (SD4, still valid). This is the file every consumer of "AI
Manager" depends on — both AI Admin's own routes and, in-process, Cadence's `@ai-admin/core` seam.

**Target design:** a directory `ai-manager/` with a thin `index.ts` barrel (preserving the current
public import surface so nothing outside the file needs to change mid-migration), backed by
`job-execution.ts`, `chat-session-lifecycle.ts`, `chat-messaging.ts`, `tool-fulfillment.ts`, and
`data-source-upload.ts` (which also fixes the O(n²) byte-cap bug in the same PR since it becomes
isolated and low-risk once standalone).

**Migration steps:** (1) land direct unit tests against the *current* file first — at minimum
`executeJobById`, `openChatSession`, `sendChatMessage`, `uploadApiDataSourcesChunked`; (2) extract
`data-source-upload.ts` (lowest coupling); (3) extract `tool-fulfillment.ts`; (4) extract
`job-execution.ts`; (5) split the remaining chat-session code last (highest fan-in). Keep
`index.ts` as a re-export barrel through all 5 steps.

**Test-first requirement:** step 1 above is a hard blocker, not a nice-to-have — after each
extraction step, the full existing e2e suite (`e2e-resume-chat`, `e2e-session-lifecycle`,
`e2e-live-provider-chat`, `e2e-devs-ai-v2-tools`, `e2e-concurrency-lock`, `e2e-calling-application`,
`chat-sessions*`) plus the new unit tests must pass unchanged.

**Dependencies:** should land after (or alongside) INFRA-02 so regressions are caught
automatically. Should land before any Cadence-side refactor of `@ai-admin/core`'s chat surface,
since Cadence consumes this in-process.

*Full detail: report 01 §4 ("P0 — `backend/src/ai-manager/index.ts`").*

**Done notes (PR #9):** Barrel `index.ts` (~60 lines) re-exports from the five modules above;
`splitRowsByByteCap` now tracks a running byte total (SD4 O(n²) fix, planned exception). Public
import path preserved for backend routes and `@ai-admin/core`. Direct unit tests in
`backend/test/ai-manager-unit.test.ts` (20 cases). Additive export of previously-private
`resolveProfileToolDefinitions` via the barrel — non-breaking. Live e2e suite not re-run in
supervisor review (env-limited); Phase 1 P0 (BE-01, FE-01, FE-02) is complete.

#### FE-01 — Split `ProcessingJobManager.tsx` + add a max-file-line lint rule [P0] — **Done** (PR #8)

**Current problem:** 5,497 lines, 14 component definitions in one file, two of which are defined
*inside* other components (`StatusIcon` nested in `SchemaValidationPanel`, `SortHeader` nested in
`AnalyticsTab` — both recreated as new function identities every render, defeating memoization).
**This file already grew back once**: `CODE_REVIEW_AND_TEST_PLAN.md`'s DM3 recorded a prior fix
(extracting `DiagnosticsTab`, ~370 lines) as done — the file is now 1,420 lines *larger* than at
that time, because the fix was file-level, not structural, and nothing (lint rule, convention, PR
checklist) stopped the next 13 features from being added back into the same file the same way.
Zero test coverage on the single highest-risk file in the repo. Three independent reimplementations
of template interpolation exist inside it instead of using the canonical `lib/interpolate.ts`.

**Target design:** a `processing-jobs/` directory with one file per current inline component
(`JobsTab`, `RuleSetsTab`, `TestRuleSetTab`, `BuildRulesTab`, `TestTab`, `SchemaValidationPanel`,
`AdvancedTab`, `AnalyticsTab`, plus `VariablesReference`/`ResponseSchemaViewer`/
`RuleSetSchemaEditor` as pure file-moves), two extracted hooks (`useProcessingJobsData`,
`useJobBulkActions`), the nested `StatusIcon`/`SortHeader`/`ScoreBadge` promoted to shared atoms,
and the orchestrator `ProcessingJobManager.tsx` shrunk to <150 lines. **Plus:** an ESLint
`max-lines` rule (threshold ~400-500, scoped at minimum to `components/organisms/**` and
`pages/**`) that fails CI — this is the actual fix for the regrowth pattern, not the split itself.

**Migration steps:** (1) test-first (blocking, not optional) — component tests for the 5 most
business-critical flows before moving a single line; (2) extract the pure zero-dependency
components first (lowest risk); (3) extract the two hooks; (4) extract the 8 remaining
tab/panel components one at a time, one commit each, re-running tests after each; (5) replace the 3
duplicated interpolation copies with `lib/interpolate.ts`; (6) replace `as unknown as` casts with
correctly-typed `api.ts` return types (pairs with FE-06); (7) add the max-file-line lint rule.

**Test-first requirement:** step 1 is a hard blocker — cover create/edit/delete-job,
build-rules prompt composition, the test-tab's request/render cycle, schema-validation
pass/fail rendering, and analytics field-scoring toggle+save, using `AiProfileManager.test.tsx`/
`WorkflowManager.test.tsx` as the house-style template.

**Dependencies:** sequence after or in parallel with adding the lint-rule guardrail — landing the
split without the guardrail risks the five extracted files becoming the *next* five monoliths.
Should land before/alongside FE-06 (`services/api.ts` split), since the new hooks want a
non-monolithic API home to import from.

*Full detail: report 02 §4.1.*

**Done notes (PR #8):** Orchestrator `ProcessingJobManager.tsx` is ~108 lines; tabs/hooks live under
`processing-jobs/`; atoms `StatusIcon`/`SortHeader`/`ScoreBadge` shared; interpolation consolidated
to `lib/interpolate.ts`; organism/page `max-lines@500` active with backlog overrides refreshed
after FE-02 (stale `AiProfileManager.tsx` override removed). Leftover oversized extracts logged in
§4.8 — do not re-open FE-01 for those.

#### FE-02 — Split `AiProfileManager.tsx` [P0] — **Done** (PR #7)

**Current problem:** 2,466 lines, 2 top-level components. The main component
(1,754 lines) mixes profile CRUD, list filter/search/sort/group-by state, card/table view toggle,
bulk actions, MCP tool discovery + auth-status polling, and tool-job configuration — 5+ concerns
before rendering starts. `TestChatPanel` (572 lines) is effectively its own embedded streaming-chat
client with real architectural overlap to whatever chat/session UI exists in Cadence's web client
(flagged cross-boundary, not a merge decision — just worth the two teams being aware of each
other). Test coverage is shallow relative to size (164 lines of tests against 2,466 of source; the
streaming/tool-auth paths are untested).

**Target design:** orchestrator `AiProfileManager.tsx` (<200 lines) + `hooks/useAiProfilesData.ts` +
`hooks/useProfileListFilters.ts` + `hooks/useProfileBulkActions.ts` + a standalone
`ai-profiles/McpToolsPanel.tsx` + `ai-profiles/TestChatPanel.tsx` moved to its own file (with a
follow-up to extract `useTestChatStream`).

**Migration steps:** (1) test-first for `TestChatPanel`'s streaming happy-path + tool-auth-required
path + bulk actions (currently untested); (2) extract `TestChatPanel` (zero logic change, cuts the
file by ~550 lines immediately); (3) extract the three hooks; (4) extract `McpToolsPanel`; (5)
re-measure, target both resulting files under 600 lines.

**Test-first requirement:** step 1 above, mandatory before touching the intricate streaming/OAuth
code paths.

**Dependencies:** none — fully independent of FE-01, can run in parallel.

**Landed (PR #7):** orchestrator ~100 lines; `TestChatPanel` (~675, move-only — `useTestChatStream`
deferred as **FE-11**); hooks + `McpToolsPanel` + `ProfileFormModal` / `ProfileListView` /
`JobsAsToolsPanel` / `ProfileRuntimeOptions` to hit size targets. Streaming/tool-auth/bulk tests added.

*Full detail: report 02 §4.2.*

---

### 4.2 Phase 2 — P1 items

Once Phase 0 exists (at least in report-only form) and Phase 1 is underway, these can be assigned
with high parallelism — nearly all are independent files. A few internal orderings matter (noted
per item / per area intro).

> **Phase 2 progress (updated 2026-07-19).** Merged to `feat/cadence` so far:
> - **BE-03** — RBAC route guards (PR #10). Side effect: the `ai-admin/backend` CI job is now
>   **green for the first time** — the missing repo secrets (`TEST_API_KEY`, `AI_MANAGER_SUPABASE_*`,
>   `CREDENTIAL_ENCRYPTION_KEY`, `DEVS_AI_API_KEY`) were added and `ci.yml` now wires `TEST_API_KEY`.
>   Follow-ups logged: **BE-03a** (diagnostic-logs GET-gating — needs product sign-off), **BE-03b**
>   (user-credentials stays un-gated).
> - **API-01** — atomic plan commit + shared confirm skeleton + the repo's first **DB integration
>   harness** (PR #11). 56/56 vitest pass against a live Cadence DB locally; the 6 new DB tests
>   `skipIf` no `CADENCE_*` secrets, so the cadence CI job stays green — **add `CADENCE_DATABASE_URL`
>   + `CADENCE_SUPABASE_*` to run them in CI too** (mirrors the AI-Admin secrets).
> - **FE-09** — auth `onAuthStateChange` unsubscribe on App unmount (PR #12). SD5 listener leak fixed;
>   `initAuthSession` returns an unsubscribe handle; App effect cleanup (incl. cancelled-init race)
>   and unit tests cover it.
> - **API-05** — smoke tests + CoachDiag provenance comment for the AI Admin `aim.ts` seam (PR #13).
>   Mocks `@ai-admin/core`; 16/16 vitest cases cover `withAim`/auth, `clockVars` UTC pairing,
>   CoachDiag finalization, and coach session surface.
> - **BE-04** — split `services/formatting-rules.ts` into `formatting-rules/{index,validators,rules/*}`
>   with a thin compatibility re-export (PR #14). Structural only; 51/51 formatting-rules tests pass.
> - **FE-07** — extract HealthDashboard aggregation into pure `lib/health-aggregation.ts` helpers
>   (PR #15). Unit-tested rollups; page keeps thin `useMemo` wrappers.
> - **API-02** — split `services/session.ts` into generate/log/weigh-in + normalize modules (PR #16).
>   Structural only; 8/8 `session-normalize` vitest cases (bounds + URL-strip backstop).
> - **PKG-01** — remove `getServiceSupabase` from `@ai-admin/core` exports; hot/cold-path grouping
>   (PR #17). Documented in `docs/cadence/PLAN.md`; core typecheck + 4/4 vitest green.
> - **BE-02** — shared `services/sse-line-reader.ts` for backend SSE line buffering (PR #18).
>   Structural extract only; 9/9 `sse-line-buffer` vitest. Cadence half completed by **API-03**.
> - **PKG-02** — split `packages/cadence-shared/src/index.ts` into 11 typed modules + barrel
>   (PR #19). Public `@cadence/shared` import path unchanged.
> - **FE-08** — extract `useHealthCheckProfilesData` from `HealthCheckProfilesPage` (PR #20).
>   Pure helpers in `lib/health-check-profiles.ts`; page is a thin render shell; first page/hook tests added.
> - **BE-05** — split widget-health-checker into browser/interaction/result modules (PR #26).
>   **Subsequently removed** — product decision: unused widget health checker deleted end-to-end
>   (`refactor/remove-widget-health-checker`). API health checks / Health Check Profiles / provider
>   health dashboard retained. **FE-05** cancelled (page deleted with the feature).
> - **CI green-up** (PR #21) — Prettier-fix `aim.test.ts` (was failing `format:check`); gate
>   `e2e-live-provider-chat` in Actions unless `RUN_LIVE_PROVIDER_E2E=1` (repo Variable). Local
>   `npm test` still runs live provider e2e by default. **CI-01** Devs.ai v1 key rotation remains a
>   human action (`DEVS_AI_V1_KEY_KNOWN_EXPIRED`).
> - **API-03** — extract coach SSE relay into `services/coach-stream.ts` + shared
>   `createSseLineBuffer` in `@ai-admin/core` (completes **CROSS-02** cadence half; same contract
>   as BE-02). Characterization tests: core 9/9 + coach-stream 8/8.
> - **FE-04** — split `SettingsPage` into `pages/settings/*` tab files (`refactor/fe-04-split-settings-page`).
>   API-key create/copy/revoke tests + `isAdminRole` gate on create/delete (matches backend).
> - **FE-06** — split `services/api.ts` into domain modules + barrel (PR #28).
> - **BE-06** — split Devs.ai v1 client into per-surface modules (PR #29).
> - **FE-03** — split `AiMatcherPage` into molecules/hooks/`lib/ai-matcher.ts`; prompt composition
>   via `lib/interpolate.ts` (`composeMatcherPrompt`). Page dropped from eslint `max-lines` override
>   (PR #32).
> - **CROSS-01** — `Broker`→`Scribe` rename across cadence-shared / cadence-api / cadence-web
>   (+ core package header) (PR #30). DevTrace fields `scribeSelect`/`scribeSummarize`;
>   `broker-contracts.ts` → `scribe-contracts.ts`. Persisted mode strings `broker-curated`/
>   `broker-partial` and profile slug `cadence-broker` left unchanged (audit trail / live IDs).
> - **API-04** — test-first nutrition backfill: extract `parseMealResult`/`wantsTargets`, unit +
>   DB integration tests for `logMeal` fallback/provisional and `getBaselineRead` cost-control /
>   propose gates (`refactor/api-04-nutrition-tests`, PR #33).
> - **Docs restore** (PR #34) — re-applied FE-03/CROSS-01 progress after #33 squash overwrote the blurb.
> - **WEB-02** — split cadence-web `lib/api.ts` into domain modules + barrel; extract coach SSE
>   parser (`lib/api/coach-sse.ts`) with characterization tests (PR #41).
>
> **Remaining Phase 2 P1 (accurate as of WEB-02):**
> - **FE-10** — CallingApplication / DiagnosticLog type drift (SD2/SD3); needs product call on extra FE fields
> - **API-06** — shared `select-and-run` extract + `buildContextPack` resilience test
> - **WEB-01** (L) — ReviewScreen split + unit-conversion tests (hard blocker)
> - **WEB-03** (L) — OccurrenceSheet panel split
> - **WEB-04** (M) — Today/Progress/Plan card dedup (natural CROSS-03 pilot host)
> - **CROSS-03** — TanStack Query pilot (opportunistic; prefer with WEB-04, not a big-bang)
>
> **Recommended batch 7 (remaining):** **API-06** · **FE-10** (if FE-10 product decision blocks,
> swap in **FE-14** or **WEB-04**). Leave WEB-01/WEB-03 for a dedicated L batch; leave CROSS-03
> until WEB-04.

#### Backend (report 01)

| ID | Item | Effort | Risk | Notes |
|---|---|---|---|---|
| **BE-02** ✅ **Done** (`refactor/be-02-sse-line-reader`, PR #18) | Extract one shared `services/sse-line-reader.ts`; replace the 4 copy-pasted SSE line-buffering blocks in `chat-sessions.ts` + the 1 in `v2-stream-events.ts` | M | Medium | Part of **CROSS-02**; write characterization tests reproducing the original R1 chunk-split regression first. **Done notes:** `createSseLineBuffer` / `pushSseChunk` in `backend/src/services/sse-line-reader.ts`; wired into 4 `chat-sessions.ts` loops + Devs.ai v2 path (`sse-transform.ts` / `client.ts` — the live buffering site; not `v2-stream-events.ts`). Structural only. Verify: `npm test -- sse-line-buffer` 9/9. Cadence half + shared core buffer landed via **API-03** (same contract; backend keeps its local module). |
| **BE-03** ✅ **Done** (`refactor/be-03-rbac`) | RBAC gap — wire `requireRole('owner','admin')` into the 8 route files currently unguarded (`providers.ts`, `ai-profiles.ts`, `app-settings.ts`, `processing-jobs.ts`, `workflows.ts`, `calling-applications.ts`, `api-keys.ts` JWT path, plus `diagnostic-logs.ts`/`user-credentials.ts` at lower sensitivity) | S per file | Low | Cheapest, highest-value item in the whole plan — additive middleware, easy to test, easy to revert. **Recommended as the literal first PR to land in Phase 2.** **Done notes:** gated all 33 mutating routes (POST/PUT/PATCH/DELETE) across the 6 core CRUD files + `api-keys.ts` JWT path; GETs left member-readable (the "don't over-gate reads" constraint). Test-first: `backend/test/rbac-route-guards.test.ts` (22 cases, mocked ctx — member→403 on every gated router, GET→not-403, api-keys JWT gate + existing api_key-mode block intact); flipped 7 red→green. `rbac.test.ts` names corrected (the admin test key clears the gate, so its assertions were passing but mislabeled "any member can…"). **Two scope decisions deferred (need product sign-off, see §4.6):** (a) `diagnostic-logs.ts` GET-gating — NOT applied; all-GET sensitive-read surface, the plan itself flags it as a product decision; (b) `user-credentials.ts` — NOT gated; it's correctly user-scoped (report 01 marks it "needs gate? N"), so admin-gating would break members managing their own keys. Verify: backend `tsc` 0; live route tests are env-gated (run in CI). |
| **BE-04** ✅ **Done** (`refactor/be-04-split-formatting-rules`, PR #14) | Split `services/formatting-rules.ts` (1,049 lines) into `formatting-rules/{index,rules/*,validators}.ts` | M | Low | Strong existing test file reduces risk; fully independent of BE-01. **Done notes:** thin re-export at `services/formatting-rules.ts` preserves public import path; module lives in `formatting-rules/{index,validators,rules/{strip-tags,trim,csv,json,case}}.ts`. Structural split only — no behavior changes. Verify: `npm test --workspace=backend -- formatting-rules` 51/51; backend `tsc --noEmit` clean. |
| **BE-05** ✅ **Done** (`refactor/be-05-split-widget-health-checker`, PR #26) → 🗑️ **Removed** (`refactor/remove-widget-health-checker`) | Split `services/widget-health-checker.ts` (542 lines, one 392-line function) into `browser-session.ts`/`widget-interaction.ts`/`result-assembly.ts` | M | Medium | Puppeteer/timing tests are flakier — budget de-flaking time. **Done notes:** thin re-export at `services/widget-health-checker.ts`; modules in `widget-health-checker/{index,browser-session,widget-interaction,result-assembly,log,timings}.ts`. Structural split + env-overridable settle/retry delays for fast unit tests (production defaults unchanged). Verify: `npx vitest run widget-health-checker` 34/34 (~2s); backend `tsc --noEmit` clean. **Follow-up (product):** feature unused — deleted end-to-end (routes, scheduler, Puppeteer/browser deps, FE page/nav, cron `/tick/widget`). Kept: API health checks, Health Check Profiles, provider health dashboard, `computeHealthStatus`, `url-validator`. DB tables/RPCs left in place (no drop migration). |
| **BE-06** ✅ **Done** (`refactor/be-06-devs-ai-client`, PR #29) | Section-comment (then optionally split) `integrations/devs-ai/client.ts` (532 lines, ~28 methods across 5 API surfaces) | S→M | Low | Start with the zero-risk section-comment step. **Done notes:** kept single `DevsAiClient` construction site; method bodies split into `ai`/`completions`/`sessions`/`tools`/`files`/`data-sources` + shared `request`/`normalize-models`/`types`; section banners retained on the thin class. Deduped the 3 SSE open paths into `openSseStream`. Public import path unchanged. Verify: `devs-ai-client` vitest 10/10; backend suite 829 pass; `tsc --noEmit` clean. |

#### Frontend (report 02)

| ID | Item | Effort | Risk | Notes |
|---|---|---|---|---|
| **FE-03** ✅ **Done** (`refactor/fe-03-split-ai-matcher-page`, PR #32) | Split `AiMatcherPage.tsx` (1,061 lines); replace its inline `composePrompt` with `lib/interpolate.ts` | M | Medium | **Done notes:** pure helpers in `lib/ai-matcher.ts` (`composeMatcherPrompt` → `interpolateTemplate`, schema validation, slot payload shaping); molecules under `components/molecules/ai-matcher/` (`AiSlotCard`, `JsonFieldTable`, `ResultCard`, `MatcherResultsSection`); hooks `useAiMatcherSlots` / `useAiMatcherExecution` / `useAiMatcherPrompt`; page is a thin shell (~190 lines, dropped from eslint `max-lines` override). Tests: `ai-matcher.test.ts` + page smoke (slot add/remove + single-slot run). Structural only — empty-string `{{var}}` now follows canonical interpolator (replaces with `''` instead of leaving the placeholder). |
| **FE-04** ✅ **Done** (`refactor/fe-04-split-settings-page`, PR #24) | Split `SettingsPage.tsx` (910 lines) into one file per tab (already logically decomposed, mechanical only); resolve the `_workspaceRole` unused-param question on the API-keys revoke action | S-M | Low/Medium on the API-key flow specifically | Add a test for API-key create/copy/revoke first — untested, security-relevant. **Done notes:** tabs/cards moved to `pages/settings/{SystemTab,LlmDefaultsTab,RateLimitsTab,BackendUrlCard,ApiKeysTab,UserCredentialsTab,DataManagementTab}.tsx`; shell keeps Tabs routing. `_workspaceRole` resolved by wiring `isAdminRole(workspaceRole)` so create/delete match backend `requireRole('owner','admin')` (members still list keys). Tests: `SettingsPage.test.tsx` cover list/create+copy-secret/revoke + member gating. Dropped `SettingsPage` from eslint `max-lines` override. |
| **FE-05** 🚫 **Won't Fix / Removed** (`refactor/remove-widget-health-checker`) | Split `HealthCheckWidgetPage.tsx` (820 lines); consolidate its `STATUS_COLORS` duplication (3rd occurrence, see FE-11) | M | Low | **Cancelled:** page deleted with the unused widget health checker feature. `STATUS_COLORS` remaining occurrences stay under FE-11. |
| **FE-06** ✅ **Done** (`refactor/fe-06-split-api-client`, PR #28) | Split `services/api.ts` (815 lines, 100 functions) into `services/api/{providers,ai-profiles,processing-jobs,workflows,health-checks,settings,workspaces}.ts` behind a barrel | M | Low | Should land before/alongside FE-01/FE-02 so their new hooks have a non-monolithic home. **Done notes:** `services/api.ts` is a thin barrel; shared `request`/`getApiAuthHeaders` in `api/client.ts`; domains also include `calling-applications`, `chat-sessions`, `admin`. `listFormattingRules` now returns `AvailableFormattingRule[]` (removes the organism `as unknown as` cast). Rebased onto widget-health removal (no widget API surface). Call-site import paths unchanged. Verify: frontend `tsc` 0; `api.test.ts` 15/15; ProcessingJobManager tests green. |
| **FE-07** ✅ **Done** (`refactor/fe-07-health-aggregation`) | Extract `HealthDashboardPage.tsx`'s aggregation `useMemo` blocks into a pure, independently-testable `lib/health-aggregation.ts` | S-M | Low | **Done notes:** pure helpers in `frontend/src/lib/health-aggregation.ts` (`aggregateUptimeTotals`, `sortHistoryByUptimeAsc`, `countActiveIncidents`, `overallUptimePercent`, `formatOverallUptimePercent`); page keeps thin `useMemo` wrappers. Detail-view `sortedItems` left in the page (UI sort, not cross-check rollup). Unit tests in `health-aggregation.test.ts`. |
| **FE-08** ✅ **Done** (`refactor/fe-08-use-health-check-profiles-data`, PR #20) | Extract a `useHealthCheckProfilesData` hook from `HealthCheckProfilesPage.tsx` (624 lines, no tests) | M | Low | **Done notes:** hook owns list CRUD, form state, key auto-resolve, and agent/model fetching (`hooks/useHealthCheckProfilesData.ts`); pure helpers in `lib/health-check-profiles.ts` (`filterEligibleProviders`, `filterKeysForProvider`, `buildAiOptions`, `buildModelOptions`, …); page is a thin render shell (~340 lines, dropped from eslint `max-lines` override). Tests: `health-check-profiles.test.ts` + page smoke (list/empty/create modal/delete). Structural only — no behavior changes beyond `aria-label` on edit/delete actions. |
| **FE-09** ✅ **Done** (`refactor/fe-09-auth-listener-cleanup`, PR #12) | Fix `lib/auth-session.ts`'s unsubscribed `onAuthStateChange` listener (SD5, still valid) — return the unsubscribe handle, wire it into `App.tsx`'s effect cleanup | S | Low | **Done notes:** `initAuthSession` now returns `() => void` (noop when bypass/unconfigured); App effect stores the handle and unsubscribes on cleanup, including the cancelled-before-resolve race for StrictMode/HMR. Tests: auth-session unsubscribe + App unmount. Scope stayed frontend auth-session + App only. |
| **FE-10** | Fix frontend/backend type drift — `CallingApplication`/`DiagnosticLog` vs. their backend `*Row` counterparts (SD2/SD3, confirmed still open) | S(fix)/M(if backend coordination needed) | Medium (shared contract) | **Not Started.** FE `CallingApplication` still has `name`/`slug`/`description`/`is_active` absent from `CallingApplicationRow`; `DiagnosticLog` shape also diverges. Needs a product decision: are the frontend's extra fields a FE bug or a missing backend column? Add a lightweight contract test afterward so this can't silently regress again. |

#### Cadence API (report 03)

| ID | Item | Effort | Risk | Notes |
|---|---|---|---|---|
| **API-01** ✅ **Done** (`refactor/api-01-plan-commit-tx`) | Plan-commit pipeline: wrap `commitActivities` in `sql.begin()` (currently un-transactional — a mid-flight crash leaves a user with **no active plan**); extract the duplicated preview-fallback skeleton shared by `lock.ts`/`replan.ts`; resolve the `lock`/`committed` naming drift | M | Medium | **Test-first is a hard blocker** — zero tests exist on this path today; write integration tests (first-lock happy path, `needs_focus`, re-plan dismiss/re-preview, self-sufficient commit, `plan_vet` rejection) before touching it. **Done notes:** `commitActivities` now runs supersede→insertPlan→insertActivities→delete-stale-occurrences inside `sql.begin()` (repos gained an optional `SqlExecutor` param — base client or tx handle — added to `db/sql.ts`); `ensureHorizon` stays outside (idempotent). Shared `services/plan-commit-flow.ts#confirmPendingPlan` now backs both `confirmLock`/`confirmReplan`. Naming drift resolved by **documenting** (header comment in `lock.ts`: "lock" is the retained internal verb; not a nomenclature violation) rather than renaming — lower blast radius. **Also built the §6 DB test harness** (dedicated test user + `resetUserData` fixtures) — the first real integration coverage in `apps/cadence-api`. Tests mock only the AI seam (`ai/aim.ts`) so they're deterministic and never load `@ai-admin/core` (the cadence CI job lacks AI-Manager secrets by design). Verify: tsc 0; **56/56 vitest pass against the live Cadence DB** incl. the atomicity case (mid-flight `insertActivities` throw → prior active plan survives, the fix), v1→v2 supersede, `confirmLock` via the shared skeleton (goal→committed), and vetoed-leaves-DB-untouched. `describe.skipIf(!CADENCE DB)` keeps the cadence CI job green whether or not the CADENCE_* secrets are set (add them to run the integration tests in CI too — mirrors the AI-Admin secrets). |
| **API-02** ✅ **Done** (`refactor/api-02-session-split`, PR #16) | Split `services/session.ts` (297 lines, 3 unrelated responsibilities: generation/weigh-in/log-parsing) | M | Low | Unit-test `normalizeSession`'s bounds + URL-stripping regex first — it's a security/UX backstop against model-invented clickable URLs. **Done notes:** thin barrel at `session.ts`; modules are `session-normalize` (pure + exported `coachingPhase`/`str`/`num`), `session-generate`, `session-log`, `weigh-in`. `routes/plan.ts` imports the concrete modules. Structural split only — no behavior changes. Verify: 8/8 `session-normalize` vitest; cadence-api `tsc --noEmit` clean. |
| **API-03** ✅ **Done** (`refactor/api-03-coach-stream`) | Extract `routes/coach.ts`'s SSE-relay-and-accumulate loop into a standalone, unit-testable `services/coach-stream.ts` | M | Medium | Part of **CROSS-02**; write characterization tests with a synthetic `ReadableStream` covering both upstream frame shapes first. **Done notes:** `relayAndAccumulate` + `applySseDataPayload`/`applySseLine` in `apps/cadence-api/src/services/coach-stream.ts`; route thins to call it. Incremental line buffer lives in `packages/core/src/sse-line-reader.ts` (`createSseLineBuffer` / `pushSseChunk`, exported from `@ai-admin/core`) — same contract as BE-02. Verify: core `sse-line-reader` 9/9; cadence-api `coach-stream` 8/8 (OpenAI deltas, v2 `message.complete`, chunk-split frames, client drop while draining). |
| **API-04** ✅ **Done** (`refactor/api-04-nutrition-tests`, PR #33) | Test-first backfill on `services/nutrition.ts` — extract `parseMealResult`/`wantsTargets` as named pure functions, unit-test them, integration-test `logMeal`'s fallback guarantee and `getBaselineRead`'s cost-control gate | M | Low | **Done notes:** pure helpers live in `nutrition-parse.ts` (`parseMealResult`, `wantsTargets`, `PROVISIONAL_BELOW`, `isMeal`) — no DB/aim import so CI without `CADENCE_*` can run unit tests; `nutrition.ts` re-exports + uses them. Unit tests in `nutrition-parse.test.ts` (valid/malformed/partial/confidence clamp + wantsTargets matrix). DB integration in `nutrition-service.test.ts` (AI seam mocked): parse-fail still persists raw text + empty items; provisional below 0.5; baseline `<7` days → `ready:false` with **zero** LLM calls; `propose_targets` yes only when wantsTargets ∧ no existing targets. Harness fix: `resetUserData` now clears `macro_targets` (start-over / observe-from-zero). Verify: 16/16 vitest (9 unit + 7 DB); cadence-api `tsc`/`lint` clean. |
| **API-05** ✅ **Done** (`refactor/api-05-aim-seam-tests`, PR #13) | Add a smoke test + provenance comment to `ai/aim.ts` — the load-bearing AI Admin seam, currently zero tests, with an unpinned structural contract (`CoachDiag`) against `@ai-admin/core`'s real return type | S | Low | **Done notes:** `aim.test.ts` mocks `@ai-admin/core` + config; pins `withAim` RequestAuthContext, `clockVars` UTC day/`day_of_week` pairing (incl. near-boundary), coach session surface, and `recordCoachReply` CoachDiag `endLlmTimer`/`complete` contracts. Provenance comment on local `CoachDiag` subset documents the unpinned structural link to AI Admin's `DiagnosticSession`. Verify: 16/16 vitest pass; scope stayed `aim.test.ts` + comment in `aim.ts`. |
| **API-06** | Extract shared `services/retrieval/select-and-run.ts` (`validateCalls`/`executeCalls`) from the duplicated `context-pack.ts`/`turn-context.ts` pipelines; add the resilience-contract test for `buildContextPack`'s 3-way fallback | M | Low | **Not Started.** |

#### Cadence web (report 04)

| ID | Item | Effort | Risk | Notes |
|---|---|---|---|---|
| **WEB-01** | Split `ReviewScreen.tsx` (648 lines, 4-step wizard + unit-conversion math + commit flow) into `useReviewWizard`/`useDraftField`/`unitConversion.ts` + 4 step components | L | Medium | **Test-first is a hard blocker**: unit-conversion round-trips and the `plausibleKg` 20-500 clamp guard a *previously-shipped data-corruption bug* per the code's own comment |
| **WEB-02** ✅ **Done** (`refactor/web-02-split-api`, PR #41) | Split `lib/api.ts` (~536 lines, 6 unrelated domains) into `lib/api/{http,coach,plan,occurrence,nutrition,review,dev}.ts` behind a barrel; extract the SSE parser into a testable unit | M | Low | **Done notes:** thin barrel at `lib/api.ts`; domains under `lib/api/*`; coach stream parsing in `coach-sse.ts` (`createCoachSseParseState` / `pushCoachSseChunk` / `applyCoachSseData`) with 8 characterization tests (chunk-split, skip `message.complete`/`v2.response.created`, `[DONE]`, keepalives). Dev-account selectors live in `http.ts` (auth headers; avoids http↔dev cycle). Call-site import paths unchanged. Verify: cadence-web `tsc` + vitest (coach-sse + existing). |
| **WEB-03** | Split `OccurrenceSheet.tsx` (487 lines, 5 unrelated domains behind one occurrence id) into `useOccurrenceDetail` + `SessionLogPanel`/`MealLogPanel`+`useMealLog`/`BaselineReadPanel`/`WeighInPanel` | L | Medium | Touches meal-photo-capture and weigh-in — unrecoverable-if-broken user input; extract pure formatters + add tests first, manual QA pass per extracted panel |
| **WEB-04** | De-duplicate `TodayDashboard`'s `DashCard`/`RhythmRow` against `ProgressView`'s near-identical `Card` and `PlanView`'s near-identical `Item` into shared `ProgressCards.tsx`/`OccurrenceRow.tsx`/`useGoalEventAdd.ts` | M | Low-Medium | Snapshot both implementations' current output *before* merging — they may have already silently drifted |

#### Shared packages & seam (report 05)

| ID | Item | Effort | Risk | Notes |
|---|---|---|---|---|
| **PKG-01** ✅ **Done** (`refactor/pkg-01-core-exports`, PR #17) (= INFRA-06) | Remove unused, high-privilege `getServiceSupabase` export from `packages/core`; reorganize remaining exports into hot-path vs. cold-path/provisioning groups | S | Low | **Done notes:** dropped `getServiceSupabase` re-export (zero `@ai-admin/core` consumers); remaining surface grouped hot-path vs provisioning/cold-path with header comments; `docs/cadence/PLAN.md` §2 documents the contract. Verify: core `tsc --noEmit` clean; 4/4 vitest. |
| **PKG-02** ✅ **Done** (`refactor/pkg-02-cadence-shared-split`, PR #19) (= INFRA-07) | Split `packages/cadence-shared/src/index.ts` (565 lines, 11 concern groups already delimited by banner comments) into `src/types/{baseline,goals,equipment,plan,occurrence,progress,nutrition,episode,conversation,broker-contracts,tripwires}.ts` + barrel | M | Low | Report 05 §4.4 gives the exact line-range-to-file mapping already derived from the file's own existing structure — this is close to a mechanical move. **Done notes:** verbatim move into 11 `src/types/*.ts` modules with one-way cross-imports (`goals`/`progress` → `baseline`; `episode` → `equipment`/`plan`; `broker-contracts` → domain types); thin barrel at `src/index.ts` preserves the package top-level doc comment and public `@cadence/shared` surface. No consumer import-path changes; no deep-path imports found. Verify: cadence-shared `tsc` + 3/3 vitest + lint clean; `apps/cadence-api` and `apps/cadence-web` `tsc --noEmit` clean. |

---

### 4.3 Cross-cutting items (span multiple areas — assign to one owner, coordinate with affected area owners)

#### CROSS-01 — `Broker` → `Scribe` rename [P1] — ✅ **Done** (PR #30)

**Was:** BRAND.md's `Broker`→`Scribe` rename had not propagated to exported DevTrace field names
(`brokerSelect`/`brokerSummarize`) or the shared contracts module title.

**Done notes:** coordinated rename across `packages/cadence-shared` (`broker-contracts.ts` →
`scribe-contracts.ts`), `apps/cadence-api` (`dev-trace.ts` + producers), `apps/cadence-web`
(`lib/api.ts` + `DevPanel.tsx`). DevTrace fields are now `scribeSelect`/`scribeSummarize`.
Intentionally left unchanged: persisted pack mode strings (`broker-curated`/`broker-partial`) and
live profile slug `cadence-broker` (audit trail / live IDs). WEB-02 mechanical `lib/api.ts` split
landed separately (PR #41).

#### CROSS-02 — Consolidate SSE parsing/line-buffering [P1]

**Current problem:** the same class of bug (TCP-chunk-split lines) has been independently fixed at
least 5 separate times across `backend/src/routes/chat-sessions.ts` (4×) and
`backend/src/services/v2-stream-events.ts` (1×), and a 6th independent implementation exists in
`apps/cadence-api/src/routes/coach.ts`, which also duplicates logic that already exists,
unused, in `packages/client/src/index.ts`'s `parseSseText`. Every copy is a place the fix can be
forgotten the next time the upstream format changes.

**Migration steps:** (1) ✅ **BE-02 done** (PR #18) — shared reader for the backend's occurrences
(`chat-sessions.ts` ×4 + Devs.ai v2 `sse-transform`/`client`); (2) ✅ **API-03** — incremental
SSE line buffer in `packages/core` (`createSseLineBuffer` / `pushSseChunk`, same contract as BE-02)
and `apps/cadence-api/src/services/coach-stream.ts` consumes it (route no longer hand-rolls); (3) ✅
chunk-split unit tests in both places (backend `sse-line-buffer` 9/9; core `sse-line-reader` 9/9;
plus coach-stream characterization 8/8).

**Status:** ✅ **Done** — backend half (**BE-02**) + cadence half (**API-03** / shared buffer in
`@ai-admin/core`). Backend still keeps a local twin module (identical contract) rather than
importing `@ai-admin/core`; optional follow-up to re-export from core if a single source file is
desired.

**Priority/Effort/Risk:** P1 / M / Low (streaming behavior is easy to regression-test with recorded
fixtures — the risk is in *not* doing this, not in doing it).

#### CROSS-03 — Adopt a data-fetching cache layer (TanStack Query) [P1, opportunistic]

**Current problem:** both React clients (`frontend/` and `apps/cadence-web/`) hand-roll
`useState`+`useEffect`+manual error-notification for every data fetch, with real, measurable
duplication (`apps/cadence-web`'s nutrition-day fetch is independently triplicated;
`frontend/`'s error-notification boilerplate repeats ~40+ times).

**Recommendation:** don't do this as a repo-wide migration. Pilot it on **one** surface per product
as part of an already-planned refactor — `frontend/`'s pilot should be FE-01 (`ProcessingJobManager.tsx`'s split naturally wants new hooks; make them `useQuery`/`useMutation`-based from the start rather than retrofitting later), and `apps/cadence-web`'s pilot should be WEB-04 (the `TodayDashboard`/`ProgressView` de-duplication, since collapsing the triplicated nutrition-day fetch is exactly what a shared query key buys). Expand from there once the pattern proves out, rather than committing to a big-bang migration up front.

**Priority/Effort/Risk:** P1 (as a decision to make now) / L (as a full migration, not being
recommended) / Low if piloted narrowly as above.

---

### 4.4 Phase 3 — P2 items (condensed; full detail lives in the area reports)

| ID | Area | Items | Pointer |
|---|---|---|---|
| BE-P2 | Backend | `types.ts` split (505 lines, 45 types — mechanical, do early since it touches nearly everything); `models/health-checks.ts`+`routes/health-checks.ts` split by table; opportunistic splits for `ai-profiles.ts`/`providers.ts`/`processing-jobs.ts`/`workflows.ts` routes | Report 01 §4 (P2 sections) |
| FE-P2 | Frontend | 16 files in the 250-624 line range (`LovableGuidePage.tsx`, `DiagnosticsTab.tsx`, `InvestigationPanel.tsx`, `WorkflowExecutionLog.tsx`, `WorkflowEditorPage.tsx`, `FailoverConfigModal.tsx`, `WorkflowTestSimulator.tsx`, `StepVariableMapper.tsx`, `ManageLlmsModal.tsx`, `HealthCheckConfigPage.tsx`, `WorkflowDetailPage.tsx`, `HealthCheckProvidersPage.tsx`, `WorkflowVariablePanel.tsx`, `WorkflowManager.tsx`) + the `STATUS_COLORS`/`formatTimestamp` triplication consolidation | Report 02 §4 (4.11-4.23), §6 |
| API-P2 | Cadence API | Delete dead `services/dossier.ts`; wire up or remove `services/completion.ts`/`services/token-budget.ts`; unit-test `services/metrics.ts`'s `rollingConsistency` (brand-critical, reused 4×); fix `repos/occurrences.ts`'s `as never` casts with a narrower return type; test `services/retrieval/registry.ts`'s render functions; adopt Zod at route-validation + LLM-JSON-parsing boundaries; test `services/capture.ts`/`services/situation.ts` | Report 03 §3 (P2 sections) |
| WEB-P2 | Cadence web | `PlanView.tsx`/`ProgressView.tsx` (paired with WEB-04); `SettingsSheet.tsx` (extract `NutritionTargets`, test the "start over" phrase-gate); `OnboardingChat.tsx` (extract `useCoachChat` hook for the SSE-drop-recovery logic); `AuthScreen.tsx`/`App.tsx` (add tests); `styles.css` (plan a CSS Modules migration before ~800-1000 lines); wire up the dead `lib/capability/` seam + move `MicButton.tsx`'s direct `SpeechRecognition` call behind it | Report 04 §3 (P2 section) |
| INFRA-P2 | Infra | Vercel deploy-target clarity for Cadence; config-as-code drift detection for `ai-admin.config.json` (dry-run mode + scheduled drift-check job); migration tooling consolidation (adopt Supabase CLI for both products, reconstruct missing `001`-`005`) | Report 06 §4.6-§4.8 |
| PKG-P2 | Shared packages | Typed error boundary for `ai/aim.ts` (currently every route does its own `catch(err: unknown)`) | Report 05 §4.5 |

### 4.5 Phase 4 — P3 / opportunistic (condensed)

Fold these into whichever PR happens to touch the same file, rather than scheduling them as
standalone work: residual `any`/`as unknown as` cleanup, `isPublicPath` prefix-match → allowlist
swap (SD6), path-param UUID validation, dead-code passes, `.claude/launch.json`/`.husky/_`
`.gitignore` hygiene, the `docs/CODE_REVIEW_AND_TEST_PLAN.md` vs. root `CODE_REVIEW_AND_TEST_PLAN.md`
naming-collision rename, and repositioning `packages/client`/`edge`/`types` with a one-line README
clarifying they're external-integrator reference code, not dead scaffolding (see report 05 §4.7 —
**do not delete these three packages**, they're correctly functioning, just misleadingly framed).

### 4.6 Newly discovered — surfaced by running CI for real (INFRA-02/03 dry-run)

None of these were fixed by the INFRA-02/03 implementer, per the plan's scope-creep guardrail
(§6.4) — each was confirmed pre-existing on unmodified `feat/cadence` via `git stash` before being
logged here as its own backlog item.

| ID | Item | Area | Priority | Effort | Risk | Status |
|---|---|---|---|---|---|---|
| **CI-01** | 4 backend e2e tests fail (revised diagnosis, see PR #6): 2 in `devs-ai-v2-lifecycle` had stale assertions (fixed), a real `calling_applications` upsert `PGRST` coercion bug (fixed) and a real `ai-profiles` bug where `config` was silently dropped on create/update, breaking jobs-as-tools entirely (fixed, verified 3/3 live), and `e2e-live-provider-chat`'s devs-ai (v1) case has a genuinely expired upstream key (quarantined via `it.skipIf(DEVS_AI_V1_KEY_KNOWN_EXPIRED)`, needs a human to rotate the key and flip the flag). **Follow-up (PR #21):** whole live-provider suite is skipped in CI unless `RUN_LIVE_PROVIDER_E2E=1` (flaky Devs.ai v2 500s); local runs unchanged. | Backend | P1 | S per test | Low | **Done** (PR #6 + #21) — **human still needed:** rotate Devs.ai v1 key and set `DEVS_AI_V1_KEY_KNOWN_EXPIRED = false` |
| **CI-02** | Frontend `npm run lint` fails immediately — `eslint-plugin-react-hooks` requires `zod-validation-error/v4`, unresolvable in the current dependency tree | Frontend | P1 | S | Low | **Done** (PR #5 — bumped to `^7.1.1`) |
| **CI-03** | Frontend `npm test`: 7 failures in `services/api.test.ts` — its `vi.mock('../lib/auth-session')` mock is missing `handleAccountGateApiError`, which the real module now exports (mock drifted from implementation) | Frontend | P1 | S | Low | **Done** (PR #6, merged to `feat/cadence`) — same drift also found independently in `App.test.tsx`'s separate mock of the same module, fixed there too |
| **CI-09** | `Devs.ai v2 resume error (400): Unrecognized key "tool_outputs"` surfaced during `e2e-devs-ai-v2-tools` debugging (PR #6) in the tool-fulfillment continuation call — doesn't currently fail the test (the flow recovers), but the resume request body shape for that endpoint looks wrong and deserves its own investigation | Backend | P2 | S-M | Low-Medium (live provider integration) | Not Started |
| **CI-04** | `npm run format:check` already flagged 186 files before INFRA-03 (no `.prettierrc` ever pinned, per report 06); INFRA-03's widened glob surfaces ~90 more from Cadence on top. Superseded by/fold into **INFRA-04** (align + pin Prettier config, then run `prettier --write` once repo-wide) — do not fix piecemeal | Cross-cutting | P1 | M (one-time repo-wide reformat) | Low (formatting-only) | **Done** (PR #5 — pinned `singleQuote`+`printWidth:120`, 84-file reformat, verified cosmetic-only) |
| **CI-06** | ESLint flat config resolves the *nearest* `eslint.config.js` to the linted file even when invoked from repo root — undocumented, load-bearing behavior for `lint-staged`; a future ESLint major bump could silently break it with no test coverage | Infra | P3 | S | Low | Not Started |
| **CI-07** | `@typescript-eslint/no-non-null-assertion` disabled repo-wide for `apps/cadence-api`/`apps/cadence-web` (both use `!` deliberately/extensively) and `react/no-unescaped-entities` disabled for `apps/cadence-web` (clashes with the brand's mandated contractions) — both are lint-suppressed rather than fixed; worth their own tickets if the team wants stricter enforcement later | Cadence | P3 | M (would require real fixes, not just re-enabling) | Low | Not Started |
| **CI-08** | Windows-only: `core.autocrlf=true` locally can reintroduce CRLF on `git checkout --`, which Prettier's `endOfLine: lf` default then flags as a formatting diff — not a repo bug, but a `.gitattributes` (`* text=auto eol=lf`) would make this deterministic across contributors' OSes | Infra | P3 | S | Low | Not Started |
| **CI-05** | Frontend `build` fails in some local sandboxes because `backend/.env` has `VITE_DEV_API_KEY` set — this is an intentional security guard (a real key must never leak into a `VITE_*` var, see `CLAUDE.md`), not a code bug. Confirmed identical on unmodified `feat/cadence`; won't reproduce in actual CI since that var is a local-dev-only convenience never set in the CI environment. **No fix needed** — logged only so a future agent doesn't rediscover and "fix" it into a weaker guard | Infra/local-dev | P3 | — | — | Won't Fix (by design) |

*Full detail: subagent report for INFRA-02/03 (2026-07-18).*

### 4.7 Newly discovered / deferred — FE-02 supervisor review (PR #7)

Logged from the FE-02 implementer (intentionally out of scope for the structural split) so they
are not lost. Neither blocks FE-02 Done.

| ID | Item | Area | Priority | Effort | Risk | Status |
|---|---|---|---|---|---|---|
| **FE-11** | Extract `useTestChatStream` from `ai-profiles/TestChatPanel.tsx` (~675 lines) — isolate SSE parsing / OAuth-resume logic from rendering; leave the panel as a thin view | Frontend | P2 | M | Medium (streaming/OAuth paths) | Not Started |
| **FE-12** | Research architectural overlap between AI Admin `TestChatPanel` streaming/session UI and Cadence web coach chat (SSE + session lifecycle) — decide whether a shared client helper is worth extracting later (research only; not a merge of the two UIs) | Frontend / Cadence | P3 | S (research) | Low | Not Started |

### 4.8 Newly discovered / deferred — FE-01 supervisor review (PR #8)

Logged so max-lines backlog overrides have tickets. **Not** re-listing pages already covered by
FE-03…FE-08 / FE-P2 (`AiMatcherPage`, `SettingsPage`, `HealthCheck*`, `LovableGuidePage`,
`DiagnosticsTab`, etc.), and **not** duplicating FE-11/FE-12 (`TestChatPanel`).

| ID | Item | Area | Priority | Effort | Risk | Status |
|---|---|---|---|---|---|---|
| **FE-13** | Further split oversized `processing-jobs/` extracts still over `max-lines@500`: `JobsTab` (~908), `AnalyticsTab` (~987), `SchemaValidationPanel` (~632), `RuleSetsTab` (~579) — keep the FE-01 overrides until each drops under the threshold | Frontend | P2 | L | Medium | Not Started |
| **FE-14** | Split `ai-profiles/ProfileFormModal.tsx` (~530 lines) further (form subpanels / sections) so it can leave the max-lines override list — leftover from FE-02 structural split, surfaced when FE-01's rule landed on current `feat/cadence` | Frontend | P2 | M | Low | Not Started |

### 4.9 Newly discovered / deferred — BE-03 supervisor review (`refactor/be-03-rbac`)

Two GET-side scope calls the plan itself flagged as product decisions (risk register: "RBAC fix accidentally
over-gates a route that should stay member-readable"). BE-03 deliberately did NOT gate these; they need
sign-off before any change. Neither blocks BE-03 Done (which gated only mutating routes).

| ID | Item | Area | Priority | Effort | Risk | Status |
|---|---|---|---|---|---|---|
| **BE-03a** | Product decision: should `diagnostic-logs.ts` GET routes be gated to owner/admin? They may contain sensitive prompt/response content (report 01 marks "needs gate? Y"), but they are reads — gating them is a UX/policy call, not pure engineering. If yes: add `router.use(requireRole('owner','admin'))` (all its routes are reads of the same sensitivity) + a negative test. | Backend | P2 | S | Low (once decided) | Not Started — needs product sign-off |
| **BE-03b** | Confirm `user-credentials.ts` should stay **un-gated** (a member managing their OWN provider keys is legitimate; it is already `user_id`-scoped and report 01 marks "needs gate? N"). Logged only so a future audit doesn't re-flag it as a gap and "fix" it into a broken member flow. | Backend | P3 | — | — | Won't Fix (by design) unless product says otherwise |

---

## 5. Overarching Goals (not tied to any single file — these make the per-file work durable)

These came out of every report's "systemic recommendations" section. Treat them as standing
workstreams that run alongside the phased backlog above, not one-time tickets:

1. **Prevent regrowth, don't just fix size once.** ✅ **DONE (INFRA-08, PR #23).** FE-01's
   frontend-organisms-only `max-lines` rule is now generalized repo-wide: `max-lines` 500 (all
   source, all 6 workspaces) + `max-lines-per-function` 150 (`.ts` logic; `.tsx` render bodies are
   file-capped only, since JSX runs long). Thresholds centralized in `eslint.config.sizes.mjs`;
   enforced at `error` via existing CI (`--max-warnings 0`) + pre-commit. Current offenders (backend
   4, frontend 10, cadence-web 2; cadence-api + both packages are exception-free) are allowlisted
   per-workspace = the shrinking backlog, each split PR deletes one. Convention note added to
   `CLAUDE.md` ("new route/tab/section = its own file day one; never add to the allowlist to pass
   CI"). Cyclomatic `complexity` deliberately deferred (too noisy on this legacy code — its own
   future ticket). This was the single most important process fix — `ProcessingJobManager.tsx`
   already proved a file-level fix without a structural guardrail doesn't hold (it regrew +1,420).
2. **Version-control the database schema.** No AI Admin `.sql` migration tooling exists (AR5), and
   `001`-`005` are missing entirely despite being referenced in `README.md`. This isn't just
   tooling hygiene — it means *this plan itself* can't independently verify tenant-isolation/RLS
   correctness from source, which caps how much confidence any RBAC finding here can carry.
   Tracked as INFRA-P2's migration-tooling item, but flagged here because it's a trust
   precondition for BE-03 (the RBAC fix), not just a nice-to-have.
3. **Adopt structured logging.** BE-01 already landed without it; still valuable for correlating
   chat/job flows across the split modules (`sessionId`/`jobId`). Opportunistic, not a Phase 2
   blocker.
4. **Finish, don't restart, the Zod/pagination rollout.** AR1/AR3 are both "mostly done" on the
   backend — remaining gaps are path-param validation and a handful of `.limit(1000)`-capped model
   functions. Cadence API's gap is different (route validation was never started) — treat these as
   two separate, smaller efforts, not one shared ticket.
5. **Backfill tests in inverse proportion to blast radius, not file size.** API-01 / API-04 /
   API-05 / FE-09 and the Phase 1 P0 test-first steps largely landed. Remaining highest-leverage
   gaps: Cadence web (WEB-01…04) and FE-10's contract test.
6. **Cadence API DB test harness** — ✅ stood up with API-01 (`resetUserData` fixtures). Reuse it
   for API-06 rather than inventing a second harness.
7. **Add a lightweight type-contract check** (a small script diffing declared field names between
   paired backend/frontend types, or a fixture-response test) so FE-10's fix can't silently
   regress the way SD2/SD3 already did once.
8. **Keep `docs/cadence/PLAN.md` honest.** It currently states the workspace fix (INFRA-01) is
   already done (`:66`) while separately carrying a risk note (`:381-383`) that it isn't — update
   this doc as part of INFRA-01's PR, and treat "the plan doc says X is done" as something to
   verify against the actual repo state before trusting it in future audits.

---

## 6. Multi-Agent Execution & Supervision Model

The user requirement driving this section: **the refactor itself will be carried out by multiple
implementer agents, overseen by supervisor agents that check their work**, not by one agent working
straight down this backlog. This section defines the roles, workflow, concurrency rules, and
guardrails for that.

### 6.1 Roles

| Role | Responsibility |
|---|---|
| **Orchestrator** | Owns this document as living state. Assigns backlog items to implementer agents, respecting the phase/dependency ordering in §4. Resolves cross-item conflicts (e.g., two items wanting to touch the same file). Decides when a phase is "done enough" to open the next phase's parallelism. Escalation point when a supervisor and implementer disagree. |
| **Implementer agent** | Owns exactly one backlog item (or, for P2/P3 bundles, one *cluster* of related items in the same file/module — never split a single file's changes across two implementers concurrently). Works on its own branch. Follows the item's test-first requirement literally — writes/confirms the test before changing production code. Self-verifies (typecheck + lint + full existing test suite + new tests) before opening a PR. Keeps "pure refactor" commits separate from any incidental fix commits discovered along the way (see §6.4). |
| **Supervisor agent** | Independent from the implementer that wrote the PR (never self-review). Reviews against: (a) the specific item's target design in this document/the area report, (b) the "no behavior change" contract for pure refactors (§6.4), (c) this repo's existing `pre-push-review`/`pr-tl-review` skill checklists, (d) CI is green (or failures explicitly quarantined — report-only does **not** excuse red). Rejects or requests changes if the test-first requirement wasn't honored, scope crept beyond the item's stated boundary, the migration skipped a stated step, or CI is still failing without a documented quarantine. Updates the item's Status in this document. |

A single agent (human or AI) may hold more than one role over time, but never the implementer *and*
supervisor role on the *same* PR.

### 6.2 Per-item workflow

Aligned with
[`.cursor/skills/development-workflow/SKILL.md`](.cursor/skills/development-workflow/SKILL.md)
(Code → Review → Fix? → Test → Fix? → Commit/CI → Fix until green → PR → Review → Fix? → Merge →
confirm base green → Done). Prod/release verification is a later gate, not required on every batch.

```
1. Orchestrator assigns item X (status → "Assigned", branch name recorded)
2. Implementer reads: this doc's entry for X + the full write-up in the linked area report
3. Implementer writes/confirms the test-first requirement against CURRENT behavior (status → "In Progress")
4. Implementer executes the stated migration steps, one commit per step where the item lists steps
5. Implementer self-verifies locally: typecheck, lint, full existing test suite, new tests — all green
6. Implementer commits/pushes and opens a PR scoped to exactly this item (status → "In Review"); CI runs
7. Implementer (and supervisor gate) fix until CI is green — or remaining failures are explicitly
   quarantined with a human action item. Never leave jobs red and move on.
8. Supervisor reviews against §6.1; CI must still be green (report-only ≠ ignore red)
   8a. If changes requested → status → "Changes Requested", back to step 4; re-enter CI gate
   8b. If approved and checks pass → merge
9. Status → "Done". Orchestrator confirms integration branch (`feat/cadence` during this refactor)
   CI is green (or quarantined) before starting the next parallel batch / assigning overlapping work.
10. Orchestrator re-checks whether merging X unblocks any item that listed X as a dependency.
11. A follow-up smoke pass (manual or scripted, per the item's risk rating) happens for any item
    rated Medium/High risk → status → "Verified" (prod/release verification remains a later gate).
```

### 6.3 Concurrency & sequencing rules

- **One item = one branch = one PR.** Never let two implementer agents hold open branches that
  touch the same file concurrently — the orchestrator checks this document's Status column before
  assigning a new item that overlaps a file already "In Progress"/"In Review" elsewhere.
- **CI gate between parallel batches.** Do **not** start the next parallel batch until CI on the
  integration branch (`feat/cadence` during this refactor) is green, or remaining failures are
  explicitly quarantined with a human action item (e.g. key rotation). Report-only CI still means
  jobs must pass or be intentionally skipped — "report-only" does **not** mean ignore red and keep
  merging.
- **Respect the phase gates in §4**, but *within* a phase, maximize parallelism — Phase 1's three
  P0 items (BE-01, FE-01, FE-02) are entirely independent files/products and should run as three
  concurrent implementer agents, not sequentially — **subject to the CI gate above** between
  batches of concurrent work.
- **Respect intra-item step ordering.** Multi-step items (BE-01's 5 steps, FE-01's 7 steps) are
  written as an ordered sequence for a reason (lowest-coupling extractions first, so each step
  de-risks the next) — a single implementer agent should carry one multi-step item through to
  completion rather than handing off mid-sequence, unless the orchestrator explicitly re-splits it.
- **Cross-cutting items (§4.3) need one owner, not a race.** CROSS-01 (Broker→Scribe) touches three
  packages — assign it to a single implementer capable of a coordinated cross-package PR (or a
  tightly sequenced 3-PR chain merged same-day), not three independent agents each renaming their
  own corner and hoping the others land in order.
- **Phase 0's INFRA-01/INFRA-02 block real verification of everything downstream.** No Phase 1/2/3
  item should be considered "Verified" (only "Done") until INFRA-02's CI is at least in report-only
  mode and actually running against that item's changed files — and those runs must be green or
  quarantined before the next batch starts.

### 6.4 Guardrails

- **"No behavior change" contract for pure refactors.** Every split/extraction item in this backlog
  is a *pure* refactor by design (move code, don't change what it does) — supervisors should treat
  any behavior change discovered in review as a signal to split the PR: land the pure move first,
  then a clearly-labeled follow-up PR for the actual fix (e.g., BE-01's O(n²) fix ships in the same
  PR as its extraction *because the item explicitly says so* — that's a stated exception, not the
  default). When an implementer discovers a bug while refactoring (e.g., API-01's missing
  transaction), the item's own write-up already calls this out as an intentional, scoped exception
  — don't generalize from it.
- **Test-first is enforced by the supervisor, not the honor system.** A PR with no new/confirmed
  test on a "test-first: blocking" item should be rejected outright, regardless of how clean the
  refactor looks.
- **Small, reviewable PRs.** This repo already has `make-pr-easy-to-review`/`review-and-ship`
  conventions — use them. No single PR should implement more than one backlog item.
- **CI green (or quarantined) before merge and before the next batch.** Same rule as §6.3 —
  supervisors must not approve-and-merge past red checks; orchestrators must not launch the next
  parallel batch while integration-branch CI is red without an explicit quarantine + human owner.
- **Rollback = revert one PR.** Because every item lands as its own small, behind-tests PR, rollback
  is always "revert this one commit/PR," never "unwind half a giant refactor branch." This is *why*
  the phased, small-PR structure was chosen over one big refactor branch.

### 6.5 Living status tracking

Every item ID in §4 should carry one of these statuses, updated by whichever role last touched it:

`Not Started` → `Assigned` → `In Progress` → `In Review` → `Changes Requested` (loops back to `In Progress`) → `Done` → `Verified`

Update Status cells in place as items move; this file is the single source of truth. Phase 0–1 and
most Phase 2 P1s are Done — see §4.2 "Remaining Phase 2 P1" for what is actually still open.

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Turning on CI for the first time (INFRA-02) surfaces a large backlog of pre-existing failures in `apps/cadence-api`/`apps/cadence-web`, which have never been collectively checked | High | Medium (delays, not breakage) | Report-only rollout before required status; budget explicit time for the "fix everything CI newly reveals" tail |
| BE-01's split of `ai-manager/index.ts` silently changes behavior in a long-running chat/job flow (the highest-blast-radius item in the plan) | Medium | High (both AI Admin and Cadence depend on this file's shape) | Hard test-first gate before any extraction; phase into 5 steps, each independently revertible; land structured logging (§5 item 3) before, not after |
| Cross-package rename (CROSS-01) lands partially — one package renamed, others not, in an inconsistent intermediate state | ~~Medium~~ Mitigated | Low | ✅ Landed as single PR #30; residual risk is only if someone reintroduces `brokerSelect`/`brokerSummarize` field names |
| RBAC fix (BE-03) accidentally over-gates a route that should stay member-readable (e.g., a GET list endpoint) | Low | Medium (breaks a legitimate user flow) | Per-route negative tests (member gets 403 on gated routes) *and* explicit product sign-off on which GETs, if any, should also be gated (e.g. `diagnostic-logs.ts` may contain sensitive content) |
| Production credentials needed for config-drift detection (INFRA-P2) get exposed to a PR-triggered workflow instead of a scheduled one | Low (if followed as designed) | High (prod credential leak) | Explicitly scope drift-detection secrets to a *scheduled* job only, never a PR-triggered one, per report 06 §4.7 |
| Two Supabase projects (AI Admin's own + Cadence's reused "Spartan Tracker") means a naive single CI job could require secrets it shouldn't have access to | Medium | Medium | INFRA-02's path-filtered, two-job design scopes secrets per job/product explicitly |
| An implementer agent "fixes" something outside its assigned item's stated scope (scope creep) | Medium | Low-Medium (review overhead, merge conflicts with other in-flight items) | Supervisor rejects out-of-scope changes; orchestrator logs a *new* backlog item instead of allowing silent scope expansion |

---

## 8. Success Criteria / Definition of Done

This plan is "done" (or rather, has earned the right to be considered a completed refactoring pass
— new debt will always accrue) when:

- [x] `npm ls --workspaces` from repo root lists all 9 real workspaces with zero `extraneous`/`invalid`. (INFRA-01)
- [ ] `.github/workflows/ci.yml` exists, is a required status check, and its `cadence` job has run
      green against real Cadence changes (not just report-only). *(workflow exists + runs; required-check flip still open)*
- [x] Zero files remain in the P0 list (§4.1); FE-01 organism/page `max-lines` is active.
      *(Repo-wide generalization = INFRA-08, PR #23.)*
- [x] `requireRole` is wired into every mutating admin-sensitive backend route (BE-03's full list).
- [ ] `apps/cadence-web` and `apps/cadence-api` each have real (not placeholder) test coverage on
      their top-5 highest-risk paths per reports 03/04's "first N tests" lists. *(API side largely yes; web still no.)*
- [ ] SD2/SD3 (frontend/backend type drift) no longer reproduces — verified by the contract-test
      added under FE-10, not just by manual inspection.
- [x] `Broker`→`Scribe` rename (CROSS-01) complete for exported DevTrace fields + contracts module
      (PR #30). Persisted `broker-*` mode strings / `cadence-broker` slug intentionally retained.
- [ ] This document's status tracking (§6.5) shows every P0/P1 item as `Verified`.

---

## 9. What Was Deliberately Left Out of Scope

- **Rewriting or replacing any product.** Every report independently concluded this is a tractable
  refactor, not a rewrite candidate — no recommendation in this plan proposes replacing an
  architecture, only reorganizing/testing/gating the existing one.
- **A full TanStack Query migration.** Recommended as a narrow pilot (CROSS-03), not a repo-wide
  effort — revisit scope after the pilot.
- **A full CSS Modules/Tailwind migration for `apps/cadence-web`'s stylesheet.** Flagged (WEB-P2)
  as a "before it crosses ~800-1000 lines" watch item, not current work.
- **Deleting `packages/client`/`packages/edge`/`packages/types`.** These are correctly-functioning
  external-integrator reference code, not dead scaffolding — see report 05's explicit
  recommendation against removal (§4.5's Phase 4 pointer).
- **API versioning (`/api/v1/`) and OpenAPI spec generation (AR10/AR11).** Still valid findings,
  but no report treated them as urgent relative to the items actually in this backlog — revisit in
  a future pass once Phase 0-2 land.
