# INFRA-P2 — Config-as-code drift detection

**Status:** Implemented (dry-run content compare + schedule-only workflow skeleton)  
**Date:** 2026-07-20  
**Pointer:** report 06 §4.7 · risk register “prod credentials on PR CI”

## Problem

`config/ai-admin/ai-admin.config.json` is the source of truth for Cadence job prompts/schemas, but live AI Admin is updated only when someone runs `sync-jobs.ts` / `provision-aim.ts`. Silent divergence = production coach/Scribe behavior that no longer matches git.

## What already existed

- `POST /api/sync` with `dryRun: true` (`backend/src/services/config-sync.ts`)
- CLI `backend/scripts/ai-admin-sync.mjs --dry-run`

**Gap:** dry-run only checked *existence* (every existing slug → `update`), so it could not tell “identical” from “prompt drifted”.

## What INFRA-P2 adds

1. **Content-aware dry-run** — compares name/description/config (and resolved ids when not placeholders); identical → `skip`, different → `update`, missing → `create`. Placeholders like `<CADENCE_BROKER_PROFILE_UUID>` are ignored so unresolved cross-refs do not false-positive.
2. **`sync-jobs.ts --dry-run [--fail-on-drift]`** — Cadence’s preferred jobs-only path (does not clobber live profile model pointers). Exit `2` on create/update when `--fail-on-drift`.
3. **`ai-admin-sync.mjs --fail-on-drift`** — same exit semantics for full config files; loads `backend/.env`; appends `/_/backend` for Vercel hosts.
4. **Scheduled workflow** `.github/workflows/config-drift-check.yml` — `schedule` + `workflow_dispatch` **only**. Never `pull_request`. Secrets stay out of `ci.yml`.

## Job `config` write semantics (intentional)

- **`PUT /api/processing-jobs/:id`** still **deep-merges** `config` so partial UI/API patches keep sibling keys.
- **`POST /api/sync` / `sync-jobs.ts`** **replaces** `config` wholesale (`replaceConfig: true`). Nested keys removed in `ai-admin.config.json` (e.g. `expectedSchema.fields.needs`) are deleted on live — deep-merge alone never removed them and left permanent drift after sync.

## Operator setup

1. Add GitHub Actions secrets `AI_ADMIN_API_KEY` and `AI_ADMIN_BASE_URL` (live AI Admin).
2. Optionally bind them to a `config-drift` Environment with no PR access.
3. Confirm a manual `workflow_dispatch` run; then rely on the daily cron.

## Local

```powershell
node --import tsx apps/cadence-api/scripts/sync-jobs.ts --dry-run --fail-on-drift
```

## Alerting (follow-on)

Workflow failure is the v1 signal (email/GitHub UI). Slack webhook or auto-opened issue can come later without changing the credential boundary.
