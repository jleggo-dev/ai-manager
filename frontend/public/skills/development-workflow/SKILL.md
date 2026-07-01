---
name: development-workflow
description: End-to-end AI Admin development workflow from implementation through QA, PR, team-lead review, fix loop, and merge. Use when finishing a feature, before commit/push, opening or updating a PR, or when the user asks for the dev workflow, ship checklist, or merge readiness.
---

# AI Admin development workflow

Follow these steps **in order** for every feature or fix. Do not skip ahead to push/merge until the current step passes.

```
Implement → Review & lint → Tests → Regression → PR → TL review → Fix → (loop) → Merge
```

## Step 1 — Develop

- Implement the smallest correct diff; match existing conventions in touched files.
- Keep scope tight — exclude unrelated work (e.g. Cadence `apps/`, `config/cadence` unless explicitly in scope).
- Backend behavior belongs in `backend/`; do not compensate only in the frontend.

**Exit:** Code compiles locally; you can describe what changed and why.

---

## Step 2 — Review before commit (ESLint + architecture)

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

## Step 3 — Tests for new code

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

Live E2E tests (e.g. `e2e-devs-ai-v2-*.test.ts`) need `DEVS_AI_API_KEY` / Supabase — skip with clear note if unset; do not treat skip as pass for risky paths.

**Exit:** New behavior has tests; new and affected tests pass.

---

## Step 4 — Regression + functional gate

Full pre-push gate (matches Vercel backend + frontend builds):

```powershell
npm run prepush
```

`prepush` runs: `typecheck` → `format:check` → `lint` → backend `tsc` → frontend lint + Vite build → full backend test suite.

**Local frontend build note:** Unset `VITE_DEV_API_KEY` before build if Vite errors about secrets in the client bundle.

**Exit:** `prepush` exits 0.

---

## Step 5 — Commit, push, create PR

Only after steps 2–4 pass.

1. `git status` / `git diff` — confirm staged files match the task.
2. Commit with a clear message (why, not only what).
3. `git push -u origin HEAD`
4. Create or update PR:

```powershell
gh pr create --title "..." --body "..."
# or gh pr edit for updates
```

Include in PR body: summary, test plan checklist, any env/migration notes.

**Exit:** PR URL exists; CI triggered.

---

## Step 6 — Team lead / architect PR review

Act as TL on the **full PR diff** (all commits), not only the latest.

Apply [pr-tl-review](../pr-tl-review/SKILL.md).

### 6a — Security, performance, build (mandatory)

| Lens | Check |
|------|--------|
| **Security** | Auth on new routes; no API keys in client; RLS/tenant; user credential isolation; SSRF/path injection in attachments |
| **Performance** | N+1 queries; unbounded loops (SSE, tool rounds); large payloads in hot paths |
| **Build / CI** | Vercel services (`backend` tsc, `frontend` vite); both workspaces; no broken exports; interface syntax in TSX |

Also watch: `chat-sessions` locks/409, provider metadata, jobs-as-tools loops.

**Exit:** Written TL review with verdict: **Approve** | **Changes requested**.

---

## Step 7 — Fix PR issues

Address all **blockers** and agreed **should-fix** items from step 6.

**Exit:** Fixes committed on the same branch.

---

## Step 8 — Loop until clean

Return to **step 2** (lint + architecture review), then **3–4** (tests + `prepush`), push updates, re-run **step 6**.

Repeat until:

- `npm run prepush` passes
- TL review has no blockers
- PR CI green (`gh pr checks` or CI watcher)

**Do not merge while CI is failing or blockers remain.**

---

## Step 9 — Merge

When PR is approved and CI is green:

```powershell
gh pr merge --squash
# or merge strategy your team uses
```

Post-merge: note any ops steps (migrations, env vars, provider setup) for the user.

---

## Quick reference — npm scripts

| Script | When |
|--------|------|
| `npm run lint` | Step 2 |
| `npm run typecheck` | Step 2 |
| `npm run prepush` | Step 4 (and after each fix loop) |
| `npm test` | Steps 3–4 |
| `npm run test:e2e` | Step 3 when chat/API/integration touched |
| `npm run ci` | Stricter than prepush (no Vite build); optional extra gate |

## Child skills

| Skill | Step |
|-------|------|
| [pre-push-review](../pre-push-review/SKILL.md) | 2 — diff/architecture checklist |
| [pre-push-qa](../pre-push-qa/SKILL.md) | 4 — prepush commands detail |
| [pr-tl-review](../pr-tl-review/SKILL.md) | 6 — TL security/performance/build review |
