# Cadence — AI Admin config-as-code

Declarative definitions for the AI Admin entities Cadence drives: AI profiles
(`cadence-coach`, `cadence-broker`, plus pinned Gemini vision for photo jobs),
processing jobs (Broker/Coach jobs from spec §C4, nutrition Observe jobs, Req 5
food-capture jobs), and the `cadence-replan` workflow. Synced idempotently by slug.

## Why this matters in the monorepo

Per spec §8.1, config-as-code matters **more** in a monorepo: the AI behavior
(prompt templates, schemas, build rules, workflow wiring) lives in version control
next to the app that depends on it, instead of being clicked together in an admin UI.

## Provisioning order (cross-references are by UUID)

`provider_id`, `ai_profile_id`, and `processing_job_id` are validated as UUIDs and
must point at entities that already exist. So fill the `<PLACEHOLDER>` tokens in
`ai-admin.config.json` in passes:

1. **Provider** — in the AI Admin admin UI, create one **Devs.ai** provider with its
   encrypted API key. Devs.ai brokers both Claude and Gemini models, so this single
   provider/key covers Coach (Claude) and Broker (Gemini). Copy its UUID into `provider_id`
   and `failover_provider_id` on both profiles.
2. **Register the calling app** — `POST /api/calling-applications` with
   `platform:cadence` (400s on every call without it).
3. **Sync profiles** — `node backend/scripts/ai-admin-sync.mjs config/ai-admin/ai-admin.config.json --dry-run`
   to preview (content-aware: `skip` = already matches, `update`/`create` = would write), then
   without `--dry-run`. Copy the created profile UUIDs into the jobs' `ai_profile_id` and the
   workflow's `ai_profile_id`.
4. **Sync jobs (preferred for day-to-day prompt edits)** —
   `node --import tsx apps/cadence-api/scripts/sync-jobs.ts` (jobs only — does not clobber live
   profile model pointers). Preview / CI:
   `… sync-jobs.ts --dry-run --fail-on-drift`. See [`docs/infra/CONFIG-DRIFT.md`](../../docs/infra/CONFIG-DRIFT.md).

### Req 5 — Food capture + recipe jobs (WS2 / WS3)

| Slug                    | Profile                                                               | Contract                                                                               |
| ----------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `parse-nutrition-label` | **Pinned Gemini vision** (same UUID as `parse-meal` / `plate-advice`) | Label photo → `serving_*` + `macros_per_serving` (+ printed micros) + `confidence`     |
| `identify-food`         | **Pinned Gemini vision**                                              | Front-of-pack photo → `name` + `brand` + `confidence`                                  |
| `estimate-food`         | Broker (Flash)                                                        | Describe-a-food text → canonical serving + macro estimate + `confidence` (macros only) |
| `structure-recipe`      | Coach                                                                 | Recipe-from-chat text → `{ name, servings, ingredients[{name,qty,unit}], steps? }`     |

Runtime resolves jobs **by slug** via `runJobBySlug` — no `AIM_JOB_*` env vars required (same
pattern as `parse-meal`). After this config lands on `main`, an operator syncs live with
**jobs-only** sync (includes `structure-recipe`):

```powershell
node --import tsx apps/cadence-api/scripts/sync-jobs.ts --dry-run
node --import tsx apps/cadence-api/scripts/sync-jobs.ts
```

Do **not** use `provision-aim.ts` for prompt-only updates — it can re-sync profiles and clobber
live model pointers.

5. **Sync the workflow** — re-run `ai-admin-sync.mjs` once job UUIDs are filled into
   `steps[].processing_job_id`.
6. **Wire env** — put the resulting profile/job ids + `AIM_WORKSPACE_ID` into
   `apps/cadence-api/.env` (see its `.env.example`).

> The CLI reads `AI_ADMIN_BASE_URL` and `AI_ADMIN_API_KEY` (an `aim_sk_` for the admin
> surface) from env. This key is for **provisioning only** — Cadence's runtime path is
> in-process and uses no `aim_sk_`.

## Model & agent choices (Devs.ai)

Devs.ai brokers any model and supports custom **agents** (tuned/tool-equipped). No
limit on how many profiles/agents we create.

- **`cadence-coach`** — **`anthropic-claude-4-5-sonnet`** (Devs.ai), chat mode,
  `temperature: 0.7`. Cost/quality balance for the bounded-context coaching loop (§4.3);
  streaming. Failover → `claude-opus-4-6`. (Devs.ai's catalog has no Sonnet 4.6; 4.5 is the
  latest Sonnet.) _Plan-quality lever:_ `synthesize-plan` is a **separate job** — point it at
  a `cadence-planner` profile on `claude-opus-4-6` if synthesis needs more muscle;
  backstopped by `plan_vet` + confirm-before-lock. _Agent upgrade path:_ a tuned Devs.ai
  agent with `config.toolJobs[]` lets the Coach call Broker jobs as tools natively (v1.4.0).
- **`cadence-broker`** — **`gemini-2.0-flash` via the Devs.ai provider**, `temperature: 0.1`.
  Cheapest for the always-on hot path. **Do NOT use the native `google-gemini` provider** —
  it rejected the id; Devs.ai serves Gemini under the same key. Failover →
  `anthropic-claude-4-5-haiku`.
- **`cadence-research`** (add later) — a Devs.ai **agent with web search** for recipe
  ideas + how-to-video lookup (§C2). Keep weather a deterministic API, not an LLM call.

Model ids are **vendor-prefixed** in Devs.ai (e.g. `anthropic-claude-4-5-sonnet`); Gemini is
served under `gemini-*` ids through the Devs.ai key. List them via `GET /api/providers/:id/models`.
Keep prompts model-agnostic so they survive failover (per
`prompt-engineering/references/model-selection.md`).

## Notes / things to verify against the live backend

- **Build-rule `options` shapes** (e.g. `require-keys` → `{ keys: [...] }`) are drafted
  from the v1.4.0 changelog. Confirm exact option keys in
  `backend/src/services/formatting-rules.ts` before relying on them.
- **Flat top-level JSON**: kept per spec §C4. v1.4.0 also supports **nested**
  `outputMappings` (dot/bracket paths) if a schema ever needs nesting — the spec's
  "top-level only" rule is now a _can_, not a _must_.
- **`plan_vet` / `synthesize_plan`** are also runnable standalone via
  `POST /api/processing-jobs/:id/test`; the `cadence-replan` workflow chains them.
