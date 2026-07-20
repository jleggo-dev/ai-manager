---
name: development-workflow
description: End-to-end AI Admin development workflow from implementation through QA, PR, CI-green gate, team-lead review, fix loop, and merge. Use when finishing a feature, before commit/push, opening or updating a PR, or when the user asks for the dev workflow, ship checklist, or merge readiness.
---

# AI Admin development workflow

Follow these steps **in order** for every feature, fix, or refactor batch. Do not skip ahead to
merge — and do not start the next batch — while CI is red.

```
Code → Review → Fix? → Test (local; AI Admin e2e cleanup on success) → Fix? → Commit/push (CI on PR)
  → Fix until CI green → PR open/updated → Review → Fix? → Merge (checks pass)
  → Confirm base branch green → Post-merge test-data cleanup → (prod/release later) → Done
```

**Source of truth for ship gates.** Child skills detail commands/checklists; this skill owns the
order and the non-negotiable CI rules.

---

## Step 1 — Code

- Implement the smallest correct diff; match existing conventions in touched files.
- Keep scope tight — exclude unrelated work (e.g. Cadence `apps/`, `config/cadence` unless
  explicitly in scope).
- Backend behavior belongs in `backend/`; do not compensate only in the frontend.

**Exit:** Code compiles locally; you can describe what changed and why.

---

## Step 2 — Review (lint + architecture)

### Automated

From repo root (PowerShell):

```powershell
npm run format:check
npm run lint
npm run typecheck
```

Fix all errors. Use `npm run lint:fix` and `npm run format` only when appropriate; re-run checks after.

### Cursory architecture review

Apply [pre-push-review](../pre-push-review/SKILL.md). Confirm:

- Correct layer (routes → services → models; UI → `api.ts` → backend)
- No secrets in diff; auth/tenant scoping on new routes
- Types/interfaces complete (no orphaned interface bodies)
- Docs/skills synced if API or integration shapes changed

**Exit:** Lint + typecheck clean; no **blockers** from architecture review.

---

## Step 3 — Fix (if review found issues)

Address blockers from step 2. Re-run lint/typecheck. Loop until exit criteria for step 2 hold.

---

## Step 4 — Test (local)

### Write tests

| Change type | Add/update |
|-------------|------------|
| New service/util | Unit test in `backend/test/*.test.ts` |
| New route behavior | Route or integration test |
| SSE/tool loops, providers | Focused unit tests + live E2E if env keys exist |
| Frontend logic | `frontend` vitest if non-trivial |

### Run targeted tests first

```powershell
# Example: only files you touched
npm test -- --run backend/test/your-feature.test.ts
npm test -- --workspace=frontend   # if frontend tests exist for the change
```

### Run E2E when relevant

```powershell
npm run test:e2e
```

Live E2E tests (e.g. `e2e-devs-ai-v2-*.test.ts`) need `DEVS_AI_API_KEY` / Supabase — skip with clear
note if unset; do not treat skip as pass for risky paths.

### Automatic cleanup after successful tests

Backend and root E2E scripts run AI Admin leftover cleanup **only when the suite exits 0**
(`vitest run && cleanup…`). Failed runs skip cleanup so junk remains for debugging.

| Command | Cleanup on success |
|---------|-------------------|
| `npm run test --workspace=backend` (or `npm run test:backend`) | `cleanup:e2e-ai-admin:soft` (e2e% rows + lifecycle/test-named providers/profiles/jobs) |
| `npm run test:e2e` | same soft cleanup |
| `npm run test:no-cleanup --workspace=backend` | none (debug) |
| `SKIP_TEST_DATA_CLEANUP=1` on any of the above | skip cleanup even on success |

Cadence scratch-account reset is **not** part of the post-test hook — use full
`npm run cleanup:test-data` after merge (step 12b) or when you intentionally want account-1/2 wiped.

### Regression + functional gate

Full pre-push gate (matches Vercel backend + frontend builds) — see
[pre-push-qa](../pre-push-qa/SKILL.md):

```powershell
npm run prepush
```

`prepush` runs: `typecheck` → `format:check` → `lint` → backend `tsc` → frontend lint + Vite
build → full backend test suite (which cleans AI Admin e2e leftovers on success).

**Local frontend build note:** Unset `VITE_DEV_API_KEY` before build if Vite errors about secrets
in the client bundle.

**Exit:** New behavior has tests; new/affected tests pass; `prepush` exits 0.

---

## Step 5 — Fix (if local tests failed)

Fix root causes; re-run the failing suite and then full `npm run prepush`. Do not push with a red
local gate.

---

## Step 6 — Commit → CI runs on the PR

Only after steps 2–5 pass.

1. `git status` / `git diff` — confirm staged files match the task.
2. Commit with a clear message (why, not only what).
3. `git push -u origin HEAD`
4. Open or update a PR so GitHub Actions can run (if not already open):

```powershell
gh pr create --title "..." --body "..."
# or gh pr edit for updates
```

Include in PR body: summary, test plan checklist, any env/migration notes.

**Exit:** PR URL exists; CI triggered on the PR.

---

## Step 7 — Fix until CI is green

Watch PR checks (`gh pr checks` or CI watcher). **Every job that runs must pass**, or be
**intentionally skipped** with a documented reason (e.g. quarantined flaky suite + human action
item such as key rotation).

- Never leave jobs **red** and move on to the next task or batch.
- CI is a **required** branch-protection gate on `main` (INFRA-02 flip Done) — failing checks block merge.
- Fix, push, re-check until green (or documented skip). Loop as needed.

**Exit:** All non-skipped PR checks green; any skip has a written reason + owner.

---

## Step 8 — Create/update PR (if not already open for CI)

If step 6 only pushed without a PR, open it now. Keep the PR description current after CI fixes.

**Exit:** PR ready for human/TL review; description matches final diff.

---

## Step 9 — Team lead / architect PR review

Act as TL on the **full PR diff** (all commits), not only the latest.

Apply [pr-tl-review](../pr-tl-review/SKILL.md).

### 9a — Security, performance, build (mandatory)

| Lens | Check |
|------|--------|
| **Security** | Auth on new routes; no API keys in client; RLS/tenant; user credential isolation; SSRF/path injection in attachments |
| **Performance** | N+1 queries; unbounded loops (SSE, tool rounds); large payloads in hot paths |
| **Build / CI** | Vercel services (`backend` tsc, `frontend` vite); both workspaces; no broken exports; interface syntax in TSX; **PR checks green** |

Also watch: `chat-sessions` locks/409, provider metadata, jobs-as-tools loops.

**Exit:** Written TL review with verdict: **Approve** | **Changes requested**.

---

## Step 10 — Fix (if review requested changes)

Address all **blockers** and agreed **should-fix** items. After fixes: return through steps 2–4
locally as needed, push, and **re-enter step 7** until CI is green again.

**Exit:** Fixes committed; CI green; no open blockers.

---

## Step 11 — Merge only when PR checks pass

When PR is approved **and** CI is green (or remaining failures are explicitly quarantined with a
documented human action item):

```powershell
gh pr merge --squash
# or merge strategy your team uses
```

**Do not merge while CI is failing or blockers remain.**

Post-merge: note any ops steps (migrations, env vars, provider setup) for the user.

---

## Step 12 — Confirm base branch green before the next batch

During the Cadence/refactor effort the integration branch is `feat/cadence` (otherwise the team's
current base).

Before starting the **next** parallel batch or assigning the next backlog item:

1. Confirm the integration branch's latest CI is green (or failures are quarantined with a human
   action item — not silently ignored).
2. Multi-agent refactor orchestration: **do not start the next parallel batch until CI on the
   integration branch is green** under that same rule.

See [refactoring_plan.md](../../../refactoring_plan.md) §6 for orchestrator/supervisor rules.

**Exit:** Base/integration branch is green (or explicitly quarantined); safe to assign next work.

---

## Step 12b — Post-merge test-data cleanup (before Done / next batch)

After merge (and before marking Done or starting the next refactor batch), clear **local/dev
scratch and E2E leftovers** so the next demo/onboarding pass starts clean. Prefer existing
scripts; never wipe production or real-auth users.

Successful local backend / `test:e2e` runs already clean AI Admin e2e leftovers (step 4). Still
run the **full** wipe here so Cadence scratch accounts are reset and any junk from failed test
runs or manual UI experiments is cleared.

### What to clean

| Surface | Safe target | Command (repo root, PowerShell) |
|---------|-------------|-----------------------------------|
| Cadence scratch accounts (`account-1` / `account-2`) | Allowlisted UUIDs only | `npm run cleanup:cadence-dev-accounts` |
| AI Admin E2E leftovers | `calling_application` / `display_name` LIKE `e2e%`; plus providers/profiles/jobs matching lifecycle & test name patterns (never by `type` alone) | Dry-run: `npx tsx backend/scripts/cleanup-e2e-test-data.ts` then `npm run cleanup:e2e-ai-admin` |
| Both | Same as above | `npm run cleanup:test-data` |

Also useful: `node --import tsx apps/cadence-api/scripts/account.ts list` (inventory) /
`reset <slug>`; in-app `POST /dev/reset` when `CADENCE_DEV_USER_ID` is set.

### Safeties

- Requires local `.env` credentials (`apps/cadence-api/.env`, `backend/.env`). **Never commit
  secrets; never print full keys.**
- Cadence reset only touches allowlisted scratch accounts — not real JWT users.
- AI Admin cleanup deletes `e2e%` tagged rows (sessions, diagnostic logs, calling apps) **and**
  ephemeral providers/profiles/jobs whose **names** match test patterns (e.g. `V1 Lifecycle
  Provider*`, `E2E * Provider*`). It does **not** delete by provider type — real `Devs.ai`,
  `Devs.ai v2`, and `Google Gemini` rows are protected by exact-name guard.
- If you cannot tell **dev vs production**, or the workspace/project looks wrong — **stop and
  ask** rather than guessing a destructive wipe.

**Exit:** Scratch accounts at zero rows (or intentionally kept for a demo); E2E inventory dry-run
shows nothing left (or leftovers documented).

---

## Step 13 — Prod / release verification (later gate)

Deploy/smoke verification in prod or a release environment is a **later** gate. It does **not**
block every refactor batch merge, but it must happen before calling a release "shipped."

---

## Step 14 — Done

Item/batch is complete for merge purposes when steps 1–12 are satisfied **and** step 12b
test-data cleanup has run (or was explicitly skipped with a written reason, e.g. intentional
demo seed kept). Mark backlog status (`Done` / later `Verified` after smoke) per the living
plan when applicable.

---

## Quick reference — npm scripts

| Script | When |
|--------|------|
| `npm run lint` | Step 2 |
| `npm run typecheck` | Step 2 |
| `npm run prepush` | Step 4 (and after each fix loop) |
| `npm test` | Steps 4–5 (backend suite auto-cleans AI Admin e2e leftovers on success) |
| `npm run test:backend` | Step 4 — backend only (+ soft e2e cleanup on success) |
| `npm run test:e2e` | Step 4 when chat/API/integration touched (+ soft e2e cleanup on success) |
| `npm run cleanup:test-data` | Step 12b — Cadence scratch accounts + AI Admin `e2e%` / lifecycle-provider leftovers |
| `npm run ci` | Stricter than prepush (no Vite build); optional extra gate |
| `gh pr checks` | Steps 7, 11, 12 |

## Child skills

| Skill | Step |
|-------|------|
| [pre-push-review](../pre-push-review/SKILL.md) | 2 — diff/architecture checklist |
| [pre-push-qa](../pre-push-qa/SKILL.md) | 4 — prepush commands detail |
| [pr-tl-review](../pr-tl-review/SKILL.md) | 9 — TL security/performance/build review |
