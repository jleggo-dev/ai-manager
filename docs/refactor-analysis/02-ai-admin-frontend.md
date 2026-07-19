# AI Admin Frontend — Refactoring Readiness Audit

**Scope:** `frontend/src/**` (components/atoms, molecules, organisms, pages, layouts, services, lib, types) and `frontend/src/**/*.test.tsx` (coverage context only).
**Method:** Full line-count inventory of all 95 `.ts`/`.tsx` files under `frontend/src`, targeted reads/greps of every size hotspot named in the brief plus every file discovered to be >250 lines, cross-referencing against `CODE_REVIEW_AND_TEST_PLAN.md` (DM/AR/SD series) and `git log` on the hotspot files.
**Not in scope:** `backend/`, `apps/cadence-*`, `packages/*` (referenced only for cross-boundary duplication in §5).

---

## 1. Executive Summary

**Overall health: Yellow.** The frontend is functionally organized (atoms/molecules/organisms/pages/layouts is a real, followed convention) and `any` usage has actually been almost fully eliminated since the last review (see §3 — SD9 is effectively fixed on the frontend side). But the codebase has one severe monolith (`ProcessingJobManager.tsx`, 5,497 lines), a second large one (`AiProfileManager.tsx`, 2,466 lines), near-zero test coverage on exactly the highest-risk files, a still-live memory-leak bug in the auth listener, and confirmed type drift between frontend and backend response shapes. TanStack Query is still absent everywhere, so every page hand-rolls loading/error/cache state.

### Top systemic issues

1. **`ProcessingJobManager.tsx` re-grew after extraction because the fix was file-level, not structural.** DM3 records the prior fix as "extracted `DiagnosticsTab` (~370 lines)" — one component was pulled into its own file. But the file already contains **13 more logically-separate components defined inline** (`JobsTab`, `VariablesReference`, `ResponseSchemaViewer`, `RuleSetSchemaEditor`, `RuleSetsTab`, `TestRuleSetTab`, `BuildRulesTab`, `TestTab`, `SchemaValidationPanel`, `AdvancedTab`, `ScoreBadge`, `AnalyticsTab`, plus two components-defined-inside-components: `StatusIcon` at line 4272 and `SortHeader` at line 5203). Every new tab/feature added since the `DiagnosticsTab` extraction followed the *existing* pattern of "add another `function XTab({...}) {...}` at the bottom of the same file" rather than "add a new file," because there was never a **rule or lint gate** enforcing a max file size or requiring new tabs to live in their own file. This is a process failure, not a one-off mistake: **without a structural guardrail (lint rule, PR checklist, or codegen scaffold), the same regrowth will happen to whatever file replaces it.** See §6 for the concrete lint-rule recommendation.
2. **Zero automated test coverage on the two largest, most business-critical organisms.** `ProcessingJobManager.tsx` (5,497 lines — prompt templates, formatting rules, schema validation, analytics that feed diagnostics decisions) and its sibling `AiMatcherPage.tsx` (1,061 lines) have **no `.test.tsx` file at all**. `AiProfileManager.tsx` has a test file but it's shallow (164 lines vs. 2,466 lines of source — mostly renders + one CRUD path). This means the two files most likely to break silently during any refactor have no safety net (echoes DM2/DM4, but the gap is now concentrated exactly where refactor risk is highest).
3. **Confirmed, live type drift between frontend and backend (SD2/SD3 still valid, not fixed).** `frontend/src/types/api.ts`'s `CallingApplication` interface declares `name`, `slug`, `description`, `is_active` fields that do not exist on the backend's `CallingApplicationRow` (`backend/src/types.ts:294-300`, which only has `id`, `display_name`, `workspace_id`, `created_at`, `updated_at`). Similarly `DiagnosticLog` (frontend) and `DiagnosticLogRow` (backend) diverge on field names (`request_payload`/`supabase_timing`/`formatting_timing`/`error_message` vs. `auth_mode`/`user_id`/`input_text`/`output_text`/`formatted_text`). These aren't cosmetic — they mean TypeScript is giving false confidence on exactly the payloads that cross the network boundary.
4. **Template-interpolation logic is independently reimplemented 3 times** instead of using the existing shared `frontend/src/lib/interpolate.ts` (already consumed by the Workflow* organisms). `AiMatcherPage.tsx:734-740` and `ProcessingJobManager.tsx:2871-2877` (`TestRuleSetTab`) and `ProcessingJobManager.tsx:3991` (`composePromptFromVars` in `TestTab`) each hand-roll `{{var}}` substitution with their own regex/`.split().join()` logic. This is the same category of bug class the backend fixed in C1 (regex injection in `formatting-rules.ts`) — the frontend copies never got the equivalent hardening because they're not the canonical implementation.
5. **No data-fetching cache layer anywhere (AR8, still valid) and no list virtualization anywhere.** Every page/organism hand-rolls `useState` + `useEffect` + manual `notifications.show()` error handling — the same 6-line pattern is repeated dozens of times (see §4 per-file notes and §6). `JobsTab` (inside `ProcessingJobManager.tsx`) renders the full job list with per-row drag-and-drop handlers with no windowing; this is fine today but will degrade as job counts grow, and it's the same shape of problem AR3 already flagged server-side for list endpoints (no pagination cap).

**Positive findings worth preserving:** the `atoms/molecules/organisms/pages/layouts` structure is real and consistently followed; `types/api.ts` + `services/api.ts` typing (C8) is intact and thorough; `ErrorBoundary` (M17) and auth loading state (L12) fixes are still in place; literal `any` is down to 2 explicitly-justified, eslint-commented casts in the whole `frontend/src` tree (see §3).

---

## 2. File Inventory

Only files ≥100 lines or otherwise notable are individually flagged; smaller leaf files (auth forms, atoms, most `lib/*.ts` utilities) are healthy and omitted from priority scoring but listed for completeness at the bottom.

| Path | Lines | Primary role | Flagged? | Priority |
|---|---|---|---|---|
| `components/organisms/ProcessingJobManager.tsx` | 5497 | Processing-job CRUD + prompt/rule-set editor + test harness + schema validation + analytics (14 components in one file) | Y | **P0** |
| `components/organisms/AiProfileManager.tsx` | 2466 | AI-profile CRUD + list/filter/sort/group + streaming test-chat panel + MCP tool auth | Y | **P0** |
| `pages/AiMatcherPage.tsx` | 1061 | Multi-slot side-by-side AI response comparison tool | Y | P1 |
| `pages/SettingsPage.tsx` | 910 | 6-tab settings shell (System, LLM defaults, rate limits, API keys, user credentials, data mgmt) | Y | P1 |
| `pages/HealthCheckWidgetPage.tsx` | 820 | Widget health-check CRUD + run history + status/timeout config | Y | P1 |
| `services/api.ts` | 815 | Flat API client — 100 exported functions across ~15 domains | Y | P1 |
| `pages/HealthDashboardPage.tsx` | 759 | Cross-check-type dashboard (uptime, incidents, heatmap) | Y | P1 |
| `pages/HealthCheckProfilesPage.tsx` | 624 | Health-check profile CRUD + investigation drill-down | Y | P1 |
| `pages/LovableGuidePage.tsx` | 585 | Mostly-static integration/onboarding guide content | Y | P2 |
| `components/organisms/DiagnosticsTab.tsx` | 534 | Job diagnostics config + log viewer (prior extraction target) | Y | P2 |
| `components/InvestigationPanel.tsx` | 502 | Run/incident drill-down panel shared by HC pages | Y | P2 |
| `types/api.ts` | 476 | All frontend response/request type definitions | Y | P1 |
| `components/organisms/WorkflowExecutionLog.tsx` | 476 | Per-step workflow execution timeline viewer | Y | P2 |
| `pages/WorkflowEditorPage.tsx` | 456 | Full-page workflow editor with drag/drop variable mapping | Y | P2 |
| `components/molecules/FailoverConfigModal.tsx` | 444 | AI-profile failover chain config modal | Y | P2 |
| `components/organisms/WorkflowTestSimulator.tsx` | 443 | Dry-run/live-run workflow test harness | Y | P2 |
| `components/molecules/StepVariableMapper.tsx` | 438 | Drag-and-drop input/output variable mapping UI | Y | P2 |
| `components/organisms/ManageLlmsModal.tsx` | 428 | Per-provider LLM model registry modal | Y | P2 |
| `pages/HealthCheckConfigPage.tsx` | 423 | API health-check CRUD + cadence config | Y | P2 |
| `pages/WorkflowDetailPage.tsx` | 411 | Full-page workflow detail + executions tab | Y | P2 |
| `pages/HealthCheckProvidersPage.tsx` | 389 | Provider-key CRUD for health-check subsystem | Y | P2 |
| `components/organisms/WorkflowVariablePanel.tsx` | 373 | Variable-flow pipeline visualization | Y | P2 |
| `components/organisms/WorkflowManager.tsx` | 361 | Workflow list + delete/test modals | Y | P2 |
| `lib/auth-session.ts` | 322 | Session/auth-token/bootstrap state machine (module-singleton) | Y | **P1** (security/stability) |
| `layouts/AppShell.tsx` | 280 | Nav shell, page registry, workspace switcher | Y | P3 |
| `pages/UserManagementPage.tsx` | 275 | Platform user approval management | Y | P3 |
| `App.tsx` | 240 | Root auth bootstrap + router | Y | P3 |
| `services/api.test.ts` | 216 | api.ts tests (context only) | — | — |
| `components/organisms/ProviderManager.tsx` | 186 | Provider CRUD + connectivity test | N | — |
| `pages/HealthDashboardPage.test.tsx` | 184 | test (context only) | — | — |
| `components/molecules/StepVariableMapper.test.tsx` | 178 | test (context only) | — | — |
| `components/organisms/WorkflowExecutionLog.test.tsx` | 178 | test (context only) | — | — |
| `components/molecules/AiProfileCard.tsx` | 174 | Profile summary card (list item) | N | — |
| `components/organisms/WorkflowTestSimulator.test.tsx` | 173 | test (context only) | — | — |
| `components/molecules/WorkflowHelpDrawer.tsx` | 168 | Static contextual help drawer | N | — |
| `components/molecules/WorkflowInputEditor.tsx` | 168 | Workflow metadata/input-variable editor | N | — |
| `components/organisms/WorkflowManager.test.tsx` | 167 | test (context only) | — | — |
| `components/organisms/AiProfileManager.test.tsx` | 164 | test — shallow relative to 2466-line source | — | see §4 |
| `components/molecules/WorkflowStepSidebar.tsx` | 160 | Workflow editor sidebar nav | N | — |
| `pages/TeamPage.tsx` | 159 | Workspace member list + role changes | N | P3 (no test) |
| `pages/HealthCheckWidgetPage.test.tsx` | 150 | test (context only) | — | — |
| `pages/HealthCheckConfigPage.test.tsx` | 138 | test (context only) | — | — |
| `lib/runtime-options.ts` | 136 | Runtime-option normalization utility | N | — |
| `components/organisms/WorkflowVariablePanel.test.tsx` | 135 | test (context only) | — | — |
| `App.test.tsx` | 132 | test (context only) | — | — |
| `components/UptimePieChart.tsx` | 128 | Presentational chart | N | — |
| `components/auth/AuthLanding.tsx` | 126 | Sign-in landing screen | N | — |
| `components/organisms/ProviderManager.test.tsx` | 121 | test (context only) | — | — |
| `components/molecules/ProviderForm.tsx` | 121 | Provider create/edit form | N | — |
| `components/UptimeHeatmap.tsx` | 115 | Presentational heatmap | N | — |
| `lib/interpolate.test.ts` | 111 | test (context only) | — | — |
| `theme.ts` | 111 | Mantine theme config | N | — |
| `pages/HealthCheckProvidersPage.test.tsx` | 106 | test (context only) | — | — |
| `lib/auth-session.test.ts` | 99 | test (context only) | — | — |
| `components/molecules/WorkflowInputEditor.test.tsx` | 93 | test (context only) | — | — |
| `components/molecules/WorkflowStepSidebar.test.tsx` | 93 | test (context only) | — | — |
| `types/api.test.ts` | 91 | test (context only) | — | — |
| `lib/runtime-options.test.ts` | 89 | test (context only) | — | — |
| `components/auth/SignUpForm.tsx` | 88 | Sign-up form | N | — |
| `components/auth/ResetPasswordForm.tsx` | 73 | Password reset form | N | — |
| `components/auth/ForgotPasswordForm.tsx` | 67 | Forgot-password form | N | — |
| `components/ErrorBoundary.test.tsx` | 63 | test (context only) | — | — |
| `components/auth/SignInForm.tsx` | 59 | Sign-in form | N | — |
| `pages/WorkflowsPage.test.tsx` | 53 | test (context only) | — | — |
| `components/auth/PendingApproval.tsx` | 53 | Pending-approval gate screen | N | — |
| `hooks/useConfirm.tsx` | 49 | Confirm-modal hook | N | — |
| `lib/interpolate.ts` | 49 | **Canonical** template interpolation (under-used — see §1.4) | N | — |
| `components/molecules/WorkflowHelpDrawer.test.tsx` | 37 | test (context only) | — | — |
| `components/ErrorBoundary.tsx` | 34 | Error boundary | N | — |
| `components/auth/GoogleGLogo.tsx` | 33 | SVG icon | N | — |
| `lib/supabase.ts` | 32 | Supabase client init | N | — |
| `pages/WorkflowsPage.tsx` | 31 | Workflow list page shell | N | — |
| `components/atoms/PageHeader.test.tsx` | 28 | test (context only) | — | — |
| `main.tsx` | 24 | Entry point | N | — |
| `test/setup.ts` | 24 | Vitest setup | N | — |
| `components/atoms/PageHeader.tsx` | 22 | Page-title atom | N | — |
| `lib/roles.test.ts` | 18 | test (context only) | — | — |
| `pages/ProcessingJobsPage.tsx` | 14 | Thin page wrapper | N | — |
| `pages/AiProfilesPage.tsx` | 14 | Thin page wrapper | N | — |
| `lib/provider-types.test.ts` | 12 | test (context only) | — | — |
| `pages/ProvidersPage.tsx` | 11 | Thin page wrapper | N | — |
| `lib/slugify.ts` | 10 | Slug utility | N | — |
| `constants/healthStatus.ts` | 7 | Shared status→color config (good pattern, under-used — see §4) | N | — |
| `lib/api-url.ts` | 6 | URL-resolution utility | N | — |
| `vite-env.d.ts` | 5 | Vite type decl | N | — |
| `lib/provider-types.ts` | 4 | Provider-type predicate | N | — |
| `lib/roles.ts` | 3 | Role predicate | N | — |

**Totals:** 95 `.ts`/`.tsx` files scanned under `frontend/src`; 27 flagged (2 P0, 8 P1, 16 P2, 3 P3-with-detail); ~40 test files provide coverage that is concentrated on Workflow* and Health* components/pages and almost entirely absent from the two largest organisms and from `AiMatcherPage`/`SettingsPage`.

---

## 3. Cross-Reference to `CODE_REVIEW_AND_TEST_PLAN.md`

| ID | Finding | Status | Note |
|---|---|---|---|
| DM3 | `ProcessingJobManager.tsx` still 4,077 lines after extracting `DiagnosticsTab` | **Still valid — worse.** File is now 5,497 lines (+1,420 since that finding). `DiagnosticsTab` extraction was file-level only; 13 more inline components were added in its place. See §1.1, §4.1. |
| SD2 | Frontend `DiagnosticLog` type doesn't match backend response shape | **Still valid.** Confirmed field-name mismatch between `types/api.ts:190-204` (`request_payload`, `supabase_timing`, `formatting_timing`, `error_message`) and `backend/src/types.ts:311-` (`auth_mode`, `user_id`, `input_text`, `output_text`, `formatted_text`). See §5. |
| SD3 | Frontend `CallingApplication` type has phantom fields | **Still valid.** `types/api.ts:131-140` declares `name`, `slug`, `description`, `is_active` — none exist on `backend/src/types.ts:294-300` `CallingApplicationRow`. See §5. |
| SD5 | `onAuthStateChange` subscription never unsubscribed | **Still valid.** `lib/auth-session.ts:344` registers the listener inside `initAuthSession()` with no stored unsubscribe handle; `App.tsx:148-155` calls `initAuthSession()` from a `useEffect` with no cleanup, so React 18 double-invoke (StrictMode/dev) and any remount/HMR stacks additional listeners. See §4.9. |
| SD9 | ~272 remaining `any` in frontend | **Effectively fixed on frontend.** Only 2 literal `any` occurrences remain in all of `frontend/src`, both in `ProcessingJobManager.tsx:728-763`, explicitly wrapped in `eslint-disable @typescript-eslint/no-explicit-any` with a comment explaining the Mantine `Select` typing workaround. Remaining type-safety smell is `as unknown as` double-casts (5 in `ProcessingJobManager.tsx`, plus scattered singles) — worth a follow-up pass but a materially smaller problem than SD9 described. If the "~272" figure included backend, that count is out of this audit's scope. |
| AR8 | No data-fetching cache in frontend | **Still valid.** No `@tanstack/react-query` or equivalent in `frontend/package.json`; every page/organism hand-rolls `useState`+`useEffect`+manual refetch. See §6. |
| DM8 | Frontend/backend types defined separately — can drift | **Still valid, now with concrete instances** (SD2/SD3 above are DM8 manifesting in practice). No shared-types package or codegen exists. |
| C8 | Defined 18+ API response types; 60+ API functions typed | **Holds.** `types/api.ts` + `services/api.ts` are consistently typed; `api.ts` now exports 100 functions (grew since the fix, still typed). |
| M17 / L12 | `ErrorBoundary` wrapping `<App />`; loading spinner during auth init | **Holds.** Both present and unchanged in `main.tsx`/`App.tsx`. |
| L10 | `PAGES` registry uses `ComponentType<PageComponentProps>` not `any` | **Holds.** Confirmed in `layouts/AppShell.tsx`. |
| AR3 | No pagination — list endpoints return unbounded sets | **Frontend-visible symptom still present.** `JobsTab` (inside `ProcessingJobManager.tsx`) and profile/model lists render full unpaginated arrays client-side with no virtualization; this is the frontend half of the AR3 problem. |

Findings not cross-referenced above (SD1, SD4, SD6-SD8, SD10-SD11, DM1/DM2/DM4-DM7/DM9, AR1-AR2, AR4-AR7, AR9-AR11, C1-C9, H1-H12, M1-M16, L1-L11, R1-R8) are backend/process/infra concerns outside this agent's frontend scope and are left to the backend and dev-manager/architect audit agents.

---

## 4. Detailed Per-File Refactor Plans (P0/P1/P2)

### 4.1 `components/organisms/ProcessingJobManager.tsx` — **P0**

**Current problems**

- **5,497 lines, 14 component definitions in one file** (verified via top-level `function`/`export default function` scan): `ProcessingJobManager` (321-892, 571 lines — top-level CRUD state owner), `JobsTab` (893-1883, 990 lines — list rendering, drag/drop reordering, multi-select bulk operations, picker modal, search/filter/sort), `VariablesReference` (1884-1959), `ResponseSchemaViewer` (1960-2132), `RuleSetSchemaEditor` (2133-2272), `RuleSetsTab` (2273-2828, 555 lines), `TestRuleSetTab` (2829-3122, 293 lines), `BuildRulesTab` (3123-3427), `TestTab` (3929-4259, 330 lines), `SchemaValidationPanel` (4260-4470, 210 lines, contains nested `StatusIcon` defined at line 4272 **inside** the component body), `AdvancedTab` (4478-5046, 568 lines), `ScoreBadge` (5047-5068), `AnalyticsTab` (5069-5497, 428 lines, contains nested `SortHeader` defined at line 5203 **inside** the component body).
- **Components-defined-inside-components** (`StatusIcon` in `SchemaValidationPanel`, `SortHeader` in `AnalyticsTab`) are recreated as new function identities on every parent render — a React anti-pattern that defeats reconciliation and any future `React.memo`/prop-stability work.
- **Single Responsibility violated at the top level**: the default-exported `ProcessingJobManager` (321-892) owns CRUD data-fetching (`loadData`, 350-374), modal open/close state, form state, delete-confirmation state, *and* renders the tab shell — 5+ concerns in one function before even reaching the tab bodies.
- **Duplicated template-interpolation logic**, independently reimplemented instead of using `lib/interpolate.ts`: `TestRuleSetTab.composePrompt` (2871-2877, `.split().join()`-based) and `TestTab.composePromptFromVars` (3991-4008). Both duplicate `RuleSetsTab`'s own inline compose helper (2860-2868, same `.split().join()` pattern). Three near-identical copies of ~8 lines each, in the same file.
- **Type-safety smell**: 5 `as unknown as` double-casts (363, 431, 434, 5091, plus one more) bypassing the type checker rather than fixing the underlying shape mismatch (e.g. `setAvailableRules((rulesData as unknown as FormattingRule[]) || [])` at line 363 — this should be a typed `api.listFormattingRules(): Promise<FormattingRule[]>` return type instead).
- **Repeated error-handling boilerplate**: `notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' })` appears 8 times verbatim in this file alone (and dozens more times across the codebase — see §6).
- **Zero test coverage.** No `ProcessingJobManager.test.tsx` exists. This is the single highest-risk file in the repo to have no tests.
- **No virtualization** in `JobsTab`'s job list rendering — every job row (with drag/drop handlers, checkboxes, action menus) is mounted at once.

**Proposed target design**

Split into a `processing-jobs/` directory (mirroring the existing `organisms/` convention but as a sub-folder, matching how Workflow* components already separate concerns across files):

- `ProcessingJobManager.tsx` (orchestrator only, target <150 lines): owns top-level data fetching via a new `useProcessingJobsData()` hook, tab routing state, and renders `<JobsTab>`/`<BuildRulesTab>`/`<AnalyticsTab>` etc. as imports.
- `hooks/useProcessingJobsData.ts`: extract `loadData`, `jobs`/`jobGroups`/`aiProfiles`/`availableRules`/`callingApps` state + the create/update/delete mutations currently inline in the default export (389-892).
- `processing-jobs/JobsTab.tsx` + `processing-jobs/useJobBulkActions.ts` (extract `toggleChecked`/`bulkChangeProfile`/`bulkMoveToGroup`/`bulkToggleActive`/picker-modal state, 916-1022, into a hook so `JobsTab.tsx` itself drops under ~400 lines).
- `processing-jobs/VariablesReference.tsx`, `processing-jobs/ResponseSchemaViewer.tsx`, `processing-jobs/RuleSetSchemaEditor.tsx` — each a straight file-move, no logic change (lowest risk, do first).
- `processing-jobs/RuleSetsTab.tsx` + `processing-jobs/TestRuleSetTab.tsx` + `processing-jobs/BuildRulesTab.tsx`.
- `processing-jobs/TestTab.tsx` + `processing-jobs/SchemaValidationPanel.tsx` (move `StatusIcon` to a shared `components/atoms/StatusIcon.tsx` — it's a generic enough concept to reuse elsewhere, e.g. `AnalyticsTab`'s own status rendering).
- `processing-jobs/AdvancedTab.tsx`.
- `processing-jobs/AnalyticsTab.tsx` (move `ScoreBadge` to `components/atoms/ScoreBadge.tsx`; move `SortHeader` to a shared `components/atoms/SortableTableHeader.tsx` since `InvestigationPanel.tsx` and other table-heavy pages could reuse it).
- Replace all three inline prompt-composition copies with calls to `interpolateTemplate` from `lib/interpolate.ts` (returns `{ text, usedKeys, missingKeys }` — a strict superset of what the inline versions do, and it's already regex-hardened).
- Introduce one shared `useApiErrorNotification()` hook (or a plain `notifyApiError(err, title?)` util in `lib/notify.ts`) to replace the 8 duplicated `notifications.show({...err instanceof Error...})` blocks in this file (and the ~40+ other occurrences repo-wide — see §6).

**Step-by-step migration plan**

1. **Test-first (blocking prerequisite, not optional):** write component tests for the current file's 5 most business-critical flows *before* moving code — (a) create/edit/delete a job, (b) build-rules prompt composition + variable substitution, (c) test-tab firing a request and rendering `TestResult`, (d) schema validation pass/fail rendering, (e) analytics field-scoring toggle + save. Use the existing `AiProfileManager.test.tsx` and `WorkflowManager.test.tsx` as house-style templates (Vitest + Testing Library + Mantine `MantineProvider` wrapper, `vi.mock('../../services/api')`).
2. Extract pure-JSX, zero-dependency components first (lowest risk): `VariablesReference`, `ResponseSchemaViewer`, `RuleSetSchemaEditor`, `ScoreBadge`, `StatusIcon`, `SortHeader` → move to atoms, update imports, re-run tests from step 1.
3. Extract `useProcessingJobsData` and `useJobBulkActions` hooks; re-run tests.
4. Extract `JobsTab`, `RuleSetsTab`, `BuildRulesTab`, `TestTab`, `TestRuleSetTab`, `SchemaValidationPanel`, `AdvancedTab`, `AnalyticsTab` into their own files one at a time, each as its own commit, re-running tests after each.
5. Replace the 3 duplicated interpolation copies with `lib/interpolate.ts` calls; add a regression test asserting identical output for a template containing a key that collides with another key's substring (the `.split().join()` approach has subtle ordering bugs that regex-based `interpolateTemplate` avoids).
6. Replace `as unknown as` casts with correctly-typed `api.ts` return types.
7. Add the max-file-line lint rule (§6) so this cannot regrow silently.

**Dependencies/blockers:** none technical; this is the highest-value, highest-effort item in the whole audit and should be sequenced after (or in parallel with) establishing the lint-rule guardrail in §6, otherwise the extracted files risk becoming the *next* five 500+-line monoliths without a backstop.

**Priority: P0. Effort: L (phase into the 7 steps above, ~1-2 weeks). Risk: High (business-critical, zero existing tests, large diff surface) — mitigated by the test-first requirement.**

---

### 4.2 `components/organisms/AiProfileManager.tsx` — **P0**

**Current problems**

- **2,466 lines, 2 top-level components**: default-exported `AiProfileManager` (139-1893, **1,754 lines**) and `TestChatPanel` (1894-2466, 572 lines).
- The main component mixes: profile CRUD (load/create/update/delete), list filter/search/sort/group-by state (540-728), card/table view toggle, multi-select + bulk actions (`checkedProfileIds`, 728), MCP tool discovery + auth-status polling (`mcpTools`/`toolAuthStatus`/`mcpLoading`, 173-176), and tool-job configuration rows (`toolJobs`, 179) — at least 5 distinct concerns in one function body before rendering starts.
- `TestChatPanel` (572 lines) independently owns full SSE streaming chat state (`messages`, `input`, `chatSessionId`, `isStreaming`, `pendingAuth` for OAuth tool flows, 1899-1905) — this is effectively its own chat-client organism embedded inside a profile-management organism. It has real architectural overlap with Cadence's own chat/session concepts (see §5) and deserves to be its own top-level file, if not eventually a shared package.
- Same repeated-notification-boilerplate pattern as `ProcessingJobManager.tsx` (7 occurrences).
- One `as unknown as` cast.
- **Test coverage is shallow relative to size**: `AiProfileManager.test.tsx` is 164 lines against 2,466 lines of source (~7% ratio) and, per a scan of its structure, exercises basic list-render + one CRUD path, not the streaming chat panel, MCP tool auth flow, or bulk actions.

**Proposed target design**

- `AiProfileManager.tsx` (orchestrator, target <200 lines) + `hooks/useAiProfilesData.ts` (CRUD state/fetching) + `hooks/useProfileListFilters.ts` (search/filter/sort/group-by, 540-728) + `hooks/useProfileBulkActions.ts` (checked-set + bulk operations).
- `ai-profiles/McpToolsPanel.tsx` for the MCP tool discovery/auth-status/tool-job-config concern (173-179 state + its rendering) — this is functionally independent of profile CRUD and is the clearest extraction candidate.
- `ai-profiles/TestChatPanel.tsx` (move as its own file, unchanged logic initially) with a follow-up ticket to extract `useTestChatStream` (SSE handling, `pendingAuth` OAuth flow) as a hook, since chat-streaming logic is exactly the kind of thing likely to be needed again (Cadence already has its own chat session concept — flagged in §5 for de-duplication research, not a merge decision here).

**Step-by-step migration plan**

1. Test-first: add coverage for `TestChatPanel`'s streaming happy-path + tool-auth-required path, and for bulk actions, before moving anything (these are currently untested branches).
2. Extract `TestChatPanel` to its own file (no logic change) — immediately cuts the file from 2,466 to ~1,900 lines with zero behavior risk.
3. Extract `useAiProfilesData`, `useProfileListFilters`, `useProfileBulkActions` hooks from the remaining main component.
4. Extract `McpToolsPanel`.
5. Re-measure; target both resulting files under 600 lines each.

**Dependencies/blockers:** none. Independent of the `ProcessingJobManager.tsx` work and can proceed in parallel.

**Priority: P0 (>1,500 lines mixing 3+ responsibilities per rubric). Effort: L (~1 week). Risk: Medium — the streaming/tool-auth code paths are intricate; test-first step is mandatory before moving them.**

---

### 4.3 `pages/AiMatcherPage.tsx` — P1

**Current problems**

- 1,061 lines, single default export (688) plus 4 helper components (`AiSlotCard` 177, `ObjectMiniTable` 391, `JsonFieldTable` 465, `ResultCard` 513) all in one file.
- Reimplements template interpolation independently (`composePrompt`, 734-740) instead of using `lib/interpolate.ts` — see §1.4.
- Mixes multi-slot AI configuration (up to 4 ad-hoc or profile-backed "slots"), prompt composition, parallel execution firing, and per-result schema validation rendering in one page component.
- No test file.

**Proposed target design:** extract `AiSlotCard`, `ResultCard`, `ObjectMiniTable`, `JsonFieldTable` to `components/molecules/` (they're already props-driven and file-move-only); extract a `useAiMatcherSlots` hook for slot CRUD + `useAiMatcherExecution` hook for the parallel-fire logic; replace `composePrompt` with `interpolateTemplate`.

**Step-by-step migration plan:** 1) add smoke tests for slot add/remove and single-slot execution rendering (test-first, currently zero coverage on a page that fires real AI provider calls); 2) move the 4 helper components out; 3) extract the two hooks; 4) swap in shared interpolation.

**Dependencies/blockers:** none. **Priority: P1. Effort: M (1-2 days). Risk: Medium (no tests today, so verify manually against a real job before/after).**

---

### 4.4 `pages/SettingsPage.tsx` — P1

**Current problems**

- 910 lines, but **already well-decomposed logically** — 7 top-level functions (`SystemTab` 50, `LlmDefaultsTab` 130, `RateLimitsTab` 247, `BackendUrlCard` 329, `ApiKeysTab` 369, `UserCredentialsTab` 568, `DataManagementTab` 782) plus the default export (920) that just renders a `<Tabs>` shell. This is the *good* version of the `ProcessingJobManager.tsx` pattern — same "multiple components in one file" symptom, but here each tab is small (60-215 lines) and single-purpose, so the risk is materially lower.
- Note the destructuring workaround at line 369: `function ApiKeysTab({ workspaceRole: _workspaceRole }: {...})` — an unused-but-required prop renamed with an underscore to silence lint. Worth checking whether `workspaceRole` should actually gate the API-keys tab's destructive actions (revoke) or whether the prop is genuinely vestigial.
- No test file despite containing the API-key creation/revocation flow (security-relevant UI).

**Proposed target design:** mechanical split only — move each `*Tab`/`BackendUrlCard` function to `settings/SystemTab.tsx`, `settings/LlmDefaultsTab.tsx`, etc.; no logic changes needed. Resolve the `_workspaceRole` question during the move (either wire it into a `requireRole` guard on revoke, consistent with backend AR2, or delete the unused param).

**Step-by-step migration plan:** 1) add a test for the API-key create/copy/revoke flow first (currently untested, security-relevant); 2) mechanical file-per-tab split; 3) resolve `_workspaceRole`.

**Dependencies/blockers:** none. **Priority: P1 (test gap on security-relevant UI elevates this above a pure line-count P2). Effort: S-M. Risk: Low (mechanical split) but Medium on the API-key flow specifically until tested.**

---

### 4.5 `pages/HealthCheckWidgetPage.tsx` — P1

**Current problems**

- 820 lines; duplicates the `STATUS_COLORS` constant (69-75) verbatim from `HealthCheckConfigPage.tsx:55-61` and `InvestigationPanel.tsx:35-41` — see §4.11/§6 for the consolidation plan.
- Contains its own `WidgetCheckRow` (794) sub-component and `EMPTY_FORM`/`DEFAULT_GLOBAL_TIMEOUTS` constants (98, 119) mixed with the page-level CRUD + run-history + config logic.
- Has a test file (150 lines) but it's thin relative to 820 lines of source.

**Proposed target design:** extract `WidgetCheckRow` to `components/molecules/`; move `STATUS_COLORS` to a shared `constants/checkRunStatus.ts` (parallel to the existing `constants/healthStatus.ts` pattern); extract `useWidgetHealthChecks` data hook.

**Priority: P1 (duplication + size). Effort: M. Risk: Low.**

---

### 4.6 `services/api.ts` — P1

**Current problems**

- 815 lines, 100 exported functions, all in one flat file. The internal design is actually sound (single `request<T>()` helper at 101-135 with consistent auth-header injection and typed error objects; domain sections marked with comment banners) — this is a **file-organization** problem, not a logic-quality problem.
- Because everything is one file, any change to one domain (e.g. workflows) risks merge conflicts with unrelated domains (e.g. health checks) touching the same file simultaneously — a real cost on a team-maintained monorepo.
- The `rulesData as unknown as FormattingRule[]` cast pattern seen in `ProcessingJobManager.tsx` (§4.1) traces back to `api.listFormattingRules()` not being strictly typed to return `FormattingRule[]` — fixing the return type here removes the downstream cast.

**Proposed target design:** split into `services/api/providers.ts`, `services/api/ai-profiles.ts`, `services/api/processing-jobs.ts`, `services/api/workflows.ts`, `services/api/health-checks.ts`, `services/api/settings.ts`, `services/api/workspaces.ts`, etc. (mirroring backend route groupings), each importing the shared `request()` helper from a new `services/api/client.ts`; keep `services/api.ts` as a barrel re-export (`export * from './api/providers'`, etc.) so no call-site import path changes are required in the first pass.

**Step-by-step migration plan:** 1) extract `client.ts` (the `request`/`getApiAuthHeaders`/`RequestOptions` machinery, 77-142) with its existing test coverage intact; 2) split remaining functions into domain files purely by cut/paste (no logic change); 3) fix `listFormattingRules` (and any other loosely-typed function found during the split) to return its real type instead of `unknown`; 4) barrel-export from `services/api.ts` (or update the ~20 call sites doing `import * as api from '../services/api'` to point at the domain files directly, if the team prefers explicit imports — either is fine, barrel is lower-diff).

**Dependencies/blockers:** should happen *before* or *alongside* the `ProcessingJobManager.tsx`/`AiProfileManager.tsx` splits, since those files' new hooks will want to import from the split-up domain files directly. **Priority: P1. Effort: M (1 day, purely mechanical). Risk: Low.**

---

### 4.7 `pages/HealthDashboardPage.tsx` — P1

**Current problems:** 759 lines, single default export with heavy `useMemo`-based aggregation logic (2 `useMemo`s doing cross-check-type rollups) mixed with rendering of uptime pie/heatmap components. Has a test file (184 lines) — better covered than most flagged files, but the aggregation logic itself isn't unit-tested in isolation from rendering.

**Proposed target design:** extract the aggregation `useMemo` blocks into a pure, independently-testable `lib/health-aggregation.ts` (or `hooks/useHealthDashboardData.ts`) so the math (uptime %, incident rollups) can be unit-tested without mounting the full page.

**Priority: P1 (business-reporting logic should be independently testable). Effort: S-M. Risk: Low.**

---

### 4.8 `pages/HealthCheckProfilesPage.tsx` — P1

**Current problems:** 624 lines, no test file, renders + drives `InvestigationPanel` (§4.11) drill-down. Mixes profile CRUD with the drill-down orchestration.

**Proposed target design:** extract a `useHealthCheckProfilesData` hook; keep drill-down wiring thin by delegating to `InvestigationPanel`'s own props contract once that component is cleaned up (§4.11).

**Priority: P1 (size + zero tests on a page driving destructive CRUD). Effort: M. Risk: Low.**

---

### 4.9 `lib/auth-session.ts` — P1 (security/stability, not size)

**Current problems**

- Only 322 lines but flagged P1 because of **SD5 (confirmed still valid, not size-driven)**: `initAuthSession()` (322-360) calls `supabase.auth.onAuthStateChange(...)` at line 344 and never stores or returns the returned `{ data: { subscription } }` handle. `App.tsx:148-155` invokes `initAuthSession()` inside a `useEffect` with **no cleanup function returned**, so:
  - React 18 `StrictMode` (dev only) double-invokes effects, immediately registering 2 listeners.
  - Any Vite HMR update to `App.tsx` or its dependency graph re-runs the effect, stacking another listener per hot-reload — in a long dev session this compounds and can cause duplicate `applySessionFromSupabase` calls (duplicate bootstrap network calls, duplicate state writes) each time Supabase fires an auth event.
  - In production this fires once per mount, but `App.tsx` is only mounted once, so production impact is low today — **the real risk is dev-loop noise and any future scenario where `App`/`initAuthSession` is remounted** (e.g. a future test harness, micro-frontend embed, or Storybook usage).
- This module is also a **hidden module-singleton state machine** (`cache`, `sessionUser`, `accountStatus` as module-level `let`s, 64-66) — acceptable for a small app, but it means multiple concurrent tests importing this module share state unless carefully reset, and it's the kind of pattern that gets harder to reason about as the module grows.

**Proposed target design:** change `initAuthSession()` to return the unsubscribe function; `App.tsx`'s `useEffect` should capture and call it on cleanup:

```typescript
useEffect(() => {
  let unsubscribe: (() => void) | undefined;
  initAuthSession().then((unsub) => {
    unsubscribe = unsub;
    setSessionUserProfile(getSessionUser());
    if (getAccountStatus() === 'approved') return loadWorkspaceOptions();
  }).finally(() => setAuthReady(true));
  return () => unsubscribe?.();
}, [loadWorkspaceOptions]);
```

(Exact signature TBD by implementer — the key requirement is that the subscription handle from `supabase.auth.onAuthStateChange` is stored and released.)

**Step-by-step migration plan:** 1) add a test asserting `initAuthSession()` called twice results in only one active listener (or that calling the returned unsubscribe actually stops further state updates) — `lib/auth-session.test.ts` already exists and mocks `supabase`, so this is a small addition; 2) implement the fix; 3) update `App.tsx`'s effect cleanup.

**Dependencies/blockers:** none. **Priority: P1. Effort: S (<0.5 day). Risk: Low — small, well-contained, testable fix.**

---

### 4.10 `types/api.ts` — P1

**Current problems:** 476 lines; the type-drift instances in §3 (SD2/SD3) live here. Beyond those two, the file has no internal organization problem (interfaces are just data shapes, not logic), but its size and its silent drift risk make it worth a P1 process fix rather than a P2 code fix.

**Proposed target design:** not a decomposition problem — the fix is **process**: either (a) generate these types from the backend's `types.ts`/Zod schemas (aligns with AR1's Zod recommendation and AR11's OpenAPI recommendation — if AR1 lands, these frontend types could be generated from the same schemas), or (b) add a lightweight contract test that fetches a real (or fixtured) backend response and asserts it satisfies the frontend interface at runtime for at least `CallingApplication` and `DiagnosticLog`, so drift fails CI instead of failing silently.

**Step-by-step migration plan:** 1) fix the two confirmed-wrong interfaces now (delete phantom `CallingApplication` fields or confirm with backend owner whether they should be *added* to the backend row instead — `name`/`slug`/`is_active` on a calling-application record seem plausible as intended-but-never-shipped backend fields, worth a product conversation, not just a type deletion); align `DiagnosticLog` field names to `DiagnosticLogRow`; 2) add the contract-test safety net described above so this can't silently regress; 3) revisit after AR1 (Zod adoption) lands on the backend.

**Dependencies/blockers:** requires a decision from whoever owns `CallingApplication`'s intended shape (backend or frontend team) — is it a frontend bug (delete phantom fields) or a backend gap (ship the fields)? **Priority: P1. Effort: S for the fix, M if it requires backend coordination. Risk: Medium (touches a shared contract; must coordinate with backend audit agent's findings).**

---

### 4.11 `components/InvestigationPanel.tsx` — P2

**Current problems:** 502 lines. Duplicates `STATUS_COLORS` (35-41, identical to `HealthCheckWidgetPage.tsx` and `HealthCheckConfigPage.tsx`) and `formatTimestamp` (45-54, similar concept to `ManageLlmsModal.tsx:99`). Contains a **dead, underscore-prefixed unused function** `_relativeTime` (56-61) — defined, never called anywhere in `frontend/src` (confirmed via repo-wide search), left over from a prior UI iteration.

**Proposed target design:** move `STATUS_COLORS` to shared `constants/checkRunStatus.ts` (§6); consolidate `formatTimestamp` variants into `lib/format.ts`; delete `_relativeTime` or wire it up if the relative-time display was intended to ship.

**Priority: P2. Effort: S. Risk: Low.**

---

### 4.12 `components/organisms/DiagnosticsTab.tsx` — P2

**Current problems:** 534 lines — this is the file previously extracted from `ProcessingJobManager.tsx` (DM3's "fix"). It is reasonably self-contained (1 `useState`, 1 `useEffect`, 2 API calls at the top level per the earlier grep pass) but is exactly large enough that it risks becoming the second instance of the same regrowth pattern if new diagnostics features are bolted onto it without discipline.

**Proposed target design:** no urgent decomposition needed today; the recommendation is procedural — apply the §6 max-line lint rule to this file too, and if it crosses ~600 lines in a future change, split its config-editing UI from its log-viewer UI as two components immediately rather than letting it grow further.

**Priority: P2. Effort: S (guardrail only, no code change needed now). Risk: Low.**

---

### 4.13 `pages/WorkflowEditorPage.tsx` — P2

**Current problems:** 456 lines, full-page drag-and-drop workflow editor. Relatively well-factored already (delegates to `StepVariableMapper`, `WorkflowStepSidebar`, `WorkflowInputEditor`, `WorkflowHelpDrawer` — all separate files). Main residual issue is 4 `useState` + duplicated `notifications.show` error blocks consistent with the repo-wide pattern (§6).

**Priority: P2. Effort: S. Risk: Low.**

---

### 4.14 `components/molecules/FailoverConfigModal.tsx` — P2

**Current problems:** 444 lines for what is conceptually a single modal form — on the larger end for a "molecule". No test file despite configuring failover behavior for AI profiles (operationally important — misconfigured failover could silently break production AI calls).

**Proposed target design:** extract the failover-chain-step list rendering into its own sub-component if it grows further; more urgently, add tests for the save path.

**Priority: P2. Effort: S-M. Risk: Medium (untested, operationally significant config).**

---

### 4.15 `components/organisms/WorkflowTestSimulator.tsx` — P2

**Current problems:** 443 lines; has a test file (173 lines). Uses `lib/interpolate.ts` correctly (confirmed via grep) — this file is a **model example** of the pattern the rest of the codebase should follow. No major issues beyond size; low priority for actual rework.

**Priority: P2 (size only). Effort: S. Risk: Low.**

---

### 4.16 `components/molecules/StepVariableMapper.tsx` — P2

**Current problems:** 438 lines, but 0 `useState`/`useEffect`/API calls at the top level (confirmed via grep) — this is a large **pure presentational** drag-and-drop component. Has a test file. Size is driven by DnD markup/handlers, not mixed responsibilities.

**Proposed target design:** low urgency; if touched again, consider extracting the drag-and-drop item-rendering sub-blocks into small named components for readability, but this is a style preference, not a structural risk.

**Priority: P2 (size only, otherwise healthy). Effort: S. Risk: Low.**

---

### 4.17 `components/organisms/ManageLlmsModal.tsx` — P2

**Current problems:** 428 lines, 9 `useState`, mixing provider-model list fetch/search/filter, single-add form, and bulk-import-via-textarea parsing in one modal. No test file. Has its own `formatTimestamp` (99) duplicating the concept in `InvestigationPanel.tsx`.

**Proposed target design:** extract `BulkImportModelsForm` (the textarea-parsing block) as its own sub-component; consolidate `formatTimestamp` per §6.

**Priority: P2. Effort: S-M. Risk: Low.**

---

### 4.18 `pages/HealthCheckConfigPage.tsx` — P2

**Current problems:** 423 lines; duplicates `STATUS_COLORS` (55-61) — third occurrence, see §4.11/§6. Has a test file.

**Priority: P2. Effort: S (mostly the shared-constant extraction). Risk: Low.**

---

### 4.19 `pages/WorkflowDetailPage.tsx` — P2

**Current problems:** 411 lines, no test file, orchestrates `WorkflowExecutionLog` + `WorkflowVariablePanel` + `WorkflowTestSimulator`. Reasonably composed already; main gap is test coverage on the orchestration/tab-switching logic.

**Priority: P2. Effort: S. Risk: Low.**

---

### 4.20 `pages/HealthCheckProvidersPage.tsx` — P2

**Current problems:** 389 lines, has a test file, provider-key CRUD for the health-check subsystem. No structural issues found beyond routine size; lowest-risk item in the P2 batch.

**Priority: P2. Effort: S. Risk: Low.**

---

### 4.21 `components/organisms/WorkflowVariablePanel.tsx` — P2

**Current problems:** 373 lines, has a test file, uses `lib/interpolate.ts` correctly. Healthy file; flagged only for size.

**Priority: P2. Effort: S. Risk: Low.**

---

### 4.22 `components/organisms/WorkflowManager.tsx` — P2

**Current problems:** 361 lines, has a test file. Healthy; flagged only for size relative to the P2 threshold.

**Priority: P2. Effort: S. Risk: Low.**

---

### 4.23 `pages/LovableGuidePage.tsx` — P2 (low actual risk)

**Current problems:** 585 lines but 0 `useEffect`/API calls — this is almost entirely static onboarding/documentation copy embedded in JSX (Mantine `List`/`Text`/`Code` blocks describing integration steps), per its own header comment ("All heavy-lifting lives in downloadable .md/.ts/skill files; this page directs the user"). The size is real but the *risk* is low — it's not mixing logic concerns, it's just long-form copy in a `.tsx` file.

**Proposed target design:** move the long-form copy blocks into markdown/constant string exports (`lovable-guide-content.ts` or similar) so the `.tsx` file is pure layout, and the copy can be edited without touching component logic (also makes it easier for a non-engineer to update onboarding copy).

**Priority: P2. Effort: S. Risk: Low.**

---

### P3 — Low priority (bullet list only)

- **`layouts/AppShell.tsx`** (280 lines) — nav shell + page registry; healthy, no action needed beyond routine upkeep.
- **`pages/UserManagementPage.tsx`** (275 lines) — no test file; add coverage for the approve/suspend actions given they're destructive/security-relevant, but size and structure are fine.
- **`App.tsx`** (240 lines) — root bootstrap; the only real issue here is the SD5-related cleanup already covered in §4.9.
- **`pages/TeamPage.tsx`** (159 lines) — no test file for role-change actions (minor security relevance); otherwise fine.
- Numerous small `lib/*.ts` utilities (`slugify.ts`, `api-url.ts`, `provider-types.ts`, `roles.ts`) are appropriately tiny and well-tested; no action.
- `hooks/useConfirm.tsx`, `components/atoms/PageHeader.tsx`, `components/ErrorBoundary.tsx` — small, single-purpose, healthy.
- Auth form components (`SignInForm.tsx`, `SignUpForm.tsx`, `ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx`, `PendingApproval.tsx`, `AuthLanding.tsx`) — reasonably sized, no test files, but low complexity; add smoke tests opportunistically rather than as a dedicated priority.

---

## 5. Cross-Boundary Duplication Flags

| Location | Description |
|---|---|
| `frontend/src/types/api.ts:131-140` (`CallingApplication`) vs. `backend/src/types.ts:294-300` (`CallingApplicationRow`) | **Confirmed field drift** (SD3). Frontend declares `name`, `slug`, `description`, `is_active` that don't exist on the backend row. Needs a decision: delete from frontend, or these are missing backend columns that should exist. Flag for backend audit agent + product owner. |
| `frontend/src/types/api.ts:190-` (`DiagnosticLog`) vs. `backend/src/types.ts:311-` (`DiagnosticLogRow`) | **Confirmed field-name drift** (SD2). Frontend uses `request_payload`/`supabase_timing`/`formatting_timing`/`error_message`; backend row has `auth_mode`/`user_id`/`input_text`/`output_text`/`formatted_text`. Needs reconciliation — likely the frontend type reflects an *older* backend shape or a *different* log-retrieval endpoint's shape; needs a side-by-side check against the actual `GET` response body. |
| `frontend/src/lib/interpolate.ts` (canonical) vs. 3 inline reimplementations in `frontend/src/pages/AiMatcherPage.tsx:734-740` and `frontend/src/components/organisms/ProcessingJobManager.tsx:2860-2877,3991-4008` | Not a cross-*repo* boundary, but a cross-*module* duplication worth flagging alongside the backend's own template-interpolation logic (`apps/cadence-api` and/or `backend` — worth the backend/Cadence audit agents checking whether their server-side interpolation utility and this frontend one have diverged in supported syntax, e.g. dotted-path keys `{{a.b}}` which the frontend regex `PLACEHOLDER_RE = /\{\{([\w.-]+)\}\}/g` supports but the 3 inline copies may not). |
| `frontend/src/components/organisms/AiProfileManager.tsx` `TestChatPanel` (1894-2466) — SSE streaming chat with tool-call/auth-required message types | Structurally similar in concept (streaming chat session with tool calls) to whatever chat/session UI exists in `apps/cadence-web`. Worth the Cadence-web audit agent checking whether Cadence has its own independent streaming-chat component that could share a `useStreamingChat` hook or message-type contract with this one — not recommending a merge without seeing both, just flagging the overlap for cross-team awareness. |
| `frontend/src/constants/healthStatus.ts` (canonical, 4-key `healthy/degraded/down/unknown` status config) vs. 3x inline `STATUS_COLORS` (`pass/warning/fail/timeout/error`, in `HealthCheckWidgetPage.tsx:69-75`, `HealthCheckConfigPage.tsx:55-61`, `InvestigationPanel.tsx:35-41`) | Not literally the same taxonomy (dashboard-level health vs. individual-run status), but the *pattern* of "put status→color mapping in `constants/`" is already established and simply not followed for the run-status vocabulary. Internal (not cross-repo) but flagged here because it's the same class of "type/constant defined once but duplicated at the point of use" issue as the true cross-repo drift above. |

---

## 6. Systemic / Cross-Cutting Recommendations

1. **Add a max-file-line lint rule (highest priority — this is what prevents the next `ProcessingJobManager.tsx`).** E.g. an ESLint rule (`max-lines` with a threshold like 400-500 for non-test files, or a custom rule scoped to `components/organisms/**` and `pages/**`) that fails CI. This is the direct fix for the DM3/§1.1 "process failure" — the prior extraction worked exactly once because nothing stopped the next feature from being added back into the same file. Pair this with a documented convention note (e.g. in a `frontend/CONTRIBUTING.md` or the root `CLAUDE.md`) stating "new tabs/major UI sections get their own file from day one."
2. **Adopt TanStack Query (AR8, still open).** Nearly every flagged file repeats the same `useState` (data) + `useState` (loading) + `useEffect` (fetch) + manual `notifications.show` (error) quadruplet. TanStack Query would collapse this to a `useQuery`/`useMutation` call, eliminate a large fraction of the duplicated boilerplate cited throughout §4, add request de-duping/caching (helping the "fetch same list twice across tabs" pattern seen in `ProcessingJobManager.tsx` and `AiMatcherPage.tsx`), and make loading/error states consistent app-wide. Recommend starting with one new/refactored surface (e.g. the `ProcessingJobManager.tsx` split in §4.1) as the pilot before a repo-wide migration.
3. **Extract a shared `notifyApiError(err, title?)` utility.** The exact block `notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' })` (or trivial variants) appears roughly 40+ times across the flagged files (8 in `ProcessingJobManager.tsx` alone, 7 in `AiProfileManager.tsx`, and at least one in nearly every CRUD page). A one-line `notifyApiError(err)` call would remove hundreds of duplicated lines and make future changes (e.g. adding Sentry reporting per AR-series backend recommendations) a one-file change instead of a 40-file find-and-replace.
4. **Consolidate status/color constant maps.** Move the `STATUS_COLORS` (`pass/warning/fail/timeout/error`) triplication (§4.5/§4.11/§4.18) into `constants/checkRunStatus.ts`, following the already-established `constants/healthStatus.ts` pattern.
5. **Consolidate template interpolation onto `lib/interpolate.ts`** everywhere (§1.4, §4.1, §4.3, §5) — this is both a DRY and a correctness fix (the canonical version is regex-based and handles dotted keys; the ad-hoc `.split().join()` copies do not).
6. **Close the test-coverage gap in inverse proportion to file size and blast radius**, not evenly: prioritize `ProcessingJobManager.tsx`, `AiMatcherPage.tsx`, `AiProfileManager.tsx`'s `TestChatPanel`, `SettingsPage.tsx`'s API-key flow, and `FailoverConfigModal.tsx` before smaller/lower-risk files — these are exactly the files with the least coverage and the highest operational impact if a refactor silently breaks them.
7. **Fix the `onAuthStateChange` leak (§4.9) as a quick, isolated, high-value fix** — small, testable, and removes a latent correctness bug independent of any larger refactor timeline.
8. **Establish a lightweight frontend/backend type-contract check** (§4.10) to catch the next SD2/SD3-style drift automatically instead of relying on manual code review to notice it — even a small Vitest-based fixture-response contract test for the highest-traffic response shapes (`ProcessingJob`, `AiProfile`, `DiagnosticLog`, `CallingApplication`) would have caught the current drift.
9. **Split `services/api.ts` into domain files (§4.6) before or alongside the two P0 organism splits**, since the new hooks extracted from `ProcessingJobManager.tsx`/`AiProfileManager.tsx` will want a natural, non-monolithic home for their corresponding API calls.
