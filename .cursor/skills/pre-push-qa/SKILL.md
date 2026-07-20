---
name: pre-push-qa
description: Runs pre-push quality gates matching Vercel CI before git push. Use as step 4 of development-workflow, when committing, pushing to GitHub, opening a PR, or when the user asks to verify the build or run QA before push.
---

# Pre-push QA (AI Admin)

Part of [development-workflow](../development-workflow/SKILL.md) **step 4**. Run after lint/review
(steps 2–3) as the local test + regression gate.

## Required commands (PowerShell)

From repo root `c:\dev\ai-manager`:

```powershell
npm run prepush
```

Or run individually if debugging a failure:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run build --workspace=backend
npm run vercel:build:frontend
npm test
```

### What `npm run prepush` runs

| Step | Catches |
|------|---------|
| `format:check` | Prettier drift |
| `lint` | ESLint backend + frontend |
| `typecheck` | TS errors (e.g. broken interfaces) |
| `build --workspace=backend` | Vercel backend `tsc` |
| `vercel:build:frontend` | Frontend ESLint + Vite production build |
| `npm test` | Backend unit/integration regressions |

## Frontend build gotcha (local)

Vite fails if `VITE_DEV_API_KEY` is set during production build. Unset it or remove from `backend/.env` before `vercel:build:frontend` locally. Vercel CI does not have this key.

## After code changes

1. Complete [development-workflow](../development-workflow/SKILL.md) steps 2–3 first.
2. Run `npm run prepush` (step 4). Local green is required before push — not optional.
3. If you edited `docs/` or `.cursor/skills/`, `prebuild` syncs to `frontend/public/` during frontend build.
4. Commit/push and open/update PR so CI runs (workflow steps 6–7). Local `prepush` does **not**
   replace GitHub Actions — PR checks must still go green (or be intentionally skipped with a
   documented reason) before merge and before starting the next refactor batch.
5. Then [pr-tl-review](../pr-tl-review/SKILL.md) (workflow step 9).
6. After merge: [development-workflow](../development-workflow/SKILL.md) **step 12b** —
   `npm run cleanup:test-data` (Cadence scratch accounts + AI Admin `e2e%` / lifecycle-provider leftovers). Do not start
   the next batch with stale test data still in the shared dev DBs.

## On failure

- Fix the root cause; do not skip checks with `--no-verify` unless the user explicitly requests it.
- Re-run the **full** `npm run prepush`, not only the failed sub-step.
- Report which command failed and the first actionable error line.
- Never leave CI red and move on. "Report-only" branch protection still means treat failing jobs as
  blockers unless quarantined with an explicit human action item.
