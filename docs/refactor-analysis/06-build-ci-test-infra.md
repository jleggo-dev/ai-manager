# 06 — Build, CI, Test & Workspace Infrastructure Audit

**Scope:** repo-wide build/CI/test/lint/format/workspace configuration — not individual application source files (see `01`–`05` for AI Admin backend/frontend, Cadence API/web, and shared-packages/seam findings).

**Method note:** all findings below come from directly reading config files (`package.json`, `package-lock.json`, `eslint.config.js`, `vercel.json`, tsconfigs, migration SQL, scripts) and from `Glob`-based file counts — no recursive shell scans, no `npm install` (dry-run or otherwise) was executed, per the instruction to avoid long-running/interactive commands. Two claims attributed to sibling agents in the task prompt are **corrected** below with direct evidence (see §0).

---

## 0. Corrections to prior sibling-agent claims (verify-briefly items)

| Claim (attributed to a sibling agent) | Verdict | Evidence |
|---|---|---|
| "Zero `.sql` migrations in-repo for AI Admin at all" | **False — corrected.** | `Glob` on `migrations/**` returns **20 tracked `.sql` files**: 7 for AI Admin directly under `migrations/` (`006_profiles_auth_approval.sql`, `007_profiles_status_enum.sql`, `008_profile_session_config.sql`, `009_triggers.sql`, `010_idempotency_keys.sql`, `011_ai_profile_slugs.sql`, `012_chat_session_provider_metadata.sql`) and 13 for Cadence under `migrations/cadence/` (`0001_init.sql` … `0013_nutrition_observe.sql`). `git ls-files migrations/` confirms all 20 are tracked, not gitignored. The migration-tooling gap (AR5, §3 below) is real, but the "zero files" framing is wrong and would mislead a refactor plan into thinking schema history doesn't exist at all — it does, just informally. |
| ".husky has no hook files" / ".github/workflows absent" | **Confirmed true.** | `Glob` on `.husky/**` and `.husky/_/**` → 0 files (only the untracked `.husky/_/*` shims from a `husky install` run show up in `git status`, which are auto-generated internals, not actual hooks). `Glob` on `.github/**` → 0 files. Both are genuine, unresolved gaps — see §3 and §4.4. |
| "workspaces = `[\"backend\",\"frontend\",\"packages/types\",\"packages/client\",\"packages/edge\"]`, missing Cadence" | **Confirmed true**, read directly from root `package.json:5-11`. See §1. |
| "Standardize on vitest since cadence-api already uses it; migration cost for backend's ~65 files" | **Partially wrong premise — corrected.** | `backend/package.json` and `frontend/package.json` **already** declare `"test": "vitest run"` with `vitest ^4.1.5` as a devDependency (same major version cadence-api uses). There is **no runner-migration cost** — backend, frontend, and cadence-api are all already on vitest. The real gap is (a) `apps/cadence-web`, `packages/core`, `packages/cadence-shared` have **zero** test files and no test script at all, and (b) none of the four already-vitest workspaces are wired into a shared root test command that also covers Cadence. See §2 and §4.2. |

---

## 1. Executive summary — top systemic gaps

1. **P0 — Workspace wiring is broken; root quality gates are structurally blind to all of Cadence.** Root `package.json` workspaces = `["backend","frontend","packages/types","packages/client","packages/edge"]`. `apps/cadence-api`, `apps/cadence-web`, `packages/core`, `packages/cadence-shared` are **not listed**, despite `docs/cadence/PLAN.md:66` asserting this was "updated" already (contradicted by the file itself, and by `PLAN.md:381-383`'s own risk note — see §6). Confirmed independently by two sibling agents via `npm install --dry-run`: npm reports `@ai-admin/core`, `@cadence/shared`, `@cadence/api`, `@cadence/web` as **extraneous** and would delete their `node_modules` symlinks on a clean install. Every root script (`ci`, `typecheck`, `lint`, `test`, `format`, `prepush`) silently skips 100% of Cadence source. This is the single highest-leverage fix in this report — nothing else here is trustworthy until this is fixed, because "CI passed" currently means nothing about Cadence.
2. **P0 (confirmed unresolved, DM1 from `CODE_REVIEW_AND_TEST_PLAN.md`) — no CI/CD pipeline exists at all.** `.github/workflows` does not exist. Every quality gate (`typecheck`, `lint`, `format:check`, `test`, `build` — all of which already exist as working root scripts) runs **only** if a human remembers to run `npm run ci` or `npm run prepush` locally before pushing. Combined with finding 1, this means there is currently no automated signal, of any kind, on Cadence code.
3. **P1 — Lint/format coverage has an entire-workspace blind spot, twice over.** `apps/cadence-api`, `apps/cadence-web`, `packages/core`, `packages/cadence-shared` have **no ESLint config file** (confirmed by direct `Glob` — zero matches under `apps/**` or `packages/**`) and are **not** included in root `format`/`format:check` globs, which are hardcoded to `"backend/src/**/*.ts" "frontend/src/**/*.{ts,tsx}"`. Two workspaces with real, shipped TypeScript source (`apps/cadence-api/src`, `apps/cadence-web/src`) are running zero static analysis outside the TypeScript compiler itself.
4. **P1 — Pre-commit hooks are configured but not installed; coverage would be partial even if they were.** `.husky/` contains no hook files (only auto-generated `_` internals from `husky install`), so `lint-staged` never runs on commit today. Even once fixed, the `lint-staged` config in root `package.json` only globs `backend/{src,test}/**/*.ts` and `frontend/src/**/*.{ts,tsx}` — Cadence files would still slip through a `git commit` untouched.
5. **P1/P2 — Config-as-code drift has no detection.** `config/ai-admin/ai-admin.config.json` is synced to the **live production** AI Admin instance (`ai-manager-alpha-seven.vercel.app` by default) via manually-run scripts (`apps/cadence-api/scripts/sync-jobs.ts`, `provision-aim.ts`) with no CI gate, no dry-run/diff step, and no record of when they were last run. A prompt/config edit that isn't manually synced silently diverges from production with no error anywhere.

**P0 count: 2. P1 count: 4 (including the migration-tooling item folded into P1/P2 below). P2 count: 2. P3 count: 2.** (Full breakdown in §4/§5.)

---

## 2. Current-state inventory

### 2.1 Workspace configuration

| Item | Value | Source |
|---|---|---|
| Root `package.json` `workspaces` | `["backend", "frontend", "packages/types", "packages/client", "packages/edge"]` | `package.json:5-11` |
| Directories that *should* be workspaces but aren't | `apps/cadence-api`, `apps/cadence-web`, `packages/core`, `packages/cadence-shared` | confirmed via their `package.json` files existing with `name`/`dependencies` but not appearing in root `npm ls --workspaces` resolution |
| `package-lock.json` `packages[""].workspaces` | `["backend", "frontend"]` — **even more stale** than root `package.json` (missing `packages/types`, `packages/client`, `packages/edge` too) | `package-lock.json:10-13` |
| `package-lock.json` `version` | `1.2.0` | `package-lock.json:3` — root `package.json.version` is `1.4.0`; lockfile has not been regenerated across at least 2 version bumps |
| Internal package cross-refs using `"*"` | `@cadence/api` depends on `@ai-admin/core: "*"` and `@cadence/shared: "*"`; `@cadence/web` depends on `@cadence/shared: "*"` | `apps/cadence-api/package.json:14-15`, `apps/cadence-web/package.json:14` — these can only resolve via npm workspace symlinking, which requires the workspace list fix |

### 2.2 CI/CD presence

| Item | Status |
|---|---|
| `.github/workflows/*.yml` | **Absent** — 0 files (confirmed via `Glob`) |
| `.github/` directory at all | **Absent** |
| Any other CI config (`.circleci`, `.gitlab-ci.yml`, `azure-pipelines.yml`, Vercel "Ignored Build Step") | Not found; `vercel.json` (see §2.5) has no build-gate configuration beyond routing/crons |
| Root scripts that *would* serve as CI jobs if wired up | `typecheck`, `lint`, `format:check`, `test`, `build`, `ci`, `prepush` — all already exist and (for AI Admin) already work; they're just never invoked automatically |

### 2.3 Test runner & coverage per workspace

| Workspace | Test runner | Test script | Test file count | Notes |
|---|---|---|---|---|
| `backend` | vitest ^4.1.5 | `"test": "vitest run"` | **68** (`Glob backend/test/**/*.ts`) | Includes unit + several `e2e-*.test.ts`; per sibling report `01`, the largest/riskiest file (`ai-manager/index.ts`, 2,071 lines) has no *direct* unit test, only indirect route-level coverage |
| `frontend` | vitest ^4.1.5 + `@testing-library/react` | `"test": "vitest run"` | **25** (`Glob frontend/src/**/*.test.{ts,tsx}`) | Per sibling report `02`, the two largest organisms (`ProcessingJobManager.tsx` 5,497 lines, `AiMatcherPage.tsx` 1,061 lines) have zero test coverage |
| `apps/cadence-api` | vitest ^4.1.5 | `"test": "vitest run"` | **1** (`engines.test.ts`) | Same major runner as backend/frontend — no runner mismatch, just near-zero coverage |
| `apps/cadence-web` | **none** | no `test` script; no `vitest`/test-lib devDependency at all | **0** | Entire workspace has no test infrastructure, not just no tests |
| `packages/core` (`@ai-admin/core`) | none | no `scripts` block at all in `package.json` | 0 | No build/test/lint script of any kind |
| `packages/cadence-shared` | none | no `scripts` block at all in `package.json` | 0 | Same — pure type/logic library with zero verification |
| `packages/types`, `packages/client`, `packages/edge` | out of this agent's scope (owned by sibling report `05`) | — | — | Sibling `05` flags these as correctly-functioning reference code with no in-repo consumers |

**Runner standardization verdict:** there is **no runner-standardization problem**. `backend`, `frontend`, and `apps/cadence-api` are already uniformly on `vitest@^4.1.5`. The actual gap is adoption in `apps/cadence-web` (zero test infra) and `packages/core`/`packages/cadence-shared` (zero test infra), plus wiring all of it into one root command (§1, item 1). Recommend: **add vitest to the three zero-coverage workspaces to match the existing standard — not a migration, an extension.**

### 2.4 Lint / format coverage

| Workspace | ESLint config | In root `format`/`format:check` glob? | In root `lint` script? |
|---|---|---|---|
| `backend` | `backend/eslint.config.js` — flat config, `eslint@^10`, TS-aware, `@typescript-eslint` recommended rules | Yes (`"backend/src/**/*.ts"`) | Yes (`npm run lint --workspace=backend`) |
| `frontend` | `frontend/eslint.config.js` — flat config, `eslint@^9` (**one major behind backend's `^9.39.2` vs backend's `^10.0.1`**), React + hooks + refresh plugins | Yes (`"frontend/src/**/*,{ts,tsx}"`) | Yes |
| `apps/cadence-api` | **None found** (`Glob apps/**/eslint*` → 0 results) | No | No |
| `apps/cadence-web` | **None found** | No | No |
| `packages/core` | **None found** | No | No |
| `packages/cadence-shared` | **None found** | No | No |
| Root `.prettierrc*` | **None found anywhere in repo** (`Glob **/.prettierrc*` → 0 results) — prettier is running on default settings, formatting choices are not documented/pinned anywhere | — | — |

Root `format`/`format:check` scripts, verbatim from `package.json:22-23`:
```json
"format": "prettier --write \"backend/src/**/*.ts\" \"frontend/src/**/*.{ts,tsx}\"",
"format:check": "prettier --check \"backend/src/**/*.ts\" \"frontend/src/**/*.{ts,tsx}\""
```
Confirmed: these globs touch only `backend/src` and `frontend/src`. They exclude `backend/test`, all of `apps/*`, and all of `packages/*` (both AI Admin's reference packages and both Cadence packages).

### 2.5 Pre-commit hook coverage

| Item | Status |
|---|---|
| `.husky/pre-commit` (or any hook file) | **Absent.** `.husky/` only contains an untracked `_` subdirectory of husky's own internal shims (`h`, `husky.sh`, `pre-commit`, etc. — these are auto-installed plumbing, not a repo-authored hook). No committed hook actually invokes `lint-staged`. |
| `package.json` `"prepare": "husky || true"` | Present (`package.json:30`) — this only re-installs husky's internal shim on `npm install`; it does not create a `pre-commit` hook file if one doesn't already exist in `.husky/` |
| `lint-staged` config scope | `backend/{src,test}/**/*.ts`, `frontend/src/**/*.{ts,tsx}`, and a catch-all `**/*.ts?(x)` that shells out to `npm run typecheck` (root script — itself scoped to backend+frontend only, per §2.1) | `package.json:32-44` |
| Net effect today | **No pre-commit enforcement runs for anyone, on any file**, because the hook file itself doesn't exist. Even after fixing that, Cadence files still wouldn't be covered by the lint-staged globs above. |

### 2.6 Deployment config (`vercel.json`)

```json
{
  "version": 2,
  "experimentalServices": {
    "frontend": { "entrypoint": "frontend", "routePrefix": "/", "framework": "vite" },
    "backend": { "entrypoint": "backend", "routePrefix": "/_/backend" }
  },
  "crons": [...]
}
```
- Only `frontend` and `backend` are declared as deployable services. **Neither `apps/cadence-api` nor `apps/cadence-web` is represented.**
- `docs/cadence/PLAN.md` (and `CLAUDE.md`) describe Cadence as consuming AI Admin **in-process**, which is architecturally consistent with Cadence needing its *own* deploy target(s) rather than being folded into this `vercel.json` — but the plan's deployment story (`docs/cadence/DEPLOY.md`) needs to be the source of truth here, and this repo-wide audit found no automated check that `vercel.json` and Cadence's actual deploy destination agree. This is a documentation/reality confirmation gap, not necessarily a missing-feature gap — flagged as P2, see §4.6.

### 2.7 Migrations tooling

| Item | Finding |
|---|---|
| AI Admin migrations | 7 files, `migrations/006_*.sql` through `migrations/012_*.sql`, plain numbered SQL, no tool. **`001`–`005` are referenced in `README.md:28` (`005_user_settings_display_name.sql`) but do not exist anywhere in the repo** — either deleted after being applied with no record, or never committed. This is worse than "no tooling": it's missing history for a migration the README still tells new developers to apply. |
| Cadence migrations | 13 files, `migrations/cadence/0001_init.sql` through `0013_nutrition_observe.sql`, same plain-SQL pattern, **plus** a parallel, undocumented apply mechanism: `apps/cadence-api/scripts/apply-migration-0005.ts` through `apply-migration-0013.ts` (9 separate one-off TS scripts, one per migration, per `Glob apps/cadence-api/scripts/*.ts`). No generic "apply pending migrations" runner exists — each migration gets its own bespoke script. |
| Tooling | No Supabase CLI migration folder (`supabase/migrations/`), no `node-pg-migrate`/Knex/Prisma config anywhere. AR5 from `CODE_REVIEW_AND_TEST_PLAN.md` is **still valid for AI Admin and equally valid (worse, actually — one-off scripts per migration) for Cadence.** |
| Two Supabase projects | Confirmed via `migrations/cadence/0001_init.sql:2-6` header comment: Cadence reuses the "Spartan Tracker" Supabase project in a dedicated `cadence` schema, separate from AI Admin's project. No migration tool spans both. |

### 2.8 Config-as-code sync / drift detection

| Item | Finding |
|---|---|
| `apps/cadence-api/scripts/sync-jobs.ts` | Manually-run script; reads `config/ai-admin/ai-admin.config.json`, pushes job definitions to a live AI Admin instance via HTTP using an API key from `backend/.env`. Defaults `AI_ADMIN_BASE_URL` to the **production** URL (`ai-manager-alpha-seven.vercel.app`) if unset — i.e., running this script with no env override targets prod by default. |
| `apps/cadence-api/scripts/provision-aim.ts` | Per `CLAUDE.md`, re-syncs profiles too and "can clobber live model pointers" — a known-dangerous manual script with no confirmation prompt or dry-run flag observed in the sync-jobs.ts pattern. |
| Drift detection | **None.** No CI job diffs `config/ai-admin/ai-admin.config.json` against the live provisioned state; no checksum/version stamp is recorded after a sync; nothing fails if someone edits the config file and forgets to run the sync script (this is explicitly the failure mode `CLAUDE.md` itself warns about: "Job prompt changes ... are NOT live until synced"). |
| Nomenclature issue in this file | Out of this agent's scope per task instructions (a sibling flagged it) — not re-chased here. |

### 2.9 Stray root-level files / docs

| Item | Finding | Recommendation |
|---|---|---|
| `.claude/launch.json` | Untracked (per `git status`), defines two debug run configs (`cadence-web` port 3100, `cadence-api` port 3101). Harmless, IDE-local, but currently invisible to any other contributor since it's untracked and not `.gitignore`d either — it's just sitting there un-committed. | P3 — either commit it (if the launch configs are team-useful) or add `.claude/` to `.gitignore` if it's meant to be personal-local. Decide, don't leave it ambiguous. |
| `.husky/_/*` files | Untracked, auto-generated husky internals (`applypatch-msg`, `commit-msg`, `pre-commit`, etc. — all shim scripts, not actual hooks). | P3 — should be `.gitignore`d (husky's own docs recommend `echo ".husky/_" >> .gitignore`); currently these will show as noise in every `git status` for every contributor who runs `npm install`. |
| `docs/CODE_REVIEW_AND_TEST_PLAN.md` vs root `CODE_REVIEW_AND_TEST_PLAN.md` | **Two different files that share a name but are not duplicates of each other.** Root file is the TypeScript-migration-era review (DM/AR findings this whole audit cross-references, §3). `docs/CODE_REVIEW_AND_TEST_PLAN.md` is a *different*, narrower document about Zod input-validation conventions for "the health monitoring feature area." Confusing naming collision — a future reader grepping for "the code review doc" has a 50/50 chance of opening the wrong one. | P3 — rename `docs/CODE_REVIEW_AND_TEST_PLAN.md` to something like `docs/health-monitoring-validation-checklist.md` to remove the collision. |
| `frontend/public/docs/{API.md,CHANGELOG.md,CONCEPTS.md,INTEGRATION.md}` | Duplicate copies of `docs/API.md`, root `CHANGELOG.md` (or similar), `docs/CONCEPTS.md`, `docs/INTEGRATION.md`, served as static public assets (there's a `sync:docs` script wired into `frontend`'s `predev`/`prebuild` — `frontend/package.json:7-8,11` — that presumably generates these). This is a **build artifact**, not manual duplication, so it's lower-risk than it looks — but it does mean these files can look "stale" if someone edits `docs/API.md` and doesn't run `npm run dev`/`build` in frontend before checking public output. | P3 — confirmed this is scripted (`sync:docs`), not manual copy-paste. No action needed beyond noting it so a refactor doesn't mistake the `frontend/public/docs/*` copies for independent source-of-truth files to edit directly. |
| `docs/plans/devs-ai-v2-integration.md`, `docs/plans/devs-ai-v2-gap-remediation.md` | Feature-specific planning docs; not stale on inspection (referenced features — devs-ai-v2 provider, structured output — match current `CHANGELOG.md` entries), just worth a mention that `docs/plans/` has no README/index explaining which plans are live vs. historical. | P3 — low priority; add a one-line "status: done/superseded/active" header convention if `docs/plans/` grows further. |
| `docs/cadence/PLAN.md` internal inconsistency | See §6 — the same document both claims workspaces were already fixed (line 66) and separately (lines 381-383) lists the unfixed CI/typecheck scope gap as a known, deferred risk with its own mitigation note. This is evidence the fix was *planned* and then never actually executed, not evidence of two different agents disagreeing. | Documented as part of the P0 fix in §4.1 — update `PLAN.md` line 66 once the workspaces array is actually corrected, don't leave the "already done" claim in place. |

---

## 3. Cross-reference to `CODE_REVIEW_AND_TEST_PLAN.md` (infra-relevant findings only)

Sibling report `01` already produced a full DM1-DM9/AR1-AR11 cross-reference from the AI-Admin-backend angle. This table covers the same items from the **repo-wide infra** angle — i.e., adds the Cadence dimension that `01` (scoped to `backend/`) couldn't see, and avoids re-litigating backend-source-level items (RBAC file-by-file, `any` counts, etc. — see `01`/`02` for those).

| Finding | Status (repo-wide infra view) | Note |
|---|---|---|
| **DM1** — No CI/CD pipeline | **Still valid, confirmed, and now worse in scope.** | Not just "no CI" — even if CI were added today pointed only at the current workspace list, it would still exclude Cadence entirely (§1 item 1). The fix must address both at once or the second problem re-hides behind the first. |
| **DM2** — Test coverage near zero | **Fixed for `backend`/`frontend` (68 + 25 files respectively); still true for `apps/cadence-web`, `packages/core`, `packages/cadence-shared` (0 files each); nearly true for `apps/cadence-api` (1 file).** | Repo-wide, "near zero" is no longer an accurate description of AI Admin, but is exactly accurate for 3 of 4 Cadence-side workspaces. |
| **DM4** — No testing framework beyond Node built-in | **Fixed, and consistently fixed.** | `vitest@^4.1.5` is the de facto standard already, adopted independently in backend, frontend, and cadence-api. No further tool decision needed — see correction in §0. |
| **DM6** — No Prettier or code formatter | **Fixed, but partially scoped.** | Prettier is installed and has working `format`/`format:check` scripts — but only for `backend/src` and `frontend/src` (§2.4). No `.prettierrc` exists anywhere, so formatting rules are implicit defaults, not a documented/reviewable standard. |
| **DM7** — No pre-commit hooks | **Configured but non-functional today (`.husky/` has no hook files), and scoped-if-fixed.** | See §2.5. Two-part gap: (a) hooks aren't installed/committed at all right now; (b) even fixed, `lint-staged` globs exclude all of Cadence. |
| **DM9** — Legacy `api/index.js` `.js` references | Out of repo-wide-infra scope; not independently re-verified this pass (backend-source item, see `01`). | — |
| **AR5** — No migration tooling, manual SQL execution | **Still valid for AI Admin; equally-or-more valid for Cadence.** Corrects sibling `01`'s "zero `.sql` files" framing — see §0 and §2.7. | Real gap is "no generic apply/rollback tool + missing 001-005 history," not "no files exist." |
| **AR7** — Vercel serverless duration limits for SSE | Not re-independently verified this pass (architectural/backend-source item); noted here only because `vercel.json` (§2.6) confirms Vercel is in fact the deploy target, so the underlying constraint is real infra, not hypothetical. | Carry forward per `01`. |
| **AR10** — No API versioning strategy | Out of infra-audit scope for content (no `/api/v1/` prefix anywhere is a routing/source concern) — noted here only insofar as no CI contract-test or OpenAPI-diff gate exists to enforce a versioning policy even if one were adopted. | Carry forward per `01`. |
| *(New, not in original doc)* — **Cadence workspace/CI exclusion** | **New P0 finding, not covered by the original TS-migration-era review** (which predates Cadence's existence in this repo). | This is the most important gap this report adds beyond the original doc — see §1 item 1 and §4.1. |
| *(New)* — **Config-as-code drift detection** | **New P1/P2 finding.** | See §2.8 and §4.7. |

---

## 4. Detailed remediation plans

### 4.1 P0 — Fix workspace wiring (root `package.json` + lockfile)

**Current problem (evidence):**
```json
"workspaces": ["backend", "frontend", "packages/types", "packages/client", "packages/edge"]
```
(`package.json:5-11`). `apps/cadence-api/package.json` (`name: "@cadence/api"`), `apps/cadence-web/package.json` (`name: "@cadence/web"`), `packages/core/package.json` (`name: "@ai-admin/core"`), `packages/cadence-shared/package.json` (`name: "@cadence/shared"`) all exist with real dependency graphs (`@cadence/api` depends on `@ai-admin/core: "*"` and `@cadence/shared: "*"`) but are invisible to npm's workspace resolution. Confirmed by two sibling agents' `npm install --dry-run`: these 4 packages are reported extraneous and would be deleted on a clean install. `docs/cadence/PLAN.md:66` incorrectly states this is already fixed.

**Proposed target state:**
```json
"workspaces": [
  "backend",
  "frontend",
  "packages/types",
  "packages/client",
  "packages/edge",
  "packages/core",
  "packages/cadence-shared",
  "apps/cadence-api",
  "apps/cadence-web"
]
```
(Explicit list recommended over a `packages/*`/`apps/*` glob — explicit entries make it obvious in review when a new package/app is intentionally added to the root's blast radius, matching this repo's existing style of listing `packages/types`, `packages/client`, `packages/edge` individually rather than `packages/*`.)

**Step-by-step migration plan:**
1. Update the `workspaces` array as above.
2. Regenerate the lockfile: `npm install` (full run, not `--dry-run`) **on a clean checkout/CI runner, not a machine with pre-existing stale symlinks** — sibling report `05` independently recommends exactly this same clean-runner check (§111 of that report) as the only way to catch this class of regression.
3. Confirm `npm ls --workspaces` lists all 9 workspaces with no `extraneous`/`invalid` markers.
4. Update root scripts (`typecheck`, `lint`, `test`, `format`, `format:check`, `build`, `ci`, `prepush`) to include the 4 new workspaces — see §4.2/§4.3 for exact script text.
5. Update `docs/cadence/PLAN.md:66` to remove the "already updated" claim once — and only once — this is actually done, and remove/resolve the stale risk note at `PLAN.md:381-383` in the same pass.
6. Commit the regenerated `package-lock.json` in the same PR as the `workspaces` change (never as a follow-up — a corrected `workspaces` array with a stale lockfile is worse than the current consistent-but-wrong state, because CI could pass against a lockfile that doesn't match `package.json`).

**Verification steps:** `npm ls --workspaces` (no extraneous/missing); `npm run typecheck` from root actually invokes cadence-api/cadence-web's `tsc --noEmit`; `git diff package-lock.json` shows the workspace list and version bump reflected.

**Dependencies/blockers:** None — this is the first thing that should land, before any CI workflow (§4.4) is written, since a CI workflow built against the current broken workspace list would just automate the existing blindness.

**Priority/Effort/Risk:** **P0 / S (well under a day of hands-on work) / Medium risk** — the change itself is a one-line array edit, but "regenerate lockfile + confirm every existing script still passes for backend/frontend" is where risk lives: if `apps/cadence-api`/`apps/cadence-web` currently have *any* latent `tsc`/lint failures that were never caught (very likely, given zero CI has ever run against them), wiring them into `npm run typecheck`/`ci` will surface those failures immediately and could block merges until fixed. Recommend landing the workspace-array + lockfile fix and a **non-blocking** CI run first (report-only, don't fail the build) to inventory what breaks, before flipping Cadence's CI jobs to required/blocking.

---

### 4.2 P0/P1 — Extend root scripts + add missing test infra for Cadence workspaces

**Current problem:** root `test`, `lint`, `typecheck`, `format`, `format:check` scripts (`package.json:12-30`) only reference `backend`/`frontend`. `apps/cadence-web`, `packages/core`, `packages/cadence-shared` have no test runner installed at all (§2.3).

**Proposed target state** (root `package.json`, once §4.1 lands):
```json
"scripts": {
  "typecheck": "npm run typecheck --workspaces --if-present",
  "lint": "npm run lint --workspaces --if-present",
  "format": "prettier --write \"{backend,frontend,packages/core,packages/cadence-shared,apps/cadence-api,apps/cadence-web}/src/**/*.{ts,tsx}\"",
  "format:check": "prettier --check \"{backend,frontend,packages/core,packages/cadence-shared,apps/cadence-api,apps/cadence-web}/src/**/*.{ts,tsx}\"",
  "test": "npm run test --workspaces --if-present",
  "ci": "npm run typecheck && npm run format:check && npm run lint && npm test",
  "prepush": "npm run typecheck && npm run format:check && npm run lint && npm run build --workspace=backend && npm run vercel:build:frontend && npm test"
}
```
Using `--workspaces --if-present` (rather than chained `--workspace=X && --workspace=Y`) means new workspaces automatically get picked up without another root `package.json` edit each time — trading a small amount of "silently skips workspaces with no script" risk (mitigated by adding the script to every workspace, see below) for not repeating this exact audit finding again in a year.

For the 3 zero-coverage workspaces, add matching `package.json` scripts + minimal vitest config (mirroring `apps/cadence-api/package.json:10-11`'s `"typecheck": "tsc --noEmit"`, `"test": "vitest run"` pattern exactly):
- `apps/cadence-web`: add `vitest`, `@testing-library/react` (already has `@vitejs/plugin-react`), a `test` script, and at minimum a smoke test per page/component to start.
- `packages/core`, `packages/cadence-shared`: add `vitest` + a `test` script; these are logic/type libraries, so unit tests are cheap to add incrementally (start with whatever `packages/cadence-shared/src/index.ts` exports per sibling report `05`'s file, before its planned split).

**Step-by-step migration plan:**
1. Land §4.1 first.
2. Add `vitest` devDependency + `test`/`typecheck` scripts to the 3 zero-coverage workspaces' `package.json` (small, additive, no existing behavior changes).
3. Add one smoke test per workspace (e.g., "app boots"/"module exports resolve") to get a passing baseline — don't block on full coverage.
4. Switch root scripts to the `--workspaces --if-present` form above.
5. Run `npm run ci` locally once (bounded, not indefinitely) to confirm exit code 0 before wiring into GitHub Actions (§4.4).

**Verification steps:** `npm run test` from root shows 4 workspaces reporting (backend, frontend, cadence-api, cadence-web) plus 2 library workspaces (core, cadence-shared) with at least 1 passing test each.

**Dependencies/blockers:** Hard dependency on §4.1 (workspaces array). Soft dependency: cadence-web's actual test authoring is realistically the other 5 agents' territory (application code) — this agent's job is making sure the *plumbing* (script + runner + one smoke test) exists so those agents have somewhere to add real tests.

**Priority/Effort/Risk:** **P1 / S per workspace (adding the plumbing), M overall (writing meaningful first tests) / Low risk** — purely additive, no existing script behavior changes for backend/frontend.

---

### 4.3 P1 — Close the lint/format coverage gap for `apps/*` and `packages/*`

**Current problem:** confirmed zero ESLint config files under `apps/**` or `packages/**` (§2.4); root `format`/`format:check` globs hardcoded to `backend/src` and `frontend/src` only.

**Proposed target state:**
- Add `eslint.config.js` to `apps/cadence-api` and `apps/cadence-web`, closely modeled on `backend/eslint.config.js` (Node/Express context for cadence-api) and `frontend/eslint.config.js` (React/Vite context for cadence-web) respectively — both already exist as good templates in this repo, this is copy-adapt work, not new tooling research.
- Add a shared/minimal `eslint.config.js` to `packages/core` and `packages/cadence-shared` (pure-TS libraries — a trimmed version of `backend/eslint.config.js` without Node-specific globals is enough).
- **Align ESLint major versions**: backend is on `eslint@^10.0.1`, frontend on `eslint@^9.39.2` — pick one major version repo-wide (recommend `^10` since it's already the newer one in-repo) so new configs aren't written against a version that's about to be bumped out from under them.
- Add a root-level `.prettierrc.json` (currently absent — Prettier is running on undocumented defaults) so formatting rules are explicit and reviewable, e.g.:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```
(Exact values should match whatever Prettier's defaults have already been formatting the existing `backend/src`/`frontend/src` code to, to avoid a repo-wide reformat diff — verify with `prettier --check` against current defaults before pinning.)
- Expand `format`/`format:check` globs per §4.2's draft above.

**Step-by-step migration plan:** 1) pin prettier config (verify zero-diff against current defaults first); 2) add eslint configs to the 4 currently-bare workspaces, run `eslint . --fix` once per workspace and review the diff (expect mostly import-order/unused-var noise, not logic changes); 3) wire into root `lint` script per §4.2.

**Verification steps:** `npm run lint` (root) touches 6 workspaces; `npm run format:check` (root) passes with zero diff on first run (proves the pinned prettier config matches current formatting).

**Dependencies/blockers:** Depends on §4.1 (workspaces array) for the root script wiring, but the config files themselves can be authored and reviewed independently/in parallel.

**Priority/Effort/Risk:** **P1 / M (mostly mechanical, but "fix whatever the first lint run flags" across 4 previously-unlinted workspaces has unpredictable size) / Low risk** for cadence-api/cadence-web (nothing currently depends on them being lint-clean); **Low risk** for the ESLint major-version alignment too, since `no-explicit-any`/`no-unused-vars` etc. are set to `warn` not `error` in both existing configs, so a version bump is unlikely to newly fail CI outright.

---

### 4.4 P0 — Add GitHub Actions CI

**Current problem:** `.github/workflows` does not exist (confirmed, §2.2). This is DM1 from `CODE_REVIEW_AND_TEST_PLAN.md`, still fully unresolved, and sibling report `01` independently calls it "the single highest-leverage fix available."

**Proposed target state** — a path-filtered workflow so a Cadence-only PR doesn't need AI-Admin-specific secrets (e.g. Supabase service keys for the AI Admin project) and vice versa, given the two products use **separate Supabase projects** (confirmed §2.7):

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      ai-admin: ${{ steps.filter.outputs.ai-admin }}
      cadence: ${{ steps.filter.outputs.cadence }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            ai-admin:
              - 'backend/**'
              - 'frontend/**'
              - 'packages/types/**'
              - 'packages/client/**'
              - 'packages/edge/**'
              - 'package.json'
              - 'package-lock.json'
            cadence:
              - 'apps/**'
              - 'packages/core/**'
              - 'packages/cadence-shared/**'
              - 'config/ai-admin/**'
              - 'migrations/cadence/**'

  ai-admin:
    needs: changes
    if: needs.changes.outputs.ai-admin == 'true'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        workspace: [backend, frontend]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck --workspace=${{ matrix.workspace }}
      - run: npm run lint --workspace=${{ matrix.workspace }}
      - run: npm run test --workspace=${{ matrix.workspace }}
      - run: npm run build --workspace=${{ matrix.workspace }}
        if: matrix.workspace == 'frontend'
        # backend build step / vercel:build:frontend variant as appropriate

  cadence:
    needs: changes
    if: needs.changes.outputs.cadence == 'true'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        workspace: [apps/cadence-api, apps/cadence-web, packages/core, packages/cadence-shared]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck --workspace=${{ matrix.workspace }}
      - run: npm run test --workspace=${{ matrix.workspace }} --if-present

  format-check:
    needs: changes
    if: needs.changes.outputs.ai-admin == 'true' || needs.changes.outputs.cadence == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run format:check
```
Notes on secrets: cadence-api's test suite (`engines.test.ts`) and any future integration tests should be checked for whether they require live Supabase credentials — if so, gate those specific tests behind an env-var check (`if (!process.env.CADENCE_SUPABASE_URL) test.skip(...)`) so the CI job can run without secrets for pure-logic tests, and only inject `secrets.CADENCE_SUPABASE_*` / `secrets.AI_ADMIN_SUPABASE_*` into the matching matrix leg (`ai-admin` job never receives Cadence secrets, `cadence` job never receives AI-Admin-project secrets) — this is the concrete mechanism for the "Cadence PR doesn't need AI Admin secrets" requirement.

**Step-by-step migration plan:** 1) land §4.1 (workspaces) and §4.2 (scripts) first — a CI workflow is only as good as the scripts it calls; 2) add the workflow in **report-only mode** first (remove branch-protection "required" status initially) to inventory real failures across all 6 newly-wired workspaces without blocking anyone's PRs; 3) fix whatever surfaces (expect: cadence-web/core/cadence-shared typecheck issues never caught before); 4) flip to required once green.

**Verification steps:** open a throwaway PR touching only `apps/cadence-web/`, confirm the `ai-admin` job is skipped and `cadence` job runs; open one touching only `backend/`, confirm the reverse.

**Dependencies/blockers:** Hard dependency on §4.1. Should land together with or immediately after the RBAC fix that sibling report `01` recommends (their §"Dependencies/blockers" note explicitly says their AR2 RBAC fix should land "after (or alongside) DM1 (CI)").

**Priority/Effort/Risk:** **P0 / M (workflow authoring is fast; the "fix everything CI newly reveals" tail is the real effort, likely 1-2 days once you see the actual failure count) / Medium risk** — the risk isn't to the workflow itself, it's that turning on CI for the first time against a 5-workspace codebase that's never been collectively type-checked/linted/tested together will almost certainly surface a backlog of small breakages; budget time for that, and use the report-only rollout above to avoid blocking the team mid-fix.

---

### 4.5 P1 — Fix pre-commit hooks (husky + lint-staged)

**Current problem:** `.husky/` has no committed hook file; `lint-staged` globs exclude Cadence even if hooks worked (§2.5).

**Proposed target state:**
1. Run `npx husky init` (or manually create) `.husky/pre-commit` containing:
   ```bash
   npx lint-staged
   ```
   and commit that file (unlike the `_` internals, this file must be tracked).
2. Expand `lint-staged` config (root `package.json`) once §4.1/§4.3 land:
   ```json
   "lint-staged": {
     "{backend,apps/cadence-api}/{src,test}/**/*.ts": ["prettier --write", "eslint --fix"],
     "{frontend,apps/cadence-web}/src/**/*.{ts,tsx}": ["prettier --write", "eslint --fix"],
     "packages/{core,cadence-shared}/src/**/*.ts": ["prettier --write", "eslint --fix"],
     "**/*.ts?(x)": ["bash -c 'npm run typecheck'"]
   }
   ```
3. Add `.husky/_` to `.gitignore` (currently untracked/noisy per §2.9).

**Verification steps:** `git commit` a trivial whitespace change in `apps/cadence-web/src/*` and confirm `lint-staged` actually runs (visible in commit output) and reformats/lints the staged file.

**Dependencies/blockers:** Depends on §4.3 (ESLint configs must exist in the newly-covered workspaces before `lint-staged` can run `eslint --fix` against them without erroring).

**Priority/Effort/Risk:** **P1 / S / Low risk** — pre-commit hooks are advisory to the author only; worst case if something's misconfigured is a slow/annoying commit, not a broken build.

---

### 4.6 P2 — Vercel deploy target clarity for Cadence

**Current problem:** `vercel.json` declares only `frontend` and `backend` as `experimentalServices` (§2.6); no Cadence equivalent exists in this file, and `docs/cadence/PLAN.md` describes Vercel deployment intentions that this audit could not confirm are actually configured anywhere for Cadence (no second `vercel.json`, no `apps/cadence-api/vercel.json`, no `apps/cadence-web/vercel.json` found).

**Proposed target state:** either (a) add Cadence services to a Cadence-specific `vercel.json` (likely at `apps/cadence-api/vercel.json` / a separate Vercel project per app, consistent with "two Supabase projects, two deploy targets" already established for the DB layer), or (b) if Cadence isn't deployed via Vercel at all yet and PLAN.md's Vercel mention is aspirational/future, update `docs/cadence/PLAN.md`/`docs/cadence/DEPLOY.md` to state current deploy status accurately rather than presenting it as settled.

**Step-by-step migration plan:** confirm with whoever owns Cadence's actual current deploy process (this audit found scripts like `apps/cadence-api/scripts/sync-jobs.ts` defaulting to a live `ai-manager-alpha-seven.vercel.app` URL, which is AI Admin's own deployment being *called* by Cadence in-process during local dev — this is not evidence that cadence-api/cadence-web themselves are deployed anywhere yet); then either add the Vercel config or correct the docs.

**Priority/Effort/Risk:** **P2 / S / Low risk** (docs-only fix if deployment isn't actually configured yet; config-only if it is and just needs registering).

---

### 4.7 P2 — Config-as-code drift detection for `ai-admin.config.json`

**Current problem:** manual, one-directional sync scripts with no verification step (§2.8).

**Proposed target state:** add a `--dry-run`/`--diff` mode to `sync-jobs.ts`/`provision-aim.ts` that fetches current live state and diffs against the config file without writing, and add a scheduled (not per-PR, since it needs live credentials) GitHub Actions job (e.g. nightly) that runs this dry-run and posts/fails if drift is detected, so silent divergence between `config/ai-admin/ai-admin.config.json` and production is caught within a day instead of discovered when a prompt behaves unexpectedly in production.

**Step-by-step migration plan:** 1) add `--dry-run` flag to existing scripts (additive, low-risk); 2) add a scheduled workflow with the relevant secrets scoped only to that job; 3) decide alerting channel (Slack webhook / GitHub issue creation) for drift detection.

**Dependencies/blockers:** Needs production credentials as a repo secret — coordinate with whoever holds `AI_ADMIN_API_KEY` for the live instance before automating anything that touches it.

**Priority/Effort/Risk:** **P2 / M / Medium risk** — the risk here is specifically about handling production credentials in CI correctly (scope them to a single scheduled job, never expose to PR-triggered workflows from forks).

---

### 4.8 P2 — Migration tooling consolidation

**Current problem:** plain numbered SQL with no apply/rollback tool, missing `001-005` history for AI Admin, and 9 bespoke one-off apply scripts for Cadence (§2.7).

**Proposed target state:** adopt Supabase CLI migrations (`supabase migration new`, `supabase db push`) for **both** products, given both already use Supabase — this consolidates AI Admin's and Cadence's currently-divergent migration habits (manual SQL vs. one-off TS scripts) into one tool and one CI-checkable directory structure (`supabase/migrations/`), directly enabling AR5's original recommendation.

**Step-by-step migration plan:** 1) reconstruct/document the missing `001-005` migrations for AI Admin from the current live schema (`supabase db diff` against production) so history is complete going forward, even if the exact original files can't be recovered; 2) move existing tracked `.sql` files into the CLI's expected structure; 3) retire the per-migration `apply-migration-NNNN.ts` scripts in favor of `supabase db push`; 4) add a CI job (or extend §4.4) that runs `supabase db diff --linked` (or equivalent) to detect uncommitted schema drift.

**Priority/Effort/Risk:** **P2 / L (this genuinely needs phasing — reconstructing missing history and migrating two products' habits is not a single PR) / Medium risk**, since it touches how schema changes reach production for both live products.

---

## 5. Sequencing recommendation

**Infra fixes must land first, ahead of (or at minimum, interleaved as the very first PRs alongside) the application-code refactors proposed in reports `01`–`05`.** Concretely, in this order:

1. **§4.1 (workspace array + lockfile fix)** — nothing else in this report or in `01`-`05` can be *verified* by automation until Cadence code is even visible to `npm`/`tsc`/`eslint`/`vitest`. Any application refactor landed before this is a refactor with zero automated safety net on the Cadence side, by construction.
2. **§4.2 (root script wiring + minimal test scaffolding in the 3 zero-coverage workspaces)** — immediately after, same PR or next PR. This is what makes "run the tests" mean something for all 9 workspaces.
3. **§4.4 (GitHub Actions, report-only rollout)** — third, so that every subsequent PR (including the other 5 agents' refactor PRs) gets an automatic, visible pass/fail signal instead of relying on someone remembering `npm run ci` locally. Land in report-only mode first specifically *because* the other agents' refactor PRs are coming next and shouldn't be blocked by a backlog of pre-existing failures this workflow surfaces on day one.
4. **§4.3 and §4.5 (lint/format/pre-commit coverage expansion)** — fourth, once CI exists to enforce them; these are individually low-risk and can run in parallel with early application-refactor PRs once §1-3 are done, since they don't change source code, only add gates around it.
5. **§4.6, §4.7, §4.8 (deploy clarity, drift detection, migration tooling)** — P2 items, can proceed in parallel with the application-code refactor work streams from `01`-`05`; none of them block or are blocked by source-level refactors.

**Justification:** every one of the five sibling reports' recommendations depends on being able to trust "the tests still pass" and "the types still check" after a refactor lands. Report `01` makes this explicit for its own AR2/DM1 fix ("Must land after (or alongside) DM1 (CI) so regressions are caught automatically, not manually"); report `05` makes the same point about the workspace-graph fix specifically ("the only way to prevent this exact regression from recurring"). This report's job was to confirm that the safety net itself — workspaces, CI, lint, test scaffolding — has holes in it *before* anyone starts pulling on the threads the other five reports identified. Landing application refactors first, against a repo where Cadence isn't even wired into `npm`, means the riskiest, newest, least-tested product in the monorepo (Cadence) would be refactored with **zero** automated verification of any kind — exactly backwards for a "refactoring-readiness" effort.
