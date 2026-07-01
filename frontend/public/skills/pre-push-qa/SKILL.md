---
name: pre-push-qa
description: Runs pre-push quality gates matching Vercel CI before git push. Use when committing, pushing to GitHub, opening a PR, or when the user asks to verify the build or run QA before push.
---

# Pre-push QA (AI Admin)

Run these checks **before every `git push`**. Do not push until all required steps pass.

## Required commands (PowerShell)

From repo root `c:\dev\ai-manager`:

```powershell
npm run prepush
```

Or run individually if debugging a failure:

```powershell
npm run typecheck
npm run build --workspace=backend
npm run vercel:build:frontend
npm test
```

### What each step mirrors

| Step | Catches |
|------|---------|
| `typecheck` | TS errors in backend + frontend (e.g. broken interfaces) |
| `build --workspace=backend` | Vercel backend service `tsc` |
| `vercel:build:frontend` | Frontend ESLint + Vite production build (same as Vercel frontend) |
| `npm test` | Backend unit/integration regressions |

## Frontend build gotcha (local)

Vite fails if `VITE_DEV_API_KEY` is set during production build. Unset it or remove from `backend/.env` before `vercel:build:frontend` locally. Vercel CI does not have this key.

## After code changes

1. Run `npm run prepush`.
2. If you edited `docs/` or `.cursor/skills/`, `prebuild` syncs to `frontend/public/` automatically during frontend build.
3. Apply [pre-push-review](../pre-push-review/SKILL.md) on the diff.
4. Only then: `git push`.

## On failure

- Fix the root cause; do not skip checks with `--no-verify` unless the user explicitly requests it.
- Re-run the **full** `npm run prepush`, not only the failed sub-step.
- Report which command failed and the first actionable error line.
