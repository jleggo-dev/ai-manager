# INFRA-P2 — Migration tooling consolidation

**Status:** Plan / notes (not a cutover)  
**Date:** 2026-07-20  
**Pointer:** report 06 §4.8 · `refactoring_plan.md` INFRA-P2 · AR5

## Current state (verified)

| Product | SQL on disk | Apply mechanism | Gap |
|---|---|---|---|
| **AI Admin** | `migrations/006_*.sql` … `012_*.sql` (7 files) | Manual SQL in Supabase SQL editor (no CLI runner) | **`001`–`005` missing** but still referenced in root `README.md` (`005_user_settings_display_name.sql`) |
| **Cadence** | `migrations/cadence/0001_init.sql` … `0013_*.sql` (13 files) | One-off TS scripts `apps/cadence-api/scripts/apply-migration-0005.ts` … `0013.ts` (9 scripts; earlier migrations applied ad hoc) | No generic “apply pending” runner; each new migration tends to get another bespoke script |
| **Tooling** | No `supabase/migrations/` folder, no Knex/Prisma | — | AR5 still open for both products |

Two separate Supabase projects (AI Admin vs Cadence/`cadence` schema on the Spartan Tracker project) — any consolidation must keep **two** linked projects, not one shared migration stream.

## Target state

Adopt **Supabase CLI** migrations for both products:

- AI Admin → `supabase/ai-admin/migrations/` (or a dedicated CLI project dir)
- Cadence → `supabase/cadence/migrations/` (schema `cadence`)

Retire per-migration `apply-migration-NNNN.ts` scripts in favor of `supabase db push` / `supabase migration up`. Add a CI check later (`supabase db diff --linked`) so uncommitted schema drift fails the build — **only** with linked non-prod credentials, never prod write keys on PR CI.

## Phased cutover (do not big-bang)

### Phase A — Document + reconstruct history (this ticket’s notes)

1. **Stop telling people to apply missing files.** Update root `README.md` to point at the oldest *tracked* migration (`006_…`) and this doc for the `001`–`005` gap.
2. **Reconstruct `001`–`005` as baseline snapshots**, not archaeology:
   - Prefer `supabase db dump --schema public` (or Table Editor export) from a known-good AI Admin DB into a single `000_baseline.sql` (or numbered `001`…`005` stubs that say “applied historically; see baseline”).
   - Goal: new environments can reach the same schema as prod without tribal knowledge. Exact original file text is optional.
3. Keep applying Cadence SQL via existing scripts until Phase C — do not break the working path.

### Phase B — CLI project scaffolding (follow-on PR)

1. `supabase init` per product (two configs / two linked remotes).
2. Move tracked `.sql` into CLI folders **without changing SQL** (copy + dual-path for one release).
3. Document `supabase link` + required roles; never commit access tokens.

### Phase C — Retire one-off apply scripts

1. New Cadence migrations only via `supabase migration new`.
2. Delete `apply-migration-*.ts` once `db push` is proven on staging.
3. Optional CI: `db diff` against a **staging** linked project on schedule or main-only — same credential hygiene as config-drift (no PR fork access).

## Explicit non-goals for the INFRA-P2 slice that shipped with this plan

- No production schema writes from CI
- No forced rewrite of historical Cadence `0001`–`0013` contents
- No merging AI Admin and Cadence into one Supabase project

## Related artifacts

- Deploy targets: [`docs/cadence/DEPLOY.md`](../cadence/DEPLOY.md)
- Config drift (jobs): `.github/workflows/config-drift-check.yml` + `apps/cadence-api/scripts/sync-jobs.ts --dry-run --fail-on-drift`
