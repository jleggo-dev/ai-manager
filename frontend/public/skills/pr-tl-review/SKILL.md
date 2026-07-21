---
name: pr-tl-review
description: Team-lead and architect review of an AI Admin pull request — security, performance, build risk, and maintainability. Use at step 9 of the development workflow, when reviewing a PR before merge, or when the user asks for TL review, architect review, or merge readiness on a branch.
---

# PR team-lead review (AI Admin)

Review the **entire PR** (all commits vs base branch), not only the latest commit. Produce a written verdict before merge.

Pair with [development-workflow](../development-workflow/SKILL.md) steps 7–11 (CI green → TL review → fix → merge).

## Gather context

```powershell
git fetch origin
gh pr view --json title,body,url,baseRefName,headRefName
git diff origin/<base>...HEAD --stat
gh pr checks
```

Read changed files in hot paths (see below). Confirm `npm run prepush` and PR CI status.

## Review checklist

```
TL PR review
- [ ] Intent: PR matches stated goal; no scope creep
- [ ] Security (see table below)
- [ ] Performance (see table below)
- [ ] Build / CI: backend tsc + frontend vite; no TS/ESLint regressions
- [ ] Tests: new behavior covered; E2E updated if integration surface changed
- [ ] Docs: API.md, INTEGRATION.md, edge function, skills if contracts changed
- [ ] Migrations: safe, applied plan documented
- [ ] Operability: logging sufficient to debug production issues
```

## Security (6a)

| Area | Questions |
|------|-----------|
| **Auth** | Every new `/api/*` route behind auth? JWT ownership rules for session writes? |
| **Secrets** | No `aim_sk_`, provider keys, or `.env` in diff? No secrets in `VITE_*`? |
| **Tenant** | `workspace_id` / RLS respected? Service role only where intended? |
| **User credentials** | Personal keys isolated per user? |
| **Input** | Validated bodies (zod schemas)? Attachment/path injection? Tool output size limits? |
| **SSE / chat** | Session lock prevents concurrent abuse? Tool fulfillment cannot run arbitrary jobs? |

Flag **blocker** for any auth bypass, cross-tenant leak, or secret exposure.

## Performance (6a)

| Area | Questions |
|------|-----------|
| **Database** | N+1 in loops? Missing limits on list endpoints? |
| **LLM / SSE** | Timeouts set? Tool loop bounded (max rounds)? Stream accumulation memory-safe? |
| **Payloads** | Huge job variables or chat history without compaction? |
| **Frontend** | Unnecessary re-renders in large organisms? |

Flag **should-fix** unless user-visible latency or cost impact is clear (**blocker**).

## Build & CI (6a)

| Check | Failure mode |
|-------|----------------|
| `npm run build --workspace=backend` | Vercel backend service fails |
| `npm run vercel:build:frontend` | Vercel frontend fails (ESLint + Vite) |
| Broken TS interfaces in `.tsx` | Vite esbuild "Unexpected :" |
| `test/**` included in backend `tsc` | Local-only errors can block CI |
| Monorepo imports | Wrong workspace paths |

Require green **product** PR checks (`CI gate` + jobs that ran). A failing non-skipped product
job is a **blocker** unless intentionally skipped/quarantined with a documented reason and human
action item. **Vercel Hobby build rate-limit** is **not** a blocker and must not prompt Hobby
setting changes. Docs-only PRs with all product jobs skipped are fine to merge as docs — do not
call that “app verified.” Report-only CI does **not** mean ignore product red.

## Maintainability

- Files > ~1k lines: prefer focused helpers (see `v2-stream-events.ts` pattern).
- Provider-specific logic stays in integrations, not scattered in routes.
- Exhaustive handling for provider/type unions where applicable.

## Verdict format

```markdown
## TL PR review — PR #N

**Verdict:** Approve | Changes requested

### Blockers (must fix before merge)
1. ...

### Should fix
1. ...

### Security notes
- ...

### Performance notes
- ...

### Build / CI
- prepush: pass/fail
- PR checks: [link or summary]

### Nice to have
- ...
```

## After review

- **Changes requested** → implement fixes → return to [development-workflow](../development-workflow/SKILL.md) step 2, then re-enter the CI gate (step 7).
- **Approve** + green CI → proceed to merge (step 11); confirm integration branch green (step 12);
  run **step 12b** test-data cleanup (`npm run cleanup:test-data`) before Done / next batch.
