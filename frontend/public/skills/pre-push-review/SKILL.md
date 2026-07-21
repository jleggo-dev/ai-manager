---
name: pre-push-review
description: Code and architecture review checklist before commit or PR. Use as step 2 of development-workflow, after implementing changes and before prepush, or when the user asks for a pre-push review.
---

# Pre-push code review

Part of [development-workflow](../development-workflow/SKILL.md) **step 2**. Run **after** `npm run lint` and `npm run typecheck`, **before** writing new tests and `npm run prepush`.

## Quick checklist

Copy and mark each item:

```
Pre-push review
- [ ] Diff scope matches the task — no unrelated Cadence/experimental files
- [ ] No secrets (.env, API keys, aim_sk_) in committed files
- [ ] TypeScript interfaces/types complete (no orphaned fields after edits)
- [ ] Imports at top of file; no inline imports
- [ ] Error handling on new async paths; errors logged with context
- [ ] API/docs updated if routes, edge modes, or config shapes changed
- [ ] frontend/public/ synced if docs or skills changed (via prebuild)
- [ ] Tests added or updated for non-trivial backend behavior
- [ ] npm run lint && npm run typecheck passed
- [ ] npm run prepush passed (workflow step 4)
- [ ] After push: product CI green (`CI gate` + jobs that ran; ignore Vercel Hobby rate-limit)
      before merge / next batch — docs-only path-skip ≠ app healthy
```

## High-risk areas (extra scrutiny)

| Area | Review for |
|------|------------|
| `chat-sessions.ts` | SSE loops, tool fulfillment, session locks, metadata persistence |
| `ai-manager/index.ts` | Provider branches, refreshed session vs stale profile |
| `AiProfileManager.tsx` / large organisms | Broken interfaces, form payload shape, missing `config` fields |
| Edge function + handbook | Mode name parity between `ai-admin-supabase-edge-function.ts` and Lovable docs |
| Migrations | Applied separately; not committed with unrelated app code unless intentional |

## Severity labels in review notes

- **Blocker** — must fix before push/merge (build break, data loss, auth bypass, red CI)
- **Should fix** — correct before merge if time allows
- **Nit** — optional follow-up

CI is not optional: failing **product** PR or base-branch checks (`CI gate` / non-skipped
`ai-admin` / `cadence` / `format:check`) block merge and block starting the next refactor batch.
Vercel Hobby rate-limit red is not a product failure. Docs-only path-skip green is not “app
healthy.” See [development-workflow](../development-workflow/SKILL.md) steps 7, 11–12 and
[ci-signals-and-merge-batching](../../rules/ci-signals-and-merge-batching.mdc).

## Common regressions (this repo)

1. **Partial interface edit** — adding a new `interface` but leaving body lines from the old one (causes Vite "Unexpected `:`").
2. **docs/ without public mirror** — edit `docs/*` but forget sync (run frontend build or `npm run sync:docs --workspace=frontend`).
3. **Pushing without backend `tsc`** — frontend-only typecheck misses backend-only changes on monorepo branches.
4. **Cadence leakage** — `apps/`, `config/cadence`, `docs/cadence` unless the task explicitly includes them.

## Output format

When reporting review results to the user:

```markdown
## Pre-push review

**Verdict:** Ready to push | Fix blockers first

### Blockers
- ...

### Should fix
- ...

### QA run
- prepush: pass/fail (paste first error if fail)
```
