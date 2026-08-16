# ai-manager monorepo

Two products live here:
- **AI Admin** (`backend/`, `frontend/`, `packages/core`) — the auditable AI-operations platform
  (providers, profiles, processing jobs, workflows, diagnostics).
- **Cadence** (`apps/cadence-api`, `apps/cadence-web`, `packages/cadence-shared`) — a
  conversational AI coach app consuming AI Admin **in-process** via `@ai-admin/core`. All AI runs
  through AI Admin jobs/workflows (auditable) — never app-built prompts or bypass relays.

Key docs: [docs/cadence/PLAN.md](docs/cadence/PLAN.md) (living plan + backlog),
[docs/cadence/BRAND.md](docs/cadence/BRAND.md) (canonical brand), 
[docs/cadence/MEMORY-ARCHITECTURE.md](docs/cadence/MEMORY-ARCHITECTURE.md) (context/memory engine).

## Cadence brand (canonical: docs/cadence/BRAND.md — defer to it for any wording decision)

- **Tagline:** *a rhythm you can keep*
- **One-liner:** A coach you just talk to — it listens, remembers you, and turns what you say
  into a rhythm you can keep.
- **Brand promise:** Cadence never makes you repeat yourself and never makes you start over: it
  remembers what you've told it, and when life changes, the plan bends instead of resetting to zero.
- **Positioning:** a **coach**, never a "fitness app". Fitness & nutrition are the *launch focus*,
  not the category — mental health, spiritual practice, creative habits are equally in scope.
  Fitness-first via example order, not taxonomy. Hearth, not scoreboard.
- **Voice:** warm, level, unhyped; the coach speaks as "I"; plain kind words for hard things
  ("burnout", "grief" — no euphemism); count what happened, never what broke (no streak-shame);
  confirm before committing ("here's what I heard — did I get it right?").

### Nomenclature rules (UI label ≠ canonical name is intentional)

Warm words in the UI; boring stable words in schema/prompts. A brand refresh never touches a column.

| Canonical (code/DB/prompts) | User-facing |
|---|---|
| `equipment` (never `tools` in schema/prompts) | "Tools — what you're working with" |
| `constraints` (replaces `injuries`; keep `plan_around`) | "What we work around" |
| `area: movement\|nourishment\|mind\|practice` (replaces goal `category`; `weight` deleted) | copy names the goal, not the area |
| `plan.status: draft → committed` (replaces `locked`) | "Set your rhythm" |
| `consistency` (replaces `adherence`) | "how you showed up this week" |
| `detours` (replaces disruptions) | "Life happened? Let's take a detour" |
| `recap` (replaces weekly readout) | "Your weekly check-in" |
| `Broker` (the Scribe rename is reverted — owner 2026-08-04; a hidden entity, internal only) | UI describes the behaviour ("Cadence takes notes while you talk"), never the entity — to the user there is only the coach |
| unchanged: `coach`, `baseline`, `occurrences`, `milestone/target/recurring` | |

**Banned:** "captured" in user copy; `beats`/`instruments`/`tempo changes` anywhere; `tools` as a
field name; `resources`/`limits` for constraints; streaks that reset to zero; wellness clichés
("unlock", "empower", "journey"). Full veto list + rationale in BRAND.md.

## Engineering conventions

- **File & function size — small by default, enforced in CI.** ESLint gates every workspace:
  `max-lines` 500 (all source) and `max-lines-per-function` 150 (`.ts` logic; `.tsx` render bodies
  are file-capped only). Thresholds live in one place: [`eslint.config.sizes.mjs`](eslint.config.sizes.mjs).
  These run at `error`, so CI (`eslint . --max-warnings 0`) and the pre-commit hook reject any PR
  that lands — or regrows — an oversized file/function. **A new route/tab/major UI section, or a
  distinct responsibility, gets its OWN file from day one; extract a hook/helper/sub-component
  before a file or function grows.** Grandfathered offenders are listed per workspace
  `eslint.config.js` (`'max-lines': 'off'` blocks) — that allowlist IS the refactor backlog; each
  split PR deletes an entry, the target is zero, and you must **never add a new file to it to pass
  CI — split the file instead.** (`ProcessingJobManager.tsx` proved a one-time size fix without a
  guardrail doesn't hold: it grew back 1,420 lines larger.)
- **Adding a coach tool — read the checklist first, every time.**
  [`docs/cadence/TOOL-HARNESS.md`](docs/cadence/TOOL-HARNESS.md) opens with *"Adding a tool: the
  checklist"* — eight steps, marked for which are CI-enforced and which are judgement. The two
  nobody else will catch: **does the dossier already carry this fact** (then it is not a tool, it
  belongs in the context pack), and **which layer** — `ALWAYS_ACTIONS` costs ~190 tokens on every
  message forever, everything else is free until she asks for it. Tool descriptions, categories,
  and declared-equals-executable are gated by `coach-meta-tools.test.ts` and
  `retrieval/description-audit.test.ts`; **what a tool hands BACK is not gated yet**, and that gap
  is what let a crash read as "nothing on file" for weeks. Touching the always-on list means
  running `npm run eval:tools`.
- **Ship / agent workflow:** follow
  [`.cursor/skills/development-workflow/SKILL.md`](.cursor/skills/development-workflow/SKILL.md)
  (CI must be green — or intentionally skipped with a documented reason — before merge and before
  the next refactor batch). Successful backend/`test:e2e` runs soft-clean AI Admin e2e leftovers
  on exit 0; after merge still run `npm run cleanup:test-data` (step 12b — Cadence scratch
  accounts + AI Admin `e2e%` / lifecycle-provider leftovers; never a production wipe). Multi-agent refactor gates:
  [`refactoring_plan.md`](refactoring_plan.md) §6.
- Secrets: NEVER put `aim_sk_` keys in client code, `VITE_*` vars, or committed `.env` files.
  `.env` is gitignored; `.env.example` is tracked with placeholders only.
- Job prompt changes in `config/ai-admin/ai-admin.config.json` are NOT live until synced
  (`apps/cadence-api/scripts/sync-jobs.ts` — jobs-only; `provision-aim.ts` re-syncs profiles too
  and can clobber live model pointers).
- Broker model: strict native json_schema is ~free on OpenAI models, ~2.2× slower on
  gemini via Devs.ai v2 — keep schema-based jobs on gpt-class models.
- Devs.ai silently removes model ids; keep primary AND failover on catalog-verified models
  (`apps/cadence-api/scripts/list-v2-models.ts`).
