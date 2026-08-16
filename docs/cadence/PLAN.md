# Cadence — Implementation Plan

> Companion to `cadence-spec.md` (the product/technical spec) and `CLAUDE.md`
> (build orientation). This plan reflects the **in-process** consumption decision
> and the current state of AI Admin (**v1.4.0**, ahead of the spec's v1.2.0 anchor).
> Status: scaffold + data/logic layers landed — repository layer (direct Postgres),
> deterministic engines, dossier compiler, 12/12 engine tests, typecheck clean. The
> AI-dependent phases (capture/coach/plan) await AI Admin provisioning.

## 1. Decision record

| Decision | Choice | Rationale |
|---|---|---|
| AI Admin consumption | **In-process from day one** (spec §8.1 preferred) | Collapses two-relay latency on the Coach hot path; Broker scans run as library calls. Engine is cleanly importable (`sendChatMessage` returns a streaming `Response`, not coupled to Express). |
| Cadence backend runtime | **Node (Express)**, new `apps/cadence-api` | In-process consumption requires the Node runtime. A Supabase Edge Function (Deno) **cannot** import the engine — this resolves the §C1↔§8.1 tension in the spec. |
| Monorepo layout | **Additive** — new `apps/*` + `packages/{core,cadence-shared}`; AI Admin `backend`/`frontend` untouched | "AI Admin stays separate" (§8.1). Don't destabilize a shipping product. |
| Cadence data store | **Reuse Spartan Tracker's Supabase**, isolated in a `cadence` schema | Cadence supersedes Spartan Tracker (whose only table is `public.tracker_data`). Schema isolation = zero collision; drop the old project's data later. Ownership split from AI Admin's DB stays (§C6). |
| DB access | **Direct Postgres** (`postgres` lib via the pooler), not the Data API | cadence-api is a trusted backend; direct SQL keeps the `cadence` schema off the Data API (no client surface) and gives transactions for atomic lock/commit. Auth is decoupled for now (dev user; migration `0002`). |
| Client | **PWA-first (Vite/React)**, Capacitor wrapper later | HealthKit/push need native; isolate behind a capability seam with web no-op (§8). |
| Secrets | No `aim_sk_` on Cadence's runtime path | In-process has no HTTP boundary between Cadence and AI Admin. `aim_sk_` is used only by the provisioning CLI. |
| Deploy | **Vercel** (cadence-web + cadence-api); **Capacitor iOS** app later | Matches how AI Admin already runs on Vercel. A native wrapper is required for HealthKit (no web API) — see §11. |

## 2. Architecture (target topology)

```
Cadence client (PWA / Capacitor iOS)           apps/cadence-web
   │  Cadence Supabase JWT  +  fetch/SSE
   ▼
Cadence backend (Node / Express)               apps/cadence-api
   ├─ owns Cadence Supabase DB (app data)
   ├─ deterministic engines (no LLM):
   │    scheduling · token-budget · tripwires · shoe-mileage · nudges · weather
   ├─ dossier compiler (§4.3 context packet)
   └─ AI Admin engine, IN-PROCESS  ───────────►  @ai-admin/core  (packages/core)
        runWithAuth(ctx) → hot-path chat / jobs (see packages/core/src/index.ts)
                                   │
                                   ▼
                      Devs.ai (Coach)  +  Gemini (Broker)
```

The client never reaches AI Admin or providers directly. All AI flows through
`cadence-api`, which establishes Cadence's AI Admin auth context (api_key mode,
scoped to Cadence's workspace, forwarding the Cadence user id) and calls the
engine in-process.

**`@ai-admin/core` surface** (canonical list: `packages/core/src/index.ts`):

| Group | Who may import | Symbols (summary) |
|---|---|---|
| **Hot path** | `apps/cadence-api` runtime (`src/ai/aim.ts`, routes/services) | Broker: `executeJob`, `executeJobById`, `executeRawPrompt`, `uploadApiDataSourcesChunked`. Coach: `openChatSession`, `resumeChatSession`, `sendChatMessage`, `submitChatToolOutputs`, `recordAssistantMessage`, lifecycle helpers, `getChatHistory`, … Model-layer: `createChatMessage` (context inject). Jobs: `getProcessingJobBySlug`. Tenant: `runWithAuth`, `getAuthContext`, `effectiveUserId`, `tenantFrom`, `tenantClient`, `RequestAuthContext`. |
| **Provisioning (cold path)** | `apps/cadence-api/scripts/*` only | AI profiles: `getAiProfile`, `getAiProfileBySlug`, `updateAiProfile`. Jobs CRUD: `createProcessingJob`, `updateProcessingJob`, `getProcessingJob`. |

Not exported (intentionally): `getServiceSupabase` — service-role client that bypasses RLS. Backend may import it from `backend/src/db/service-supabase.ts`; Cadence must use `runWithAuth` + tenant helpers.

## 3. Monorepo layout (scaffolded)

```
packages/
  core/            @ai-admin/core      — in-process engine surface (hot-path + provisioning re-exports; see §2)
  cadence-shared/  @cadence/shared     — domain types (spec §5) + Broker job contracts (spec §C4)
apps/
  cadence-api/     @cadence/api        — Node backend; owns Cadence DB; consumes @ai-admin/core
    src/ai/aim.ts        ← the in-process adapter (THE load-bearing seam)
    src/routes/{coach,plan,health}.ts
    src/services/{capture,token-budget,metrics,context-pack}.ts
    src/auth/middleware.ts · src/db/supabase.ts · src/config.ts
  cadence-web/     @cadence/web        — Vite/React PWA
    src/lib/capability/{index,web}.ts  ← native seam + web no-op (§8)
    src/lib/api.ts · src/features/{onboarding,review}/
config/ai-admin/   ai-admin.config.json + README — config-as-code for profiles/jobs/workflow
migrations/cadence/0001_init.sql       — Cadence DB DDL (its own Supabase project)
docs/cadence/PLAN.md                   — this file
```

Root `package.json` workspaces updated to include `packages/core`, `packages/cadence-shared`,
`apps/cadence-api`, and `apps/cadence-web` (explicit entries alongside the pre-existing
`backend`/`frontend`/`packages/{types,client,edge}`, not a glob — see INFRA-01 in
`refactoring_plan.md`). `npm ls --workspaces` from repo root confirms all 9 workspaces resolve
with no `extraneous`/`invalid` markers, and `package-lock.json` was regenerated from a clean
install to match.

## 4. AI Admin entities to provision (config-as-code)

Authored in `config/ai-admin/ai-admin.config.json`, synced via
`backend/scripts/ai-admin-sync.mjs`. See `config/ai-admin/README.md` for the
UUID-fill order.

| Entity | Slug | Role |
|---|---|---|
| Profile (chat) | `cadence-coach` | Coach: conversation, plan synthesis, readouts, steer-back |
| Profile (completion) | `cadence-broker` | Broker: extract / vet / assess / select (low temp) |
| Job | `capture-extract` | Ambient capture (§6.1) → flat capture deltas |
| Job | `plan-vet` | Verifier (output-verification.md) → `{valid,violations,verified}` |
| Job | `situation-assess` | Session-start assessment (§B4), tripwire-gated |
| Job | `context-select` | JIT relevance retriever (§4.3) |
| Job | `synthesize-plan` | Coach plan synthesis on lock (§6.3) |
| Workflow | `cadence-replan` | assess → synthesize → vet (§B3 closed loop) |

Plus a one-time `POST /api/calling-applications` for `platform:cadence`.

## 5. Deterministic engines (plain app code — no LLM)

Per spec §4.2, these stay out of the models. Scaffolded as stubs in `cadence-api`:

- **Token budget** (`services/token-budget.ts`) — green/amber/red tiers (§4.3); pure + unit-tested, **not yet wired** into Coach turn-context. ✅ (engine) / ⏳ (hot-path adopt)
- **Goal guardrail** (`services/goal-guardrail.ts`) — hard cap 50 + weighted focus budget (§6.2/§A1). ✅
- **Scheduling** (`services/scheduling.ts`) — RRULE subset → dated occurrences. ✅
- **Shoe-mileage** (`services/shoe-mileage.ts` pure) — accrue run distance math + `retire_soon` ~85% (§5.3). ✅ DB action (`completion.addRunMileage`) removed as unwired — wire into `logOccurrence` when run distance is on the completion path. ⏳
- **Tripwires** (`services/tripwires.ts`) — timezone/location/missed/divergence/weather/streak (§B4); empty ⇒ no Broker call. ✅
- **Context packet** — Coach grounding via retrieval/`context-pack` (dead `services/dossier.ts` compiler deleted; duplicated retrieval renderers). ✅
- **Nudge engine** — schedule off activity times; dedupe HealthKit auto-completions; channel routing. ⏳ to add.
- **Weather** — deterministic OpenWeatherMap API keyed on location+time for outdoor occurrences (§B1). ✅

All pure engines are unit-tested (`services/engines.test.ts`, 12/12). Data access is the
**repository layer** (`src/repos/*` — goals, equipment, plans, activities, occurrences,
conversations, users) over a **direct Postgres** connection (`db/sql.ts`, the `postgres`
lib via the Supabase pooler); the `cadence` schema stays off the Data API.

## 5a. Coaching session intelligence (§4.1, §4.3)

The coaching *quality* lives here, not in the plumbing. Three load-bearing rules:

**The Coach is stateless between turns.** AI Admin persists + compacts session history, but
we never rely on it (compaction drops detail; sessions reset; windows overflow). The
structured store is the source of truth; every session is reassembled from the DB.

**Prompts are assembled from stored data, not remembered.**
- The Coach is a chat session **bound to a processing job** (`cadence-coach-chat`), not just
  a profile. Binding the job is what makes AI Admin **own the prompt** and **turn on
  conversation analytics** (diagnostics key off `processing_job_id`, default-on).
- The **persona/tone/safety is a managed AI Admin asset** — the job's `config.systemPrompt`,
  a first-class build-rules field (`backend/src/schemas/processing-jobs.ts`), editable in the
  admin UI. Version-controlled seed: `config/ai-admin/cadence-coach.system-prompt.md`, applied
  via `scripts/set-coach-persona.ts`. NOT hardcoded in app code.
- The engine sources the bound job's `config.systemPrompt` as the native `role:'system'`
  message and **appends the app-sent dossier** to it (`openChatSession`, the
  `[jobSystemPrompt, systemPrompt].join` change in `backend/src/ai-manager/index.ts`). So the
  app sends only **data** (the dossier); AI Admin owns the prompt. `coach-context` / retrieval
  builds just the runtime context (intent guide + baseline, active goals+progress,
  equipment, current plan, recent consistency). **P0 (done): this context is no longer the system
  prompt** — `routes/coach.ts` opens a persona-only session (`openCoachSession` → `aim.coachJobSlug`)
  and injects the context as a separate provenance-stamped turn (`buildCoachContext` →
  `injectCoachContext`), keeping the persona prefix cacheable and the context refreshable.
- Transport is Devs.ai's OpenAI-compatible `/chat/completions` (completion mode): native
  system role, model-agnostic + failover, stateless reassembly from our store. The Devs.ai
  *agent* API is intentionally avoided — it has no per-call system role (would force prepending
  the per-user dossier) and moves analytics off AI Admin. Revisit only if the Coach needs
  server-side tool/OAuth/MCP calls.
- Refresh the dossier when state changes (capture/lock) or context is at risk.
- Per-turn just-in-time injection (`assembleTurn` → `context_select`): when the user
  references something outside the dossier, the Broker names the records and the app injects
  them. Rolling summary + last-K turns ride AI Admin's session compaction.
- Same discipline for every job: the app gathers the stored data and passes it as variables —
  the model never "gathers."

**Coaching turns are logged in AI Admin.** The in-process coach route relays the SSE while
accumulating the reply + usage, then finalizes each turn (`recordCoachReply` →
`recordAssistantMessage` + diagnostics `complete`) — the same post-stream bookkeeping the AI
Admin HTTP chat route does. So the full conversation + token/cost are observable in AI Admin
diagnostics, even though the Coach is a chat session, not a job.

**Identity is captured, never assumed.** The dossier omits the user's name until it's known and
instructs the Coach to ask for it; onboarding/sign-up captures it (no seeded name).

**Context scales as memory, not a growing string.** The deterministic dossier won't scale over
months (context overflow; mutating data in the system prefix kills prompt caching). The
longitudinal design is an **agentic memory layer**: a semantic-layer retrieval registry
(parameterized functions, *not* free SQL) → a Broker-curated, provenance-tagged **context pack**
(working memory) → placed as an **end-of-prompt block** (cache-aware), refreshed on TTL +
data-volume + conversational-staleness triggers. MemGPT-adjacent, but with governed retrieval +
a separate curator + an auditable substrate. Full design + schemas:
[MEMORY-ARCHITECTURE.md](./MEMORY-ARCHITECTURE.md). Phase-in: P0 keep today's dossier but move it
to an end-of-prompt block (immediate caching win), then add the registry → Broker
`build-context` → refresh loop.

**Objectives vs. commitments (the missing bridge).** Distinguish a high-level **objective**
(outcome: "run a Spartan Beast in October, beat my time") from the daily/weekly **commitments**
that ladder up to it (the executable plan: runs, strength, mobility, weigh-ins). After capture,
the coach's job is to **review the objective and propose the commitment plan to agree to** — a
distinct, coached step (objective → `synthesize_plan` → commitments), not silent generation.
OKR-shaped: objectives are high-level goals; commitments are activities/occurrences.

**Dynamic intake.** The onboarding questionnaire is generated *after* the coach assesses the
stated objective: a Broker step answers "what metrics do I need to tailor a plan for *this*
goal?" → the coach proposes that tailored form → user fills → captured → synthesis. The intake
is a function of the goal, not a fixed form.

**AI Admin enhancements this surfaced (proposed).** Engine-owned chat finalization (so no
consumer can bypass logging); a first-class per-user **context/memory store** (TTL + provenance);
cache-aware "stable prefix + dynamic tail" assembly; a governed retrieval-function (semantic
layer) primitive; cross-session longitudinal variables. See MEMORY-ARCHITECTURE.md §5.

**Canned report jobs synthesize gathered data into deliverables.**
- `weekly_readout` (Coach-tier) — app-computed adherence + outcome + streaks + episodes → the
  narrative "how am I doing" readout (§6/§A5).
- `surface_insights` (Broker) — state snapshot → quick wins/risks (shoe near EOL, streak
  milestone, adherence/outcome divergence) the Coach weaves in (§4.1 role 5).
- Fed by a deterministic **metrics layer** (`services/metrics.ts`: adherence, streaks, outcome
  deltas). Later: recipe/meal-plan from preferences+fridge photo; a `checkin_opener` for
  steer-back ("About Friday").

### Coaching intents (the "pre-baked buttons")

Coaching is intent-driven, not one generic chat. `buildCoachSystemPrompt(userId, intent, topic)`
composes persona + an intent guide + an intent-specific context slice + the dossier:

- **onboarding** — gather goals/baseline/equipment/location before planning, driven by a
  deterministic readiness checklist (captured vs. still-needed). **Conversational by default:
  one question at a time, plain text (no bulleted interrogations).** Optional flow: after the
  goal chat, the coach offers a short **questionnaire** — the Broker emits a form schema, the
  UI renders it, and the Broker captures the filled answers (for users who'd rather not chat
  through every detail). Optional upgrade: a tuned Devs.ai onboarding agent.
- **initial** — first session after lock: orient the user to the plan.
- **ongoing / {topic}** — topic-scoped (nutrition/training/goal/recipes/struggles); the app
  composes the relevant slice (e.g. nutrition → macro trends + recent logs + recipes). UI
  buttons map to these.
- **disrupted** — gather episode + available equipment (incl. a hotel-gym photo→parse) →
  the `disrupted_plan` job builds the additive overlay (base plan preserved, streak protected).

`coach-context.ts` holds the intent registry; the topic composers are stubbed pending the
nutrition_logs/recipes repos.

### Conversation mechanics: session + templates + Broker-composed context

Completion-mode is **not** one-shot. The Coach runs as a completion *profile* inside a
*stateful chat session* (`openChatSession`/`sendChatMessage`); AI Admin replays the system
prompt + compacted history every turn, so it's a coherent multi-turn conversation. (The
alternative — `mode:'chat'` + a tuned Devs.ai *agent* — moves threading/context into Devs.ai;
reserve it for when we want native agent tools.)

Two layers carry context into a turn:
- **System prompt (at open):** persona + base dossier → stable grounding.
- **Templated turns:** chat sessions support `{{variable}}` templates via **rule sets**
  (`config.ruleSets[]`, invoked by `ruleSetKey`) and **workflow steps** (`stepKey`). A topic
  turn is a rule set (e.g. `nutrition`) whose `{{context}}` the **Broker composes**.

Principle: **context composition (Broker jobs) is decoupled from the conversation (Coach
session + templates), joined by a template variable** — the Coach reasons over a clean,
pre-composed brief instead of re-deriving it.

### Per-topic conversational continuity

Coaching must feel continuous: returning to *nutrition* (or any goal) should recall prior
chats on it, not just the structured data. Achieved by **segmenting conversations by
topic/goal** and combining three mechanisms, all backed by existing AI Admin features:

1. **Resume (full fidelity).** One chat session per (user, topic|goal); `conversations` maps
   it. Opening a topic **resumes** that session (`resumeChatSession` by `externalChatId`,
   v1.3.0) so the compacted thread replays.
2. **Compressed topic memory (durable).** AI Admin session compaction maintains a rolling
   summary; Cadence persists it per topic (`conversations.rolling_summary`), always loaded in
   the Broker-composed `{{context}}` — survives long gaps / expired provider chats
   (`fallbackToLocal`).
3. **Broker briefing on open.** The Broker composes `{{context}}` = data slice + topic rolling
   summary + recent specifics ("summarize before initiating").

After a session (or at compaction) the Broker refreshes that topic's memory for next time.
Net: opening *nutrition* → base dossier + resumed nutrition thread + fresh nutrition brief.

*Schema add (migration `0003`):* `conversations.topic`, `conversations.goal_id`, unique
(user_id, topic|goal_id) so each strand has one resumable session.

### Proactive check-ins

Beyond reminders (nudges) and data-driven tripwires (§B4), Cadence proactively asks the user
to *reflect*: "Want to chat about today's run?" — on a **configurable cadence**. This is the
human-feedback complement to tripwires: tripwires catch what the data shows (missed, outcome
divergence); check-ins catch what the user *feels* (a knee flaring up) that data alone misses,
and feed it into the plan-efficacy loop.

- **Cadence config** (`users.check_in`): per-session / daily / weekly / off + channel; asked at
  onboarding ("how often should I check in?"), adjustable anytime, optional per-goal override.
- **Trigger** (deterministic): on occurrence completion (session) or an end-of-day/week
  scheduler (Vercel cron → trigger); respects quiet hours + disrupted-mode softening.
- **Prompt → opt-in chat**: a two-way nudge ("chat about today/yesterday/that workout?"). Tap or
  reply opens a Coach **check-in session** (intent `checkin`), scoped to the period/workout —
  context = the occurrence(s) + plan + recent feedback (Broker-composed). Ad-hoc chat is always
  available regardless of cadence.
- **Broker captures feedback** (`capture_feedback`): structured feedback (felt, perceived
  effort, pain/injury flare, adherence reasons) → persisted per session/day/week (`check_ins`)
  and folded into the per-topic compressed memory.
- **Injury-flare → replan**: a flagged pain/injury signal is a first-class input to
  `situation_assess` → `cadence-replan` → `adjust_plan` (e.g. knee flaring → soften/modify the
  plan). This is the path the user called out: a flare must adjust the plan.

*Schema add (migration `0003`):* `users.check_in` (jsonb config) + a `check_ins` table
(user_id, scope session|day|week, occurrence_id?, period, feedback jsonb, signals jsonb).

## 5b. Job & template catalog

Sorting every requirement into what each layer owns. ✅ = provisioned; ⏳ = planned.

**Broker jobs — extract / parse / compose (cheap, structured):**

| Job | Purpose | |
|---|---|---|
| `capture_extract` | conversation → goals/equipment/baseline (§6.1) | ✅ |
| `plan_vet` | proposed plan → validity (§C4) | ✅ |
| `situation_assess` | tripwire snapshot → action (§B4) | ✅ |
| `context_select` | turn → records to inject (§4.3 JIT) | ✅ |
| `surface_insights` | state → wins/risks (§4.1 r5) | ✅ |
| `compose_context` | per-intent/topic `{{context}}` (dossier brief, nutrition/training/goal slice + rolling summary) | ⏳ |
| `parse_meal` / `parse_meal_photo` (vision) | meal text/voice/photo → items+macros+confidence (§5.6/§B2) | ⏳ |
| `parse_equipment_photo` (vision) | hotel-gym photo → equipment (§5.7) | ⏳ |
| `parse_fridge_photo` (vision) | fridge/pantry photo → ingredient list (Req 5 Phase 4) | ✅ job + API (`parse-fridge` → review → generate) |
| `parse_nudge_reply` | SMS/email reply → action (§A4) | ⏳ |
| `reconcile_state` | recent convo vs store → conflicts on confirm/lock (§4.3) | ⏳ |
| `capture_feedback` | check-in chat → structured feedback + injury/pain signals (feeds replan) | ⏳ |

**Coach jobs — synthesis / generation (strong model):**

| Job | Purpose | |
|---|---|---|
| `synthesize_plan` | confirmed inputs → activities (§6.3) | ✅ |
| `weekly_readout` | stats → narrative readout (§6/§A5) | ✅ |
| `disrupted_plan` | episode → additive overlay (§5.7) | ✅ |
| `adjust_plan` | tweak existing plan, version-bump (§6.3) | ⏳ (may reuse synthesize) |
| `generate_recipe` | fridge ingredients (+ dietary/targets) → 1–3 recipe drafts (Req 5 Phase 4) | ✅ job + API (`generate` → confirm save) |
| `generate_meal_plan` | prefs/fridge/recipes/targets → week + shopping list (Req 5 Phase 5) | ✅ job + API (`meal-plans/generate` → confirm save) |
| `discover_recipe` | query → 1–3 recipe drafts (scoped; not live web search) | ✅ job + API (`recipes/discover` → confirm save) |
| `parse_nutrition_label` / `estimate_food` / `identify_food` | Req 5 WS2 food capture (label / describe / front-of-pack) | ✅ jobs + app wire (`food-capture` + routes) |
| `structure_recipe` | Req 5 Phase 2 — recipe from chat | ✅ job + API (`structure-recipe` → recipes from-chat) |

> **Req 5 reframed (2026-07-24) → a Food & Recipe data layer (MFP-parity), foundation-first.** Phases
> 1–3 foundation shipped (foods cache, recipes, OFF barcode + camera, USDA micros, micro insights,
> `lookup_food` retrieval). **Phase 4** fridge → recipes and **Phase 5** meal plans + shopping list
> (+ scoped `discover-recipe`) shipped as API verticals (confirm-before-save). **Phase 5 web:** Food →
> This week's meals + shopping list; Recipes discovery gated on discover probe. Full plan:
> **`docs/cadence/REQ5-food-and-recipes.md`**.

**Coach chat rule-set templates (the conversation — turns, not jobs):** `onboarding`,
`initial`, topic (`nutrition`/`training`/`goal`/`struggles`/`recipes`), `disrupted`,
`lets_focus` (goal-cap §6.2), `checkin` (steer-back §6.6) — each loads a Broker-composed
`{{context}}`. ⏳ author.

**Nudge copy:** cheap-tier templates `morning_run` / `protein_status` / `kitchen_closed`
with `{{state}}` (§6.5). ⏳

**Agents (Devs.ai, optional):** `research` (web search) for `resolve_howto` + recipe ideas
(§C2); optional tuned `onboarding` agent; optional tuned `coach` agent if we later want
native tools.

**Deterministic — no LLM:** weather API, scheduling, metrics, tripwires, token-budget,
shoe-mileage, goal-guardrail, HealthKit. ✅ built/stubbed.

## 6. Phased build (maps to spec §C8 acceptance criteria)

**Phase 0 — Activate the scaffold.** `npm install` (links new workspaces); create the
Cadence Supabase project + run `migrations/cadence/0001_init.sql`; provision AI Admin
providers/profiles/jobs (config-as-code); fill `apps/cadence-api/.env`.
*AC: `GET /health` on cadence-api returns ok; a one-paragraph written confirmation of
auth + base-URL rules (per §C8.1).*

**Phase 1 — Engine smoke test (in-process).** From cadence-api, run one Broker job and
one Coach completion through `@ai-admin/core` inside `runWithAuth`.
*AC: a `run-slot`-equivalent call on each profile returns a completion; key never in any client bundle (§C8.2–3).*

**Phase 2 — `capture_extract`.** Finish `services/capture.ts` contract assertion;
hostile-input test (instructions-as-data).
*AC: a sample transcript yields goals/equipment JSON matching §5.2/§5.3; "ignore instructions" input is treated as data (§C8.4).*

**Phase 3 — Coach chat loop + capture persistence.** Persist `conversations` mapping;
compile the §4.3 context packet (retrieval/`context-pack`); stream SSE; upsert captured records → counter/chips.
*AC: a multi-turn conversation streams and stays coherent with injected dossier; 409-safe send (§C8.5).*

**Phase 4 — Capture → confirm → lock.** Confirm gates + goal-cap guardrail (§6.2);
run `cadence-replan`/`synthesize` workflow in a session; `plan_vet`; commit on `valid`.
*AC: locking a confirmed set produces a committed, vetted plan (§C8.6).*

**Phase 5 — First end-to-end feature.** Onboarding chat captures goals → renders the
Review screen (mockup 02) from real model output, all via cadence-api.
*AC: a new user talks → sees captured goals → confirms → locks a plan (§C8.7).*

**Phase 6 — Daily loop.** Today timeline, occurrences, HealthKit auto-complete via the
capability seam, shoe-mileage, weekly readout, one nudge channel.

**Phase 7 — Adaptation.** Tripwires → `situation_assess` → disrupted mode / check-in /
replan. Native wrap (Capacitor): HealthKit + push behind the capability seam.

## 7. Spec ↔ reality reconciliation (AI Admin v1.4.0)

The spec is anchored to v1.2.0; the repo is v1.4.0. The "AI Admin improvement spec"
features the spec said to work around **have shipped**, which removes app-glue:

| Spec assumption | v1.4.0 reality | Impact on Cadence |
|---|---|---|
| jobs-as-tools "not yet" | Shipped (`ai_profiles.config.toolJobs[]`) | Coach can call Broker jobs as tools; less app orchestration of insight-surfacing (§4.1 role 5). |
| triggers "don't exist" | Shipped (`POST /api/triggers/:slug/run` + event triggers) | Broker always-on scans can ride triggers, not the legacy scheduler (§8.1). |
| context compaction "none" | Shipped (session summarizer) | Summarize-and-roll has native support; still keep deterministic token-budget tiers app-side. |
| schema-assertion rules "none" | Shipped (`require-keys`/`assert-json-schema`/…→`verified:false`) | `plan_vet` and contract asserts use native rules. |
| `outputMappings` TOP-LEVEL only | Nested paths now supported | Keep schemas flat (clear), but nesting is available if needed. |

**Net:** several Broker roles become native platform features; the app layer still
orchestrates explicitly where convenient, but is not blocked.

## 8. Risks & mitigations

- **In-process coupling (accepted, §8.1).** Cadence's correctness now includes AI
  Admin's. *Mitigation:* the only seam is `@ai-admin/core` + `src/ai/aim.ts`; keep
  the engine free of route entanglement (already true). Falling back to the HTTP
  proxy path later touches only `aim.ts`.
- **Shared process env.** cadence-api must carry AI Admin's engine env
  (`AI_MANAGER_SUPABASE_*`, `CREDENTIAL_ENCRYPTION_KEY`, `DEVS_AI_*`) plus its own.
  *Mitigation:* documented in `apps/cadence-api/.env.example`; fail fast in `config.ts`.
- **Two Supabase projects.** Easy to point the wrong client at the wrong DB.
  *Mitigation:* `cadenceDb()` vs the engine's own client are distinct; never share.
- **`tsc`/CI scope.** The Cadence workspaces are now correctly registered under root
  `workspaces` (INFRA-01, `refactoring_plan.md`) and typecheck/resolve cleanly (`npm run
  typecheck --workspace=@cadence/api`/`@cadence/web` both pass with zero errors as of this
  fix). They are still **not** wired into the root `typecheck`/`lint`/`test`/`ci` scripts
  (those remain scoped to `backend`/`frontend` only) and there is still no CI pipeline at all
  (`.github/workflows` does not exist). *Mitigation:* tracked as INFRA-02/INFRA-03 in
  `refactoring_plan.md` — extend root scripts to `--workspaces --if-present` and add a
  path-filtered GitHub Actions workflow (report-only rollout first) before relying on this as
  an automated gate.
- **HealthKit realism.** Needs Mac + Xcode + Apple Developer account + a physical
  iPhone. *Mitigation:* the capability seam + web no-op lets all non-native work
  proceed on-device immediately; defer HealthKit to Phase 7.

## 9. Resolved decisions (from review)

1. **Goal cap — two numbers.** Hard ceiling = **50 active goals** (the UX-manageable max); the Coach can never exceed it. Separately, a **weighted focus budget** (default 4) triggers the "let's focus" keep/park conversation — weighted because a daily habit (load 1) is far cheaper than a training block (load 3). Implemented deterministically in `apps/cadence-api/src/services/goal-guardrail.ts`. "Active" = status captured/confirmed/locked; parked/completed/abandoned don't count.
2. **Active-shoe attribution.** Default to a single **active** pair; all run mileage accrues to it. Only prompt ("Which shoes?") when the user owns 2+ running pairs and hasn't set an active one; provide a one-tap switcher when they rotate/replace. Never block logging to ask.
3. **Disrupted mode — suggest, never auto-apply; additive overlay, not a rewrite.** Deterministic tripwires (timezone/location/missed/etc.) gate a Broker assessment that **proposes** entering disrupted mode with one-tap accept ("Looks like you're traveling — switch to travel mode?"); the plan is never silently overridden. When entered, it is an **additive temporary plan**, not a destructive rewrite: the base plan is preserved and resumes on `end`, the **streak is protected**, tone softens, and the user does "what they can" guilt-free. Triggers aren't only fitness — `type: 'custom'` covers life events (a wedding, a bereavement) where supportive tone matters more than equipment. The episode **confirms available equipment** for its duration — e.g. the user photographs a hotel gym and the Broker/Coach parses it into `available_equipment`, which seeds the temporary activities. (Modeled in `@cadence/shared` `DisruptedEpisode` + `migrations/cadence/0001_init.sql` `episodes`.)
4. **Supabase — reuse Spartan Tracker's project** (`qvukqinwmyvewzgcsgzt`), Cadence tables isolated in a `cadence` schema. Cadence supersedes Spartan Tracker. Enable Supabase **Auth** on the project (Spartan Tracker didn't use it; Cadence needs real users). Service-role secret key still required for cadence-api.
5. **Models (one Devs.ai provider/key — it brokers Claude + Gemini).** Coach = **Claude Sonnet 4.6** (`claude-sonnet-4-6`, chat, `temperature: 0.7`) — cost/quality balance for bounded-context coaching (§4.3); plan synthesis is backstopped by `plan_vet` + confirm-before-lock, so the cheaper Coach is low-risk. Broker = **Gemini 2.0 Flash** (`gemini-2.0-flash`, `temperature: 0.1`) — cheapest for the always-on hot path. **Plan-quality lever:** `synthesize-plan` is a separate job; point it at a `claude-opus-4-8`/`claude-fable-5` `cadence-planner` profile only if Sonnet synthesis disappoints. Failovers: Coach → Opus 4.8, Broker → Haiku 4.5. Model IDs must match Devs.ai's catalog. Upgrade path: tuned Devs.ai **agent + `toolJobs`** Coach (v1.4.0 jobs-as-tools) realizes "Broker as a tool the Coach calls" (§4.1 role 5); add a `cadence-research` web-search agent for recipe/how-to lookup.
6. **Deploy = Vercel** for both cadence-web (SPA) and cadence-api (Node). See §11 for the iOS/native answer and the serverless-streaming caveat.

7. **Auth deferred (dev mode).** Decoupled from Supabase Auth (migration `0002`): `cadence.users` is the standalone identity table, a dev user is seeded (`jleggo@gmail.com`, id `00000000-0000-4000-a000-000000000001`), and cadence-api uses `CADENCE_DEV_USER_ID` (forwarded to AI Admin as `X-Forwarded-User-Id`). Real auth links `cadence.users.id ↔ auth.users.id` later.
8. **Env: single source of truth.** cadence-api loads AI Admin engine secrets from `backend/.env` plus its own `apps/cadence-api/.env` — the AI Admin vars are not duplicated.

## Remaining to confirm
- Exact build-rule `options` shapes (verify vs. `backend/src/services/formatting-rules.ts`).
- ~~Whether cadence-api streaming needs a long-running host vs. Vercel functions~~ — **decided:** Vercel Services (see [`DEPLOY.md`](DEPLOY.md)).

## 10. Immediate next steps

> **Superseded — see §12 "Status & backlog" for the current state and detailed next steps.**
> (The steps below were the original bring-up and are all complete: workspaces linked,
> migrations applied, AI Admin provisioned, env filled, dev servers run, in-process engine
> proven.)

## 11. Deployment & native (iOS)

> **Canonical deploy doc:** [`docs/cadence/DEPLOY.md`](DEPLOY.md) (INFRA-P2). The bullets
> below are the product summary; if they disagree with DEPLOY.md, **believe DEPLOY.md**.

**Web + API → Vercel (two projects).** `cadence-web` is a static Vite SPA
(`apps/cadence-web/vercel.json`). `cadence-api` is a **long-running Vercel Service**
(`apps/cadence-api/vercel.json` `services` key) — same compute model as AI Admin’s backend,
**not** a classic short-lived serverless function. Repo-root `vercel.json` stays AI Admin–only.

**Why Services (not functions) for the API:** (a) `postgres.js` pool, (b) Coach SSE streams,
(c) in-process `@ai-admin/core` cold-load. Broker / scheduled work still prefers
**Vercel Cron → AI Admin trigger endpoints** where applicable — matches AI Admin’s pattern.

**iOS app — yes, and it must be native for HealthKit.** A pure PWA cannot reach
HealthKit (the deciding constraint, §7/§8). The path:
- One codebase: PWA-first, then wrap with **Capacitor** for iOS. The native seam is
  already scaffolded — `apps/cadence-web/src/lib/capability/{index,web}.ts` — so HealthKit
  and push get a native implementation on iOS and a no-op on web, with no app-logic changes.
- HealthKit via a maintained Capacitor health plugin; push via APNs through the wrapper.
- Requires: a Mac + Xcode, the HealthKit entitlement + usage-description keys, an Apple
  Developer account (TestFlight/persistent builds), and a **physical iPhone** for HealthKit
  testing. This is Phase 7.
- The same Capacitor plugin also supports Android/Health Connect — low-cost later (deferred per §10).

## 12. Status & backlog (living — **refreshed 2026-08-04**, previously stamped 2026-07-01)

> This section supersedes the pre-build "immediate next steps" in §10. It is the durable
> record of what is built and what remains, captured in detail so it survives context loss.
>
> **Refresh pass 2026-08-04** — every item below was re-checked against the code, not against the
> previous entry. A durable record that has gone stale is worse than no record: it sends the next
> session to build things that already exist. What the pass changed:
>
> | item | was | is |
> |---|---|---|
> | E · Real auth | "currently the dev user" | **SHIPPED** — `AuthScreen.tsx` + Supabase sign-in |
> | F · Multimodal content parts | "proposed" | **SHIPPED** — `ContentPart` flows through devs-ai-v2, gemini, job-execution-run |
> | A · P3 refresh policy | implied next | **NOT built** — and `getFreshContextPack` is dead code (defined, called nowhere) |
> | A · P4 reflection | implied next | **NOT built** — an earlier grep "found" it, but that was `reflection` as an activity *category* in `burn.ts` |
> | B · Proactive check-ins | not started | **PARTIAL** — `check_ins` + `recordCheckIn` + streak days ship; the user-chosen *cadence* does not |
> | E · Native iOS | "seam scaffolded" | **still open** — no Capacitor dependency anywhere |
> | The whole Mind pillar | absent from this section | **SHIPPED** — see below |
>
> Two lessons for the next refresh: a grep hit is not a shipped feature (P4), and an exported
> function is not a wired one (P3).

### Done & verified
- **Monorepo + in-process AI Admin** via `@ai-admin/core` + `apps/cadence-api/src/ai/aim.ts`.
  Migrations `0001_init`, `0002_decouple_auth`, `0003_context_pack` applied to Supabase
  `qvukqinwmyvewzgcsgzt` (`cadence` schema).
- **Full spine talk→capture→confirm→lock** proven live against real models + DB.
- **Coach = chat session bound to the `cadence-coach-chat` processing job** (not a bare
  profile). The persona — including all per-intent guides (onboarding/initial/ongoing/
  disrupted) — lives in that job's `config.systemPrompt`, editable in the AI Admin **Build
  Rules** tab. Binding the job is what enables conversation diagnostics/analytics.
- **AI Admin frontend fix (shipped):** `frontend/.../ProcessingJobManager.tsx` Build Rules tab
  now exposes a **System Prompt** field (reads/writes `config.systemPrompt`); the save now
  preserves the entire config (previously rebuilt it from two keys, dropping the rest).
  `ProcessingJobConfig` type gained `systemPrompt`.
- **Engine change (shipped):** `backend/src/ai-manager/index.ts` — `openChatSession` sources a
  bound job's `config.systemPrompt` as the system role, appended with the caller's runtime
  context; `JobConfig` gained `systemPrompt`. Backward-compatible.
- **In-process chat finalization:** the coach route accumulates the SSE + `recordCoachReply`
  (`recordAssistantMessage` + diagnostics) so assistant turns + token/cost are logged, mirroring
  the AI Admin HTTP chat route (the in-process path had been bypassing this).
- **Context/memory engine P0–P2** (full design: `docs/cadence/MEMORY-ARCHITECTURE.md`):
  - **P0** persona = cacheable system prefix; dossier = provenance-stamped end-of-prefix
    context turn (`injectCoachContext`).
  - **P1** retrieval-function registry (`services/retrieval/registry.ts`, 7 fns) + catalog
    (`catalog.ts`) + `cadence.context_pack` table + `repos/context-pack.ts`.
  - **P2** Broker curates — `pack-select` (chooses fns from the catalog) → app validates +
    executes → `pack-summarize` (renders the block). Deterministic fallback at each LLM step;
    identity + injuries **always** retrieved (safety net). Verified: selection adapts per
    intent, summary reasons over the data.
- **Persona conversational fixes:** short/plain, no markdown, asks for the name (no longer
  assumed — dev seed name cleared).
- **Blog series post #1** (`docs/cadence/blog/01-teaching-an-ai-coach-to-remember.md`) + Word
  export with embedded diagrams (`.docx`) + standalone `fig1-when-it-runs`, `fig2-picking-engine`
  (PNG + SVG). Diagrams generated via Node (`@resvg/resvg-js` + `docx`) since Python/LibreOffice
  aren't installed locally.

### In progress

> **Refresh note 2026-08-04:** the dev X-ray below still stands as written — `DevPanel.tsx` and
> `GET /coach/trace` both exist, and the v1.5 enrichment (exact AI Admin diagnostics: composed
> prompt + token/cost) is still not done. The `?dev=1` panel has since been joined by the
> `?preview=<tool>` harnesses, which bypass auth to render one tool against fixtures — that is
> how the Mind pillar's surfaces get looked at, since the journal sits behind sign-in.
- **Dev "X-ray" mode — v1 BUILT** (backend verified; live UI not yet screenshot-verified).
  Impl: `services/dev-trace.ts` (in-memory per-user trace) + `GET /coach/trace` + wiring in
  `context-pack.ts` (context/broker) and `routes/coach.ts` (coach turn + capture) +
  `ai.getCoachPersona`; frontend `features/dev/DevPanel.tsx` + split layout & toggle in
  `App.tsx` (🛠 bottom-right or `?dev=1`). **v1.5 pending:** enrich with exact AI Admin
  diagnostics (composed prompt + token/cost). Minor polish: `pack-summarize` sometimes wraps
  output in ``` fences — tighten its prompt/rules.

### Sign-in & onboarding v2 — the wizard becomes the chat (2026-08-09)

Design: *Cadence Sign-in & Onboarding v2.dc.html*. The five-screen intake wizard is gone. Cadence
asks one question per turn and ships that turn's answer affordances with it, so she can skip what
she already knows, reorder, or follow up — none of which a client that hard-codes the questions
can do.

- **The protocol** (`packages/cadence-shared/src/coach-picks.ts`): a fenced `cadence-picks` block
  on the end of a turn, parsed out before render. `list` (labelled options) and `tiles` (short
  scalars) are the entire answer vocabulary; `confirm` is the one exception and carries no options
  — it tells the client to render everything captured so far. Stream-safe by construction (an
  unclosed fence is withheld, never painted as JSON) and every failure degrades to plain chat.
- **Where the format lives:** injected at session open by `services/coach-picks-protocol.ts`,
  NOT written into the persona — same reasoning as `coach-capabilities.ts`. The parser ships in
  code, so the format does too, and **no job sync is needed** to change it.
- **Taps compose, they never send.** A pick writes plain words into the composer; the user still
  presses send and can edit first. That is what keeps a tap and a typed sentence the same act, and
  it is why there is no CONTINUE button and no "something else" row.
- **The order of the flow changed:** fork (get started / sign in) → meet Cadence (AI disclosed
  first) → one running chat → confirm what she heard → build → **sign-up gate last**, standing in
  front of a week you can already see. Onboarding runs on a Supabase anonymous session that the
  gate upgrades in place (same user id, so nothing is migrated). See **backlog A0** for the
  abuse/cleanup/RLS work that opens up.
- **Multi-account on a device** (`features/auth/deviceAccounts.ts`): a roster in the same
  localStorage Supabase already uses for the live session. Removing a row signs out here only.
- **OWNER RULING — the coach's face is drawn at random and kept.** Meeting Cadence assigns a
  random portrait immediately; the picker during the plan build opens with her already selected,
  and the mark tile sits **last** as a deliberate opt-out. This supersedes the earlier "never
  assign a portrait, always start from the mark" rule in `coach-face.ts` — that rule was written
  for a wizard where the mark was all anyone had seen, and it does not survive a product that
  opens with "Hi, I'm your coach". Still a picture, never a personality; naming stays open (see
  Known issues).
- **Availability is now captured** (`baseline.time_of_day` / `days_per_week`, top-level so the
  shallow jsonb merge can't clobber siblings). Extraction added to the `capture-extract` prompt —
  **needs `sync-jobs.ts` to go live.**
- **Two beats deliberately dropped:** the client-authored greeting (Cadence opens the conversation
  herself now, via an `<open>` turn the API filters out of the transcript and the capture window),
  and the separate see-the-plan-then-commit step (the confirmation moved earlier, into the chat;
  the built week is the reveal behind the gate). Owner: fine — the plan is talkable-to afterwards.

### Done & verified — the Mind pillar (added in the 2026-08-04 refresh; this section had no record of it)

REQ9's toolkit shipped whole and this backlog never mentioned it. Each tool is a `COACH_TOOLS`
entry + a client renderer + normalize caps, with the deterministic content (patterns, games,
vocabularies, question banks) living in `@cadence/shared` so it is code-reviewed, never generated:

- **`breathing`** — 9 patterns as data, `phaseAt()` pure in elapsed time; safety-capped rounds.
- **`meditate`** — bells, optional interval, the "came back" tap that never shows a running total.
- **`grounding`** — 6 games; nothing scored, nothing checked. (Its "did that help?" close was
  **removed** 2026-08-04 by owner ruling — the weekly conversation is the better instrument.)
- **`feeling_log`** — fixed 6×5 vocabulary; the coach chooses *when* to ask, never the words.
- **`journal`** — 12 banks across four families (reflection · craft · study · devotion), the
  writing page, the store, secrets (`listForCoach` excludes them **in SQL**), Markdown **export**,
  and the **timed free-write** on screen or in a physical notebook.
- **Plan shape** (REQ10 §12) — split by occasion, not by subject; day-shape as a judgment, and a
  live probe (`probe-plan-shape.ts`) that fails in three directions.
- **Governance** — the runtime `{{tool_catalog}}`, two compile-time guards (every tool renders;
  every `ItemField` exists), and two live probes wired into a weekly, non-blocking CI workflow.

**Settled rulings worth not re-litigating:** no emergency chrome and no message scanning (REQ9 §8);
the journal is a writing tool, not a feelings tool (§4.5); mind practices log as ordinary
occurrences with `skipped`/`missed`; the coach names no crisis phone number.

### Backlog — detailed

**A0. Anonymous onboarding — abuse, cleanup, and the RLS audit (opened 2026-08-09, NOT BUILT)**

Sign-in & onboarding v2 moved the sign-up gate to the *end*: "Get started" opens a Supabase
**anonymous** session so the coach can build a first week before asking for an account
(`features/auth/anonymous.ts`). Anonymous sign-ins and manual linking are enabled on the project.
Three consequences to close out, none of which block the flow but all of which get worse with
traffic:

- **RLS audit — do this first.** Anonymous users assume the **`authenticated`** Postgres role,
  exactly like permanent users. Any policy written against `authenticated` or `public` now admits
  them. Cadence's own app data is *not* currently exposed by this — `apps/cadence-api` validates
  the JWT and then talks to Postgres directly through `db/sql.ts`, scoped by `req.cadenceUserId`,
  and Storage goes through the server-only service-role client — but that is a property of today's
  access path, not a guarantee. Audit every policy on `cadence.*` and on Storage buckets, and gate
  the ones that should be permanent-users-only on
  `(select (auth.jwt()->>'is_anonymous')::boolean) is false`, as a **restrictive** policy.
  Supabase's advisor lint `0012_auth_allow_anonymous_sign_ins` flags this; run `get_advisors`
  after any policy change.
- **Abuse prevention.** The endpoint writes a real `auth.users` row per call, so it is a
  database-growth vector. Supabase caps it at 30/hour per IP by default; turn on invisible CAPTCHA
  / Cloudflare Turnstile (Auth → Attack Protection) before any public launch, and review the rate
  limit alongside it.
- **Cleanup.** There is no automatic reaping of abandoned onboardings. Add a periodic
  `delete from auth.users where is_anonymous is true and created_at < now() - interval '30 days'`,
  plus the matching `cadence.users` rows, ideally as a step alongside `npm run cleanup:test-data`
  so it is one documented chore rather than two. Note the interval must comfortably exceed how
  long an unsaved draft plan is allowed to live — still an open design question (see the v2
  design doc's own "open call").

- **Gate the inspectable webview before App Store submission (opened 2026-08-10).**
  `apps/cadence-ios/capacitor.config.ts` sets `ios.webContentsDebuggingEnabled: true` so Safari's
  Web Inspector can attach to the running app — set explicitly because this project consumes
  Capacitor via SPM, where Capacitor's own `#if DEBUG` default is evaluated against the framework's
  build, not the app's, and a debug app build can still ship a non-inspectable webview. As written
  it applies to **Release** builds too, so anyone holding the device could inspect the webview.
  Before submission: drive it from build configuration (a `CAPACITOR_DEBUG` Info.plist value set
  per-configuration is the documented seam) rather than a flat `true`.

**A1. Coach voice in intake — three open judgements (opened 2026-08-10, owner's call)**

All three came out of reading real onboarding transcripts against production after the v2 redesign
(#152–#161). None is a code defect; each is a wording or framing decision that needs the owner, and
all three live in `apps/cadence-api/src/services/coach-picks-protocol.ts` — **prompt text, injected
from code, so changing them needs a redeploy but NO `sync-jobs.ts` run.**

1. **The `0 / ~1 / 2-3 / 4+` tiles are a week-count grid by another name.** Cadence uses them for
   "where are you starting from", which is genuinely different in intent from a commitment quota —
   it is `measure.start`, where they are today, which the Broker wants. But on screen it is a
   four-tile weekly-frequency grid, and the owner's ruling (2026-08-10) was that "how many days a
   week" is a fitness-app question Cadence should not ask (see the daily-rhythm rework in #156).
   Open: does the *baseline* question survive in that shape, or should it be framed by distance,
   minutes, or plain words ("not at all / here and there / regularly")?

2. **"But before I can build anything, I need to know…"** — observed verbatim when a user answered
   a question she had not asked and she circled back to hers. Re-asking is correct behaviour; that
   phrasing turns it into a demand, and the voice is "warm, level, unhyped" (BRAND.md).

3. **The day question has never been heard in a real conversation.** #156 replaced the weekly
   day-count with "what does your day usually look like?" and "what sort of time do we have to work
   with?", plus a SAY IT LIKE A PERSON rule — because the model echoes the phrasing it is handed and
   was reading our shorthand aloud. Four live turns never reached that far, so the fix is verified
   by unit test (the strings are in the prompt) and NOT by ear. Needs one full walkthrough.

**A2. Landscape mode (opened 2026-08-10, NOT BUILT — owner wants it)**

The app is locked to portrait as of #165 (`apps/cadence-ios/ios/App/App/Info.plist`,
`UISupportedInterfaceOrientations`). That was a **fix, not a decision**: rotating produced a broken
screen, and locking removed it rather than shipping a layout nobody had drawn. The owner wants real
landscape support.

What has to change, and why it is more than a media query:

- **The full-bleed rules key off screen WIDTH, not the shell.** `styles.css`'s
  `@media (max-width: 480px)` block is what turns the fake phone frame into a real full-screen app.
  An iPhone in landscape is ~852pt wide, so the query stops matching and the app falls back to the
  desktop 390×760 mockup — clipped, with a second fake status bar over the real one. **This is the
  same root cause as iPad showing the mockup in portrait.** Fixing the signal (native shell rather
  than width) is a prerequisite for landscape and fixes iPad for free — see the open question in
  A0's neighbourhood, tracked here so the two are not solved twice.
- **The chat's vertical assumptions.** `.chat` reserves room for a floating composer stack measured
  at runtime (`useFloatingInset`); in landscape the usable height roughly halves and the composer,
  capture pills and confirmation bar together can exceed the viewport. The confirmation card and the
  face-picker grid in particular are designed as tall columns.
- **`PhoneFrame` syncs `--app-height`/`--app-top` from visualViewport** for the iOS keyboard. In
  landscape with the keyboard up there is very little left; the chat may need the composer to
  collapse or the transcript to scroll under it.
- **Unlock the orientations** in Info.plist (iPhone + the `~ipad` array) once there is a layout worth
  rotating into.

Do NOT unlock the plist before the CSS is ready — that is exactly the state that was just fixed.

**A3. Interrupting Cadence — Stop shipped, Pause/Continue still open (2026-08-10)**

**Shipped (#168, #169):** a Stop button in the composer while she is replying. It aborts the
client's read AND cancels the response upstream, so generation actually halts. Whatever she had
already said stays on screen, and the composer comes back — which is why someone reaches for Stop
("I mistyped something and don't want to wait for an answer to the wrong question").

Cancelling needed one piece that did not exist: the id of the response generating *right now*.
AI Admin's HTTP chat route stashes that in the chat session's `provider_metadata`, but Cadence
consumes the coach stream **in-process** and never goes through that route, so for a coach turn
that field is empty or still holds the PREVIOUS turn's id — cancelling it would have reported
success while the live reply carried on. The relay now records the id on
`cadence.conversations.in_flight_response_id` (migration 0029) the moment the stream announces it,
and clears it when the turn ends. Writing `provider_metadata.previous_response_id` instead was
rejected: it would switch every Cadence turn to upstream response-chaining — a real change to how
prompts are built, smuggled in behind a Stop button.

**Correction to what this entry first said.** It claimed Devs.ai v2 "does not expose pause/resume".
That was wrong, and it was wrong because it was copied from a stale comment in `ChatComposer`
rather than checked. The v2 Responses API has the full lifecycle —
`POST /api/v2/responses/{id}/cancel`, `/pause` and `/resume`
(https://docs.devs.ai/api-spec#tag/Responses-API-v2). Our own client had implemented cancel and
never implemented pause, which is what made the gap look like an API limitation.

**Why Stop uses CANCEL and not pause.** Cancel is what every mainstream chat UI means by "stop
generating": the turn ends, what she already said stands, the user moves on. Pause is a different
interaction — "hold on, I'll be back" — and behind a Stop button it would suspend a response
upstream that nothing would ever resume. `pauseV2ChatResponse` / `pauseCoachTurn` now exist for
when there is a visible Continue to pair with them.

**Still open:**
- **Pause / Continue as its own affordance.** The plumbing is in (`client.pauseResponse` →
  `pauseV2ChatResponse` → `pauseCoachTurn`); it needs the UI and a rule for how long a paused
  response may sit before it is cancelled.
- **Resume a DROPPED turn instead of re-fetching.** `reconnectResponseStream` +
  `reconnectV2ChatStream` already exist and are unused by Cadence: today a dropped connection
  re-reads the persisted reply from `/coach/current`. Reconnecting mid-stream would be better and
  is the same family of work.
- **What is persisted on a stop.** Cancel stops generation, but confirm the recorded turn is the
  PARTIAL the user saw rather than nothing or something longer — a restore that disagrees with what
  was on screen is the bug this feature exists to remove.

**A12. Points/XP and streaks were never actually settled — and our own logic contradicts itself (owner 2026-08-11)**

Parked deliberately. Recording it now so it is decided on purpose rather than inherited from
whatever the next feature happens to need.

**What exists.** `cadence.users.streak_state` (migration 0015) — `{current, longest, freezes,
freeze_credit, last_evaluated, last_saved_by_freeze}`, computed forward-only in
`services/streak.ts`, seeded with one freeze so a new user's first streak has a cushion. Points/XP
appear ON THE MAIN SCREEN. But there is **no points service, no ledger and no award rules anywhere
on the API side** — searched. So we shipped the surface without the system, and nobody has defined
what a point is, what earns one, or what it is worth.

**The contradiction, owner's own observation.** CLAUDE.md bans "streaks that reset to zero", and
0015's header justifies the reinstated streak precisely by saying the freeze economy keeps it from
resetting. But as the owner put it: *resetting a streak to 0 does make sense if we have streak
freezes* — that is what the freezes are FOR. A freeze you can spend, that then still cannot lose
you the streak, is not an economy; it is decoration. So the ban and the shipped mechanism disagree,
and one of them has to give. Not resolved here.

**Questions this needs to answer when it is picked up:**
- What earns points, and at what weight? A 9,000-step day and finishing a 50 km should not be equal.
- Monotonic, or can it go down? (The brand argument for never-decreasing is strong; the freeze
  economy is a real counter-argument that a stake is what makes consistency mean anything.)
- What IS the number on the main screen today, and is a prominent score compatible with
  "hearth, not scoreboard"? A number on the home screen is a scoreboard whatever its rules are.
- How do points, the streak, and the honest 5-of-7 rolling metric relate? Three measures of the
  same thing that disagree is worse than one.

**Explicitly NOT the near-term problem.** The owner's refocus, verbatim:

> For now let's just really consider "is a task done?" and "do we show the user that it's done?"
> and how does the coach assess your progress... which is really about hitting your targets. The
> coach isn't going to care that you're 10% off or not, they'll use that as a data point to help
> you adjust your program for the following week.

That is the frame for daily targets (the A10 exploration, cancelled mid-flight): the day's quantity
is **a data point for RE-PLANNING, not a score**. Its value is the signal it gives `replan.ts` /
`synthesize-plan` — "this 9K target was consistently 60% met, lower it or re-shape it" — not any
award. Which dissolves the threshold argument entirely: nothing is being awarded, so there is no
tolerance to place and no curve to choose.

For the record, since it came up and would otherwise be re-litigated: a flat ~10% "close enough"
rule is wrong on two counts. It is **direction-blind** — 10% over a calorie LIMIT is not close
enough, it is over — and it **does not scale**: 10% of 9,000 steps is a ten-minute walk, 10% of a
marathon is 4.2 km. "Met or exceeded" needs no tolerance, and a near miss deserves honest warm
words ("900 short — that's a ten-minute walk if you fancy it") rather than being rounded up on the
user's behalf. Telling someone they hit a goal they missed is flattery, and it makes the number
mean nothing.
**A7. Never leave someone with an empty week — companion goals and next milestones (owner 2026-08-11)**

Owner's framing: *"The objective is to always have a schedule of routines ready for the user. If
their schedule of tasks is relatively empty, then their habits will have fallen off and we'll have
been a bad lifestyle coach."*

Three moments, one principle:

1. **End of onboarding with a single goal.** Cadence asks whether they want to take on anything
   else, and SUGGESTS related ones — analysing the goal to propose routines that serve the primary
   objective. Owner's examples: a race in October → learning to optimise nutrition alongside it; a
   gratitude practice → breath work or meditation; writing a novel → walking meditation.
2. **A major milestone lands.** She helps them line up the next one rather than letting the plan
   quietly run out.
3. **A thinning schedule** is itself the signal that habits have fallen off.

**There is no tension here, and framing it as one (my first draft did) gets the design wrong.**
Owner's correction, 2026-08-11, and it reshapes the guardrail rather than fitting around it.

"Don't take on too much" is NOT a cap on how many goals someone may hold. It is a question about
FEASIBILITY AGAINST THEIR ACTUAL AVAILABILITY, and it cuts both ways:

- **Does it fit?** Fifteen activities a day does not fit anyone's Tuesday.
- **Is it ENOUGH?** *"Cadence needs to discover that they won't be able to achieve their objective
  of running a marathon if they can only run twice 15 minutes a week, because they're writing a
  novel and practicing piano."* A plan can be comfortably inside someone's time and still be
  nowhere near what their stated objective demands. Saying so plainly is the coach's job — it is
  BRAND.md's "plain kind words for hard things", not discouragement.

And the ceiling is personal, not a constant: *"unless they're retired, you know then... shit, take
on 20 things at once if you want."* Someone with open days can carry what would crush someone with
two 15-minute windows. So the number that matters is availability against demand, per person —
never a fixed count of goals.

**This means `goal-guardrail.ts` is probably the wrong shape**, not merely something to route
around. A weighted focus budget with a hard cap on goal COUNT answers a question nobody asked. The
question is whether the WEEK'S DEMAND fits the week's availability, and whether that demand is
sufficient for the objectives on the books. `baseline.availability` (windows + session length,
shipped this week) is the input that makes the first half computable for the first time; the
second half needs the goal's `brief` to know what the objective actually demands. Both landed in
the last few days, which is why this is newly buildable.

Companion suggestions then stop being a threat to the guardrail and become part of the same
calculation: an offer is only made when it fits, and it is weighed against the goals already held.

**Brand constraints this must not break:**
- *The offer is justified by THEIR objective, never by their emptiness.* Owner's correction: the
  framing is never "your schedule is looking empty". It is *"good eating habits will improve your
  marathon performance, want to explore that?"* or *"cold showers and meditation can lower your
  cortisol before bedtime and help with that sleeping routine, are you open to exploring these
  practices?"* — the suggestion earns its place by serving something they already told us they
  want. That is coaching. Emptiness-framing would be shame, and BRAND.md forbids it; the thin
  schedule is our SIGNAL to look, never our opening line.
- *Confirm before committing.* A suggested goal is an offer, never an addition. It goes through the
  same "here's what I heard — did I get it right?" gate.
- *Hearth, not scoreboard.* "Always have a schedule ready" must not become "always be busy". Rest
  weeks, taper weeks and deliberately quiet periods are legitimate and must not read as decay.

**What already exists to build on:**
- `Goal.brief` (migration 0030, this week) is what makes "analyse the goal" possible at all — the
  load-determining facts in the user's own words now travel with the goal to any job that needs
  them. Before it, a proposer would have had a title and nothing else.
- `ensureHorizon` already tops the plan up ~2 weeks ahead, so "the schedule runs out" has partial
  cover; what it cannot do is notice that the GOALS have run out.
- `evaluateGuardrail` already computes weighted load — the number a proposer needs to size against.
- The quick-pick protocol already renders an offer as tappable options.

**Open questions, none answered:**
- What counts as "relatively empty"? Occurrences per week, or goals with any live activity? A taper
  week is empty by design. (Note the signal is for US, to prompt a look — it is never said aloud in
  those terms.)
- What does the two-sided feasibility check actually compute, and does it replace `evaluateGuardrail`
  or wrap it? "Enough for the objective" needs a notion of what a 50 km in ten months demands, which
  is judgement, not arithmetic — likely a job reading the goal's `brief` against the week's load.
- Does a companion suggestion create a GOAL, or a lighter thing (a routine attached to an existing
  goal)? The nomenclature table has no word for the lighter thing, and inventing one is a brand
  decision.
- Who proposes — the coach mid-conversation, or a job (`suggest-companions`) whose output she
  offers? A job is auditable and testable; a coach turn is warmer.
- On milestone completion, how soon? Immediately risks stepping on the moment. There is a real
  argument for letting an achievement stand for a day before asking "what's next".
- How often may she re-offer after a no? Once declined, silence for how long?

Not scoped. Needs a design pass before any code.

**A8. Averages are the wrong question — recent performance, previous bests, and analysing a run (owner 2026-08-11)**

Owner: *"Cadence captures AVERAGES from Apple Health but doesn't look at max distance (previous
achievements) or recent performance. She should consider these as she would in a weekly check-in —
what did the last month ACTUALLY look like, not averages. During onboarding she said 'you're
averaging 4.3km a run at 36 mins' — I've done 3-5 runs of 5-6km in the past 7 days and 16K
steps/day. Where did that number come from?"*

**Where the 4.3 km came from — settled.**

The number is not a bug in anything. It is exactly what the pipeline is built to produce, and every
step of it is wrong for the question the owner was actually asking.

- `buildDigestFromWorkouts` (`apps/cadence-web/src/features/onboarding/health-digest.ts`) buckets
  every workout by type and takes a **flat arithmetic mean** of `distanceKm` and `durationMin` per
  bucket, over a **rolling 90-day window** (`DIGEST_PERIOD_DAYS = 90`). `fmtType` in
  `apps/cadence-api/src/services/health-context.ts` renders that row verbatim: "avg 36 min, avg
  4.3 km". The same ten runs are quoted in the header of
  `apps/cadence-api/src/services/observed-health.ts`.
- So five 5–6 km runs this week are averaged against everything back to mid-May, and a build-up is
  indistinguishable from a taper. **Nothing anywhere in the pipeline computes a maximum, a personal
  best, a last-4-weeks figure, or any recency weighting.** There is no field for one to live in.
- `HealthPlugin.swift:395` returns `"distance": workout.totalDistance?.doubleValue(for: .meter())
  ?? 0` — absence becomes **0**. `toSeamWorkout`'s `typeof w.distance === 'number'` is therefore
  ALWAYS true, and `buildDigestFromWorkouts`'s `.filter((n) => n != null)` never drops a thing. A
  treadmill run, or a session mistyped as a run, is averaged in as a 0 km run and pulls the mean
  down. "No distance recorded" and "0 km" are the same value by the time we see them.
- The digest ALREADY carries the last **five** workouts individually (`MAX_RECENT = 5`; the server
  schema allows 10) and **nothing renders more than `recent[0]`** — `renderHealthDigest` prints one
  "most recent" line, `toObservedHealth` builds `most_recent_workout` from the same single row.
  Four dated sessions we already collect, store and validate never reach a model.
- Steps are the one part that already does this right: `dailySteps` carries `avgPerDayLast7`
  alongside the 90-day mean and a `byWeek` series, and `observed-health.ts` passes all of it. The
  16k-steps-a-day reading is fine. Workouts have no equivalent.

**What the plugin can actually give — audited (`node_modules/capacitor-health`, both the TS
definitions and the Swift it ships).**

Available today and unused, no native code required:

- `id` = `workout.uuid.uuidString` (`HealthPlugin.swift:392`). A stable per-workout identity —
  the join key A14's canonical history store needs. `PluginWorkout` in `native.ts` drops it.
- `sourceName` / `sourceBundleId` (`:390–391`). Which device or app recorded it: the only way to
  tell a Watch run from the iPhone's duplicate of the same run, or a Strava import from a native one.
- `calories` (`:394`) and `endDate` (`:388`) — emitted on every row, both discarded at the seam,
  and we already hold the `READ_ACTIVE_CALORIES` permission for the first.
- `steps?: number` per workout, behind `includeSteps: true` (`:426–433`) — HealthKit's stepCount
  aggregated over the workout's own interval. Divided by duration this is the **only** cadence
  figure obtainable: one average steps/min for the whole run. Not per-split, not Apple's stride data.
- `heartRate?: HeartRateSample[]` behind `includeHeartRate: true` (`:403–412`, `:456–484`) — the
  raw `{timestamp, bpm}` series, one entry per HealthKit sample. It is **not** an average: the
  plugin never emits an `avgHeartRate` key at all, which is why `toSeamWorkout`'s `w.avgHeartRate`
  read has always been `undefined` and `Workout.avgHr` has never once been populated (verified by
  A13). HR coaching is blocked on this seam, not on the hardware. Any average is ours to compute.
- `route?: RouteSample[]` behind `includeRoute: true` (`:415–424`, `:487–543`) —
  `{timestamp, lat, lng, alt}` per CLLocation. **It also needs the `READ_ROUTE` permission, which
  `HEALTH_PERMISSIONS` in `native.ts` does not request.** Setting the flag without adding the
  permission returns an empty array, not an error — a silent nothing.

Genuinely NOT available without writing Swift:

- **Apple's own lap and segment markers** (`HKWorkoutEvent`). Never queried. Any splits are ours
  to derive; we cannot show the user the same splits the Fitness app shows them.
- **Running form metrics** — `runningSpeed`, `runningPower`, `runningStrideLength`,
  `runningVerticalOscillation`, `runningGroundContactTime`. No constant for them exists in the
  `HealthPermission` union, and no query path reaches them.
- **A distance time-series.** `queryRecords` hard-rejects everything but steps ("queryRecords
  currently only supports dataType 'steps'", `:291–292`) and `queryAggregated` knows only
  `steps | active-calories | mindfulness`. `distanceWalkingRunning` samples are unreachable, so
  **an indoor or treadmill run has no route, no distance timeline, and cannot be split at all** —
  its only derivable detail is average cadence from `steps`.
- Resting HR, HRV, VO₂max, weight, sleep — no permission constants, no queries. (`native.ts`
  already returns `null` for weight and sleep and says a Swift extension is the future path.)
- Anything incremental. There is no anchored query; every read re-fetches the whole window.

Hazards in the plugin's own code that a richer read has to handle:

- **Nothing is sorted.** Both `HKSampleQuery` calls pass `sortDescriptors: nil`, and `queryRoute`
  appends the locations of multiple `HKWorkoutRoute` objects in completion order (`:501–507`).
  Splits maths must sort by timestamp before it does anything else.
- **`includeRoute` is all-or-nothing across the whole window.** One `queryWorkouts` call fetches
  the full route of EVERY workout between `startDate` and `endDate`. Over the 90-day digest window
  that is potentially hundreds of thousands of CLLocations serialised through WKWebView. Route can
  only ever be fetched **per run**, with the dates narrowed to that one workout.
- The response carries an `errors` map (`{'heart-rate', 'route'}`, `:446`) that our TS types do not
  declare, so a partial failure is currently invisible to us.

And the boundary rule holds over all of it: `apps/cadence-api/src/validation/health.ts` exists to
stop raw-sample-sized payloads reaching the server, and both series above are exactly that — a
36-minute run is roughly 430 HR samples and a couple of thousand locations. **Derive on device,
ship derived shapes.**

**What she should look at instead.**

The test every field below has to pass: *it changes a coaching decision*. A number that only makes
the payload look thorough is a number that costs context and buys nothing.

1. **The sessions themselves, dated — the cheapest fix in this entry.** Not a statistic: the list.
   "6.1 km / 34 min on the 9th, 5.4 km / 31 min on the 7th, 5.8 km / 33 min on the 4th…" answers
   the owner's complaint with no arithmetic at all, because five 5–6 km runs in seven days is
   *visible* the moment you stop collapsing them. We already collect, validate and store these
   rows; `MAX_RECENT = 5` on the client, 10 in the schema, and exactly one is ever rendered.
   Decision it changes: what to schedule next week, and whether the plan we already wrote is
   remotely near what this person does.
2. **A recent window beside the baseline one.** Per modality: sessions, total km and mean distance
   over the last **28 days**, next to the same over the full period. Twenty-eight rather than seven
   because one week is one bad week — 28 days is the owner's "last month" and survives a missed
   one. Decision: whether to build on what they are doing now or on what they were doing in May.
3. **Previous bests, each with its date.** Longest distance, longest duration, and — where both
   distance and duration exist — the quickest pace over a comparable distance. This is the
   *anti-streak*: a best is counting what happened, and it never resets to zero, which is exactly
   what the brand promise asks for. The date is not optional decoration: "your longest is 12 km"
   and "your longest is 12 km, back in March" are different facts and lead to different sessions.
   Decision: how to size a milestone, and whether today's 8 km is a stretch or a Tuesday.
4. **Direction of travel — last 28 days against the 28 before them.** Sessions and total volume,
   two plain numbers, no slope and no index. Decision: add load, hold, or back off. Naming rule:
   the field is `prior_28`, never `decline` or `dropoff` — the payload carries numbers and the
   persona decides how to speak, and a quiet fortnight must be able to read as a taper, a holiday
   or a hard week rather than decay. Hearth, not scoreboard.
5. **Pacing consistency.** Over the sessions with both distance and duration: typical pace plus the
   spread (median and range, not a standard deviation — a coach reasons in "your easy runs and your
   quick ones", not in variance). Decision: someone whose every run lands between 5:45 and 6:00/km
   is running the same run over and over and should be offered variation; someone ranging 4:30 to
   7:30 is already doing genuinely different sessions and needs the opposite advice. Derivable
   today from data we already hold — no new permission, no new read.
6. **How much of the average is actually measured.** `distance_recorded_for: 6 of 10 sessions`.
   Given the `?? 0` above, an average distance can rest on a minority of the runs and nothing says
   so. Decision: whether to trust the number, and whether to ask about the rest instead of
   asserting. Paired with the seam fix — treat a `distance` of exactly `0` as *not recorded* rather
   than as zero kilometres, since HealthKit's `?? 0` makes the two indistinguishable and no real
   run covers 0.000 m — this is what stops treadmill sessions dragging the mean down.
7. **The 16k-steps person, read correctly.** Steps are already the one half of this that works:
   `avgPerDayLast7` sits beside the 90-day mean with a `byWeek` series, and `observed-health.ts`
   ships all of it under a `what_this_is` that says in words that high steps with few workouts
   means an active person who does not press start, not a sedentary one. The asymmetry is the bug:
   **workouts get no last-7 or last-28 figure at all**, so the recent half of the picture exists
   for steps and not for training. Items 2 and 4 make the two halves symmetric, and that is the
   whole fix — we should NOT add an `unrecorded_activity_likely` flag. That is an inference dressed
   as a measurement, and both series in front of the coach are better than one guess.

Deliberately **rejected**, so nobody adds them later without an argument:

- *Average heart rate per workout.* Even once the seam is fixed (A13), an average bpm with no
  resting HR and no max is uninterpretable — and resting HR, HRV and VO₂max are precisely what the
  plugin cannot read. HR earns its place inside single-run analysis, not in the standing digest.
- *Calories.* Emitted on every row and permissioned already, but nothing Cadence decides turns on
  it, and activity calories invite an in/out conversation the nutrition side deliberately avoids.
- *Any composite score or fitness index.* Scoreboard.
- *Deleting `avgDistanceKm`.* It is not wrong; it was only ever wrong as the **only** line.

**Where these are computed, and why it is not the digest.** A14 established the canonical
per-workout store (`workouts`, a new table — **not** `cadence.occurrences`, which is date-keyed
with `unique (activity_id, date)` and has no instant, so two runs on one Tuesday collapse into one
row). Every shape above is a **view over that store, derived server-side**, not a new column on
`health_digests`. The device's job shrinks to what only the device can do: read HealthKit and ship
per-workout rows — with the `id`, `endDate`, `sourceName` and `sourceBundleId` the seam currently
throws away — into the canonical store. A workout row is not a raw sample: ten to a few hundred
rows over ninety days, against the tens of thousands of HR samples and locations behind them. The
`validation/health.ts` rule is satisfied by that distinction, not violated by it, and we already
send ten such rows today. `renderHealthDigest` and `toObservedHealth` become two renderings of the
canonical store, which is also what stops them drifting into two phrasings of the same facts.

**What she should look at instead.**

The frame is the owner's: what did the last month ACTUALLY look like. Every field below has to
change a coaching decision or it does not go in.

- **Fix the zero first.** Until `distance ?? 0` is distinguished from a real zero, every figure
  below inherits the same lie. Absent distance must be `null` at the Swift seam, and the digest's
  `.filter((n) => n != null)` then does what it already claims to. This is a prerequisite, not a
  feature — and it is the cheapest fix in this entry.
- **A recency pair, not one mean.** Steps already model this correctly (`avgPerDayLast7` beside
  the 90-day figure, plus `byWeek`); workouts get the same shape — last-4-weeks beside the 90-day
  baseline. Two numbers side by side ARE the direction of travel, and they cost nothing but a
  second reduce over data we already hold.
- **Bests, which do not exist anywhere today.** Longest distance and longest duration per type,
  each with its date. A previous best is the single most useful thing a coach knows about someone
  training for a distance goal: it is what makes "you've run 21 km before, 50 km is a different
  animal but not an unknown one" sayable at all.
- **The last five sessions, individually, with dates.** We already collect, bound and validate
  them; only `recent[0]` is ever read. Rendering the other four is free signal, already paid for,
  and it is the difference between "you average 4.3 km" and "your last five runs were 5.2, 5.8,
  4.9, 6.1 and 5.4 km, all in the past nine days".
- **The walker case.** High steps with few recorded workouts must read as an active person who
  does not press start, never as a sedentary one. `dailySteps` already carries this; the coaching
  language around it does not exist yet.

Deliberately NOT included: anything derived from HR (the seam is broken — see above), and any
per-sample series crossing the boundary. `validation/health.ts`'s rule holds — derive on device,
ship the derived shape, and let the bound be part of the schema.

**Analysing a run — feasibility, then shape.**

Split analysis is possible for OUTDOOR runs only, and it is ours to compute: `route` gives
`{timestamp, lat, lng, alt}` per CLLocation, so per-kilometre splits fall out of consecutive-point
distance against elapsed time. It requires adding `READ_ROUTE` — a new HealthKit ask, on a
permission surface that has already bitten us twice, and one the user may reasonably decline for a
coaching app. Note also the privacy asymmetry: we need the SHAPE of the effort, not where they
went, so the route must be reduced to splits on device and the coordinates discarded — they must
never reach our server.

An indoor or treadmill run **cannot be split at all** (no route, no distance timeline,
`queryRecords` refuses anything but steps). Its only derivable detail is average cadence from
`steps ÷ duration`. Say so plainly in the UI rather than silently offering less.

Where it lives: on demand, from a completed session, because "how did that run go?" is a question
asked the same evening — with the weekly check-in citing the same derived summary rather than
recomputing it. That implies one new job (`analyse-run`) taking a bounded split summary plus the
goal's `brief`, and never raw samples.

Brand: the splits are evidence, not a verdict. "Your last kilometre was your fastest — you had
more left than you thought" is coaching. "You faded after 3 km" is a scoreboard, and on a bad day
it is a wound. Count what happened.

**Architecture scaffold.**

| Component | Owns | Status |
|---|---|---|
| `HealthPlugin.swift` (vendored) | `distance ?? 0` → null; already emits `id`, `sourceName`, `sourceBundleId`, `endDate`, `calories`, `steps`, `heartRate`, `route` | EXISTING, under-consumed |
| `lib/capability/native.ts` | the seam: pass through the dropped fields; add `READ_ROUTE` only when split analysis ships | EXISTING, needs widening |
| `features/onboarding/health-digest.ts` | derive on device: last-4-week aggregates, bests, the five recent sessions, split summaries | EXISTING, extend |
| `validation/health.ts` | bounded schema for the above; the abstraction rule stays | EXISTING, extend |
| A14's `workouts` store | per-workout canonical rows, keyed by the plugin's `uuid` | PROPOSED (A14) |
| `services/observed-health.ts` | becomes a VIEW over A14's store rather than a parallel pipeline | EXISTING, re-point |
| `analyse-run` job | one run's derived splits + goal `brief` → coaching read | PROPOSED |

Flow: HealthKit → plugin (all fields) → seam → on-device derivation → bounded POST → A14's store →
views (digest, `observed_health`, recap) → coach.

**Open questions.**
- Is `READ_ROUTE` worth the permission cost, given it buys splits for outdoor runs only? A
  reasonable first slice ships everything above WITHOUT it and adds it if users ask.
- Four weeks is asserted, not derived — is it the right recency window for someone training across
  a ten-month build?
- A "best" needs a per-type comparison rule (fastest 5 km is not the same question as longest run);
  which bests are worth keeping per area, and does a `mind`-pillar session have one at all?
- The 0 km fix changes historical digests silently — do we re-derive stored digests, or let the
  series carry a known discontinuity?
**A9. Intermittent fasting — a meal skipped on purpose still counts against you (2026-08-11)**

A real generated plan carried the recurring activities "Log breakfast — Every day" and "Log lunch
— Every day". For a 16:8 eater breakfast is skipped *by design*, so every single day they leave a
scheduled activity unfulfilled. That is BRAND.md inverted — "count what happened, never what
broke".

**The defect is real, and it is narrower and nastier than "consistency drops".** Reading the code
first, because the exact blast radius decides the fix:

- `rollingConsistency` (`apps/cadence-api/src/services/metrics.ts`) is **per-day, not
  per-activity**: it counts days with ≥1 `done` occurrence. A fasting user who logs lunch and
  dinner still has a kept day. The headline "5 of 7" is NOT wrong.
- Nothing in the codebase ever writes `'missed'`. The status exists in the enum
  (`migrations/cadence/0001_init.sql:96`, widened in `0016_episode_engine.sql:16`) and readers
  branch on it, but a forgotten occurrence just stays `pending` forever. "Missed" is *derived*:
  `situation.ts:82` counts `status === 'pending' && date < today`.
- That derived count is what does the damage. It feeds `missedCount` →
  `detectTripwires` against `steer_back.missed_threshold` (default 3). **A 16:8 eater trips the
  "they're falling off" tripwire on day three and never stops tripping it.**
- `evaluateStreak` (`streak.ts:60`) puts `pending` into `dueDays`, so every fasting day is a day
  with an unmet obligation. It is rescued only by `engaged` (any `done` that day) — so the streak
  survives, but only accidentally, and only while they log something else.
- `replan.ts:31 recentActivity` ships `scheduled: occ.length` alongside `done`, so synthesis sees
  a person completing ~2/3 of their plan forever and keeps re-planning around a shortfall that
  does not exist.

So: consistency is fine, the tripwire and the replan signal are not, and the *daily lived
experience* — a breakfast card sitting there unfulfilled every morning, a coach asking about a
meal you deliberately did not eat — is the worst part and is not a metric at all.

**Collateral, and worse than the fasting case: the tripwire is already broken for everyone with a
nutrition goal.** `missedCount` counts every past-due pending occurrence over a 14-day window, and
the per-meal split (7a9366e) put FOUR daily occurrences in that window — 56 of them. The default
`missed_threshold` is 3. One forgetful Tuesday trips "they're falling off the plan". Fasting only
makes permanent what is already firing weekly. Whatever else we do here, a system meal-log task is
not evidence someone is drifting, and the tripwire should not count it.

The fix has a precedent in the repo, which is the tell that the distinction is already understood:
`pauseUserOccurrencesInWindow` (`repos/occurrences.ts:336`) shelves an episode's occurrences with
`and a.kind = 'user'`, and its comment says why — "the effortful ones — system tracking like
food/weigh-in keeps running". `situation.ts` should read the same predicate. Ticking a food log is
not the work; it is how we watch the work.

### The thing we got wrong

**`synthesize_plan` already knows exactly what to do.** The prompt has carried a FASTING/OBSERVANCE
clause since 7a9366e, the same commit that split the food log into per-meal tasks:

> if a goal or constraint involves fasting or a set eating window (16:8, OMAD, etc.), DROP the meal
> tasks that fall outside the window — 16:8 usually means no breakfast (keep lunch, snack, dinner),
> OMAD keeps a single meal; if a constraint notes Ramadan, use suhoor (pre-dawn) and iftar
> (post-sunset) instead of the usual set.

So this is not a coach that doesn't know. **It is a coach nothing can tell.** The clause fires only
"if a goal or constraint involves fasting", and there is no field anywhere that holds an eating
window. The Broker's `baseline_updates` contract (`capture-extract`) accepts age, sex, height,
weight, `availability`, `starting_point`, `constraints` — and nothing else. "I eat between noon and
eight" has nowhere to land. Today the clause only fires by luck: the user phrases fasting as a
*goal* ("Do a 16:8 intermittent fasting window"), or the Broker files it as a *constraint* — which
is wrong, and wrong in a way that matters. `constraints` is "what we work around". Fasting is not
something you work around; it is how you eat. Filing it there tells the whole planner to treat a
person's chosen rhythm as an impairment, and `plan_around: true` will start deleting things.

Second thing the clause cannot fix: **the plan is a snapshot.** Someone who starts 16:8 in week
five keeps "Log breakfast" until the next replan, and someone who mentions it mid-conversation gets
nothing at all. `ensureHorizon` (`plan-horizon.ts`) has already materialized 14 days of pending
occurrences from the old recurrence.

### The model

**1. `baseline.eating_window`, modelled on `availability` — not on the dietary profile.**

`availability` is the precedent and it fits almost exactly: it is the shape of someone's day, stated
in their own words, with optional clock edges, held top-level on `Baseline` (the comment in
`types/baseline.ts` says why — the baseline persists as a shallow jsonb merge and a nested write
would clobber its siblings). An eating window is the same kind of fact about the same day.

It does *not* belong on `dietary_profile`. That column is a safety input — hard allergen excludes
consumed by `dietary-safety.ts` before anything is suggested. An eating window excludes no food.
Putting a way of eating next to a list of things that could hurt you is a category error the
allergen pass would then have to defend against.

```ts
/** One span they can eat in. Clock edges only when they gave them. */
export interface EatingWindowSpan {
  earliest?: string;  // "12:00"
  latest?: string;    // "20:00"
  /** Days this span applies to, as the RRULE codes `scheduling.ts` already parses
   *  ('MO'|'TU'|…). Absent = every day. Present is how 5:2 and "weekdays only" are
   *  expressed — two different days, two different spans. */
  days?: string[];
}

export interface EatingWindow {
  /** Their words, always — "16:8", "OMAD", "I just skip breakfast", "Ramadan". Never our label. */
  said_as: string;
  /** Empty means they named a pattern we could not turn into clock times. Still keep it:
   *  the coach reads `said_as` and can ask. Never a guess. */
  windows: EatingWindowSpan[];
  /** YYYY-MM-DD it stops being true, when they said so (Ramadan, a trial month) — same
   *  semantics as `Constraint.until`. Absent = open-ended. */
  until?: string;
}
```

`baseline.eating_window?: EatingWindow`. No migration — `baseline` is jsonb. `capture-extract`'s
`baseline_updates` gains the key, and that single change is what makes the existing FASTING clause
reachable at all.

**Absent means they never said, and nothing may infer it.** This is the load-bearing rule and it is
not a nicety: we have already run this experiment. `days_per_week` was captured, went 1 → 2.5 → 2
for a man training for a 50 km ultra because the app kept reading descriptions of the present as
statements of capacity, and the number then acted as a hard ceiling on his plan. "He hasn't logged
breakfast in nine days, he must be fasting" is the identical mistake with a worse ending: a person
who was simply busy in the mornings gets breakfast quietly deleted from their plan and a coach who
stops mentioning it. The window is written when someone says it, by hand in Settings, or not at all.

**2. Fewer meal tasks, never rescheduled ones.** The clause's DROP is right and should stay. A "Log
breakfast" card sitting at 13:00 is a lie about what breakfast is, and the entire point of the
per-meal split was that each task lands at the moment you'd actually do the thing. 16:8 →
lunch/snack/dinner. OMAD → one meal task. Ramadan → suhoor and iftar. 5:2 → the `days` field on a
span lets synthesis emit `FREQ=WEEKLY;BYDAY=…` for the fuller days and a lighter set on the two low
ones, which is the only one of these patterns the current all-or-nothing clause cannot express.

**3. Eating at 11 instead of 12 is not failing at anything, so record nothing.** There is no
breakfast occurrence to fail, and the meal itself logs normally — `parse-meal` infers `meal` from
the user's words and an 11am meal comes back `lunch` or `other`. That is the whole mechanism, and it
is enough.

**Explicitly do NOT add an `off_window` flag to `nutrition_logs`.** A flag exists to be counted, and
the only thing you can build from a count of off-window meals is a tally of the times someone broke
their fast. That is a scoreboard, and it is the exact move BRAND.md bans. The coach may notice
timing out loud and warmly ("you ate earlier today") — she may never keep score of it.

The one thing genuinely missing is the opposite of a flag. **`nutrition_logs` has no clock time at
all** — `date` (a date), `meal`, and `created_at`, which is an insert timestamp, not an eating time.
So `nutrition_baseline`'s prompt asks the coach for a read on "timing" from data that contains none,
and for a fasting user timing is the whole subject. An optional `eaten_at` is the honest addition
here: know when they ate, describe it, never score it.

**4. What the coach must know, and where it survives compaction.** Storage is durable; that is not
the same as present in the turn. The retrieval registry (`services/retrieval/registry.ts`) is the
layer that decides what reaches the coach, and it has `get_constraints`, `get_weight`,
`get_dietary_profile`, `get_food_log` — and **nothing that renders `availability`**. Copying
availability's storage pattern and stopping there would faithfully reproduce its hole.

So: store on `baseline`, but render inside **`get_dietary_profile`** rather than minting a
fifteenth function. Its description already reads "use before suggesting foods/recipes" — precisely
the moment the coach must not offer breakfast — and its domains are already `['nutrition','safety']`,
so `context_select` pulls it for any food turn without a catalog change. One line in the render:

> `Eats between 12:00 and 20:00 (their words: "16:8").`

One fact, two readers, each through the door it already uses: the planner reads `<baseline>`, the
coach reads the dietary block. Write that asymmetry down where the column is defined so nobody
tidies it up later by moving the field.

**5. Safety: change nothing, and that is a recommendation, not a dodge.** The house already drew
this line and drew it well. `goal-screen.ts` deliberately omits "fast" from `HARM_TERMS` — its own
comment says these words are "ordinary and the false positive would be brutal" — and *"Do a 16:8
intermittent fasting window"* is a committed passing test case (`goal-screen.test.ts:22`). The coach
persona refuses *"fasting to compensate for eating"*, and `plan-vet` repeats it. That is the correct
distinction, already implemented: the harmful thing is a compensatory act, not a way of eating.

No pregnancy/ED/medication interstitial. Cadence does not know a user is pregnant, holds no
medication list, and cannot ask without imputing a category to someone who just told us how they
eat. Over-warning is its own harm and it lands hardest on exactly the person the warning is for: a
user with an ED history, being told by an app that their eating is suspect. We have a crisis
boundary in the persona for real signals; a stated eating window is not one.

The one gap worth closing is the mirror image — Cadence must never *propose* fasting.
`nutrition_baseline`'s `suggestion` is the only place the app proposes an eating change, and its
rule is already "additive or a gentle swap". One clause making it explicit that narrowing an eating
window or dropping a meal is never the suggested change delivers the "never prescribes" half of the
requirement for the price of a prompt edit.

**6. The observe phase needs one clause.** `OBSERVE_DAYS_NEEDED = 7` (`nutrition.ts:328`) counts
distinct dates with any meal, so a fasting user reaches it on schedule. But
`meals_per_logged_day` will read ~2 where the prompt expects ~3.5, and `nutrition_baseline` must not
read that as a thin log. When a window is on file, fewer meals per day IS the pattern.

### ARCHITECTURE

| Component | File | Status | Role |
|---|---|---|---|
| `EatingWindow` / `EatingWindowSpan` types | `packages/cadence-shared/src/types/baseline.ts` | **proposed** | Alongside `Availability`; `baseline.eating_window?` |
| Baseline storage | `cadence.users.baseline` jsonb | existing | No migration; shallow-merge write, top-level key |
| Broker capture | `capture-extract` → `baseline_updates` in `config/ai-admin/ai-admin.config.json` | **proposed** (extend) | The missing input. Only writes what was said |
| Capture normalize/guard | `apps/cadence-api/src/services/capture-normalize.ts` | **proposed** (extend) | Assert model output before commit — same as `isTimeOfDay` |
| Manual edit | Settings / review wizard (`apps/cadence-web`) | **proposed** | Like `time_of_day` — hand-editable, never inferred |
| Plan synthesis | `synthesize_plan` prompt (FASTING/OBSERVANCE clause) | existing; **extend** for 5:2 `days` | Drops out-of-window meal tasks at generation |
| Plan vet | `plan_vet` prompt | existing | Already flags fasting-to-compensate; no change |
| Occurrence materializer | `apps/cadence-api/src/services/plan-horizon.ts` | existing | 14-day rolling horizon; **the reason a snapshot fix is not enough** |
| Mid-plan retirement | new service beside `episode-overlay.ts` | **proposed** | On a window write: drop the out-of-window meal activities + clear their FUTURE pending occurrences (replan already does this wipe). Not `skipped` (that is the user's acknowledgement) and not `paused` (that is episode-owned and an episode is a rough patch, which a way of eating is not) |
| Tripwire | `apps/cadence-api/src/services/situation.ts:82` | **proposed** (fix) | Count only `a.kind = 'user'` occurrences in `missedCount` — the predicate `pauseUserOccurrencesInWindow` already uses. Fixes the collateral bug above for everyone |
| Replan signal | `apps/cadence-api/src/services/replan.ts:31` | **proposed** (fix) | `scheduled` should not count meal-log tasks a fasting user was never meant to tick |
| Consistency / streak | `metrics.ts`, `streak.ts` | existing — **no change** | Per-day and already correct |
| Coach retrieval | `retrieval/registry.ts` → `get_dietary_profile` | **proposed** (extend render) | How the fact reaches a turn and survives compaction |
| Meal parse | `parse-meal` prompt, `nutrition_logs.meal` | existing | An off-window meal is just a meal; no new field |
| Meal clock time | `nutrition_logs.eaten_at` | **proposed** (migration) | The only new column; makes "timing" real for a prompt that already asks for it |
| Baseline read | `nutrition_baseline` prompt | **proposed** (extend) | Never propose narrowing a window; low `meals_per_logged_day` is the pattern, not a gap |
| Safety screens | `goal-screen.ts`, coach persona | existing — **no change** | Line already correctly drawn |

Data flow: **user says it → `capture_extract` → `baseline.eating_window`** → read by
`synthesize_plan` (via `<baseline>`, drops the tasks) *and* by `get_dietary_profile` (via the
context pack, stops the breakfast suggestion). Meal logs flow independently and are never scored
against the window.

### First slice

Ship the four changes that remove the harm, in one PR each:

1. `EatingWindow` type + `baseline.eating_window` + `capture_extract` writes it. Nothing else
   changes and the FASTING clause becomes reachable for the first time.
2. `get_dietary_profile` renders it — the coach stops offering breakfast.
3. Count only `kind = 'user'` occurrences in `situation.ts` `missedCount`. Independently correct,
   already precedented, and a live bug for every user with a food goal, not just fasting ones.
4. Mid-plan retirement of out-of-window meal activities, so week five works like week one.

`eaten_at`, the 5:2 `days` handling, and the `nutrition_baseline` clauses follow. Not scoped yet.
**A14. One history, many doors — Cadence's canonical workout store (owner 2026-08-11, NOT BUILT)**

Owner requirements 4 and 8: write our own completed sessions to HealthKit so they count for the
rings, and give people who trained before us a way to bring their history in. Both land on the same
question — what happens when the same run arrives twice — and the owner answered it: *"I think
that's why we kind of have to try to compose our own historical, no?"* So **Cadence keeps THE
canonical per-workout history**, composed from HealthKit reads, our own in-app sessions, Strava
imports (A16) and later Oura. It is the hub the coach reads; everything else is a door into it.

**Verified: `capacitor-health` cannot write, and the permission constant is a trap.**
`WRITE_WORKOUTS` is in the `HealthPermission` union (`node_modules/capacitor-health/dist/esm/
definitions.d.ts`, v8.1.2, unpatched — no `patches/`, no override), and the Swift side really does
honour it: `permissionToHKObjectWriteType("WRITE_WORKOUTS")` returns `[HKObjectType.workoutType()]`
and feeds it to `healthStore.requestAuthorization(toShare:read:)`
(`node_modules/capacitor-health/ios/Sources/HealthPluginPlugin/HealthPlugin.swift:44,72`). But
`HealthPlugin` exposes **no save method at all** — `isHealthAvailable`, `checkHealthPermissions`,
`requestHealthPermissions`, two settings openers, `queryAggregated`, `queryWorkouts`, `queryRecords`,
and nothing else. We can ask the user for permission to write and then have no way to write. Asking
for a scope we cannot exercise is worse than not asking: it spends the one prompt iOS gives us.

**Recommendation: a small owned native bridge, not a fork.** `apps/cadence-ios/ios/App/App/
CadenceHealthWrite/CadenceHealthWritePlugin.swift`, modelled exactly on the existing
`CadenceCoachIdentity/CadenceCoachIdentityPlugin.swift` (lazy `registerPlugin`, every call wrapped,
silent fallback — see `apps/cadence-web/src/lib/capability/native.ts`). Forking `capacitor-health`
means owning a fork of the dependency our READ path depends on, for one method; the repo convention
is small owned code over forks. Two things the bridge gets that the plugin could not give us anyway:

- **`HKWorkoutBuilder` is mandatory, not a preference.** Every `+workoutWithActivityType:…`
  initializer on `HKWorkout` is `API_DEPRECATED("Use HKWorkoutBuilder", ios(8.0, 17.0))` — checked
  against the iOS 26.5 SDK header. `HKWorkoutBuilder`'s own header describes it as the way to record
  "a workout that occurred in the past", which is precisely our case: `initWithHealthStore:
  configuration:device:` → `beginCollectionWithStartDate:` → `addMetadata:` → `endCollectionWithEndDate:`
  → `finishWorkoutWithCompletion:`.
- **Write authorization is knowable; read authorization is not.** `health-permissions.ts` exists
  because iOS returns no usable answer to a read request. Write is different:
  `HKHealthStore.authorizationStatusForType:` returns `HKAuthorizationStatus` whose three cases are
  documented purely in terms of *saving* — `NotDetermined` / `SharingDenied` / `SharingAuthorized`
  (`HKDefines.h:85`). So our bridge can report the real state and the UI can stop guessing. That is
  a capability `capacitor-health` never surfaces, and it is a second reason to own this.

**Why the canonical store cannot be `occurrences`.** `cadence.occurrences` is DATE-keyed with
`create unique index occurrences_activity_date_idx on (activity_id, date)`
(`migrations/cadence/0001_*.sql:91-102`). One occurrence per activity per day, a `date` column and
no instant anywhere. Two 30-minute runs on one Tuesday are one row, and A16's dedup heuristic
(start-time proximity) has nothing to anchor to. `health_digests` (0024) is the other candidate and
is worse: one jsonb row per *share*, holding an aggregate, deliberately bounded to "≤25 types, ≤10
recent" by `apps/cadence-api/src/validation/health.ts`. Neither is a per-event record. This needs a
table.

### The shape — two tables, and the second one is the whole point

**`cadence.workout_sources`** — immutable, one row per *(source, source_id)*, never edited, never
merged. `ingest_id`, `user_id`, `workout_id` (nullable — the composition it currently belongs to),
`source` (`healthkit | cadence_app | strava | oura | manual`), `source_bundle_id` (HealthKit's
originating app, e.g. Strava's own bundle), `source_id` (HKWorkout UUID / Strava activity id /
occurrence id), `external_uuid` (the id WE put in, see below), `started_at`, `ended_at`, `payload`
jsonb (that source's own fields, as read), `ingested_at`. Unique on `(user_id, source, source_id)` —
which makes re-import idempotent for free.

**`cadence.workouts`** — the canonical row, one per real-world event, **composed** from its sources.
`workout_id`, `user_id`, `started_at` (the instant occurrences lack), `ended_at`, `duration_sec`,
`local_date` (device calendar day, so day-bucketed reads need no timezone maths), `type`,
`distance_km`, `avg_hr`, `max_hr`, `energy_kcal` (nullable and often null — see below),
`occurrence_id` (nullable FK: the join to OUR plan, when there was one), `primary_source`,
`sources text[]`, `weather` jsonb, `detail` jsonb (splits/laps from whoever had them), `composed_at`.
RLS owner policy and a `pack_touch` trigger like every other Cadence table (0022 rule).

**Argue the second table, because it costs a table and roughly doubles the rows.** Without it,
dedup is destructive: the first bad heuristic merges two real Tuesday runs into one and the inputs
are gone. With it, composition is a pure function of immutable ingests and can be re-run after the
heuristic is fixed. It is also the only way to satisfy A16's §7.4 obligation — *delete all Strava
Data within 30 days* — as an executable query rather than a forensic exercise: delete the
`source='strava'` ingests and recompose. A field-level merge into a single table cannot un-merge.

### Dedup — exact identity first, heuristics only as the last resort

Ordered, and the order matters more than any single rule:

1. **Our own bundle never re-enters.** `queryWorkouts` already returns `sourceBundleId` on every
   workout, and our bundle is `builders.cadence.app` (`apps/cadence-ios/ios/App/App/
   capacitor.config.json`). The HealthKit read path drops those rows **on the device, before the
   wire**. This is the one dedup rule that is guaranteed correct rather than probably correct, and
   it is currently impossible: `PluginWorkout` in `native.ts:68` declares only `workoutType`,
   `startDate`, `endDate`, `duration`, `distance`, `avgHeartRate` — it drops `sourceBundleId`, `id`
   and `sourceName`, all of which the plugin actually returns. Adding those three fields to
   `PluginWorkout`, `toSeamWorkout` and the seam's `Workout` is the smallest prerequisite in this
   entry and unblocks the largest part of it.
2. **Explicit id match.** A13's ruling gives us one for free: `WorkoutPlan.init(_:id:)` lets us
   choose the UUID and `HKWorkout.workoutPlan` hands it back, with plan id = f(occurrence_id),
   deterministic. Our own writes carry the same id as `HKMetadataKeyExternalUUID` (verified present
   since iOS 8.0, `HKMetadata.h:136`). So a watch-completed session matches our occurrence **by id**
   — no timestamps involved.
3. **Known self-echo.** A Strava activity carrying an `external_id` we wrote (A16's publish path) is
   our own round trip. A HealthKit workout whose `source_bundle_id` is Strava's is the same object
   arriving by a second door.
4. **Only then, fuzzy.** Same event when **starts are within 120 s AND durations within 5% AND the
   activity types are compatible**. Adopted verbatim from A16 so the two entries cannot drift.
   Distance is deliberately excluded — GPS and wrist-derived distance for one run differ by more
   than people expect, and an indoor session has none. Day-bucketing is excluded for the same reason
   the occurrence table fails: two runs in one day are normal.

**Merge fields, do not pick a winner — but pick a winner per FIELD.** The owner's question was
merge-or-winner; the answer is that row-level winner-takes-all throws away real data (Strava has the
splits, HealthKit has the HR samples, we have which prescribed items they actually did), and
free-for-all field merging produces a row nobody can explain. So: one canonical row, a
`primary_source` for the record as a whole, and a fixed precedence **per field** —

| field | precedence | why |
|---|---|---|
| `started_at` / `duration_sec` | device-measured (healthkit, oura) → api-imported (strava) → self-reported | the recorder that held the clock wins |
| `distance_km` | GPS-bearing source → device → self-reported | |
| `avg_hr` / `max_hr` | whoever actually has samples | usually only one source does |
| `energy_kcal` | device only; **never** derived, never imported into an empty field | see below |
| `detail` (splits/laps) | strava → healthkit | only Strava reliably has them |
| `occurrence_id`, `type` | `cadence_app` wins — it is the only source that knows what we asked for | |

`sources[]` records every contributor regardless. When two device sources disagree on duration by
more than the fuzzy window we should *not* have merged them — that is the signal the heuristic was
wrong, and it belongs in a log, not in a silent average.

### Flow A — write-back (our session → HealthKit → the rings)

1. Walkthrough finishes (`apps/cadence-web/src/features/walkthrough/`). **Gap: we do not currently
   keep the instants.** `state.ts` holds elapsed/round counts and composes a text line; the log goes
   through `logOccurrence` (`apps/cadence-api/src/services/session-log.ts:52`) onto a *date*. The
   walkthrough must start carrying real `startedAt` / `endedAt`, or the write has nothing to say.
2. `POST /me/occurrences/:id/log` as today → occurrence `done`. Unchanged.
3. Client → `capability.health.saveWorkout(...)` → `CadenceHealthWrite` → `HKWorkoutBuilder`.
4. Ingest row `source='cadence_app'`, `source_id = occurrence_id`, plus the returned HKWorkout UUID.
5. Compose → canonical row. **Dedup does not run here.** Its position is step 3 of Flow B, where the
   bundle filter drops our echo before any comparison happens.

**What we write, exactly.** `HKWorkoutActivityType` mapped from the session's area/tool, falling
back to `.other` rather than guessing something specific; `startDate`/`endDate` from step 1 (duration
is derived, never sent separately); `distance` only when the user actually reported it or the
prescription carried it *and* they completed it. Metadata: `HKMetadataKeyExternalUUID` = the
occurrence/plan id, `HKMetadataKeyWasUserEntered = YES` (verified, `HKMetadata.h:211`) — honest,
because no sensor measured this, and it is the flag other apps use to weight our row.

**No calories. Ever.** We have no heart rate (A13: `avgHeartRate` is never emitted and
`Workout.avgHr` has always been `undefined`), no motion data, and no body mass at that instant.
`totalEnergyBurned` is what feeds the Move ring, which is the one number the user will check, and a
fabricated figure there is a lie inside Apple's own UI. Omitting it is not a degraded write: a
workout with duration and no energy still contributes Exercise minutes, which is the honest share of
what we know. (`HKWorkout.totalEnergyBurned` is itself deprecated as of iOS 18 in favour of
`statisticsForType:` — another reason the builder path is the only one worth writing.)

### Flow B — backfill (history import)

1. **Permission moment.** WRITE is a new ask and iOS does not re-prompt for a newly-added type —
   `native.ts`'s `HEALTH_PERMISSIONS` comment records exactly this happening when `READ_STEPS`
   joined the set after people had granted the other four. So existing installs need the one-time
   re-ask, reusing the `STEPS_ASKED_KEY` pattern in `health-steps.ts` verbatim with its own flag.
   Ask at the moment of value ("want this to count toward your rings?"), never at onboarding, and
   use `authorizationStatusForType:` rather than the uninformative request response.
2. Client pages `queryWorkouts` in 90-day windows back to the bound, `includeHeartRate: false`,
   `includeRoute: false`.
3. **Filter `sourceBundleId === 'builders.cadence.app'` on the device.** Dedup step 1, here.
4. `POST /me/workouts/import`, pages of ≤200 workouts → one `workout_sources` row each.
5. **Compose on the server, per page, in one transaction**: dedup steps 2 → 3 → 4 above, then the
   per-field merge, then `sources[]`.
6. Views recompute (below). `pack_touch` fires once per page, not once per workout.

**Bound: default 2 years, hard cap 5, and "further back" is a second explicit ask.** A 4×/week
athlete is ~208 workouts a year: two years is ~420 rows, five is ~1,000, and ten years of someone
training twice a day is 5,000+ rows whose 2016 tempo run tells the coach nothing it cannot learn
from 2025. **Per-WORKOUT rows only.** That does not violate `validation/health.ts`'s abstraction rule
— a workout row is already an abstraction over thousands of samples — but the HR series is exactly
what the rule exists to stop: `heartRate?: HeartRateSample[]` is unbounded (700+ samples an hour), so
backfill must never request it, and the recent-window read that does must reduce to avg/max natively
before anything crosses into React state. The import route gets its own file
(`apps/cadence-api/src/routes/workouts.ts`) and its own zod boundary alongside `health.ts`, bounded
the same way.

### Read side — views, not a second pipeline

`observed-health.ts` is the thing to preserve, not replace: its `ObservedHealth` payload is what the
planner sees, and its shape is referenced by the `synthesize_plan` template, so changing it is a
prompt change requiring `sync-jobs.ts`. Migration path from today's `health_digests` series:

1. **Free first step.** `HealthOfferCard.tsx` already calls `getWorkouts(since)` over 90 days and
   throws the individual rows away after `buildDigestFromWorkouts` aggregates them
   (`apps/cadence-web/src/features/onboarding/health-digest.ts:130`). Send them instead of dropping
   them. Both paths run; nothing changes downstream.
2. `observedHealthFromWorkouts(userId)` computes the identical `ObservedHealth` from the store;
   `observedHealthForPlanning` prefers it, falls back to digests. No prompt change, no job sync.
3. `health_digests` stops being written. The `trend` array improves in the process: today
   `trendFromSeries` samples successive *shares* (`observed-health.ts:133`), so the trend records
   when the user happened to open the app, not when they trained. From the store it becomes real
   weeks.
4. Retire, or keep the table as a frozen audit of what was shared and when.

One rename is unavoidable and is prompt-visible: `ObservedHealth.source: 'apple_health'` becomes
multi-source. That is the one change in this entry that needs a job sync.

### A15's weather stamp lands here, and A15's assumption needs correcting

A15 puts the conditions stamp on `occurrences.weather` and says the row is "owned by A14". It cannot
be: A15's own headline field is `observed_at` — *the SESSION's instant, not the fetch time* — and the
occurrence has no instant, which is exactly why A15's defect 2 (opening a three-week-old run stamps
it with today's weather) is possible at all. So the stamp belongs on `workouts.weather`, typed with
A15's field list adopted unchanged (`temp_c`, `feels_like_c`, `conditions`, `wind_kph`, `precip_mm`,
`observed_at`, `place`, `place_label`, `source`). `occurrences.weather` stays for non-workout
occurrences and for the existing rows. A15's date-guard fix is still separable and still first.

### Architecture

| Component | Where | Status |
|---|---|---|
| Canonical store + ingest table | migration **0032** (see below) | **new, not written** |
| Repo | `apps/cadence-api/src/repos/workouts.ts` | **new** |
| Composition + dedup (pure, testable) | `apps/cadence-api/src/services/workouts/compose.ts` | **new** |
| Import route + zod bound | `apps/cadence-api/src/routes/workouts.ts`, `validation/workouts.ts` | **new** (own files — size rule) |
| Native write bridge | `apps/cadence-ios/ios/App/App/CadenceHealthWrite/` | **new**, copy `CadenceCoachIdentity` |
| Seam entry `saveWorkout` + write auth status | `apps/cadence-web/src/lib/capability/index.ts`, `native.ts`, `web.ts` | extend |
| `sourceBundleId` / `id` / `sourceName` on reads | `native.ts:68` `PluginWorkout`, `toSeamWorkout` | **fix — prerequisite** |
| Session instants | `apps/cadence-web/src/features/walkthrough/state.ts` | **fix — prerequisite** |
| Backfill pager | `apps/cadence-web/src/features/settings/health-import.ts` | extend |
| Planner view | `apps/cadence-api/src/services/observed-health.ts` | becomes a view |
| Digest series | `migrations/cadence/0024_health_digests.sql` | frozen, then retired |
| Occurrence join | `cadence.occurrences` (0001) | unchanged — stays the PLAN record |
| Weather stamp | `workouts.weather` (A15's fields) | A15 |
| Strava ingests | `source='strava'` rows in this store | A16 — **no `strava_activities` table** |
| Watch hand-off id | A13's deterministic `WorkoutPlan` UUID | A13 |

**Migration numbering, resolved 2026-08-11.** Three entries wanted a number at once. Settled:
**0031** = token accounting (`ai_usage`, A11 — it already has code on a branch, so it keeps the
number it was written against), **0032** = this entry's workouts store, **0033** = A16's
`connections`. None are written or applied yet; A16's references were renumbered here rather than
and whichever lands second takes the next free number.

### Open questions

- **The table is called `workouts` and the product is not a fitness app.** Meditation, breathwork
  and morning pages are sessions too and belong in the same store; `sessions` collides with coach
  chat sessions and `occurrences` means the scheduled thing. The nomenclature table has no entry
  for this. Owner's call.
- **Who composes — the writer or a reader?** Composing on ingest keeps reads cheap and makes the
  canonical row a cache that can be rebuilt; composing on read is always correct and always slower.
  Leaning ingest-time, because A16's deletion obligation wants a recompute button anyway.
- **What does the coach do when it notices a duplicate it did not merge?** Silence is wrong and a
  "we found 2 possible duplicates" modal is a scoreboard. Probably nothing user-facing in v1.
- **120 s / 5% are A16's numbers, and neither entry has tested them.** A treadmill run started on
  the watch and logged in the app can be minutes apart. Needs real data before it ships.
- **Does an imported historical workout count toward consistency or the streak?** It must not —
  those count engagement with OUR plan (`PLAN_COUNTS_NOTE`, `observed-health.ts:87`) — but the rule
  needs writing down before someone imports five years and lights up a streak.
- **Backfill and anonymous sessions.** A pre-account user importing two years of history, who then
  abandons the session, is a lot of rows in a scratch account (A0).
- **Oura.** Named as a future source and not designed. Its sleep and readiness data are not
  workouts at all, so it is a different table with the same provenance discipline, not a fifth
  `source` value.

Not scoped. The `sourceBundleId` fix and the walkthrough instants are the two prerequisites, and
both are small enough to land independently of the rest.
**A15. Weather on the workout you actually did — we feed the forecast and never keep the record (owner 2026-08-11)**

> *"Store/track weather by workout performed outside (performance in rain, snow, ice, high winds,
> cold days, hot days) can help the coach better understand performance and how the user will
> perform in different conditions."*

**Weather is not greenfield — it is one of the most built-out subsystems in the app, and almost all
of it points at the future.** The requirement is therefore much smaller and much sharper than it
looks: we already spend provider calls on conditions, we simply throw the answer away the moment the
session is over. This is about keeping the record, not about adding weather.

**What exists today (all shipped):**

- `apps/cadence-api/src/services/weather/weather.ts` — a two-provider engine. WeatherKit preferred
  (so an iOS user's Cadence forecast matches their lock screen), OpenWeatherMap as fallback and as
  the only geocoder. Two cache layers: an in-process `Map`, and `cadence.weather_cache`
  (migration 0025) shared across instances, keyed `roundedLat,roundedLon:localDate` — a ~11 km cell
  with **no `user_id`**, because weather is a property of a place, not a person.
- `apps/cadence-api/src/services/weather/weatherkit-http.ts` — the REST client, ES256 provider JWT
  minted from the `.p8` in `cadenceConfig.weatherkit` (`apps/cadence-api/src/config.ts:141`).
  Requests `dataSets=currentWeather,forecastHourly` for one coordinate.
- **The `weather` VARIABLE on `synthesize-plan` is already populated** — `plan-synthesis.ts:93` calls
  `weatherVarsForUser`, which is *current conditions at `users.home_location`*. So does
  `prescribe-session` (`session-generate.ts:97`, outdoor activities only), the Today header
  (`routes/me.ts:52`), `date-context.ts`, `situation.ts` (tripwires), and `day-recap.ts`.
- `notify/producers/weather-move.ts` is the only consumer of a real forecast SERIES
  (`weather/forecast.ts`, OWM-only) — "it's wet at seven tomorrow, here's a drier hour".

**And a per-occurrence stamp already exists — pointed at the wrong moment.** `OccurrenceWeather`
(`packages/cadence-shared/src/types/occurrence.ts:16` → `occurrences.weather` jsonb) is written by
`attachOutdoorWeather` (`session-generate.ts:163`) through `setOccurrenceWeatherIfEmpty`
(`repos/occurrences.ts:148`). Three things are wrong with it, and they are why this entry exists:

1. **It fires on OPEN, not on completion.** `getOccurrenceDetail` stamps the row when the user first
   taps the card — which for a pending session is usually *before* they go out, and sometimes days
   before. What we store is a forecast wearing a record's clothes.
2. **It has no date guard.** `attachOutdoorWeather` runs before the today-or-future gate that
   protects session generation, so opening a three-week-old outdoor run for the first time stamps it
   with **today's** weather at home. `logged_at` makes the skew detectable and nothing checks it.
   This is a live data-integrity bug, not just a design gap — it should be fixed even if the rest of
   this entry is never built.
3. **The log path never stamps at all.** The doc comment on `setOccurrenceWeatherIfEmpty` says
   "outdoor open/log paths race-safe" — but `logOccurrence` (`services/session-log.ts:52`), the one
   function that knows a session actually happened, does not call it. The intent was written down
   and never wired.

So the work is: move the stamp to the moment of truth, give it the right place and time, and give
the coach permission to reason from it.

**Which location — coarse, and only when we have a reason to believe it.** Recommendation: keep
`users.home_location` as the default, but record on the stamp *which* location it came from and how
confident we are, and let a workout override it. Rationale:

- Home is free and correct most days. It is wrong exactly when it matters most — the owner was
  travelling during a recent onboarding run, and a hotel week silently attributes another city's
  weather to every run.
- **Never store precise per-workout coordinates.** The cache already proves we do not need them:
  weather resolves identically anywhere inside an ~11 km cell. Store the rounded cell and a place
  label, nothing finer. A row that says "Boulder, CO" is a weather fact; a row that says
  `40.0176,-105.2797` is a movement record we did not ask for and do not want to hold.
- **Routes stay off the table** (already settled). We do not read HealthKit workout routes, and
  nothing here reopens that.
- Practically: the client can offer a coarse fix at log time on the same footing as `LocationOffer`
  (`apps/cadence-web/src/features/shell/LocationOffer.tsx`) already uses for home — one tap, rounded
  before it leaves the device, no prompt if home is fine. When the user declines or the read fails,
  fall back to home and *say so on the stamp*, so the coach can weigh it later.

**Which moment — at completion, live.** `logOccurrence` is the seam: it already knows the session
happened, already writes `log`/`value`/`provenance`/`status='done'` in one place, and already runs
on every path (self-report, ad-hoc `adhoc-log.ts`, and the reply path). Stamping there costs at most
one provider call per outdoor session, and usually zero — the L1/L2 cache almost always has the cell
for today already, because the Today header fetched it that morning.

This is also the honest ordering. Conditions read at the completion of a 6 a.m. run are not the
conditions of the run if it is logged at 9 p.m., so the stamp must carry the *session's* time, not
the fetch time. See the historical read below.

**Backfill — possible, and worth doing narrowly.** WeatherKit serves history back to **1 August
2021** on the *same* metered quota as a forecast call: no separate historical product, no separate
price. The existing client already speaks this dialect — it is the same
`/weather/{lang}/{lat}/{lon}?dataSets=…` call with `hourlyStart`/`hourlyEnd` (or
`dailyStart`/`dailyEnd`) added; absent those, hourly simply starts at the current hour, which is
what `weatherkit-http.ts` does today. **One request is capped at a single contiguous ~10-day
window**, so a backfill is inherently a paged, resumable job and never one call. OWM's history is a
paid add-on we do not have, so backfill is **WeatherKit-only** and must degrade to "no stamp" rather
than to a wrong one. (Sources are Apple's developer forums and WWDC24 rather than the REST reference
page, which would not render for this pass — worth a five-minute confirmation against the live docs
before building, but the shape is not in doubt.)

That gives a clean rule: **stamp forward always; backfill only where we have a real timestamp and a
credible location.** For A14's imported history that means the ones with an honest start time and a
plausible home at that date — and it means accepting that older imported rows will have no
conditions at all. An unstamped row is fine. A row stamped from the wrong city is worse than nothing,
because the coach will cite it.

**Where it is stored — in A14's store, not next to it.** A14 is designing the canonical workout
history; the conditions stamp is a column/blob on *that* record, not a parallel table. This entry
should not mint a second home for the same fact. Concretely: extend `OccurrenceWeather` rather than
replacing it (`occurrences.weather` is the row A14 inherits), following the small-blob-with-a-comment
pattern of `streak_state` (0015) and `macro_targets` (0001):

```
temp_c, feels_like_c, conditions, wind_kph, precip_mm   -- existing shape, mostly already there
observed_at        -- the SESSION's instant, not the fetch time (the current field conflates them)
place: 'home' | 'workout' | 'unknown'   -- provenance of the location, so the coach can discount it
place_label        -- coarse, human ("Boulder, CO"); never coordinates
source: 'weather_api' | 'weather_api_historical'   -- forward stamp vs backfill
```

`source` earns its place: a backfilled hourly reading and a live read at the finish line are not the
same evidence, and the day we find a systematic bias in one we need to be able to find those rows.

**How the coach uses it — the entire point, and the easiest thing to get wrong.**

Three behaviours worth building:

1. **Explain a number that would otherwise read as a decline.** *"You were about forty seconds a
   kilometre slower than usual — it was 31°C. That's the heat, not you."* This is the highest-value
   one by a distance: without conditions, a hot-week slowdown looks like lost fitness, and the plan
   adapts *downward* against a cause that will pass on its own.
2. **Set expectations before a session, from their own history.** *"It's going to be near freezing
   Thursday. Last two cold mornings you ran easier than planned and that worked well — want to do
   the same?"* Distinct from the existing `weather_move` nudge, which only knows the forecast; this
   one knows what *they* did last time.
3. **Offer a detour the user has not had to ask for.** Ice and high wind are safety facts, not
   excuses. *"Thursday looks icy. I can move the run to Friday, or swap it for something indoors —
   your call."* This routes into the existing detour vocabulary, which is where "life happened"
   already lives.

Anti-behaviours, stated as hard rules:

- **Never "you skip rain days".** That is a streak-shame sentence with a weather variable in it, and
  BRAND.md forbids the shape: *count what happened, never what broke.* If someone consistently does
  not go out in rain, the coaching move is to offer a rainy-day alternative, not to report their
  record back to them.
- **Never let conditions become an excuse the coach supplies unprompted.** "It's cold, want to skip?"
  is not warmth, it is lowering the bar on someone's behalf.
- **Never a weather scoreboard.** No "tough conditions" badge, no bad-weather points. Hearth, not
  scoreboard — and A12 is already unpicking one points system; do not feed it a second.
- **Never assert a physiological mechanism.** "Heat raises your cardiac drift" is a claim we cannot
  support. "You ran slower and it was hot" is an observation we can.

**Evidence threshold — she may not generalise from one bad Tuesday.** Before the coach states a
pattern as fact she needs, for the *same activity type*: **at least three sessions inside the
condition band and three outside it, within a rolling 12 weeks**, with a comparable metric present
(pace needs both distance and duration; `occurrences.value` and `log.items` already carry these) —
and the gap has to be bigger than that person's ordinary session-to-session spread, not merely
non-zero. Below that bar she may only *ask*: *"That felt harder than usual and it was pretty hot —
does heat tend to hit you?"* A question invites correction; an assertion the user knows is wrong
costs more trust than the insight was ever worth. The threshold is deliberately conservative because
the failure is asymmetric: a missed pattern is invisible, a confidently wrong one is memorable.

Open: whether the threshold is computed in code (a deterministic helper, auditable, testable) or
left as a rule in the prompt. Strong lean toward code — this is arithmetic, and every other
deterministic fact in the app is computed and injected rather than trusted to a model.

**Architecture scaffold (existing → proposed):**

| Component | File | Status |
|---|---|---|
| Provider client + JWT | `apps/cadence-api/src/services/weather/weatherkit-http.ts` | exists — needs a historical variant |
| Historical read | `apps/cadence-api/src/services/weather/weather-history.ts` | **proposed** — `getWeatherAtInstant(lat, lon, iso, tz)`; `forecastHourly` + `hourlyStart`/`hourlyEnd`, WeatherKit-only, returns null on OWM-only deployments |
| Cache | `apps/cadence-api/src/repos/weather-cache.ts` + migration 0025 | exists — reuse as-is; the key is `text`, so a historical key can carry the hour with **no migration** |
| Snapshot mapping | `weather/weatherkit-map.ts`, `weather/weather-map.ts` | exists — historical hourly needs a small sibling mapper |
| Stamp writer | `apps/cadence-api/src/services/weather/stamp-conditions.ts` | **proposed** — owns "should this be stamped, from where, for when" |
| Stamp storage | `occurrences.weather` jsonb / `OccurrenceWeather` | exists — extend (fields above), **owned by A14** |
| Completion hook | `apps/cadence-api/src/services/session-log.ts` (`logOccurrence`) | exists — **add the stamp call here** |
| Wrong-moment stamp | `session-generate.ts` (`attachOutdoorWeather`) | exists — **remove or date-guard**; it is the bug above |
| Outdoor predicate | `isOutdoorActivity` (`weather/weather-map.ts:171`) | exists — a keyword regex; see open questions |
| Pattern read | `weather-patterns.ts` (deterministic aggregate) | **proposed** — computes the evidence threshold, emits a fact or nothing |
| Coach injection | `date-context.ts` / `situation.ts` / context pack | exists — the aggregate rides the same rails as every other deterministic fact |

Data flow: *session completed* → `logOccurrence` writes log/value/status → `stamp-conditions`
resolves place (workout fix if offered, else home, recorded either way) → cache or
`getWeatherAtInstant` for the session's instant → `setOccurrenceWeatherIfEmpty` → later,
`weather-patterns` aggregates stamped rows per activity type → threshold met → one deterministic
sentence injected into coach context → *she can cite conditions.*

**Cost.** WeatherKit's free tier is 500k calls/month, pooled per Team ID across every app and both
the Swift and REST surfaces; over it you move to the next subscription tier rather than paying
per call. One stamp per outdoor session is negligible against that, and most stamps are cache hits.
A one-off historical backfill is the only spiky consumer — it should be rate-limited and
resumable, not a loop.

**Open questions:**

- `isOutdoorActivity` is a keyword regex over category + title. "Track workout" matches nothing;
  "treadmill run" matches `run` and gets stamped with outdoor weather it never saw. Does the stamp
  need a real indoor/outdoor signal — the coach's own tag on the activity, or a confirmation at log
  time — before any of this is trustworthy?
- Does the user get to see and correct the stamp? "It was actually pouring" is a correction the
  brand's confirm-before-committing instinct says we should accept, but per-workout weather editing
  is a lot of UI for a small fact.
- Apple Health-observed workouts have **no location at all** — `HealthDigest`
  (`packages/cadence-shared/src/types/health.ts`) is an aggregate digest with type/start/duration/
  distance and nothing else, and it is client-built. Stamping those means assuming home. Is that
  assumption acceptable, or do observed workouts simply go unstamped?
- Which conditions actually matter? The owner named rain, snow, ice, wind, cold, heat — but ice is
  not a WeatherKit field (it is inferred from temperature plus precipitation), and humidity, which is
  arguably the strongest driver of perceived heat effort, is not on the list. Do we band conditions
  into a small vocabulary the coach can reason over, or hand her the numbers?
- Does the same stamp belong on interval-tool sessions and other non-occurrence logs, or is
  the occurrence row the only spine? (A14's answer probably settles this.)

Not scoped. The date-guard bug (defect 2) is separable and should be fixed first.
**A16. Strava: the terms forbid the product we would build (2026-08-11)**

Owner requirement: *"Integrate to Strava to retrieve/store workout history (bi-directional
integration)"*, priority below Apple Watch and above Oura — *"I have a Strava."* The HealthKit half
of history-migration is A14's; this is the Strava half.

**Verdict up front: the current Strava API terms prohibit the architecture the owner described, and
they prohibit it by name.** Not ambiguously, not by strained reading — the June 1 2026 Strava API
Policy enumerates the exact steps of our design as prohibited activities. This is not a "get a
lawyer to bless it" situation. It is a "the clause says the thing we want to do" situation. If we
integrate Strava's API at all, we integrate it as a **write-only publisher** and get history from
somewhere else.

**Where the rules actually live — and why the first look missed them.** The API Agreement at
`strava.com/legal/api` (Effective June 1, 2026) contains **no AI clause at all**; grep it for
"artificial intelligence", "model", or "AI" and you get nothing. Everything that matters is in the
separate **API Policy** at `strava.com/legal/api_policy`, which the Agreement pulls in: *"which
incorporate by reference the Strava Terms of Service, the Strava Privacy Policy…, the Strava API
Brand Guidelines, and the Strava API Policy (the "Policy"). The Policy is incorporated by reference
into, and forms part of, this Agreement."* Anyone who reads only the Agreement — as the owner
reasonably might, and as my first fetch did — concludes Strava has no AI position. They have a very
detailed one.

The public history is worth knowing: the November 11 2024 change was announced as narrow, and
Strava's own press note said it would affect *"less than .1% of applications"* with most use cases
still permitted *"including coaching platforms and performance analysis tools"*. That reassurance
described the 2024 text. **The 2026 Policy is a different and far harder document**, and the 2024
press framing should not be cited as cover for it.

**(a) May Strava-sourced data, stored in our DB and merged with other sources, be read by an LLM in
service of the user who owns it? No.** Policy §5.3, titled *"No AI/ML Training, Fine-Tuning,
Grounding, Evaluation, Embedding, or Retrieval-Augmented Generation"*:

> "You may not use the Strava API Materials or Strava Data, directly or indirectly, in connection
> with the development, training, evaluation, or **operation** of any AI Application. This
> prohibition extends to: Any data **derived from, aggregated from, anonymized from, or generated
> using Strava Data**, in any form (including original, derivative, aggregated, anonymized,
> de-identified, or model-output form); and Any of the following activities with respect to an AI
> Application: training, pre-training, post-training, fine-tuning, reinforcement learning,
> alignment, grounding, evaluation, benchmarking, embedding generation, retrieval-augmented
> generation, **ingestion into a context window or working memory**, and any other activity
> intended or reasonably likely to develop, improve, evaluate, or **operate** an AI Application."
> *(emphasis mine)*

The owner's clarification was: *"I'm not proposing passing Strava data to an LLM [directly]. I'm
proposing we use it to populate a history in our app, where it's combined with our data or a
history from other applications… The LLM reads the data in our app, which is aggregate across all
data sources."* Read that against the clause. **"Directly or indirectly"** closes the indirection.
**"Any data derived from, aggregated from… in any form"** closes the aggregation. **"Ingestion into
a context window or working memory"** is a literal description of what our retrieval layer does
when it assembles coach context. And **"operation"**, repeated twice, is what distinguishes this
from a training ban: §5.3 is not a rule about building models, it is a rule about *running* one on
their data. The distinction the task asked me to draw — training bans (near-certain) vs
serving-the-user's-own-data-through-an-LLM (the real question) — resolves the wrong way here.
Strava drafted for exactly this case and forbade both.

Note also what §3.5 gives away: Strava built the **Strava MCP** as *"the sole authorized first-party
agent-mediated interface"*, on which *"Subscribers to Strava may access the Strava MCP in connection
with their personal use of their own Strava data… and may bring their own AI Application to interact
with their own data."* So the personal-use-of-your-own-data-with-an-LLM case is explicitly carved
out — **and routed through Strava's own surface, not ours.** §5.16 then forbids us from operating
*"any MCP Server, agent-mediated interface, or analogous mechanism"* ourselves, *"regardless of
name"*. The gap in the wall exists and it is deliberately not the shape of a third-party app. That
is the strongest available evidence that our reading is the intended one rather than an
over-cautious one: they thought about the exact use case and built a different door for it.

**(b) Does aggregation or derivation help? It is specifically what §5.4 forbids.** Titled *"No
Aggregation, Analytics, or De-Identified Processing"*:

> "You may not process or disclose Strava Data—even publicly viewable Strava Data—including in an
> aggregated, de-identified, or anonymized manner, for the purposes of analytics, analyses,
> customer insight generation, or product or service improvements. **You may not combine Strava
> Data with other customer data for these or any other purposes.** The restrictions in this Section
> 5.4 apply to data derived from Strava Data and to output that incorporates or was generated using
> Strava Data."

"You may not combine Strava Data with other customer data … for any other purposes" is the
one-sentence answer to the migrate-then-merge architecture. Merging with HealthKit history is the
combination the sentence names. And the trailing sentence — restrictions attach to *"output that
incorporates or was generated using Strava Data"* — confirms the general principle the task flagged:
**restrictions follow the data, not the call.** Laundering a Strava run through our own
`workout_history` table does not produce a non-Strava row; it produces Strava Data in a new
location, still carrying every restriction, plus a derived-data tail that catches the coach's
summary of it.

**(c) Retention: seven days, and that alone ends it.** §6.2: *"You may not retain Strava Data in
your cache for longer than seven (7) days… Except for such limited caching, you may not store
Strava Data."* §5.5: *"You may not bulk-export Strava Data, including by accumulating Strava Data
through repeated authorized API calls into a corpus, dataset, archive, or database that exceeds the
operational scope of your Developer Application"*, and *"You may not store Strava Data, or any data
derived from Strava Data, in any **Persistent Index**… indefinite storage in vector stores,
embedding stores, search indexes, knowledge graphs, retrieval-augmented data stores, **archives**,
and any other storage configured to enable subsequent retrieval, query, or use."* §6.4 caps
retention at *"only so long as necessary for the purpose for which it was originally obtained."*

**A seven-day cache is not a history.** The owner's requirement is the word "history" — the whole
point is a durable record of what someone has done, going back years, that the coach can reason
over. Even with §5.3 and §5.4 struck out, §6.2 would still forbid the thing being asked for. Three
independent clauses each kill it.

On disconnect, §7.4 requires deletion within **thirty (30) days** of *"all Strava Data and all
Personal Data derived from Strava Data relating to the requesting or revoking user"* on user
request, revocation, **or** Strava-account deletion — and *"regardless of user"* if we stop using
the API or the agreement terminates. §6.3 requires deletions the user makes on Strava to propagate
to us **within 48 hours**, which on its own implies a live mirror we must poll or webhook, not an
archive. Agreement §4.4 repeats it: on termination we *"must promptly cease using and permanently
delete… all Strava Data provided hereunder and so certify in writing to Strava."* Note the shape of
that risk: an imported-then-merged history means a disconnect obliges us to **surgically unpick
Strava-derived rows out of a merged store, and arguably any coach memory derived from them, within
30 days** — which is only possible if provenance is tracked per-row from day one. A16 assumes A14's
canonical store carries per-row provenance regardless of what we decide here.

**One honest caveat, which does not change the answer.** The Policy uses **"AI Application"** as a
defined term four times and **never defines it**; the word does not appear in the Agreement at all.
Same for "Persistent Index" — used, capitalised, undefined. A drafting gap. It is tempting to build
on it. Don't: §5 opens with *"Strava shall determine in its sole discretion whether your Developer
Application's use of the Strava API Materials complies with this Section and the Agreement"*, and
§6.2 of the Agreement plus §3.2/§6.2 of the Policy give them audit rights and unilateral
termination. An undefined term interpreted at the counterparty's sole discretion is not a loophole,
it is an unbounded risk. Cadence is a coach whose entire value is an LLM reading your history; there
is no reading of "AI Application" under which we are not one.

**What this means for the requirement.** The bi-directional integration the owner asked for splits
cleanly, and only one half survives:

- **Read/import into a durable history the coach reasons over — dead.** §5.3, §5.4, §6.2 each
  independently. Not "risky", not "needs review". Prohibited in terms.
- **Write/publish our workouts to Strava — alive**, and genuinely useful. Pushing an activity we
  own to a user's Strava feed sends no Strava Data anywhere; nothing lands in our store and nothing
  reaches a model. See the write section below.

**The generic connections pattern (this is the durable deliverable)**

Strava would be our first third-party OAuth integration, and whatever we conclude about Strava
specifically, **the pattern outlives it** — A17 (Oura) consumes it, Google Fit / Health Connect
would, Garmin would. `Connection` in
[`packages/cadence-shared/src/types/baseline.ts:169`](../../packages/cadence-shared/src/types/baseline.ts)
is currently a stub with nothing behind it:

```ts
export interface Connection {
  source: 'apple_health' | string;   // `| string` = "we haven't decided yet"
  scopes: string[];
  status: 'connected' | 'disconnected';
}
```

It lives on `UserProfile.connections` and no table backs it. Note the shape already leaks a wrong
assumption: `apple_health` is not a connection in this sense at all — HealthKit is an on-device
grant with no server-side token, no refresh, and no revocation webhook (see
`migrations/cadence/0024_health_digests.sql`, where the client builds the digest and POSTs it). Two
genuinely different things are sharing one type. The generic pattern should model **server-side
OAuth connections**, and `apple_health` should either move out or be explicitly marked as the
device-grant variant.

*Generic — belongs to the pattern, not to Strava:*

1. **`cadence.connections` table** (new migration, `0033_connections.sql`): `user_id`, `provider`,
   `provider_user_id`, `scopes text[]`, `status`, `connected_at`, `last_sync_at`, `expires_at`, and
   the encrypted token blob. One row per (user, provider). RLS owner policy like every other
   Cadence table; `pack_touch` trigger if a connection's existence should invalidate the context
   pack. **The refresh token must never be readable by the client** — no `VITE_*`, no anon-key
   read path; the row is service-role-only, which means the RLS policy here is *deny-to-user*,
   unlike the rest of the schema.
2. **Encrypted-at-rest token store** (`apps/cadence-api/src/services/connections/token-store.ts`):
   AES-256-GCM via `node:crypto` with a key from `CADENCE_CONNECTIONS_KEY`, added to
   `apps/cadence-api/src/config.ts` beside the existing `apns` / `weatherkit` blocks. Include a
   `key_version` column from day one so rotation is possible without a migration.
   `apps/cadence-api/src/services/weather/weatherkit-http.ts` is the precedent for
   "third-party credentials, no SDK, config-gated, absent block means feature-off" — follow its
   `isWeatherKitConfigured()` shape so an unconfigured deploy degrades rather than crashes.
3. **Generic OAuth routes** (`apps/cadence-api/src/routes/connections.ts`, mounted in
   `apps/cadence-api/src/app.ts` next to the other `/me` routes): `GET /me/connections` (status
   list — never tokens), `POST /me/connections/:provider/start` (returns the authorize URL with a
   signed, single-use, short-TTL `state`), `GET /connections/:provider/callback` (public, exchanges
   code, stores tokens), `DELETE /me/connections/:provider` (revoke upstream, then delete local).
   Provider-specific bits (authorize URL, scope strings, token endpoint, revoke endpoint) live in a
   small per-provider module the generic router looks up.
4. **Refresh-on-use with a single-flight lock.** Serverless means N concurrent lambdas can each
   notice an expired token and each burn a refresh; providers that rotate refresh tokens will
   invalidate all but one and the connection dies. A row-level advisory lock (or a `refreshing_at`
   claim column) is not optional here.
5. **Revocation is three-sided:** the user disconnects in Cadence, the user revokes at the provider
   (we learn via webhook or a 401), or we shut the integration down. All three must converge on the
   same code path — the same lesson as A5's "sign out and start over should share one path".
6. **A per-provider retention policy is part of the pattern, not a Strava special case.** Strava's
   is 7 days plus a 30-day deletion SLA; Oura's will differ. The connection row should carry the
   provider's policy so a sweeper can enforce it generically rather than each integration
   remembering its own rules.

*Strava-specific — must NOT leak into the generic layer:* the seven-day cache ceiling and the
48-hour deletion-propagation SLA; the single-webhook-subscription-per-application constraint (§below);
the attribution/branding obligations; and the fact that for Strava the store is write-only. If those
end up hard-coded in `connections.ts` rather than in a `providers/strava.ts` descriptor, Oura will
inherit rules that were never about it.

**The write half — what actually survives**

Agreement §7.1 expressly contemplates it: *"Your Developer Applications may include the option to
upload activities or information to the Strava Platform."* And the compliance story is clean, which
is the point: **an activity the user logged in Cadence is our data, not Strava Data.** It never
becomes Strava Data by being sent *to* Strava — §2.3(i) defines Strava Data as *"all data you access
or collect from the Strava API Materials"*, i.e. data flowing outward from Strava to us. Sending
in the other direction touches none of §5.3, §5.4, §5.5 or §6.2.

What we would push: occurrences the user logged against a movement-area activity, where we hold
enough to make a real Strava entry — type, start time, elapsed time, distance where we have it,
and the user's own note. No GPS (we do not record tracks), so these are manual-style entries, not
routes. Off-plan logs (`ADHOC_CATEGORY` in `apps/cadence-api/src/repos/activities.ts`) qualify
equally — the user did them.

Design constraints on the write path:

- **Opt-in per push, or one explicit standing consent — never silent.** Publishing to someone's
  Strava feed is a social act with an audience. It is exactly BRAND.md's *"confirm before
  committing"*, and getting this wrong posts to a user's followers on our initiative.
- **Idempotency.** Store the returned Strava activity id on our occurrence so a retry, a webhook
  echo, or a re-log does not create a second copy. Without it, a serverless retry duplicates a
  post on a stranger's feed.
- **API-created activities are visibly attributed.** Strava shows an "uploaded via *App*" line on
  activities created through the API; there is no hidden write. That is fine — desirable, even —
  but it means the push is a branding surface, not a silent sync, and it must therefore respect
  §4.3 (no implied endorsement) and §4.6 (**no press release mentioning Strava without their prior
  written consent** — a launch-blog trap worth flagging now).
- **We must not create the round-trip we just banned.** If we push an activity to Strava and the
  user also has Strava→Apple Health sync on, that activity can come back to us through HealthKit.
  Harmless in itself (it is our own data returning), but the dedup rules below must recognise our
  own echo or the coach will see every logged workout twice.
- **Reading back what we wrote is still reading.** Fetching the activity id we just created is a
  Strava API call returning Strava Data. Keep the id, do not re-fetch the object.

**Attribution and display obligations (Brand Guidelines, apply the moment we ship anything):**

- Interoperability must be described as exactly *"Powered by Strava"* or *"Compatible with
  Strava"* — those two phrasings, not a paraphrase. (Note both are stiffer than Cadence's voice;
  the copy around them has to carry the warmth.)
- *"Never use any part of a Strava logo as the icon for your application"*; the Strava logo must be
  *"completely separate and apart from (and should not appear more prominently than) the name/logo
  of your application"*; never modified, altered or animated.
- OAuth must go through `https://www.strava.com/oauth/authorize` or `.../oauth/mobile/authorize`,
  presented as the Connect-with-Strava button.
- Any link to a source activity must read exactly *"View on Strava"*, styled legibly (bold,
  underline, or Strava orange `#FC5200`).
- *"You must not use the Strava name in your application name."*

**And the clause nobody thinks to read: §5.2, "No Competing or Imitating Applications".** *"You may
not use the Strava API Materials in any manner that is competitive to Strava or the Strava
Platform."* Strava has since shipped its own AI analytics features. An AI coach that reads your
training history and tells you what to do next is not obviously non-competitive with that, and
§5 leaves the judgement to *"Strava… in its sole discretion"*. Even the surviving write-only path
should be presented to Strava as *feeding* their platform, because that framing is both true and
the one that keeps the integration alive. §5.8 is the related trap for a paid app: we may not
charge *"for access to or use of the Strava API Materials"*, though we may charge for
*"functionality not provided by the Strava Platform… and that is not substantially duplicative of
functionality offered by Strava"* — so Strava publishing must never sit behind the paywall as a
named feature.

**Dedup — no Strava store, ever**

There is **no `cadence.strava_activities` table** in any version of this design, and that is a
deliberate ruling, not an omission. Imported workouts land in **A14's canonical history store** with
per-row provenance; a Strava row is a row in the same table with `source = 'strava'`. Two reasons,
and the second is the one that matters: a separate store makes the same run appear twice to the
coach, and — under the terms above — provenance is the only thing that makes §7.4's *"delete all
Strava Data and all Personal Data derived from Strava Data relating to the revoking user"* an
executable query rather than a forensic exercise. **Whatever we decide about Strava, A14's store
needs per-row provenance for this reason alone.**

Recognising a Strava copy of a run we already know from HealthKit:

- **Match on start time + duration proximity**, not on distance or title. Start times drift between
  sources (device clock, upload rounding, timezone handling): treat two workouts as the same event
  when starts are within ~2 minutes *and* durations within ~5%. Distance is the weaker signal —
  GPS and wrist-derived distance for the same run differ by more than you would expect, and an
  indoor workout has no distance at all.
- **The obvious cases first, before fuzzy matching.** If the Strava activity carries an
  `external_id` we wrote, it is our own echo — drop it. If the HealthKit workout's source is
  Strava's own bundle, the two records are literally the same object arriving by two doors.
- **Fidelity wins, provenance is kept.** When the same event arrives twice, keep the richer record
  and note both sources on the row. Dropping the second copy silently loses the fact that we saw
  it, which matters when a disconnect requires unpicking one source.
- **Same-day repeats are real.** Two 30-minute runs in one day is a normal Tuesday for some people.
  The window must be tight enough not to collapse them, which is why it is start-time-anchored
  rather than day-anchored.

**Architecture scaffold**

Two columns, because the terms split the design. **Everything in the right-hand column is scaffolded
for completeness and must not be built** unless the terms change or Strava grants a written
exception — see the closing note.

| Component | File (existing / proposed) | Owner | Ships? |
|---|---|---|---|
| `Connection` type, fleshed out | `packages/cadence-shared/src/types/baseline.ts:169` *(exists, stub)* | shared | yes |
| `connections` table + RLS | `migrations/cadence/0033_connections.sql` *(proposed)* | api | yes |
| Encrypted token store | `apps/cadence-api/src/services/connections/token-store.ts` *(proposed)* | api | yes |
| Generic OAuth routes | `apps/cadence-api/src/routes/connections.ts` *(proposed)*, mounted in `apps/cadence-api/src/app.ts:44` | api | yes |
| Provider descriptor | `apps/cadence-api/src/services/connections/providers/strava.ts` *(proposed)* | api | yes |
| Strava HTTP client | `apps/cadence-api/src/services/strava/strava-http.ts` *(proposed; mirror `services/weather/weatherkit-http.ts`)* | api | yes |
| **Publish occurrence → Strava** | `apps/cadence-api/src/services/strava/publish.ts` *(proposed)* | api | **yes** |
| Config block + secrets | `apps/cadence-api/src/config.ts:141` *(exists — add beside `weatherkit`)* | api | yes |
| Canonical history store + provenance | **A14** *(sibling entry)* | A14 | yes |
| Retention sweeper (per-provider) | `apps/cadence-api/src/services/connections/retention.ts` *(proposed)* | api | yes |
| ~~Webhook receiver~~ | ~~`apps/cadence-api/src/routes/strava-webhook.ts`~~ | — | **no — §5.3/§6.2** |
| ~~Backfill worker~~ | ~~`apps/cadence-api/src/services/strava/backfill.ts`~~ | — | **no — §5.5 bulk-export** |
| ~~Strava rows in canonical history~~ | ~~A14 store, `source='strava'`~~ | — | **no — §5.4 combine** |
| ~~Coach reads Strava-derived rows~~ | ~~`services/retrieval/catalog.ts` `renderCatalogDoc`~~ | — | **no — §5.3 context window** |

The last row is the sharpest illustration of why this is not a solvable engineering problem.
`renderCatalogDoc` in `apps/cadence-api/src/services/retrieval/catalog.ts` exists to assemble
domain rows into the coach's prompt. §5.3 prohibits *"ingestion into a context window or working
memory"*. There is no version of Cadence in which imported history reaches the user and does not
pass through that function.

*Flow 1 — publish (ships).* User logs an occurrence → `POST /me/connections/strava/publish` (or a
standing opt-in fires it) → `token-store` decrypts + refreshes if needed → Strava upload endpoint →
returned activity id stored on the occurrence for idempotency → UI shows "View on Strava". No
inbound data at any step.

*Flow 2 — webhook incremental sync (scaffolded, not built).* Strava allows **one push-subscription
per application**, created once out-of-band; the callback is a single public URL that must answer
Strava's `GET` validation handshake by echoing `hub.challenge` when `hub.verify_token` matches, then
accept `POST` events (`object_type`, `aspect_type` create/update/delete, `object_id`, `owner_id`).
Two Cadence-specific hazards worth recording even though we are not building it: **(i)** Strava
expects a fast acknowledgement, and cadence-api runs as an Express service on Vercel
(`apps/cadence-api/vercel.json`, catch-all rewrite) — a cold start can exceed the window, so the
handler must be a thin enqueue-and-200 with the real work deferred, and the endpoint wants keeping
warm. **(ii)** The route must mount **outside** `requireCadenceUser`; every other `/me` route sits
behind it (`apps/cadence-api/src/app.ts`), so a webhook route added carelessly would either 401
Strava forever or, worse, be added by disabling the guard. Verification is the shared `verify_token`
plus an `owner_id`→`connections.provider_user_id` lookup — Strava does not sign payloads, so the
event body is a **notification, not evidence**: it says "activity N changed", and the object must be
fetched. Delete events are the one case where the event alone is actionable, and §6.3's 48-hour
propagation SLA means they cannot be dropped on the floor.

*Flow 3 — rate-limited historical backfill (scaffolded, not built).* This is the migration the
owner asked for and the one §5.5 names: *"accumulating Strava Data through repeated authorized API
calls into a corpus, dataset, archive, or database."* Shape, for the record: page
`GET /athlete/activities` with `after`/`before` epochs and `per_page`, walking backwards from today;
persist a cursor per connection so a lambda timeout resumes rather than restarts; back off on 429
using the returned usage headers rather than a fixed sleep; and decide up front whether summaries
suffice — a per-activity `GET /activities/{id}` for splits and laps multiplies the call count by the
number of activities and turns a minutes-long job into an hours-long one.
**A11. What does this cost? — token accounting by user, task, day, week and phase (2026-08-11)**

Owner: *"We will want to start tracking token usage: by user, by task, by day, by week, etc
(including by onboarding) so that we can begin to assess the cost of running this application.
Eventually we can build an admin view to review the data, but for now we just need to start
tracking it."* So: capture must be complete and correct now, aggregation must be answerable in SQL,
and there is no admin UI in this entry.

**What was already captured — verified against production, not assumed.**
AI Admin writes one `diagnostic_logs` row per model call, and for Cadence it is in far better shape
than expected. Over the whole corpus (4,780 rows, 2026-02-08 → 2026-08-11), the Cadence slice is
1,283 rows and every axis the owner named is already on them:

| axis | column | Cadence coverage |
|---|---|---|
| by user | `user_id` | **1,283 / 1,283 — zero nulls** |
| by task | `processing_job_id` → `processing_jobs.slug` | every job row |
| by day/week | `created_at` (timestamptz) | every row |
| tokens | `llm_response.usage.{prompt,completion,total}_tokens` | see below |
| model | `llm_timing.model` | every row that reached a model |

The `user_id` question mattered most and the answer is the good one: `DiagnosticSession`'s
constructor reads `effectiveUserId(getAuthContext())`, and for `mode: 'api_key'` that returns
`forwardedUserId` (`backend/src/db/tenant.ts`) — which `aim.ts`'s `aimContext()` sets to the
**Cadence end-user id**, not the workspace or the sentinel api-key uuid. Confirmed on live rows: 26
distinct `user_id`s, all real Cadence users. Per-user attribution needed nothing built.

Per-job usage coverage is also near-perfect, because no Cadence job sets `advanced.diagnostics`, so
`shouldRunDiagnostics` returns `{enabled: true, persist: true}` for all 28 and the verbose branch
that calls `endLlmTimer` always runs. Verified: `prescribe-session` 189/189, `context-select`
187/187, `synthesize-plan` 93/93, `pack-select` 80/80, `pack-summarize` 73/73, `capture-detour`
60/60, `plan-vet` 53/53, `capture-extract` 288/290. **Broker fire-and-forget calls are fully
attributed** — `void runCaptureExtract(...)` still runs inside `withAim`, so the ALS context is
live when the diagnostic row is constructed. That was the third suspected gap and it is not one.

Sample query that produced the table above (AI Admin DB, `platform:cadence` slice):

```sql
select date_trunc('day', d.created_at) as day, coalesce(j.slug, 'coach-chat') as task,
       count(*) as calls,
       count(*) filter (where d.llm_response->'usage'->>'prompt_tokens' is not null) as with_usage,
       sum((d.llm_response->'usage'->>'prompt_tokens')::bigint)     as prompt_tokens,
       sum((d.llm_response->'usage'->>'completion_tokens')::bigint) as completion_tokens
from diagnostic_logs d left join processing_jobs j on j.id = d.processing_job_id
where d.calling_application = 'platform:cadence'
group by 1, 2 order by 1 desc, 5 desc nulls last;
```

**Gap 1 — the most expensive call in the app is the one we half-measure.** The coach chat is
`anthropic-claude-4-5-sonnet` at ~10k prompt tokens a turn, and it is the only Cadence call whose
usage does not come from AI Admin's own LLM client: Cadence streams in-process and reconstructs
usage from the SSE frames in `coach-stream.ts`, then hands it to `recordCoachReply`. Of 184 coach
turns, **141 carry usage — and the trend is the wrong way: July 111/130 (85%), August 25/49 (51%)**.
The mechanism is exact, not mysterious. Upstream sometimes ends the stream with `inputTokens: 0` /
no usage frame at all; `relayAndAccumulate` faithfully returns `0`; and then `aim.ts` line 187 —
`args.metrics.promptTokens || args.metrics.completionTokens` — sees `0 || 0`, decides there is no
usage, and writes `usage: null`. Live proof, one conversation on 2026-08-11 where the prompt-token
count climbs turn over turn (9252 → 9616 → 9857 → 9999 → 10085 → 10360 → 10491) with **zero-token
turns interleaved between them** — turns that plainly consumed ~10k prompt tokens each and are
recorded as having consumed nothing. Same in `cadence.ai_log`: `promptTokens: "0"` on a 1,523-char
reply. We are under-reporting coach spend by roughly half, on the dominant cost line.

Two things follow, and they are different. (a) A zero we invented must be distinguishable from a
zero we measured — `usage: null` is a lie either way, so the row has to say *how* it knows. (b) When
upstream tells us nothing, we still hold the resolved prompt and the full reply text, so a
characters/4 estimate is available and is enormously better than zero. Cost math needs a floor, and
an honest flag on the estimate is what keeps the floor from becoming a fiction.

**Gap 2 — "by onboarding" is not answerable at all today, and cannot be answered by a join.**
`POST /coach/sessions` receives `intent: 'onboarding' | 'ongoing'`, uses it for `buildContextPack`
and `renderPickProtocol`, and then **drops it** — it is not passed to `openCoachSession`, not stored
on `cadence.conversations`, not in any diagnostic row. Worse, the obvious fix does not exist:
`diagnostic_logs` lives in the **AI Admin Supabase project** (`mkxynwtuqceiblilxkvz`) and every
`cadence.*` table lives in a **different project** (`qvukqinwmyvewzgcsgzt`). There is no cross-database
join. Any Cadence-side fact — phase, conversation, plan state — either gets written into the AI
Admin row at call time, or it is never queryable alongside the tokens. This is the single constraint
that decides the design.

**Gap 3 — a coach turn that produces no text produces no row.** `recordCoachReply` is called only
`if (content.trim())`, and it is the *only* caller of `diag.complete()` on the chat path. A turn the
user Stops, or one that errors after tokens were spent, never completes its `DiagnosticSession` —
so there is no row at all, not even a zero one. It also always reports `complete('success')`,
including for a turn the client dropped. (Failed *job* calls do log: `job-execution.ts` calls
`diag.complete('error', …)` — 579 error rows exist corpus-wide. Those legitimately carry no usage
because the call threw before a response; the failover case where a primary burned tokens and then
succeeded on failover does lose the primary's tokens, which is real but rare and out of scope here.)

**Gap 4 — estimated tokens are already silently mixed in.** `v2-stream-events.ts` and
`coach-stream.ts` both fall back `inputTokens ?? estimatedInputTokens`, and nothing downstream
records which one arrived. Provider-estimated and provider-metered tokens are being summed as if
identical.

**The design: one Cadence-side ledger, written at the single seam every Cadence AI call passes
through.** Given the two-project split, the choice is between stamping Cadence facts into AI Admin
rows (touches the core engine's job signature, and still leaves the numbers un-joinable to Cadence
users) or mirroring the usage into Cadence. The second wins on every count and is smaller:
`apps/cadence-api/src/ai/aim.ts` is a genuine chokepoint — all 28 job slugs reach the model through
`runJobBySlug`/`runJob`, and the coach reaches it through `recordCoachReply`. Nothing else calls a
model. One write in three functions covers 100% of Cadence AI traffic, in the same database as the
users, conversations and plans it needs to be sliced by.

Diagnostics stay exactly as they are — they remain the auditable per-call record, and the ledger is
deliberately a *derived* mirror, not a replacement. If the two disagree, `diagnostic_logs` is right.

Phase attribution rides an AsyncLocalStorage scope rather than 28 changed signatures. `void
runCaptureExtract(...)` inherits the store from the request that started it (the same property
`runWithAuth` already depends on), so a fire-and-forget Broker call started during an onboarding
turn is attributed to that onboarding session without its call site knowing anything. Phase itself
is *derived at query time* by joining the recorded `session_id` to `conversations.intent` — one
column, written once at session open, rather than a phase copied onto every row.

Prices live in `cadence.model_prices` (model, $/1M in, $/1M out, `effective_from`), seeded by the
migration and joined by the views — one maintainable place, no price literal in any query. A model
we have not priced shows as `null` cost rather than `0`, so an unpriced model is visible as a hole
instead of quietly reading as free.

**ARCHITECTURE**

```
                    ┌──────────────────────── Cadence API (apps/cadence-api) ────────────────────────┐
                    │                                                                                │
 POST /coach/       │  routes/coach.ts ──► runWithUsageContext({ sessionId })   [PROPOSED wrapper]   │
   sessions         │        │              └─ ALS scope; inherited by fire-and-forget Broker calls  │
   sessions/:id/    │        │                                                                       │
   messages         │        ├─► services/context-pack.ts ─┐                                         │
                    │        ├─► services/capture.ts ──────┤                                         │
                    │        ├─► services/turn-context.ts ─┼─► ai/aim.ts  ◄── THE SEAM (existing)    │
                    │        └─► …25 more services ────────┘     runJobBySlug / runJob               │
                    │                                            recordCoachReply                    │
                    │                                                   │                            │
                    │                            services/ai-usage.ts ──┘  [PROPOSED]                │
                    │                              recordUsage() — best-effort, never throws         │
                    └───────────────────┬────────────────────────────────────┬─────────────────────-─┘
                                        │ in-process @ai-admin/core          │ postgres (pooler)
                                        ▼                                    ▼
        ┌── AI Admin Supabase (mkxyn…) ──────────┐   ┌── Cadence Supabase (qvukq…) ──────────────┐
        │  diagnostic_logs   [EXISTING, source   │   │  cadence.ai_usage      [PROPOSED 0031]    │
        │    user_id ✓ job ✓ created_at ✓        │   │  cadence.model_prices  [PROPOSED 0031]    │
        │    llm_response.usage ~                │   │  cadence.conversations.intent [PROPOSED]  │
        │    of truth — audit trail, unchanged]  │   │  cadence.v_ai_cost / _daily / _weekly /   │
        │                                        │   │    _by_user / _by_task / _onboarding      │
        │  ✗ no cross-DB join possible ──────────┼─X─┤  cadence.users / conversations / plans    │
        └────────────────────────────────────────┘   └───────────────────────────────────────────┘
```

| component | file | status |
|---|---|---|
| the seam every model call crosses | `apps/cadence-api/src/ai/aim.ts` | existing, +3 write calls |
| usage writer + token estimator | `apps/cadence-api/src/services/ai-usage.ts` | proposed |
| phase/session ALS scope | `apps/cadence-api/src/services/ai-usage-context.ts` | proposed |
| `intent` persisted at session open | `apps/cadence-api/src/repos/conversations.ts`, `routes/coach.ts` | existing, +1 column |
| ledger, prices, views | `migrations/cadence/0031_ai_usage.sql` | proposed, **not applied** |
| per-call audit record | `backend/src/services/ai-diagnostics.ts` | existing, unchanged |
| the aggregation queries | `docs/cadence/TOKEN-ACCOUNTING.md` | proposed |

Ownership: Cadence owns the ledger and the prices; AI Admin owns the diagnostic record and is not
modified by this entry. Data flow is one-way (call → engine → result → ledger); nothing reads the
ledger back into a coaching decision, which is what keeps it safe to write best-effort.

**Open questions, unanswered:**
- Is a Devs.ai-reported token our real cost, or is Devs.ai's own margin on top of it the number the
  owner actually wants? The ledger prices *model list rates*, which is a lower bound on the invoice.
- Cache reads and cache writes price differently on every provider and we capture neither. The
  persona prefix is deliberately cacheable (MEMORY-ARCHITECTURE P0) — so the coach's real bill is
  probably *below* what list-rate prompt tokens imply, and we cannot yet say by how much.
- Should the estimate fallback be char/4 or a real tokenizer? char/4 is wrong by 10-20% per model
  and needs no dependency; a tokenizer is right and is a package per provider family.
- Retention: `diagnostic_logs` stores full prompts and replies and nothing prunes it. The ledger
  stores no content, so it can be kept forever — but nobody has decided what happens to the
  diagnostics it derives from.
- "Cost of an onboarding" is a distribution, not a number. Do we report median, p90, or mean? An
  onboarding that ran long because the user was chatty is not the same fact as one that looped.
**A13. Run tracking, heart rate, and the watch — the WorkoutKit hand-off is v1 (owner 2026-08-11)**

The owner's three requirements, in priority order: **(1)** run tracking in our application, **(2)**
heart rate for the non-running work — HIIT, resistance, meditation, **(3)** Apple Watch
notifications.

**The ruling — settled, do not reopen.** Our phone app *composes* the workout (goal / pace /
interval structure) with **WorkoutKit**, hands it to Apple's own Workout app on the watch — where it
appears with our icon and name — Apple does all the live tracking (GPS, heart rate,
battery-optimised), the result lands in HealthKit, and we read it back through the path we already
have. Accepted trade-off: during the run the user is in Apple's UI, so **no live coach nudges in
v1**. A native watchOS app is wanted eventually; it is v2.

**Verified against the SDK, not from memory.** Every API claim below was read out of the iOS 26.5
SDK's own `WorkoutKit.swiftinterface` (under `iPhoneOS.sdk/System/Library/Frameworks/`, in
`WorkoutKit.framework/Modules/WorkoutKit.swiftmodule/`) and cross-checked against
[Apple's docs](https://developer.apple.com/documentation/workoutkit). Framework floor is **iOS 17 /
watchOS 10**. What it actually gives us:

- **Four composition types.** `SingleGoalWorkout` (one goal), `PacerWorkout` (distance *and* time —
  this is the "run 5 k in 28 min" shape), `CustomWorkout` (warm-up + `[IntervalBlock]` + cool-down),
  `SwimBikeRunWorkout`. Goals are `WorkoutGoal.open | .distance | .time | .energy` (+
  `.poolSwimDistanceWithTime`, iOS 18).
- **Interval structure maps onto ours almost exactly.**
  `IntervalBlock(steps: [IntervalStep], iterations: Int)`, and
  `IntervalStep(.work | .recovery, goal:alert:)`. Our own
  `IntervalSet { workSec, recoverSec, rounds }` (`packages/cadence-shared/src/interval.ts`) **is**
  one `IntervalBlock`, so `IntervalPlan.sets` → `blocks` and multi-set falls out for free. Two
  mismatches: `restBetweenSetsSec` has no home in WorkoutKit's model (not a block, not a step), and
  EMOM (`recoverSec: 0`) must emit a work-only step rather than a zero-length recovery.
- **Support is a runtime question, not a table.** `CustomWorkout.supportsActivity(_:)`,
  `.supportsGoal(_:activity:location:)` and `.supportsAlert(_:activity:location:)` are static
  functions the SDK answers at run time. **Probe them on a device and write down what comes back** —
  a hardcoded matrix of "which activities WorkoutKit allows" will be wrong and will rot.
- **Scheduled, not started.** `WorkoutPlan.openInWorkoutApp()` is `@available(watchOS 10.0, *)` and
  `@available(iOS, unavailable)` — confirmed in the interface file. From an iPhone the *only* route
  is `WorkoutScheduler.shared.schedule(_:at: DateComponents)`, plus `scheduledWorkouts`,
  `remove`, `markComplete`, `removeAllWorkouts`, and the cap `maxAllowedScheduledWorkoutCount`. So v1 is
  "it's on your watch for Thursday", never "tap here and it starts on your wrist". Users see the
  coming seven days and the previous seven (WWDC23-10016).
- **No watch, no problem — and we can tell.** `WorkoutScheduler.isSupported`, `authorizationState`
  / `requestAuthorization()` (`notDetermined | restricted | denied | authorized`), and
  `StateError.watchNotPaired` / `.workoutApplicationNotInstalled`. The affordance must not render
  at all when these say no; a dead "send to your watch" button is exactly the class of defect A5/A6
  keep finding.
- **The join key we did not know we had.** `WorkoutPlan.init(_:id: UUID = UUID())` lets *us* choose
  the id, and `HKWorkout.workoutPlan` (async, iOS 17+) hands the plan back off a completed workout.
  So a HealthKit workout can be **matched to our occurrence by id** instead of guessed at by
  timestamp and type. This is the most valuable thing in the framework for us and it is the clean
  hand-off to A14.

**v0 — phone-only Core Location + MapKit tracking. Verdict: don't build it.** Asked honestly, it is
not a smaller first step than the hand-off; it is a bigger one.

- *What it costs.* A continuous `CLLocationManager` session, the `location` background mode (a new
  `UIBackgroundModes` entry in `apps/cadence-ios/ios/App/App/Info.plist` plus an App Review
  justification), `NSLocationAlwaysAndWhenInUseUsageDescription` — we have when-in-use only, and its
  copy promises *"It never tracks where you go"*, which continuous route tracking makes false — a
  route store, GPS-noise filtering, pace maths, auto-pause, a live map, screen-wake, battery
  behaviour, and crash-safe partial-run recovery. `@capacitor/geolocation` is already installed but
  gives one coarse `getCurrentPosition` for weather (`capability/native.ts`); it is not a run
  tracker, and streaming location through the webview bridge is the wrong place for one.
- *What it buys.* A run recorded less accurately than the watch, on a device many runners don't
  carry, **with no heart rate at all** — requirement 2 gets nothing. And to reach A14's store by the
  same path as everything else it would have to be written *into* HealthKit, which means
  `WRITE_WORKOUTS` and rewriting the `NSHealthUpdateUsageDescription` string we currently use to say
  we don't write.
- *Against v1:* a pure composer plus a small plugin, **no entitlement, no new background mode, no
  new permission**, and it returns GPS *and* heart rate.
- *The one thing it would cover:* someone with no Apple Watch. That is real and worth naming rather
  than hiding — but the answer for them is the manual log and the Apple Health import we already
  have, not a second tracking stack. Revisit only if watchless users turn out to be the majority.

**v1 — the committed slice. Architecture.**

| Component | Where | Status |
|---|---|---|
| Composer: `SessionItem` → `WorkoutPlanSpec` (pure) | `packages/cadence-shared/src/workout-plan.ts` | **new** |
| Capability seam entry `WorkoutPlanCapability` | `apps/cadence-web/src/lib/capability/index.ts` | extend |
| Native impl / web no-op | `…/capability/native.ts`, `…/capability/web.ts` | extend |
| Native bridge `CadenceWorkoutPlanPlugin` | `apps/cadence-ios/ios/App/App/CadenceWorkoutPlan/` | **new** |
| Prescription source | `occurrences.session` (migration 0010), built by `session-generate.ts` | existing |
| Interval vocabulary + bounds | `packages/cadence-shared/src/interval.ts` | existing, reuse |
| Read-back | `capacitor-health` → `capability.health.getWorkouts` | existing |
| Where completed workouts land | **A14's cross-source store** | not designed here |

- **The bridge is ours and it has to be native.** A webview cannot run on watchOS and cannot call
  WorkoutKit, so the calls live in a Capacitor plugin in the **App target** — modelled on
  `apps/cadence-ios/ios/App/App/CadenceCoachIdentity/CadenceCoachIdentityPlugin.swift`
  (`@objc(...)`, `CAPPlugin, CAPBridgedPlugin`, `pluginMethods`). Methods: `isSupported()`,
  `requestAuthorization()`, `schedule({plans})`, `listScheduled()`, `remove({id, dateISO})`,
  `markComplete({id, dateISO})`, `removeAll()`. Same manual Xcode wiring caveat as
  CadenceCoachIdentity — Capacitor's SPM layout does not auto-discover loose Swift files, so the
  folder must be dragged into the App target (that plugin's README documents the step, and is itself
  still marked UNVERIFIED ON DEVICE; a second hand-wired plugin doubles that debt).
- **Everything decidable is decided in TypeScript.** The Swift side decodes a spec and calls the
  framework; it makes no judgements. `tool: 'interval'` + the five `interval_*` fields →
  `CustomWorkout`; a run with both `distance_km` and `duration_min` → `PacerWorkout`; one or the
  other → `SingleGoalWorkout(.distance / .time)`; anything else → nothing at all rather than a
  meaningless `.open` goal. Reuse the existing clamps (`MAX_SETS 4`, `MAX_ROUNDS 20`,
  `MAX_INTERVAL_SEC 3600`) — do not invent a second set of bounds on the Swift side.
- **Plan id = f(occurrence_id), deterministic.** Makes scheduling idempotent under replan *and*
  makes the read-back attributable. This is the contract A14 consumes.
- **The server needs nothing.** Scheduling is device-local and HealthKit-adjacent; the phone already
  holds the session. If the API ever needs to know what is on a watch, that is a projection of A14's
  store, not a second source of truth.
- **Flow:** coach turn → `occurrences.session` → user opens the session → "Send this to your watch"
  → composer → seam → plugin → `WorkoutScheduler.schedule` → Apple's Workout app → `HKWorkout`
  carrying `workoutPlan.id` → `queryWorkouts` → A14 → occurrence done.
- **Build order.** (1) the pure composer and its tests — all the design risk is here and it needs no
  Xcode; (2) the plugin with `isSupported` / `requestAuthorization` only, confirmed on a device;
  (3) `schedule` + `listScheduled` and one real run end-to-end; (4) read-back matching by plan id.
- **Provisioning.** WorkoutKit needs **no entitlement** — nothing is added to `App.entitlements`,
  no new usage-description string, so Debug sideload and the free-team story are unchanged. The one
  real build change is the floor: the project is `IPHONEOS_DEPLOYMENT_TARGET = 15.0` and WorkoutKit
  is iOS 17. `CapApp-SPM/Package.swift` declares `.iOS(.v15)` and is stamped "DO NOT MODIFY —
  managed by Capacitor CLI", which is a second reason the bridge belongs in the App target behind
  `@available(iOS 17, *)` guards rather than in the SPM package.

**v2 — a native watchOS app (scaffolded, not designed).** Only start it once v1's read-back is
proven against real HealthKit data. What it structurally adds: `HKWorkoutSession` +
`HKLiveWorkoutBuilder` for **live** heart rate, distance and energy in *our* UI; mid-run coaching,
the thing v1 knowingly gives up; `openInWorkoutApp()`, so "start this now" becomes possible at all;
and standalone use with the phone left behind. What it costs: a second app target and a second UI
codebase in SwiftUI — **this is the point at which "one codebase behind a capability seam" ends** —
plus complications, watch-side notification layouts, and another review surface.

**Requirement 2 — heart rate, path by path.**

| | v0 phone GPS | v1 hand-off | v2 watch app |
|---|---|---|---|
| Running HR | none | after the fact, from HealthKit | live |
| HIIT / resistance HR | none | after the fact | live |
| HR *targets during* the work | none | yes — Apple enforces them | yes |
| Meditation | none | not a WorkoutKit activity | possible, see below |

- **Targets are free in v1.** `HeartRateRangeAlert` (`.heartRate(120...150, unit:)`) and
  `HeartRateZoneAlert` (`.heartRate(zone: 3)`) attach per step, and the watch does the alerting.
  Legality per activity is `supportsAlert(_:activity:location:)` — probe, don't assume.
- **Reading HR back is where the actual bug is, and it has nothing to do with the watch.**
  `capacitor-health`'s `Workout` payload declares `heartRate?: HeartRateSample[]` and **no
  `avgHeartRate` field at all** (`node_modules/capacitor-health/dist/esm/definitions.d.ts`; its
  `HealthPlugin.swift` never emits one). Our seam's `toSeamWorkout` reads `w.avgHeartRate`
  (`apps/cadence-web/src/lib/capability/native.ts`), so **`Workout.avgHr` has always been
  `undefined`** — and we pass `includeHeartRate: false` regardless. Requirement 2 is blocked on
  this, not on hardware. Fixing it means asking for the samples and reducing them, and the series is
  unbounded (`HKObjectQueryNoLimit` — 700+ samples for an hour), so the reduction happens natively
  or at the seam, never as a raw array crossing into React state.
- **Meditation is not a workout and must not be made into one.** HealthKit models it as
  `mindfulSession`, and the plugin already supports it — `READ_MINDFULNESS` in `HealthPermission`,
  and `queryAggregated({ dataType: 'mindfulness' })`. We request neither today
  (`HEALTH_PERMISSIONS` in `native.ts` is five read scopes; mindfulness is not among them), so
  adding it is small. But heart rate during a sit is a **calm/recovery signal and nothing else**:
  never a target, never a score, and the coach never says a sit went better because a number went
  down. Hearth, not scoreboard. Our `meditate` tool already runs in-app with bells; the watch adds a
  measured minute count and resting-HR context, not a grade.

**Requirement 3 — Apple Watch notifications: free vs. work.**

**Free today, zero code:** an iPhone notification is shown on the paired watch whenever the phone is
locked — Apple's default forwarding, with "Mirror my iPhone" the default per-app setting ([Apple
Support HT108369](https://support.apple.com/en-us/108369)). So every push already sent through
`apps/cadence-api/src/services/notify/dispatch.ts` → `push-apns.ts`, and every local nudge
scheduled by `apps/cadence-web/src/lib/local-notifications-sync.ts`, **already reaches the wrist**.
There is no watch-side work required to get a notification onto a watch.

What actually needs work, most valuable first:

- **Nothing consumes a tap.** There is no `pushNotificationActionPerformed` listener, and no
  `localNotificationActionPerformed` one, anywhere in `apps/cadence-web` or `apps/cadence-ios`, and
  no `UNUserNotificationCenterDelegate` in `AppDelegate.swift`. The categories and the seven action
  ids in `packages/cadence-shared/src/notifications/actions.ts` are registered and carried on push
  as `aps.category` — and the buttons they draw do nothing. **On the wrist that is worse than on the
  phone**, because an actionable notification *is* the whole interaction; there is no natural "open
  the app and go find it" fallback. Highest-value item in requirement 3, and it is not watch work at
  all.
- **Interruption level and thread id are unset.** `push-apns.ts` builds
  `{aps: {alert, sound, category}}` — no `interruption-level`, no `thread-id`, no
  `relevance-score`. `almost_time` for a session starting in ten minutes is the textbook
  time-sensitive case, and on the watch relevance ordering decides what is seen first. Payload-only,
  cheap.
- **A watch app would add** our own notification layout, complications and the Smart Stack. All v2,
  all optional, none of it needed for a nudge to arrive.

And note that a scheduled WorkoutKit workout is itself watch presence: it sits at the top of the
Workout app's list on its day, with our icon and name, without any notification at all. Pair that
with the existing `almost_time` nudge and requirement 3 is largely answered before any
watch-specific code exists.

**Open questions.**
- `restBetweenSetsSec` has no WorkoutKit representation. Drop it, or fold it in as a leading
  recovery step of the next block? (Dropping it silently changes what the user was told they'd do.)
- Raise the deployment floor to iOS 17, or `@available`-guard indefinitely? Raising it is cleaner
  and should be an explicit decision, not a side effect of this feature.
- **When do we schedule?** The whole committed week up front, or a rolling day or two? Users only
  see ±7 days, and `maxAllowedScheduledWorkoutCount` is a real cap we must read rather than assume.
  What happens on a detour or a replan — `remove` then re-`schedule`, and does an in-progress
  workout survive that?
- **Who marks an occurrence done** — our read-back, or `markComplete`? Both exist and they are
  different truths: `markComplete` tells Apple's list it happened; a HealthKit read tells us *what*
  happened. When they disagree, ours wins — but that needs saying out loud.
- Does "send this to your watch" live on the session screen, or does the coach offer it in
  conversation? Every other tool in Cadence is offered by the coach.
- Is SwiftUI's `workoutPreview(_:isPresented:)` (iOS 17+, the `_WorkoutKit_SwiftUI` cross-import
  overlay) worth presenting over the webview as an Apple-drawn confirmation, or is our own confirm
  card better? It is the only piece of native UI this feature would otherwise need.

Not scoped beyond v1's first slice. v0 is rejected; v2 waits on v1 proving the read-back.
**A17. Oura — a recovery signal, parked on purpose (owner 2026-08-11, LOWEST priority)**

Owner: *"Integrate to Oura"* — and explicitly last in line: Apple Watch first, then Strava, then
Oura (*"I don't even have an Oura ring"*). Logged so the bet is placed, not so anyone builds it.

**What Oura is for: recovery, not workouts.** Sleep staging, overnight HRV, resting HR, temperature
deviation, and a daily readiness score. The brand fit is exact — "you've slept badly three nights
running, want today's session to bend?" is plan-bends-not-breaks with a physiological signal behind
it. Honest overlap check: an Apple Watch worn to bed already writes sleep stages, HRV and resting
HR into HealthKit, which we integrate first anyway — that covers most of Oura's value for
watch-wearers. Oura's residual edge is night-time measurement quality (finger PPG, temperature
trend), the synthesized readiness score itself, and being the ONLY signal for ring-not-watch
people. That residual is what has to earn the build cost, and today it doesn't.

**API facts (verified 2026-08-11).** v2 REST, OAuth2 authorization-code; scoped tokens (`daily`
covers the daily_sleep/daily_readiness summaries; `heartrate`, `workout`, `session`, `spo2` are
separate scopes). Rate limit 5000 req/5 min — irrelevant at our scale. A webhook subscription API
exists (per data_type + event_type, HMAC-verified callback), but data only lands after the user
opens the Oura app and the ring syncs — so in practice it is a **morning batch, not a stream**.
Critical caveat: Gen3+ users **without an active Oura membership get no API data at all** — a
connected ring can silently go dark when the subscription lapses, so the connection UI must render
"connected but nothing arriving" as state, never as the user's failure.

**PROPOSED shape: A16's pattern, three deltas.** Oura is the second consumer of the generic
OAuth-connection pattern A16 (Strava) owns — no framework work here. Deltas only: (1) **cadence** —
a morning batch keyed off the daily_* webhook events (or a daily poll), not near-live workout
ingestion; (2) the **membership check** above; (3) **where it lands** — Oura workouts join A14's
canonical workout store like everyone else's, but daily readiness/sleep is a different shape (one
scored row per day, not an event) and goes into a small daily-signals table the context engine
reads, not the workout store.

**Readiness ethics, settled now so it isn't relitigated:** a readiness score is an opinion — a
vendor's model of your night, not a fact about your day. The coach may OFFER to bend the plan on it
("your body's asking for an easier day — want to swap?"); she never scolds from it, never withholds
anything because of it, and never overrides what the user says they feel. Someone who feels great
on a "poor readiness" morning is right.

**Trigger:** start only when (a) A16's connection pattern has shipped and survived contact with
Strava, AND (b) the owner owns a ring or real users ask for it. Until both, this entry is the whole
deliverable.

**A5. A dead session bricks the app — no path back to signed-out (2026-08-11)**

Deleting an auth user while the app held its session left the phone unusable: every turn answered
"Something hiccuped on my end". Evidence, in the order that settled it — AI Admin had NO diagnostic
log for the failing turn (so nothing reached a model), and Supabase had ZERO auth requests in two
hours (so it was not a rejected sign-in, it was no attempt). supabase-js found a stored session in
local storage, considered itself authenticated, and never called `signInAnonymously`; every API
call then carried a JWT for a user that no longer existed.

Self-inflicted here, but the general case is real and is NOT: a revoked refresh token, rotated
project keys, or an account deleted by support all produce the same state. There is no path from
"the stored session is invalid" back to "bootstrap a fresh anonymous one", so the app is bricked
permanently. Clearing it needed a machine with `devicectl`; a real user just has a dead app.

Fix, next to the auth bootstrap: on a 401 / `user_not_found` from the API, or a failed token
refresh, clear the stored session and start a new anonymous one. Guard it against a loop (a genuine
outage must not spin up anonymous users), and note it is the same recovery a "sign out and start
over" would take — so it should share that code path rather than invent a second one.

**A6. First full run on the new capture — four defects (2026-08-11)**

The A-Z run after the capture/health/schema work. The plan itself is not yet assessed; these are the
mechanical faults it surfaced.

1. **Duplicate goals from a spelling variant.** Two captured goals for one race — "Spartan
   Ultrabeast" and later "Spartan Ultra Beast" (with a space) — which then collapsed back to one.
   Dedup is matching on the title string, so the model rewording its own extraction mints a second
   goal. Goals need identity that survives rewording; the title is not it.
2. **The captured-goal pills vanish mid-conversation** (observed once the coach asked about time in
   the day). They are the running proof that she heard you — disappearing silently is the opposite
   of the promise, and worse than never showing them.
3. **FIXED (#176) — "Change something" and "+ Did I miss something? Tell me" did nothing, same cause.**
   `OnboardingChat.tsx`: `{confirming ? <cfm-bar> : <composer>}`. While the confirm card is up the
   composer is REPLACED by the Build/Change bar, and both buttons only call `setInput(...)` — they
   prefill an input that is not on screen. The fix is to leave confirm mode (restoring the composer,
   focused, with the prefilled text) rather than to write into nothing. Both are the app's only
   offered way to correct the plan at the moment of committing to it, so this was the highest-value
   of the four. A correction now sets an explicit override that suppresses the confirm bar and
   restores the composer; her next turn clears it so the following card can still offer "Build it".
   Shipped WITHOUT a regression test — the harness needs a driven confirm turn — and the failure was
   invisible to all 331 existing tests, which is exactly the kind of bug a test should catch.
4. **The progress bar reads 90% at the end.** It is driven by the coach-emitted `progress` on quick
   picks, which never reaches 1. Either the last turn must carry 1, or the confirm stage should pin
   it — a bar that never completes undercuts the one screen that says "done".

**A4. Claiming an anonymous run into an account that already exists — NEEDS DESIGN (2026-08-10)**

Hit on device: at the end of onboarding every way of saving the plan answered "you already have an
account", with no way forward and no way back. #173 ended the dead end by offering "sign in to that
account instead". That is the FLOOR, not the fix — its price is "this week won't carry over", and
discarding the run is precisely what BRAND.md forbids:

> Cadence never makes you repeat yourself and never makes you start over.

**Why our version is harder than the one everyone copies.** Duolingo-style apps gate EARLY — a
lesson or two in — so a collision costs about ninety seconds and "log in instead" is a fine answer.
Cadence gates at the far end: fifteen minutes of conversation, two corrections, injuries, a race
date, and a built plan. Copying their recovery copies the wrong half; their recovery is cheap
because their exposure is small.

**The shape of the real fix (deliberately not scoped yet — owner wants to think it through).**
Merge rather than discard. The data model is unusually friendly to it: `goals`, `plans`,
`occurrences`, `conversations` are rows keyed by `user_id`, so claiming an anonymous session is
largely reassignment, not migration. The hard part is the one genuine conflict — the existing
account already has an active plan — which needs a single explicit choice ("keep the week you just
built" or "keep the plan you already had"), asked once, in the confirm-before-committing style the
coach already uses.

Open questions, none answered yet:
- What merges silently (constraints, equipment, baseline) versus what must be chosen (an active
  plan, conflicting goals, a different name)?
- What happens to the anonymous run's conversation history — adopted, archived, or dropped?
- Is a claim reversible, and for how long? An unreversible merge is its own way to lose work.
- Does the coach narrate it, or is it silent chrome? A merge the user cannot see is a surprise at
  the next weekly check-in.

**Cheap complement, independent of the above:** ask earlier. A line near the start of onboarding —
"Been here before? Sign in." — costs nothing and stops most collisions forming. Returning users on
a new device currently get no signal until the very end. Note Supabase deliberately does NOT expose
"does this email exist" (account enumeration), and for OAuth nothing is knowable until the provider
returns — so prevention has to be a PROMPT, not a lookup.

**Related and already shipped:** #171 (silent OAuth failures were creating the orphaned identities
in the first place), #173 (the way out). The account that triggered this was an empty husk holding
the Google and Apple identities — earlier silent link attempts had succeeded server-side while the
client never learned, and clearing production removed the `cadence.*` rows but not `auth.users`.
Escaping it required database access, which is exactly what must not be true for a real user.

**A. Context/memory (MEMORY-ARCHITECTURE.md §9 phasing)**
- **P3 — pack reuse: BUILT 2026-08-04** (the reuse half; enrichment deliberately dropped — see
  below). A coach session open now serves a cached dossier and skips BOTH Broker calls whenever
  the pack provably reflects every dossier write since it was built. The invalidation rule is
  **database triggers** (migration `0022_pack_touch`), not app-side calls — the `listForCoach`
  move: one missed invalidate call would be "making you repeat yourself", so no app code is
  trusted to remember. Every dossier table touches `users.pack_touched_at` on write; the one
  churn trap is handled in SQL — occurrences' UPDATE trigger fires only on dossier-real columns
  (status/value/log/date/episode), so the prescription-CACHE writes on every plan open cannot
  kill packs. Reuse requires intent match (framing is baked into `rendered`) and expiry.
  Verified three ways: a live SQL truth-table on the deployed DB, a 7-case integration suite
  through the app's own read (goal write / secret toggle / status flip invalidate; cache write
  does not), and 3 mock tests proving the service short-circuits with zero model calls and zero
  inserts. *Known races, accepted:* session-open fires ensureHorizon concurrently — a horizon
  top-up may invalidate a pack a moment after it was served (next open rebuilds).
  *Deliberately dropped from the original spec:* data-volume triggers and `status='enriching'`
  partial refresh — the watermark makes both redundant (any relevant write rebuilds, and builds
  are cheap enough once they only happen on real change); conversational-staleness stays with P4.
- **P4 — reflection + cross-session/topic memory. NOT BUILT** (checked 2026-08-04). Background
  reflection pass (MemGPT-style); per-topic packs; a longitudinal memory store beyond per-session
  `workflow_variables`. *Note for anyone grepping:* "reflection" appears in `services/burn.ts` as
  an activity **category**, not as a memory pass — it is not evidence of this being started.

**B. Coaching**
- **Objective → commitment bridge — PARTIAL (2026-07-15).** Objectives = goals, commitments =
  activities/occurrences. SHIPPED: `synthesize_plan` now tags each activity with the goal it serves
  (`goal_title` → deterministic `matchGoal` in `services/plan-match.ts` → `activities.goal_id`); the
  "Set your rhythm" preview GROUPS commitments under their objective ("Toward Run a 10k", system/
  foundational work sinks to a "Foundations" group); and because occurrences inherit the activity's
  `goal_id` via the existing join, logged accomplishments now AUTO-LINK to the right goal's progress
  count (closes the goal_events manual-only gap from the Progress module). Live-verified: a real
  synth linked 2/3 activities to their goals, the weekly check-in stayed unlinked. The
  conversational moment SHIPPED 2026-07-16: `why` persists at commit (migration 0012), the dossier
  renders the full ladder (goal → commitments → why, with commit recency), and the persona walks
  it in chat on a fresh thread after a recent commit — see the cut-3 batch entry. (Blog #2.)
- **Dynamic intake — CUT 1 SHIPPED (2026-07-16), deterministic.** For a TARGET goal, the missing
  intake fact is almost always "where are you now?" — detectable without an LLM. `GoalMeasure.start`
  added; capture extracts it ONLY when the user states today's number (body weight excluded —
  baseline owns it); pure `services/intake.ts` `startingPointGaps` (unit-tested) feeds
  `onboardingReadiness` with per-goal "where they are today on X" need-lines + a one-at-a-time
  nudge, so the coach asks naturally in conversation — never a form. Live-verified on account-2
  ("Read 100 books" flagged; weight goal correctly skipped). CUT 2 SHIPPED (2026-07-16): bespoke
  non-numeric intake via assess-goal (`intake[]`, ≤3 coach-voiced questions, rendered in the
  assessment panel as "worth talking through with your coach") and the Review `measure.start`
  editor ("starting from …") for when capture misses it. Intake is now: deterministic starting
  points chased in chat + LLM texture questions on demand — never a fixed form.
- **Daily loop (Phase 6) — LARGELY SHIPPED** (checked 2026-08-04). The Today trail, occurrences
  (`listOccurrences` + the walkthrough's commit-on-Finish), the HealthKit capability seam,
  shoe-mileage and `weekly-readout` all exist. The one piece genuinely missing is the **nudge
  channel** — and it is missing for the same reason as everything else in this family: nothing
  can fire without the user present. Parked with reminders/check-ins (REQ10 §7).
- **Proactive check-ins — PARTIAL, and the rest is PARKED** (owner 2026-08-04). SHIPPED: the
  `check_ins` table, `repos/check-ins.ts` (`recordCheckIn`, `listCheckInDays`), consumed by
  `routes/plan.ts` and `services/streak.ts`. NOT built: the user-chosen **cadence**
  (`users.check_in`), a `capture_feedback` job, and anything that fires without the user present.
  **Parked** with the rest of "reminders and proactive check-ins" (REQ10 §7) — nothing can wake
  up without a user today, which is the actual blocker, and the owner has deferred it.
  ⚠️ Naming: REQ10 §7b rules that **absence is a habit signal, never a health signal** — no copy
  or column here may imply we inferred anything about someone's wellbeing.
- **Nutrition topic slice — OBSERVE PHASE SHIPPED (2026-07-17).** `parse-meal` job +
  `nutrition_logs` writes (raw_text always kept) + deterministic summary feeding dossier,
  `get_food_log` retrieval, replan `recent_activity.food_log`, and the Food-log capture sheet;
  synthesis holds eating changes until 7+ logged days, then ONE at a time. See the dated batch
  entry. Photo input SHIPPED capture-first 2026-07-17.
  **Stale line corrected 2026-08-06:** this entry claimed vision parse + `macro_targets` day view
  + rings were REMAINING; the spec section below is stamped **✅ SHIPPED N1–N4**, so they are
  done — the entry was describing finished work as outstanding (exactly the failure the §12
  refresh header warns about). REMAINING is only **per-topic thread continuity**, which is really
  a face of P4 (see below), not a nutrition-specific task.
- **Adaptation (Phase 7) — AUDITED 2026-08-04: BUILT END TO END.** The chain, traced in code:
  `GET /plan` fires `assessIfDue` (fire-and-forget) → **deterministic tripwires gate it, so no
  wire firing means no LLM call at all** → `situation-assess` proposes → `users.pending_proposal`
  → `PlanProposalBanner` on the next load → accept runs either `enterEpisode` (the additive
  temporary plan, via `episode-overlay`) or `replanPlan` → `endEpisode` exits, wired to a route
  and to `PlanView`. Guards in place: one outstanding proposal at a time, a 7-day assess interval,
  and nothing assessed before a plan exists.
  **Six wires:** timezone shift (≥2h), location move (≥100km), missed threshold,
  consistency/outcome divergence (showing up, number not moving), consistency dip, extreme
  weather (≤-10°C / ≥38°C). Absence is handled on RETURN (`RETURN_GAP_DAYS` 4,
  `REBASELINE_GAP_DAYS` 7).
  **Correction to an earlier note in this refresh:** Phase 7 is *not* blocked on the parked
  reminders work. It is request-time triggered by design — the user opening their plan is the
  clock — so it functions today without anything that wakes up on its own.
  **Gap found and closed:** `tripwires.ts` — the gate deciding whether the LLM runs, and the home
  of every threshold — had **zero tests** while everything downstream was covered (situation 11,
  episode 8, overlay 5). Now 12, covering each boundary, the empty case, and the guard that a
  partial fact never fires a wire (a missing home location must not propose a detour to someone
  sitting at home).
  **Genuinely still unknown:** no end-to-end run on a live account — every link is verified in
  isolation, the seam between them is not.

**C. Capture quality — FIXED (2026-07-15)**
- **Baseline schema drift — FIXED.** `normalizeBaseline` (`services/capture-normalize.ts`)
  canonicalizes every weight shape the Broker emits (`{value,unit}`, `weight_lbs`, `weight_kg`,
  bare number) into `weight_kg{current,start,source}` + `weight_unit`, and maps legacy `injuries[]`
  → `constraints[]`. Verified against the exact fields Review reads (`weight_kg.current` behind a
  20–500 kg plausibility guard, [ReviewScreen.tsx:163-169]); unit-tested. Earlier capture fixes
  still in place: full-conversation window, tighter prompt, replace-`captured`, durable
  `cadence.ai_log`.
- **Over-extraction / duplication — FIXED.** Two deterministic layers now. Cross-run duplication
  (the old 1→2→4 climb) was already killed by REPLACE-on-each-run: delete captured-without-
  milestones, re-insert the consolidated set. Intra-run duplication — the model returning two
  near-duplicate goals in ONE response — is now caught by `selectCapturedGoals`
  (`services/capture-normalize.ts`): a fuzzy title collapse against confirmed, sticky
  milestone-bearing goals, AND each other (keep first seen). The prompt also caps to "the FEWEST
  goals … usually 1-3". Unit-tested. (Semantic/embedding dedup for reworded-but-unrelated titles
  remains a possible future upgrade; the title-fuzzy backstop covers the observed failure.)

**D. Persona / UX tuning**
- **Question cadence — still open, and now a BEHAVIOUR gap rather than a wording one.** The
  persona is unambiguous (checked 2026-08-04: *"Ask only ONE question at a time"*, plus a ban on
  bulleted question lists and an offer to send a questionnaire instead of interrogating in chat),
  so there is nothing left to align in Build Rules — the instruction says strict-one already. What
  was observed in the sim was the model not obeying it. The open decision is therefore: accept
  1–2 related questions and soften the rule to match reality, or keep strict-one and enforce it
  the way the tool catalog enforces everything else (a check, not a sentence). Re-observe first —
  the sim predates several persona edits, so the behaviour may have moved.

**E. Platform / infra**
- ~~**Real auth**~~ — **SHIPPED** (verified 2026-08-04): `features/auth/AuthScreen.tsx` with
  Supabase sign-in, email/password + Google, wired in `App.tsx`; `requireCadenceUser` gates every
  API route. The dev user survives only behind `?dev=1` / `?preview=` harnesses.
- **Sign in with Apple — CLIENT SHIPPED 2026-08-07, awaiting portal + Supabase config.** Button,
  provider-agnostic native path (`signInWithProviderNative`), the `com.apple.developer.applesignin`
  entitlement, and `scripts/generate-apple-secret.ts` are all in. **Decision: ship the shared
  browser-sheet path first, not `@capacitor-community/apple-sign-in`** — guideline 4.8 requires that
  Sign in with Apple be *offered*, not that it use the native ASAuthorization sheet, so the system
  sheet is a UX upgrade rather than a submission gate, and this way App Store submission isn't
  blocked on a new native dependency. **The recurring trap:** Apple issues no static client secret —
  it is an ES256 JWT with a **6-month maximum lifetime**, so Apple sign-in breaks on a timer with no
  code change to blame. `generate-apple-secret.ts` re-mints it and prints the expiry date. Also
  restored `aps-environment` in `App.entitlements` (removed 2026-08-06 for the free-team install).
  - **BACKLOG — owning the Apple OAuth client (deferred 2026-08-07; Supabase is fine for now).**
    The expiring secret is not inherent to Sign in with Apple; it is the cost of Supabase performing
    the **token exchange** for us. Whoever POSTs to Apple's token endpoint can mint the client-secret
    JWT per request with a ~5-minute expiry and store nothing — the pattern `push-apns.ts` and
    `weatherkit-http.ts` already use here. Note this needs no "IdP" of our own: Apple issues the
    identity, we would only be the OAuth *client*.
    **The cheaper 80% is the native path:** `@capacitor-community/apple-sign-in` gets an Apple
    identity token straight from the OS sheet, which goes to `supabase.auth.signInWithIdToken(...)`
    and is verified against Apple's PUBLIC keys — **no client secret in that flow at all** (Supabase
    needs the bundle id in its allowed client IDs). So it is not only a UX upgrade, as the decision
    above framed it; it also removes the expiring credential on iOS.
    **What it does NOT fix:** web has no system sheet, so the redirect flow — and the 6-month
    secret — stays for the PWA. Native therefore buys *blast radius* (a lapse leaves iOS users
    signing in fine and breaks only web), not a cure. Dropping Apple on web WOULD delete the
    problem outright (4.8 is an App Store rule, not a web one) but is rejected: a user who signed up
    on iOS with **Hide My Email** has a relay address and could be left with no way into the web app
    — a direct violation of "never makes you start over".
    **Revisit when** the secret actually lapses once, or web Apple sign-in gets real usage. Until
    then the tripwire below is the mitigation.
  - **BACKLOG — expiry tripwire (recommended next, ~20 lines).** Record the secret's expiry date to
    a committed file from `generate-apple-secret.ts`, and fail a test within 30 days of it, so CI
    goes red weeks before users are affected. Chosen over automated rotation via Supabase's
    Management API because a rotation job that runs twice a year is untested when it matters —
    teams who automate this properly rotate MONTHLY so the path is exercised. Not worth that
    operational surface for a solo maintainer yet.
- **Social logins: Apple + Facebook (added 2026-08-06)** — extend `AuthScreen.tsx` alongside the
  existing Google button; both are Supabase Auth providers, so the flow (incl. the native
  `cadence://auth-callback` PKCE deep link) is already built — per-provider work is dashboard
  config + a button. **Sign in with Apple is NOT optional:** App Review guideline 4.8 requires it
  in any iOS app offering third-party login (Google today) — it gates the App Store submission,
  so ship it with (or before) TestFlight. Needs the paid enrollment: an App ID with the
  "Sign in with Apple" capability + a Services ID/secret key for Supabase; native-first via
  `@capacitor-community/apple-sign-in` (system sheet, no browser hop) with the web-OAuth path as
  fallback. Facebook is optional/when-wanted: **Meta developer account created 2026-08-06** —
  app + Facebook Login product + OAuth redirect URI (`https://qvukqinwmyvewzgcsgzt.supabase.co
  /auth/v1/callback`) + Supabase provider config + button still to do. Correction to an earlier
  note: `email`+`public_profile` now get Standard Access automatically — **no App Review
  needed** for what Cadence uses; the only gate is filling in Basic Settings (privacy policy URL,
  icon) to flip the app from Development to Live. Both providers must respect the brand's
  plain-words copy —
  **Account-linking: DECIDED (owner 2026-08-06) — one account per verified email**, providers
  link into it (Supabase's default; keep it). Fits the brand promise directly: never make the
  user start over — signing in with Apple tomorrow after Google today must land in the same
  coach relationship. Caveat to honor at build time: Apple offers "Hide My Email" relay
  addresses — a relay email won't match the user's Google email, so linking silently won't
  happen for those users; the sign-in copy should not promise it does.
- **Native location — SHIPPED 2026-08-06.** `capability/native.ts` now uses `@capacitor/geolocation`
  (CoreLocation) instead of inheriting the web `navigator.geolocation`. Not cosmetic: the shell is
  served from `capacitor://localhost`, which iOS does **not** treat as a secure origin, so the web
  geolocation API is unreliable in WKWebView — the previous inherit was a latent bug, not just an
  inconsistency. Also gains a real permission state (`checkPermissions`) rather than only
  success/failure. Requests `coarseLocation` (weather + timezone is all Cadence needs).
- **Weather via Apple WeatherKit — CODE COMPLETE 2026-08-07, awaiting credentials.** Membership went
  active 2026-08-07, unblocking this (and TestFlight, the APNs key, Sign in with Apple). The swap is
  built and tested against a mocked provider; it stays **dormant until the four `WEATHERKIT_*` env
  vars are set** (`isWeatherKitConfigured()` gates every call, so an unset block just means "keep
  using OpenWeatherMap"). Shipped: `weather/weatherkit-http.ts` (ES256 provider JWT + REST client),
  `weather/weatherkit-map.ts` (payload → `WeatherSnapshot`), provider selection with OWM fallback in
  `weather/weather.ts`, `source` on the snapshot, and the Apple Weather attribution line in the
  Today header. Two things worth knowing for the first live call: `sub`/header-`id` use the
  **Services ID**, not the bundle id (the overwhelmingly common 401), and WeatherKit reports wind in
  **km/h** where OWM uses m/s — mis-mapping that is a silent 3.6× error, so it is pinned by a test.
  Design (2026-08-06). Rationale
  is OS consistency: an iOS user's lock-screen/Weather-app forecast is Apple's, so Cadence quoting
  OpenWeatherMap reads as wrong even when it isn't. Design: **swap the SERVER-side source**
  (`services/weather/weather.ts`) to the WeatherKit **REST** API and keep OpenWeatherMap as the
  fallback when WeatherKit is unconfigured or errors — the existing cache/`WeatherSnapshot`/
  tripwire layers are source-agnostic, so this is a `weather-http.ts` swap, not a re-architecture.
  Do NOT move weather on-device: server-side keeps one source for web + iOS (a per-client source
  would make a user's web and phone disagree) and preserves the cache. Auth reuses machinery we
  already built — WeatherKit REST signs an **ES256 JWT from a p8 key**, exactly like
  `services/push-apns.ts`; needs a WeatherKit-enabled key + Services ID + App ID, and the JWT's
  `sub`/`jti` differ from APNs. Free tier 500k calls/month with membership — far beyond our volume.
  **Product constraint:** displaying Apple weather data REQUIRES showing the Apple Weather
  trademark plus a link to Apple's legal-attribution page, so every weather surface needs an
  attribution line before this can ship.
  **Call budget (analysed 2026-08-06 — the fix is WHERE the cache lives, not how often we call).**
  500k/month ≈ 16.6k/day. The existing key already bounds this well: `weatherCacheKey` buckets to
  **1 decimal degree (~11 km) + local calendar date**, with a 1h soft TTL — so cost scales with
  *populated 11 km cells*, NOT with users (a whole city shares one entry), giving ~700 distinct
  cells/day at 24 hourly refreshes. Six call sites (`me`, `session-generate` ×2, `day-recap`,
  `date-context`, `situation`) all share that cache, so a chatty coach hour is one fetch.
  ~~**The actual risk: the cache is a process-local in-memory `Map`.**~~ — **FIXED 2026-08-06**
  (migration `0025_weather_cache` + `repos/weather-cache.ts`). Two tiers now: L1 the existing
  in-process Map (free, no DB round trip on repeat hits), L2 `cadence.weather_cache` shared by
  every instance and surviving restarts, then the provider. The table is deliberately **not**
  user-scoped (weather belongs to a place — the ~11 km bucket sharing IS the saving) and
  deliberately has **no `pack_touch` trigger** (weather is ambient; wiring it to the 0022
  watermark would invalidate every user's context pack on every fetch). RLS on with no policy:
  no owner column exists, so no policy would be correct, and the `cadence` schema isn't exposed
  to the Data API anyway. The migration script asserts all three properties.
  **Bug found while testing:** the L2 read sat outside `getWeatherAt`'s try/catch, and
  `session-generate` awaits `getWeatherForUser` with no `.catch` — a cache fault would have
  broken session generation. Now independently guarded; a cache outage costs a provider call,
  never a failed request. Still to do with WeatherKit: it returns
  `currentWeather`+`forecastDaily`+`forecastHourly` in ONE request, halving today's two OWM calls
  (current + forecast) per miss.
- **Deployment (Vercel)** — SSE + always-on caveats (§11); Broker triggers via Vercel Cron → AI
  Admin trigger endpoints.
- ~~**Native iOS (Capacitor) + HealthKit**~~ — **SHIPPED as a simulator-verified shell (2026-08-06):**
  `apps/cadence-ios` (Capacitor 8, SPM not CocoaPods), runtime capability selection
  (`capability/native.ts`: HealthKit workouts via `capacitor-health`, APNs register), OAuth deep link
  (`cadence://auth-callback`, PKCE), CORS on cadence-api, `.env.ios` absolute API base, migration
  `0023_device_tokens` + `/me/push-token` + APNs p8 sender (`services/push-apns.ts`, no SDK dep),
  confirm-first Apple Health import + notifications in Settings. Built and verified on the iOS 26.5
  simulator (blank-screen fix: PhoneFrame must never pin `--app-height` to WKWebView's early
  `visualViewport.height` of 0). **Still open:** paid Apple Developer enrollment, bundle-id decision
  (placeholder `com.cadenceapp.ios`), Supabase redirect allowlist for the deep link, APNs `.p8` env,
  deploy cadence-api (CORS) — then device build, HealthKit-on-device, TestFlight. Push *scheduling*
  still belongs to item B (check-in cadence); plugin gap: `capacitor-health` has no weight/sleep
  queries, so those seams return null (custom Swift later). Device install 2026-08-06: bundle id
  is **`dev.jleggo.cadence`** (`com.cadenceapp.ios` was taken — app ids are globally unique);
  free-team build on jeffrey's iPhone, push entitlement locally removed until enrollment activates.
  **Bundle id changed to `builders.cadence.app` (2026-08-07), BEFORE any App Store Connect record
  existed** — the last moment it is free. `dev.jleggo.*` was a personal namespace and, unlike a
  display name, a bundle id is permanent: changing it after first upload means a NEW app record and
  losing ratings, reviews, and the install base. It now reverse-DNSes a domain actually owned
  (`cadence.builders`, on Vercel DNS), which `dev.jleggo.cadence` never did — `jleggo.dev` is
  unregistered. `.app` as the final segment, not `.ios`, because Capacitor's single `appId` becomes
  the Android package name too. Avoided `com.cadence.*`: that is Cadence Design Systems' namespace
  (they own cadence.com), and squatting it on an unchangeable identifier invites a dispute.
  **The two Services IDs deliberately keep the old `dev.jleggo.cadence.{weather,signin}` strings** —
  a Services ID is not the bundle id, is not user-visible, and is not permanent; renaming them would
  mean re-minting the Apple client secret and re-pointing Supabase for zero functional gain. The
  Sign in with Apple Services ID does need its **Primary App ID re-pointed** to the new App ID.
- **Onboarding health context — SHIPPED 2026-08-06, incl. goal-gating + foreground refresh.**
  The CLIENT builds a compact digest (workouts by type/week — the Broker cannot query HealthKit,
  it is on-device only) → `POST /me/health-digest` (zod-bounded; optional live-session inject) →
  `cadence.health_digests` (0024, pack_touch trigger) → `get_health_history` retrieval fn +
  `health_history` catalog stat (without the stat the Broker never selects it — verified live).
  **Goal-gated offer (detour pattern):** session open declares `healthAvailable` (iOS shell +
  unanswered) → context gets a "Device: Apple Health is available…" line → the persona offers
  ONCE, in prose, only for goals Apple Health actually records (never mind/practice goals),
  always naming "Apple Health" → the client anchors the permission card under that coach turn
  (`findHealthOfferTurn`). No Device line (web/answered) = the coach never mentions it.
  **Foreground refresh:** `maybeRefreshHealthDigest` on app open — 6h local throttle, skip if
  server digest <24h old, content-diff (key-order-insensitive; jsonb reorders) so an unchanged
  digest never trips pack_touch and never forces a pack rebuild.
- **Strava — PAUSED (owner decision 2026-08-06).** Direct API integration deferred. Owner's
  position: imported activities become the user's own *workout history* inside Cadence, merged
  with other health data; the Broker only ever sees a parsed abstraction with no Strava
  provenance — so the app is not "sending Strava data to an LLM". Recorded caution: Strava's
  API terms (late 2024) ban Strava data in AI models and this reading skirts them — the
  provenance-stripping happens in OUR pipeline, which their terms may not recognize. Preferred
  path remains Strava→Apple Health sync (user-enabled in Strava's app, forward-only) which
  keeps Strava's API out of the loop entirely. Revisit only with a terms-compatible shape.

**F. AI Admin enhancements this exercise surfaced (proposed — MEMORY-ARCHITECTURE.md §5)**
- ~~**Multimodal content parts in the provider layer**~~ — **SHIPPED** (verified 2026-08-04, not
  merely planned): `ContentPart = {type:'text'} | {type:'image_url'}` in `backend/src/types/llm.ts`,
  normalised by `backend/src/lib/message-content.ts`, and consumed by the **devs-ai-v2
  request-builder, the google-gemini client, devs-ai completions, and job-execution-run**. Vision
  jobs downstream of it are live too (`parse-fridge-photo`, `identify-food`). This entry said
  "proposed" for two weeks after it landed.
- Engine-owned chat finalization (so no consumer can bypass logging).
- First-class per-user **context/memory store** primitive (TTL + provenance).
- Cache-aware "stable prefix + dynamic tail" prompt assembly.
- Governed retrieval-function (semantic-layer "tool") primitive.
- Cross-session longitudinal variables.

### Known issues
- **Flaky under load: three DB-backed `nutrition-service` tests (seen 2026-08-10).** `logMeal marks
  low-confidence macros provisional` and two siblings time out on their `beforeEach` (10s hook
  timeout) during a full `vitest run` of `apps/cadence-api`, and pass in isolation — the file takes
  ~91s of real Supabase work, so under parallel load the hook simply does not get its connection in
  time. Not caused by any recent change; it predates the onboarding v2 work and was noticed while
  gating it. **Why it matters:** it reddens a full local run for no reason, which trains people to
  ignore red. Fix by raising the hook timeout for the DB-backed suites or serialising them
  (`--no-file-parallelism` for that project), not by deleting coverage.
- **UNRESOLVED — coach face naming** (raised 2026-08-09, owner). The fifteen portraits ship with
  ids carrying the source-art vocabulary: `steady-pacer` (Athlete/Body), `mindful-guide`
  (Yogi/Mind), `rhythm-keeper` (Artist/Creative/Spiritual), `hearth-anchor` (General/any), each
  with feminine/masculine/neutral variants. **These names are not settled.** The design doc's own
  attempt (`Bright Spark`, `Quiet Pro`) was a hallucination but, per the owner, *"arguably better
  names"* — so the whole scheme is open.
  - **Why it is only a naming problem, not a design one:** the standing ruling is that a face is a
    PICTURE, not a personality — one Cadence, one voice, and picking a face changes nothing but the
    picture. So the type names are never shown to the user: the picker renders portraits with no
    captions and the accessible labels are positional (`Face 1`…`Face 15`). Nothing derives meaning
    from these strings.
  - **Cost to change:** rename the ids in `packages/cadence-shared/src/coach-face.ts`, rename the
    matching files in `apps/cadence-web/public/avatars/` (the test
    `coachFaceAssets.test.ts` fails loudly on a mismatch), and migrate any stored
    `cadence.users.coach_face_id`. A retired id already degrades to the brand mark rather than a
    broken image, so a missed row is cosmetic, not a break.
  - **Open sub-question:** whether the four types should survive at all as an organising concept,
    given users never see them and the ruling says they carry no behaviour.
- ~~**Capture over-extraction / baseline drift**~~ — FIXED 2026-07-15 (see C).
- **Backend `tsc` fails on EXTERNAL `devs-ai-v2` code** (not Cadence): `devs-ai-v2/client.ts:101`
  (`role` on the response message type), `devs-ai-v2/sse-transform.ts:105` (duplicate `type`),
  `ai-manager/index.ts` `ExpectedSchema` cast. Appeared ~2026-06-30 (in-progress Devs.ai v2
  work). `apps/cadence-api` itself is type-clean; this blocks a clean shared typecheck until the
  devs-ai-v2 owner fixes it.

### Broker latency root cause: strict schema is slow on gemini — FIXED (2026-07-04)
- **Strict native `json_schema` is ~free on OpenAI models but ~2.2× slower on gemini** via
  Devs.ai's v2 shim. Clean bench (`scripts/bench-v2-latency.ts`, same extraction prompt):
  gemini-3.5-flash 7.3s no-schema → **16.3s WITH schema**; gpt-4.1-mini 4.3s → **4.1s WITH
  schema** (no penalty). Since every schema-based broker job pays this, gemini made session-open
  (`pack-select` w/ schema ~16s + `pack-summarize` no-schema ~7s) ≈ 22–26s.
- **Fix:** broker → **`gpt-4.1-mini`** (failover `gpt-4o-mini`) — both OpenAI, first-class strict
  schema, catalog-valid. Warm session-open **22–26s → ~9.5s**; capture accuracy identical
  (2 goals + measures + 7 equipment + name, all `verify-capture` checks pass). Set with
  `scripts/set-broker-v2.ts [model]` (defaults to gpt-4.1-mini). The DB was never the bottleneck
  on a healthy link (~75ms/round-trip; `scratchpad db-latency`).
- **Note on cost:** gpt-4.1-mini ≈ gemini-flash pricing but 4× faster with the schema, so it's
  the right broker model. Coach stays on sonnet (free-form/streaming, no schema — unaffected).
- **Further optional trim:** session-open still runs 2 serial broker calls (~8s). Could drop to
  ~4–5s via a deterministic context pack for the first turn, or by folding pack-select +
  pack-summarize into one call. Deferred — not needed for now.

### ⚠️ Devs.ai removed `gemini-2.0-flash` — FIXED (2026-07-03)
- **`gemini-2.0-flash` was removed from Devs.ai entirely** — 400 `Invalid model ID` on v1, and
  it was never in the v2 catalog. Any profile pointing at it (our old v1 broker + both failovers)
  is now dead. Fixed: broker → `devs-ai-v2`/`gemini-3.5-flash` failover `devs-ai-v2`/`gpt-4.1-mini`;
  coach failover → `devs-ai-v2`/`claude-sonnet-5` (broker later moved to gpt-4.1-mini, see above).
  **Lesson: Devs.ai silently drops model ids; keep failovers on catalog-verified models**
  (re-check with `scripts/list-v2-models.ts`).
- Note: a degraded local wifi earlier compounded this (multi-second DB round-trips + intermittent
  `getaddrinfo ENOTFOUND aws-1-us-west-2.pooler.supabase.com`), which muddied diagnosis. On a
  healthy link the DB is ~75ms/round-trip and the real latency driver was the gemini+schema
  penalty (resolved by the gpt-4.1-mini switch above).

### Broker on Devs.ai v2 (native structured output) — DONE for capture (2026-07-03)
- `cadence-broker` now points at the **`devs-ai-v2`** provider / **`gemini-3.5-flash`**, failover
  **`devs-ai-v2`** / **`gpt-4.1-mini`** (both catalog-valid). `scripts/set-broker-v2.ts [model]`
  sets the primary model; failover is pinned to the valid `gpt-4.1-mini`.
- Root cause of the earlier 5-min hang: **`gemini-2.0-flash` is not in the v2 model catalog**;
  v2 accepts an unknown model id and never responds. v2's gemini models are the 3.x family
  (`gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-3.1-pro`). Full catalog via
  `scripts/list-v2-models.ts`. The AI-Admin v2 code itself was fine.
- `capture-extract` has `expectedSchema.fields` → v2 request builder emits strict `text.format`
  json_schema → engine `skipFormatting` (native schema, no `applyFormattingRules`) → Broker no
  longer formats JSON. Verified: clean valid JSON, 2 goals + measures + baseline + name, stable
  across runs (`scripts/verify-capture.ts`).
- **Rollout DONE (2026-07-03):** `expectedSchema` added to every broker JSON job —
  `capture-extract`, `plan-vet`, `situation-assess`, `context-select`, `surface-insights`,
  `pack-select`. (`pack-summarize` stays plain-text; `synthesize-plan`/`disrupted-plan` run on
  the coach profile, still v1/Sonnet — out of scope until the coach moves.) Formatting rules are
  **kept** on purpose: they're skipped on the v2 happy path but are the safety net when the
  Broker fails over to v1 (no native schema there). Pushed live with `scripts/sync-jobs.ts`
  (jobs-only `/api/sync` — deliberately does NOT re-sync profiles, so it can't clobber the live
  v2 broker profile the way `provision-aim.ts` would).
- **Verified:** `capture-extract` (verify-capture) and `pack-select` (verify-p2) exercised live
  on v2 with native structured output — clean valid JSON both. `plan-vet`, `situation-assess`,
  `context-select`, `surface-insights` were synced with the identical, proven field pattern but
  are lower-traffic (replan/tripwire/insight paths) and not yet exercised end-to-end.

### Coach on Devs.ai v2 (streaming) — DONE (2026-07-03)
- `cadence-coach` now points at **`devs-ai-v2`** / **`anthropic-claude-4-5-sonnet`**, failover
  **`devs-ai-v2`** / **`claude-sonnet-5`** (both catalog-valid; opus-4-6 is NOT on v2, so the old
  v1/opus failover was replaced). No `expectedSchema` — the coach is free-form chat.
- Switch/revert with `scripts/set-coach-v2.ts` (`v1` arg reverts primary to v1).
- v2 SSE transform (`backend/src/integrations/devs-ai-v2/sse-transform.ts`) re-emits
  `{choices:[{delta:{content}}]}` deltas + a final `message.complete`, the exact shape the coach
  route/UI already parse — streaming is unchanged from the user's side. Verified live with
  `verify-coach`: coherent persona reply, tokens (1140/447), diagnostics bound, P0 placement OK.
- **Drop-resilient coach turns — DONE (2026-07-03):** the coach turn no longer dies with the
  client connection. `routes/coach.ts` decouples upstream draining from client writes (tracks
  `res.on('close')`; guards `res.write`) so if the browser drops mid-reply the server keeps
  reading the v2 stream to completion and ALWAYS persists the assistant turn via
  `recordCoachReply` (+ capture still fires). Client side (`OnboardingChat` + `lib/api.ts`):
  `sendCoachMessage` returns `{completed}`; on a stream that ends without `[DONE]`,
  `recoverFromServer()` polls `GET /coach/current` and heals the UI with the durably-persisted
  reply. Verified end-to-end (`scripts/verify-drop-resilience.ts`): client saw only "Great"
  before an abort, server persisted the full reply, `/coach/current` recovered it. The v2
  `responseId` is now captured into the coach `ai_log` meta for diagnostics.
- **Phase 2 (still open):** true LIVE re-attach — reconnect to the in-flight v2 stream via
  `reconnectResponseStream(responseId, lastSequence)` so a reconnecting client resumes
  token-by-token instead of waiting for the finished reply. Needs an engine-level export from
  `@ai-admin/core` (don't build a raw v2 client in the app — that bypasses the auditable path).
  The engine already threads `previous_response_id` in `session.provider_metadata` +
  `resumeChatSession`, so the plumbing exists to build on.

### Dev accounts + in-app name + UI dup fix — DONE (2026-07-04)
- **UI reply duplication (not in storage):** the v2 stream ends with a `message.complete` frame
  carrying the FULL reply text (server uses it for logging); the client's delta parser had a
  `?? p.text` fallback that appended that whole text on top of the streamed deltas → doubled
  bubble. Fixed in `lib/api.ts` — skip `message.complete`/`v2.response.created` control frames;
  only `choices[].delta.content` is content. (Latent bug the v2 migration exposed; v1 didn't emit
  that frame.)
- **Name asked in-app, not by the coach:** the coach was greeting "Matt" from stale captured
  data. New flow — the Welcome screen asks "What should I call you?" and `updateName()` writes
  `users.name` BEFORE the coach session opens, so `get_identity` puts "User is <name>" in the
  context pack and the coach greets by name without spending a chat turn. Empty name (`''`) is
  treated as "not captured → ask" by `get_identity` (registry.ts:40). Verified: injected context
  reads "User is Sam".
- **Distinct dev accounts (onboarding vs ongoing):** real auth still deferred; added named dev
  accounts resolved by the `X-Cadence-Dev-User` header (allowlisted server-side in
  `config.devAccounts`; middleware maps slug→uuid, unknown → default). `onboarding` =
  `…0001` (kept empty), `ongoing` = `…0002`. Frontend: `AccountSwitcher` (bottom-left) flips the
  account + reloads; `lib/api.ts` sends the header on every call. Verified isolation
  (Alice/onboarding vs Bob/ongoing land on separate users).
- **Account tooling:** `scripts/account.ts <list|seed|reset> [slug]` — `reset` wipes every
  per-user cadence table + resets name/baseline (note `users.name` is NOT NULL, default `''`).
  Both accounts currently reset to empty for fresh onboarding testing.

### Brand identity set + broadened-promise review — 2026-07-04
- **Brand v1.0 decided and canonical in [BRAND.md](BRAND.md)** (summary auto-loads via repo
  `CLAUDE.md`): tagline *"a rhythm you can keep"*; positioning = a **coach**, never a "fitness
  app" (fitness-first at launch via example order, not taxonomy); promise = never repeat
  yourself, never start over; governing nomenclature rule = warm words in UI, boring stable
  words in schema/prompts.
- **Review verdict:** the engineering genuinely earns the core promises (memory, consent,
  bend-don't-break, independent plan-vet, auditability) — but the day-one taxonomy claim is
  currently FALSE: the capture prompt hard-codes `fitness|nutrition|weight|habit`, capture.ts
  silently DROPS out-of-enum captures, the DB CHECK rejects them, and the persona introduces
  itself as "a fitness and nutrition coach". Recurrence/plan mechanics already generalize
  (RRULE + optional targets) — the lock is one enum pair replicated across six sync points +
  three narrative surfaces.

**P0 — DONE (2026-07-04, all verified).** Executed as one coordinated pass: migration 0005
(goals.category→area + new CHECK; baseline injuries+string-constraints → unified
`constraints: [{id,label,kind,plan_around}]`), shared types (GoalArea/Constraint), capture
drop-fix (coerce+log, never discard; legacy value map), review routes (area + constraints),
registry get_injuries→get_constraints (render "What we work around"; MANDATORY list updated),
area-conditional onboardingReadiness, per-area guardrail weights, all job prompts + persona
(crisis boundary incl. 988; conditional weigh-in; physical AND non-physical constraint safety)
synced live, full frontend copy pass. Verified: engines vitest 12/12; verify-capture 11/11 on a
MIXED window (Spartan→movement, weight target→nourishment, morning pages→practice, journal
captured, knee physical + burnout life constraints, dedup stable); verify-p2 PASS
(broker-curated, both constraint kinds in summary); banned-word sweep agent: zero violations;
adversarial 8-surface agent: all findings fixed (welcome bend-sentence, daily-pages example,
config profile models updated to catalog-valid gpt-4.1-mini/gpt-4o-mini + claude-sonnet-5).

**Engine fix discovered by verification (backend/src/ai-manager/index.ts):** Devs.ai v2's
`text.format` json_schema is NOT reliably enforced by the shim — gpt-4.1-mini returned
```-fenced JSON with a strict schema accepted (200). The engine used to SKIP formatting rules
when a native schema was configured → fenced output reached JSON.parse raw (pack-select fell to
deterministic fallback). Fixed: (1) formatting rules now ALWAYS run when defined — they're
deterministic app-side no-ops on clean output and the backstop when the shim ignores the schema;
(2) the failover call now carries `expectedSchema` (it was rebuilt without it — latent bug).
Treat v2 native schema as an OPTIMIZATION, never a guarantee; keep formatting rules on every
JSON job permanently.

**P0 backlog (original list, now complete — kept for context):**
1. Goal `category` → `area: movement|nourishment|mind|practice` across the SIX sync points
   (shared type index.ts:13, DB CHECK 0001_init.sql:33, capture.ts:9, review.ts:9,
   ReviewScreen.tsx:22+162, capture-extract prompt) — expand-then-contract migration; `weight`
   deleted as category (becomes measure.target); no more 'fitness' default on new goals.
2. **Fix the silent capture drop** (capture.ts:113,121): never discard out-of-enum captures —
   map to nearest area / holding value, surface in review flagged. (Also masks migration skew.)
3. Injuries → **constraints** `{label, kind?, plan_around}` end-to-end: shared type, baseline
   jsonb key, capture-extract schema, get_injuries→get_constraints (registry + catalog +
   pack-select hints + MANDATORY list in context-pack.ts:31 — atomic change), plan-vet wording,
   ReviewScreen section, persona intents.
4. Persona line 1 → broadened coach identity; **add mental-health crisis boundary** to persona
   safety + a matching plan-vet check (safety gap, not just brand).
5. synthesize-plan: weigh-in CONDITIONAL on a body-metric target; generalize the safety block
   beyond knees (one physical + one non-physical worked example).
6. Onboarding intake area-conditional: stop chasing weight/injuries for every user
   (coach-context.ts:29 readiness checklist + persona onboarding intent; fix "food control").
7. Brand copy pass: approved welcome copy + steps ("Talk / Confirm what it heard / Set your
   rhythm"), greeting examples "+ a steadier mind, the daily pages", kill "captured"/"it",
   first-person coach everywhere.

**P1 — DONE (2026-07-05).** Migration `0006_p1_nomenclature.sql` (goal.status `locked`→`committed`;
equipment.category +`practice`/`craft`/`study`; episodes `protect_streak`→`protect_momentum`) +
coordinated code/prompt renames: `adherence`→`consistency` (registry `get_adherence`→
`get_consistency`, render labels, dossier, context-pack selection, `metrics.consistency`);
streaks retired for a rolling window (`metrics.rollingConsistency` kept/window, never resets;
tripwires `streak_break`→`consistency_drop`, `adherence_outcome_divergence`→
`consistency_outcome_divergence`, snapshot fields renamed); `CoachTopic` goal-domain-driven
(movement|nourishment|mind|practice|goal|struggles); weekly-readout prompt reframed as a
two-way "weekly check-in"/recap (vars `consistency`+`rolling_window`); word "streak" removed from
every prompt/persona; docs/blog "fitness-and-nutrition coach"→"coach", "health data"→"intimate
personal data". (Guardrail per-area weights + voice-integrity-at-trust-moments already shipped in
P0.) Verified: tsc clean × both packages, vitest 13/13, `verify-p1.ts` (DB accepts new enums,
rejects retired `locked`), live seed→confirm→lock smoke (status=committed, 5 activities), and two
adversarial agents — 6/6 cross-layer consistency, zero banned-word residue. **Deferred:** the
`weekly-readout` job SLUG stays (renaming it re-provisions for an unbuilt flow); `committed_at`
column (no reader yet).

**P2 — later:** named grief/burnout detour types; "What Cadence remembers about you" memory
screen (the trust surface, backed by existing dossier/registry renders).

### Ongoing / adaptive planning architecture — the "living plan" (design, 2026-07-05)

The biggest gap after onboarding: the product is all *setup* and no *life*. Once you set your
rhythm there's no surface to live with the plan, and the plan is materialized as a fixed window
that runs dry. Founder direction (2026-07-05): the plan must be **living, not frozen** —
"I can commit it, but it shouldn't be *locked* locked" — able to hold a 6-month or open-ended
goal, materialize variably, and **adapt to my actual progress and cadence**. The schema already
anticipates this (`plans.version`, `status: active|superseded|draft`, `supersedeActivePlans()`,
the `cadence-replan` workflow); it just isn't *driven* that way yet. This is why `locked`→
`committed` mattered: committed = the current version, not a cell door.

**Three-layer model (the target):**
- **Plan = intent**, versioned: activities + cadence + the goal's *arc* (a 6-month race carries a
  progressive build; an undated practice carries a sustainable rolling cadence). Never a giant
  up-front dump of dated rows.
- **Occurrences = a rolling horizon**: materialize ~2 weeks ahead, topped up idempotently as days
  pass (`upsertOccurrences` is `on conflict (activity_id,date) do nothing`, so top-up is safe). A
  long or undated goal rolls forever.
- **Adaptation = weekly + on-demand**: a coached re-plan reads *actual* consistency + progress +
  the goal arc and proposes the next version (build volume at 6/7, ease off at 3/7 or on a burnout
  flag). New version **supersedes**; nothing resets. User can tweak on the fly; the coach proposes,
  never silently applies (suggest-never-auto-apply — the brand's autonomy stance).

So the plan is neither "one month at a time" nor "all six months at once": it holds the **whole-
goal shape**, **materializes a rolling 2 weeks**, and **re-evaluates weekly**.

**Recurrence engine gap (found 2026-07-05):** `scheduling.ts` today only understands `FREQ=DAILY`
and `FREQ=WEEKLY;BYDAY=…`; it **silently ignores `INTERVAL`**, so "every other day" would expand as
*every* day (over-schedules). Interval needs a **stable anchor** (the plan start) so a rolling
top-up produces the same date pattern each time.

**Phased build:**
- **Phase 1 — rolling horizon + recurrence engine — DONE (2026-07-05).** `scheduling.ts` now does
  `INTERVAL` (every-other-day/week), `FREQ=MONTHLY` (BYMONTHDAY), the bare-weekly fix (fires on the
  anchor weekday, not daily), all anchored so parity is stable across top-ups; `describeRecurrence()`
  humanizer added. `services/plan-horizon.ts` `ensureHorizon(userId, days=14)` — idempotent rolling
  materialization anchored to plan `generated_at`; `lock.ts` uses it for the initial window and it
  tops up on every coach-session open (`routes/coach.ts`, best-effort, no cron). Verified: vitest
  19/19 (incl. every-other-day, parity-stable-across-a-topped-up-window, every-other-week, monthly,
  bare-weekly); live smoke (`scripts/smoke-horizon.ts`): every-other-day lands on alternating dates
  from today, re-run is idempotent (no dup rows), horizon 14→28 extends cleanly.
- **Phase 2 — the daily view + check-off — DONE (2026-07-06).** `GET /plan` (services/plan-view.ts)
  returns active plan + activities (humanized cadence via `describeRecurrence`) + this-week
  occurrences grouped by day + rolling consistency, topping up the horizon on read;
  `POST /plan/occurrences/:id` checks items done/skipped/pending. Frontend `features/plan/PlanView.tsx`
  — Today + week-ahead, tap-to-complete, skip/undo, "showed up N of 7 days" chip (never a streak),
  "Coach →" door. `App.tsx` gained a loading gate that auto-routes an account with a committed plan
  straight into the plan view; review→plan on lock. Verified live in-browser: auto-route, render,
  check-off persists + consistency updates, skip toggles. **Bug caught + fixed by the smoke:**
  `rollingConsistency` compared a Set of DB `Date` objects against ISO strings (passed unit tests
  with string dates, broke on real rows) — now normalizes dates. **Deferred to Phase 3:** the
  "Coach →" door currently reuses OnboardingChat (onboarding greeting/intent); wants a proper
  ongoing-intent coach screen.
- **Phase 3 — adaptive re-plan — DONE (2026-07-06, first slice).** Extracted the shared
  synthesize → vet → **commit-a-new-version** spine (`services/plan-synthesis.ts`
  `synthesizeVetCommit`), used by both first-lock (`lock.ts`) and re-plan (`services/replan.ts`).
  `synthesize-plan` prompt now takes `current_plan` + `recent_activity` and EVOLVES rather than
  restarts (build when consistent, ease when struggling — never reset to zero), emitting a warm
  coach `note`. `replanPlan` gathers goals + baseline + equipment + active plan + recent activity
  (consistency, done/skipped/missed over 14d) → new version supersedes the old, stale
  future-pending occurrences of the superseded plan are cleared (history kept), rolling horizon
  re-materialized. `POST /plan/replan` (200 committed + note · 422 vetoed). Frontend: "Adjust my
  plan" button + iris note banner ("Committed, not locked — your plan bends to fit how you're
  doing"); coach door now opens the **ongoing** intent with a plan-aware greeting (fixes the Phase 2
  deferral). Verified: tsc + vitest 19/19; `scripts/smoke-replan.ts` (fresh lock→v1, check-off,
  replan→v2 that eased runs on low consistency, v1 superseded, no orphan future-pending
  occurrences, history preserved, coach note); browser (Adjust → busy → note banner → evolved plan;
  ongoing greeting). **Still open (Phase 3 remainder):** the AUTOMATIC weekly trigger
  (`situation-assess` tripwires → proactively propose) and conversational in-chat re-plan
  (coach proposes a change mid-conversation with accept/tweak) — the manual "Adjust my plan" +
  the ongoing coach are the foundation those layer onto.
- **Phase 3 — automatic weekly trigger — DONE (2026-07-07).** Wired the previously-unused
  `services/tripwires.ts` (§B4, pure/no-LLM) into a real weekly gate: `cadence.users` gained
  `last_assessed_at` + `pending_proposal` (migration 0007, purely additive). New
  `services/situation.ts` `assessIfDue(userId)` — deterministic-only `buildSnapshot()` (rolling
  consistency this week vs. last, week-over-week dip as `consistencyDropped`; past-due-still-
  `pending` occurrences read as "missed" since the `missed` status is never written elsewhere) →
  `detectTripwires()` → **only if something fired**, calls the already-provisioned but
  never-invoked `situation-assess` Broker job → if `recommend_replan`, stores a `PendingProposal`
  (reason + suggested_levers). Runs at most once/7d per user, skips entirely if a proposal is
  already outstanding or there's no active plan yet — fire-and-forget from `GET /plan` (same
  best-effort pattern as `ensureHorizon`), so it never blocks page load; a proposal it stores
  shows up on the *next* load. `POST /plan/proposal/accept` runs the same re-plan spine as the
  manual button (accepting IS the commit); `POST /plan/proposal/dismiss` just clears it — the gate
  won't re-fire until next week regardless. Manual re-plan also clears any pending proposal so a
  stale banner can't linger. **Suggest-never-auto-apply held**: nothing here ever calls
  `replanPlan` without an explicit user click. Tightened the `situation-assess` prompt (synced
  live): added `consistency_drop` guidance (ease off, never add load) and an explicit instruction
  that `reason` is shown directly to the user in the coach's own warm voice, never clinical/
  internal-jargon — this field went from "the Broker's internal scratch note" to real user-facing
  copy the moment it got wired to a UI banner. Frontend: `PlanView.tsx` renders an amber
  `.plan-proposal` banner (distinct from the iris post-replan `.plan-note`) with the reason,
  lever chips, and Adjust/Not-now buttons. Verified: tsc + vitest 19/19 (unchanged);
  `scripts/smoke-weekly-trigger.ts` — fabricates a real week-over-week consistency drop directly
  in the DB (past dates never get materialized by `ensureHorizon`, which only rolls forward, so
  the smoke inserts real done-occurrence rows for days −13..−7 the same way genuine history would
  look), then drives the full loop over HTTP: tripwire fires → proposal lands → dismiss clears it
  → **gate throttles** a second assessment even with the dip still in the DB → re-arming the gate
  fires again → accept commits a real v2. All 9 checks passed. Live browser: seeded the same dip,
  reloaded, saw the real banner ("Noticing you've had a bit of a dip in consistency, let's make
  things a little easier…") with lever chips, clicked "Not now", confirmed a full page reload
  does NOT bring it back (server-persisted, not local state). **Still open:** conversational
  in-chat re-plan (the coach proposing mid-conversation) and `enter_disrupted`/`open_checkin` —
  `situation-assess` already returns them, but there's no disrupted-mode or check-in UI yet to
  act on them, so those two fields are read but intentionally not consumed in this slice.

**Migration guardrails (from the review):** the two enums each have exactly 6 sync points that
move together; prompt sync (ai-admin DB) and code deploy are SEPARATE release events → always
expand-then-contract (widen CHECK + accept both value sets in validators → deploy → sync prompts
→ backfill UPDATE → tighten). Never flip the prompt before validators accept new strings — the
silent-drop bug (P0 #2) makes that skew invisible. Confirmed/locked goals are never re-inserted
by capture, so backfill must UPDATE in place. `equipment` stays the canonical schema word
permanently ("tools" is UI-only — LLM tool-calling collision).

### Provisioned AI Admin inventory (referenced via `AIM_*` env)
- **Profiles:** `cadence-coach` (`devs-ai-v2` / `anthropic-claude-4-5-sonnet`, failover
  `devs-ai-v2` / `claude-sonnet-5`), `cadence-broker` (`devs-ai-v2` / `gpt-4.1-mini`, failover
  `devs-ai-v2` / `gpt-4o-mini`). All four ids are catalog-verified (`gemini-2.0-flash` removed;
  broker is gpt-4.1-mini because strict schema is ~free on OpenAI, ~2.2× slower on gemini).
- **Coach chat job:** `cadence-coach-chat` (persona in `config.systemPrompt`).
- **Jobs:** `capture-extract`, `plan-vet`, `situation-assess`, `context-select`,
  `synthesize-plan`, `weekly-readout`, `surface-insights`, `disrupted-plan`, `pack-select`,
  `pack-summarize`.
- **Workflow:** `cadence-replan` (assess → synthesize → vet).

### Verification / provisioning scripts (`apps/cadence-api/scripts`)
- Provisioning: `provision-aim`, `set-coach-persona`, `provision-pack-jobs`.
- Verification/debug: `live-coach`, `verify-coach`, `verify-p2`, `coach-sim` (turn-by-turn),
  `dump-sse`.
- `probe-weatherkit [lat] [lon]` — checks the four `WEATHERKIT_*` values locally (p8 parses? key
  is EC? Services ID not accidentally the bundle id?) before making one real call, then maps the
  status to the specific portal screen to fix. Exists because Apple answers every credential
  mistake with the same opaque 401 and the values come from three different screens.

### Blog series (`docs/cadence/blog`)
- **#1 "Teaching an AI Coach to Remember"** — DONE (`.md` + `.docx` + figures). Refreshed 2026-07-07
  to match the shipped implementation: real registry fn names (`get_consistency`/`get_active_plan`/
  `get_constraints`), and idea #3 now states honestly that the pack is a single per-session curation
  — not yet a mid-conversation loop (forward-links to #4).
- **#2 "The Gap Between a Goal and a Tuesday"** — objective→commitment (outline appended to #1's `.md`);
  the engine it describes is now largely BUILT — see the living-plan phases above.
- **#3** — the memory engine in production (consistency signals, drift detection, proactive adaptation).
- **#4 "Letting the Coach Ask Its Own Questions"** — DONE draft (`04-...md`): the agentic retrieval
  loop — swapping the Broker's single pre-fetch for the coach's own on-demand tool calls, plus the
  coach↔Broker seam and the accuracy/latency trade-offs. Companion to the "Final step" section below.

### Dev "X-ray" mode — requirement (building now)
A permanent developer/debug view. Keep the mobile phone frame but shift it left; on desktop
widths show a right-hand inspector panel (toggle via `?dev=1` or a corner switch; hidden on
mobile widths). Four cards mapping to the pipeline:
1. **Context data** — the registry results + provenance for the current pack (functions, row
   counts, the Broker's select *reason*, the mode: broker-curated/deterministic).
2. **Prompts sent** — system (persona) + the injected context turn + the user turn; plus the
   Broker prompts.
3. **Coach response** — the streamed reply + tokens/model.
4. **Broker responses** — `pack-select {calls, reason}`, `pack-summarize` output,
   `capture_extract {goals, equipment, baseline}`.
Data via **`GET /coach/trace`**, backed by an in-process per-user **trace recorder** Cadence
writes as it runs (session-open pack build; each coach turn; capture). **v1 = Cadence-captured**
(fast; exact data + exact coach prompts + broker outputs; broker prompts shown as the
interpolated template). **v1.5** = enrich each entry with the exact AI Admin diagnostic
(composed prompt + token/cost per call). Intended as a durable long-term tool + a demo of the
auditable architecture.

### Coaching-quality pass — onboarding intake, Review UX, and goal assessment (2026-07-09)
Driven by a live "Jeffrey" walkthrough that surfaced real gaps between capture and Review.
- **Diagnosis first (the key lesson):** capture was NOT the weak link — the user stated "~195lbs"
  and the extractor got it perfectly (stored 88.5 kg). The real gaps were (a) the coach off-ramping
  to Review before finishing intake — root cause: `onboardingReadiness` treated the baseline as
  all-or-nothing (any field ⇒ "have baseline"), so captured constraints masked missing body metrics;
  itemized it (age/height/weight flagged individually for body-relevant goals). And (b) a Review
  **weight-editor corruption** (`current: 5078 kg`) from deriving the input from the stored value while
  writing back through the lossy kg↔lbs round-trip on every keystroke — fixed with local-draft +
  commit-on-blur + a sane-range clamp (+ display guard for pre-fix data). Persona onboarding intent
  rewritten (synced) to gather intake before Review and pressure-test goal realism, not just transcribe.
- **Review UX cluster:** contextual goal fields by type (milestone → target-date · target →
  number+unit · recurring → none, so "become vegetarian" reads cleanly); height ft/in↔cm toggle
  (canonical cm, smart-defaults to ft/in when weighing in lbs, same draft/commit/clamp as weight);
  killed native number-spinners; thin scrollbar on `.scrollbody`; long goal titles wrap (auto-growing
  textarea). PATCH `/review/goals/:id` + `updateGoal` now accept `timeframe`.
- **Goal assessment (the "coach actually coaches" build):** `Goal.milestones[]` stepping-stones
  (migration 0008, jsonb). New Coach job `assess-goal` (verdict on_track/stretch/unrealistic + a warm,
  constraint-aware read + optional right-sized target/date + 2–4 dated stepping-stones laddering to
  the goal's deadline). `services/goal-assess.ts` + `POST /review/goals/:id/assess` (suggest-only —
  never auto-applies). Review UI: per-goal "Is this realistic? Get the coach's read →" → verdict badge
  + rationale + suggested stepping-stones → "Use these" writes milestones (+ any target/date) in one
  PATCH; existing milestones render as editable dated rows. `synthesize-plan` prompt: sequence toward
  the NEXT upcoming stepping-stone (milestones already ride in the goals JSON; synced). **Capture
  preservation:** milestone-bearing captured goals are NEVER deleted by capture's replace churn
  (`deleteCapturedWithoutMilestones`), and a re-extracted near-dup is fuzzy-skipped (either title
  contains the other) — durable user intent doesn't live on ephemeral goals. Verified: tsc + vitest;
  `scripts/smoke-assess-goal.ts` (assess a Spartan goal → "stretch" + 4 dated stepping-stones, apply →
  persisted; capture re-run keeps exactly one 10k goal with its stepping-stone despite the model
  rephrasing "Run a 10k" → "Run a 10k this spring"); live browser (assess → panel → "Use these" →
  4 editable milestone rows, persisted server-side).
- **Goal type/measure clarity (2026-07-09):** root cause of "a number you're moving toward is unclear"
  = the capture prompt listed the `milestone|target|recurring` enum but gave NO rubric for choosing,
  so habit goals ("reduce daily alcohol") got mislabeled as number-targets with a meaningless "30 days".
  Added an explicit type rubric (milestone=dated one-off · target=concrete number · recurring=habit,
  never force a number onto a habit) + a richer measure bullet (fill `metric`+`direction`, not just
  target/unit; only for target goals, only from a stated number) — synced. Review now shows a per-type
  hint line and renders a target's measure as a plain phrase ("Reduce to 170 lbs") over an editable
  direction/number/unit row. Recommended AGAINST a rigid catalog of broker-chosen UI components (fights
  the "coach for any goal" brand); kept the flexible measure model, filled well + rendered legibly.
  Verified: tsc; capture smoke (habit→recurring, weight→target with direction=decrease, race→milestone);
  live browser (phrase + direction select + type hints per goal type). Also fixed a Review body-metrics
  layout bug: Age/Height/Weight were crammed 3-across so the ft/in boxes went tiny and weight clipped —
  now each is a full-width block row (no overflow).
- **Every LLM call now always knows today's date (2026-07-10):** the `today` gap wasn't just
  capture-extract — audited the whole surface and found the live Coach chat had NO notion of the date at
  all: not in the persona (correctly static/cacheable), not in the session-open context pack, not in the
  per-turn just-in-time injection. Only `assess-goal` got `today`, passed manually. Since a returning
  user's session is *restored*, never reopened (`GET /coach/current`), a session-open-only stamp would
  also go stale after day one, forever. Fixed systemically at two levels: (1) `ai/aim.ts`'s `runJob`/
  `runJobBySlug` now auto-merge `{ today, day_of_week }` into every job's variables — confirmed
  `interpolateTemplate` only reads `{{...}}` keys a template actually names, so this is a harmless no-op
  for jobs that don't use dates and a zero-effort opt-in (`{{today}}`) for ones that do; removed the
  now-redundant manual `today` from `goal-assess.ts`. (2) New `services/date-context.ts` injects a
  `<context source="date">` turn into the live coach session — deterministic, no LLM call — the first
  time each session is used each calendar day (keyed by `sessionId`, not `userId`: a session reset/
  recreated after a user was already stamped today still needs its own first-turn stamp). Wired capture-
  extract's prompt to actually use `{{today}}` (closes the "Known minor" logged in the batch above) with
  a rule to anchor relative phrases ("in 4 weeks") to it. Added a persona line (Memory section) telling
  the coach to trust the injected date and never guess. **Caught by the smoke test itself:** the first
  implementation computed the ISO date via UTC (`toISOString`) but the weekday label via the server's
  local timezone (`toLocaleDateString` with no `timeZone`) — for hours around the UTC day-boundary
  (most of every US business day) this produced self-contradictory output like "Today is Thursday, July
  9 (2026-07-10)". Fixed by pinning both to `timeZone: 'UTC'` in both `clockVars()` and `todayLabel()`.
  Verified: tsc; temp smoke (capture-extract anchors "in about 4 weeks" to a timeframe.end within days of
  real today, not a wrong year or an absurd offset; a fresh coach session's first turn injects exactly
  one internally-consistent date turn carrying the real ISO date + weekday; a second same-day turn does
  NOT re-stamp).
- **Returning-user routing — new/in_progress/committed stage (2026-07-11):** diagnosed alongside two
  other "what's next" candidates (a plan-preview-before-lock confirm step; real auth) — this one was
  cheapest and shipped first. Root cause: `App.tsx` routed on a single binary `hasPlan` — anyone
  captured-but-not-locked landed on the Welcome/Start screen on every reload, even mid-conversation or
  sitting on a fully-confirmed Review. The chat session itself always restored correctly underneath
  (`GET /coach/current`); the bug was purely the framing of "Start" for someone who'd already started.
  Fix: `buildPlanView` (`services/plan-view.ts`) now returns `stage: 'new' | 'in_progress' | 'committed'`
  — `in_progress` when either an open conversation OR any captured goal exists (checked via the already-
  existing `getLatestConversation` + `listGoals`, no new queries) — and `App.tsx` routes `in_progress`
  straight to the coach chat (which resumes the real session) instead of Welcome; `new` is unchanged.
  Bonus fix found in the same pass: `OnboardingChat`'s captured-goal counter only called `refreshCaptured()`
  inside the "a session was found" branch, so the goals-exist-but-no-session case (now reachable by design
  from `stage=in_progress`) showed a stale 0 — moved the call to run unconditionally on mount. Verified:
  tsc on both packages; HTTP smoke driving all three real transitions (fresh reset → `new`; an opened
  session with no goals → `in_progress`; goals captured with NO session at all → still `in_progress`;
  confirm + lock → `committed`); live browser confirmed a goals-only account skips Welcome and lands on
  the chat with the counter correctly reading "1 goal · Review →", and a truly fresh reset still shows
  Welcome (no regression).
- **Plan-preview before commit (2026-07-11):** the third "what's next" candidate from the same diagnosis
  session — the initial `POST /plan/lock` synthesized AND committed a full activity schedule in one call,
  the one place still auto-applying without a look, inconsistent with the suggest-never-auto-apply pattern
  everywhere else (goal assessments, the weekly re-plan proposal). Mirrors the EXACT `pending_proposal`
  accept/dismiss pattern used for the weekly trigger, applied to first-lock: `cadence.users` gains
  `pending_plan jsonb` (migration 0009); `services/plan-synthesis.ts`'s `synthesizeVetCommit` split into
  `synthesizeAndVet` (Coach synthesize + Broker vet, zero DB writes) and `commitActivities` (the actual
  plan/activity/occurrence writes) — `synthesizeVetCommit` itself survives as a thin wrapper of both so
  `replan.ts` (both the manual "Adjust my plan" button and the weekly-proposal accept) needed ZERO changes
  and keeps its existing one-shot behavior. `services/lock.ts` gained `previewLock` (guardrail gate →
  synthesize+vet → stores `pending_plan`, commits nothing), `confirmLock` (commits the stored preview,
  flips goals to committed; self-sufficient — runs `previewLock` inline first if called with no preview on
  file, so `POST /plan/lock` never breaks for a caller that skips `/plan/preview`), and `dismissLock`
  (clears it). New routes `POST /plan/preview` and `POST /plan/preview/dismiss`; `POST /plan/lock`'s
  response shape is UNCHANGED on the committed path. `ReviewScreen.tsx`'s lock step now shows a preview
  panel (proposed activities as day/time/duration rows, reusing the existing `.confirm-sec` card style +
  the coach's note) with "Set your rhythm" (confirm) / "Not yet" (dismiss, back to the summary); the
  original button that used to commit directly is now "See my rhythm →" and only previews.
  **Deliberately out of scope:** the manual "Adjust my plan" re-plan button has the identical gap (commits
  immediately, only explains after the fact via its `note`) — not fixed here since re-plan is evolving an
  already-understood plan the user explicitly asked to adjust, a materially lower-stakes moment than a
  cold first-time schedule; same `synthesizeAndVet`/`commitActivities` split would make it a small
  follow-up if wanted. Verified: tsc on both packages; HTTP smoke (preview returns a proposal but leaves
  `hasPlan:false`/goal status `confirmed` — commits NOTHING; confirm commits the exact previewed activity
  count and flips the goal to `committed`; dismiss discards without committing; direct `/plan/lock` with
  no prior preview still commits via the inline fallback); live browser walkthrough — seeded a real goal,
  drove the full wizard to "See my rhythm →", watched the actual synthesize+vet round-trip (~29s) return a
  5-activity preview with legible day/time/duration rows, clicked "Set your rhythm", landed on the Plan
  view showing those exact activities. No console errors.
- **Plan-preview extended to manual re-plan (2026-07-11):** closed the parallel gap flagged (and
  deliberately deferred) above — the manual "Adjust my plan" button also auto-committed with no consent
  moment. `services/replan.ts` gained the same `previewX`/`confirmX`/`dismissX` trio as lock.ts
  (`previewReplan`/`confirmReplan`/`dismissReplan`), sharing the SAME `pending_plan` column (a user is
  only ever in one situation — no plan yet, or one to evolve — so no collision risk) and a new shared
  `PlanFlowResult` type (moved out of lock.ts, now used by both). Extracted `gatherReplanInputs` so the
  input-gathering isn't duplicated between the old and new paths. Deliberately did NOT touch
  `POST /plan/proposal/accept` (the weekly banner's accept) — its banner already shows `reason` +
  `suggested_levers` before the user ever clicks Accept, so it already has its own consent moment; adding
  a second preview-confirm on top would just be friction for a lightweight weekly nudge. `PlanView.tsx`'s
  preview reuses the existing `.plan-proposal`/`.lever-chip` styling already on-screen for the weekly
  banner (title · cadence chips) rather than inventing new UI. Verified: tsc both packages; HTTP smoke
  (preview leaves the plan version unchanged; confirm bumps the version and commits the exact previewed
  activity count; dismiss discards; direct `/plan/replan` with no prior preview still works via the
  inline fallback; `/plan/proposal/accept` independently confirmed STILL commits in one call with no
  preview step and still clears the pending proposal — proving the two paths didn't get tangled).
- **"Trust & Wellness" rebrand — full palette + mark swap (2026-07-11):** the brand team's response to
  the brief above: away from dark-violet/ember toward Oat & Alabaster canvas, Deep Slate text, Sage &
  Forest Green (vitality), Terracotta/Dawn Peach (human warmth) — "sunlight on natural materials," not
  "neon in the dark." Full palette rewrite in `styles.css`'s `:root` (ink/surface/line/text tiers all
  flipped light, `--ember-1..4`→`--dawn-1..4`, `--iris`→`--forest`, `--spring`→`--sage`, `--danger`
  warmed to a muted brick red) PLUS every hardcoded `rgba()`/hex literal found by a full-file color
  inventory (30+ sites: tags, banners, buttons, the stepper, the dev panel's tone dots) — a stray
  hardcoded triple would have silently kept the old hue after the token rename. Dropped the ambient
  radial-gradient page glows and the phone-shadow's colored glow entirely: they were a dark-canvas
  technique (low-opacity color pools against near-black) that reads as near-invisible on a light one,
  and "moody glowing pools of color" is exactly the "neon" the brand team said to move away from.
  Replaced the animated ember-gradient `.orb` (radial gradient + specular highlight + a `drift`
  keyframe) with `components/Orb.tsx`, a new cairn mark (3 stacked ellipses, forest/sage/terracotta,
  fills wired to the CSS vars so it stays in sync with the palette) — deliberately static, no glow, no
  animation: a cairn is about stillness/balance, so animating it would undercut the concept. Kept
  `className="orb"` on the new component so every existing size-override rule (`.wordmark .orb`,
  `.consist .orb`, `.welcome .hero .orb`, ...) kept working unchanged — zero CSS sizing rules touched,
  only the 10 JSX call sites (`<span className="orb" />` → `<Orb />`) across 4 files. Updated BRAND.md's
  one stale line ("the ember orb on dark violet is a hearth") to describe the cairn; the promise, voice
  principles, and nomenclature table are untouched — none of it was color-dependent. Verified: tsc; a
  full-file grep confirmed zero remaining `--ember`/`--iris`/`--spring` references or old rgba triples
  anywhere in `src/`; live browser across Welcome, onboarding chat, Review, Plan, and the dev X-ray panel
  — computed styles confirmed exact hex matches at every checkpoint (canvas, glass, wordmark gradient,
  CTA gradient, the cairn's three ellipse fills, card surfaces/borders, the dev panel's tone dots) and
  zero console errors throughout.
- **Mark swap: cairn → sunrise arch (2026-07-11, same day):** the brand team's second pass on the
  mark — a terracotta arch over a forest-green horizon line, replacing the cairn a few hours after it
  shipped. Closer to the brief's own language ("the warmth of a sunrise") and, structurally, two
  visually distinct shapes (arc + bar) instead of three same-shaped ellipses — better small-size
  legibility, which was the one open concern flagged about the cairn. Same two colors already in the
  palette (`--dawn-3` terracotta, `--forest`), so purely a `components/Orb.tsx` swap — no new tokens,
  no CSS touched (still `className="orb"`, still every existing size-override rule unchanged).
  Updated BRAND.md's mark line again to match. Verified: tsc; live browser confirmed the arc/dome/bar
  computed colors match exactly and the mark renders correctly at both 22px (header) and 84px (Welcome
  hero) with the same 120×120 viewBox; zero console errors.
- **Splash polish: texture, hand-drawn logo, button depth, sunrise animation (2026-07-11):** brand
  team feedback pass. (1) Tactile canvas — a faint grayscale paper grain (inline SVG `feTurbulence`,
  opacity .045, no asset file) on `.glass` behind content; solid cards cover it so it only shows in
  the paper gaps. (2) Logo gains a hand-shaded warm gradient in the arch at ALL sizes; the Welcome
  hero ADDITIONALLY gets a subtle `feTurbulence`+`feDisplacementMap` roughened edge (`Orb hero` prop)
  — scoped to the 84px hero because at 22px it'd just blur. Per-instance IDs via `useId()` so the
  hero's defs don't collide with the header/chat instances. (3) Button depth — layered warm shadow
  (deep-brown contact + terracotta diffusion) + hover-lift/active-press on `.cta` and `.lockbtn`.
  (4) A one-shot "sunrise rising" draw-in on the hero (horizon settles, arch draws up, dome warms in)
  — chose one-shot over a persistent pulse because a loop reads as a loading throb against the
  "warm, level, unhyped" voice; fully gated behind `prefers-reduced-motion`. Verified: tsc; live
  computed-style checks (noise present, gradient stops resolve dawn-1→3→4, hero has the rough filter
  while the header instance does NOT, layered CTA shadow, arch dashoffset animates 96→0); no console
  errors. Also fixed the Welcome hero copy: "a plan that bends when life happens" → "help you build
  the routine you actually want" — the outcome users come for is the routine; adaptability is a
  differentiator, not the headline reason to open a coach.
- **Real Supabase auth, coexisting with dev/test accounts (2026-07-11):** the last of the original
  three "what's next" items. The two paths COEXIST rather than the prior all-or-nothing: dev accounts
  are available only when `CADENCE_DEV_USER_ID` is set (local) AND the request carries a valid
  `X-Cadence-Dev-User` slug — the web app sends that header only at `?dev=1`; any request without it
  falls through to real JWT validation, so the login flow can be exercised locally too, and in
  production (env var unset) the dev branch is dead so no bypass ships. Backend: `auth/middleware.ts`
  rewritten for the coexist logic; `ensureUser(userId, email?)` moved to `repos/users.ts` (re-exported
  from `dev-reset.ts` for the two script importers) and called on a real user's FIRST authenticated
  request to lazily provision their `cadence.users` row — no signup DB trigger needed, and it works
  because there's no FK to `auth.users` (dev accounts with fake UUIDs have always inserted fine).
  Auth is validation-only; data access stays app-side (`where user_id = …` over the direct PG
  connection), so no RLS work was required. Frontend: `@supabase/supabase-js` (already hoisted at the
  workspace root) added to cadence-web deps; `lib/supabase.ts` browser client from
  `VITE_CADENCE_SUPABASE_*` (already in `.env.example`; created the gitignored local `.env`);
  `api.ts` `headers()` sends the dev header only in `isDevMode()` (`?dev=1`), else the Bearer token;
  new `features/auth/AuthScreen.tsx` (email+password sign in/up), `components/PhoneFrame.tsx` (chrome
  extracted so both the app and the auth screen share it), and `App.tsx` split into an auth gate +
  `CoachApp` (mounts only once identity resolves, so its getPlan fires with auth in place). Dev
  affordances (account switcher, X-ray toggle) render only in dev mode; real-auth mode gets a small
  sign-out control instead. Verified: tsc both packages; backend curl (no auth → 401 [previously
  silently 200 as the default dev user — a real tightening], dev header → 200, bogus JWT → 401); live
  browser (plain load → sign-in screen with dev affordances hidden, signin/signup toggle works;
  `?dev=1` → unchanged dev flow with switcher + X-ray, `?dev=1` preserved across reloads); no console
  errors. **NOT verifiable by me / user's part:** the actual credential exchange — the Supabase
  project must have the email provider enabled (and, for instant login without an inbox round-trip,
  email confirmation disabled), and per operating guardrails I can't create an account or enter a
  password; the user does the real sign-up/sign-in.
- **Google social login (2026-07-11):** added "Continue with Google" above the email form on
  `AuthScreen` (`supabase.auth.signInWithOAuth({ provider: 'google', redirectTo: origin })`). No new
  plumbing on the return leg — the browser client's `detectSessionInUrl` parses the session Google
  redirects back with, firing the same `onAuthStateChange` listener that email auth uses. Official
  4-color Google "G" inline SVG; `.auth-google` outline button + an "or" divider. Verified: tsc;
  live click drove the real redirect to
  `/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%3A3100` — correct provider
  + redirect target, proving the client wiring is right up to the server boundary. Supabase returned
  `{"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`.
  **User's part (dashboard, can't be done in code):** enable the Google provider in Supabase Auth
  with a Google Cloud OAuth client id/secret, and add the redirect URLs (`http://localhost:3100` +
  the prod origin) to the Auth URL allowlist. Until then, clicking Google lands on Supabase's JSON
  error page (the redirect has already left the app, so it can't be caught into a friendly inline
  message); once enabled it flows to the Google consent screen and back. **Confirmed working
  2026-07-13:** with the provider enabled in the dashboard, a live click drove all the way to the
  real Google account picker ("to continue to qvukqinwmyvewzgcsgzt.supabase.co", no
  `redirect_uri_mismatch`) — the full outbound leg verified; the credential entry itself is the
  user's to complete.
- **Guardrail soft-budget no longer hard-blocks the lock (2026-07-13):** first real-auth user hit a
  409 on "Set your rhythm" with a textbook set — Spartan race (movement/milestone, load 3) + cut
  alcohol + cut candy (both nourishment/recurring, load 2) = weighted load 7, one over the focus
  budget of 6. Root cause: `previewLock`/`lockPlan` gated on `exceedsHardCap || overFocusBudget`, but
  `overFocusBudget` is documented (goal-guardrail.ts) as the SOFT "let's focus" signal, not a hard
  stop — and since no keep/park UI was ever built, it functioned as an un-resolvable wall. Worse, a
  race + a couple of everyday habits is exactly the "several life areas at once" the brand exists to
  support. Fix: the lock gate now trips ONLY on `exceedsHardCap` (>50 active goals); `overFocusBudget`
  stays computed and still rides in GET /review's `guardrail` object for a future NON-blocking nudge.
  Also relaxed `review.ts`'s `lockable` the same way. `evaluateGuardrail` itself is unchanged, so the
  guardrail unit tests still pass. Verified: tsc; reproduced the exact load-7 set on a dev account →
  `GET /review` now reports `lockable:true` (was false), and `POST /plan/preview` returns 200 proposed
  with a 7-activity plan (was 409). (Separately, the connection errors reported just before this were
  a dead web dev server, not code — restarted it; backend was healthy throughout.)
- **Review recovers from an out-of-sync committed plan (2026-07-13):** after the guardrail fix, the
  same user hit a 422 "No confirmed goals to lock" on "See my rhythm". DB check showed WHY: their
  goals were already `committed` and plan v1 was active with 7 activities + 46 occurrences — an
  earlier lock had actually SUCCEEDED server-side, but the client never advanced to the plan (the
  200 was almost certainly lost to one of the dev-server blips). So they were re-clicking a stale
  Review screen, and `previewLock` correctly found zero *confirmed* goals (they'd moved to
  committed) → 422. A page reload already fixes it (App routes on `getPlan().stage` → committed →
  plan view), but the Review screen shouldn't dead-end. Fix: `recoverIfAlreadyCommitted()` in
  ReviewScreen — when preview/lock comes back vetoed, it checks `getPlan()`; if the stage is
  `committed`, it routes to the plan (`onLocked`) instead of showing the error. Wired into both
  `doPreview` and `doConfirmLock`; no regression risk since it only runs on the veto branch and a
  genuinely goal-less new user resolves to stage `new`/`in_progress` (not committed) → normal error.
  Verified: tsc; drove the full load-7 set through confirm→preview(200)→lock(committed, 6 acts) on a
  dev account, then loaded the app → routed straight to the plan view ("A fresh week" + this week's
  occurrences), no console errors — confirming both the guardrail fix end-to-end AND the committed
  reload path the real user will take.

- **Fitness module: Prescribe → Log → Adapt (2026-07-13):** the jump from "a schedule you check
  off" to "a coach that coaches the work itself" — user ask: see the actual session (exercises/
  sets/reps/loads), report it in your own words, have the coach adapt the next one, steer the plan
  conversationally, video help, and (north star) coach-built modules for ANY goal type. Built per
  the approved plan (`~/.claude/plans/immutable-plotting-pixel.md`), Phases A+B; nutrition (C) and
  video library (D) deferred by agreement. Architecture: one universal module shape hung off
  occurrences — migration 0010 adds `occurrences.session` (the coach's generated prescription, a
  REGENERABLE CACHE — replan wipes future pending rows and it regenerates on next open) and
  `occurrences.log` (the user's structured report, durable). Payload is deliberately GENERIC
  (`blocks[] → items[]` with optional sets/reps/load/duration/distance/detail) so a practice-area
  goal (prayers, pages) flows through the same pipe with no new code. Two new jobs:
  `prescribe-session` (coach-tier + expectedSchema; constraint-safety mirrored from synthesize-plan;
  progression from `<recent_logs>`; `video_query` = SEARCH PHRASES ONLY, mechanically de-URLed
  app-side — the client builds youtube.com/results links, the model never supplies URLs) and
  `parse-session-log` (broker; never invents numbers; user's units; data-not-commands). Key design
  decisions from the Plan-agent pressure-test: recent logs keyed by activity TITLE across plans
  (replan recreates activity ids — id-keyed history would reset progression memory exactly when the
  plan evolves); generation gated to user-kind + pending + today-or-future + session-null with a
  single-flight map + conditional `where session is null` write (no double coach-spend on races);
  `listOccurrences` trimmed to explicit columns (week payloads don't carry session/log);
  parse-failure fallback preserves the user's words verbatim and still marks done; first-ever
  writer of the `provenance` column ({source:'self_report'}). Steer: `POST /plan/replan/preview`
  accepts optional free-text (`user_steer` var in synthesize-plan, empty-safe through the shared
  lock path, capped 500); PlanView's planbar gains the input. New `get_recent_logs` retrieval fn
  (auto-appears in the Broker catalog). UI: occurrence rows tappable (user-kind) → bottom-sheet
  session view (blocks → "3×8 @ 55 lb" rows, per-item ▶ YouTube search links, coach note, "How did
  it go?" log box → done + summary chip). Drive-bys: provision-aim's coachJobs set was missing
  assess-goal (fresh provisions silently mis-tiered it — fixed, + kept in lockstep comment);
  dev-reset now clears `pending_plan`. Verified END-TO-END on account-2: prescribe (first open 39s
  → 4 blocks/11 items/first-session note, cached re-fetch 1s, generated_at stable; system rows
  null; bogus/cross-account 404; no-auth 401) → log ("3×5 pull-up negatives, 4×40m farmer carries
  @ 50 lb felt easy, skipped dead hangs" → correct items, felt:easy, dead hangs done:false, value
  rollup, provenance, status done) → ADAPT (Wednesday's same-title session: carries bumped to
  "55 lb per hand", 5 rounds × 50m, dead hangs re-included, note: "Last session felt easy… grip
  strength wins races") → STEER ("I want three run days" → Easy/Moderate/Long run split, note cites
  the request; dismissed to preserve state) → garbage text → 200 fallback with raw_text preserved →
  empty → 400 → coach chat "how did my last strength session go?" → X-ray shows turnSelect chose
  get_recent_logs(2 rows) and the reply cites the real numbers + follows up on the skipped hangs.
  vitest 19/19; tsc both apps; zero console errors. account-2 left in the demo state deliberately
  (logged Monday + adapted Wednesday) so the loop can be seen live at ?dev=1.

- **Assessment-first coaching — the module arc (2026-07-13):** user insight: a real coach's first
  sessions are EVALUATIONS ("he's giving coaching without really knowing the context"), a real
  nutritionist observes a week of eating before changing anything, an anxiety plan starts by
  logging triggers. Generalized as the universal module arc — **Observe → Baseline → Prescribe →
  Progress** — with the phase DERIVED FROM DATA, not stored state: how many logs exist for this
  activity (by title, cross-plan) decides how the coach behaves. Implemented for fitness now:
  `services/session.ts` `coachingPhase()` — discover (0 logs) / calibrate (1-2) / progress (3+) —
  passed to `prescribe-session` as `phase` + `sessions_logged`; the prompt's COACHING ARC rules
  make discover a measurement session (modest defaults, every item measures a starting point,
  "stop one rep shy of failure", note says week one finds where you are), calibrate keeps
  measuring while gently applying what's already clear (preserves the earlier demo behavior — one
  clear "felt easy" log DID warrant the 55 lb nudge), progress = full evidence-based progression.
  `synthesize-plan` gained FIRST-PLAN framing (week one is discovery; note sets the expectation —
  also fixed the output-contract line that said note="" on a first plan, which was overriding the
  new instruction) and a TITLE-STABILITY guard on re-plans (history is keyed by title; a rename
  orphans it). `phase`/`sessions_logged` ride the prescribe ai_log meta for the X-ray. Verified on
  a fresh account: the synthesized plan itself titled day one "Running Assessment"; its session
  note = "I'm measuring where your aerobic base is right now…"; items carry talk-test/recovery
  measurement cues; log meta shows `phase:discover, sessions_logged:0`; account-2's cached demo
  state (logged Monday → adapted Wednesday) untouched.
  **Design (deferred modules — the same arc instantiated per area):**
  - *Nutrition (specific):* week 1 = SILENT OBSERVATION — `parse-meal` → `nutrition_logs`
    (tables/types exist since 0001), day view shows what was eaten vs `users.macro_targets`,
    coach explicitly does NOT suggest changes ("this week I'm just learning how you eat").
    After ~7 logged days: a `nutrition-baseline` read (meal timing, protein, processed-food
    patterns) → propose ONE change at a time (gradual introduction, suggest-never-auto-apply);
    each habit stabilizes before the next. Phase signal: count of distinct logged days.
  - *Mind/anxiety (general):* week 1 = trigger logging (a parse job: what happened / when /
    intensity — same parse→log pipe), coach listens and asks, no interventions. After the
    window: a pattern read ("your triggers cluster around work handoffs") → introduce ONE
    practice at a time. Crisis boundary (BRAND.md) always overrides the arc. Spiritual/practice
    goals: same shape, gentler — observe current practice for a week, then build the rhythm.
  - The generic `blocks[]→items[]` session payload plus phase-from-log-count means each new
    module is: one parse job + one observation instrument + area rules in prescribe — no new
    state machines.

- **App Shell v2 — tabs, coach continuity, progress module, settings, voice (2026-07-14):** the
  app's graduation from onboarding-flow-plus-list to its real shape, per the approved plan (user
  asks: ongoing coach conversation with progress awareness; adjust-as-popup; voice input; bottom
  nav with settings/progress/history/goal-editing, "variable, defined by the coach").
  **P1 (UX reshape):** `MainTabs` shell — Today/Coach/Progress tabs + Settings gear, ALL inside
  `.app` so the existing absolutely-positioned sheets naturally cover the tab bar with their scrim
  (no z-index games); committed stage renders it, onboarding flow untouched pre-tabs. Coach tab =
  the chat with a new `chrome='none'` prop (no goal-counter/stepper). Session FRESHNESS policy
  (P3-lite), server-computed in `GET /coach/current`: stale iff idle >7d (`touchConversation`
  bumps updated_at per message) OR the conversation predates the FIRST plan commit while a plan is
  active ("onboarding graduation" — `getFirstPlanCommitAt`); deliberately NOT invalidated by
  replans (would break the very continuity asked for; per-turn retrieval covers plan changes). A
  stale restore starts a fresh thread and does NOT render the old transcript (visible-transcript
  amnesia). "Adjust my plan" became `AdjustSheet` (steer + preview + confirm in a popup; slim pill
  in the week-label row). `MicButton` (Web Speech API): feature-detected (absent on Firefox/non-
  secure origins), base+finals+interim recomposition (never append deltas), abort on unmount;
  wired into composer, session log box, and AdjustSheet.
  **P2 (progress/history):** migration 0011 `goal_events` (countable accomplishments; FK to
  cadence.users — NOT auth.users; first cut hit exactly the 0002-decouple trap and was repointed).
  `parse-session-log` gains optional `events[]` (explicit accomplishments only — "finished Dune";
  doing the scheduled session is NOT an event); manual `POST /progress/events` "+1" path (count
  reliability since `activities.goal_id` is null in practice — parsed events power History,
  manual adds power the 20/100 numerator). Weigh-in capture is DETERMINISTIC (no LLM): weigh-in
  system rows open a number+unit sheet → `POST /plan/occurrences/:id/weigh-in` (20–500kg clamp,
  lb→kg) → `value.weight_kg` series point via recordOccurrenceLog (weigh-ins land in History for
  free) + `baseline.weight_kg.current` merged app-side (jsonb `||` is shallow — `.start`
  preserved). `services/progress.ts` — the whole dashboard is deterministic (the "coach-defined,
  variable" requirement is met by DATA: cards derive from goal type+unit, trends from activities
  with ≥2 honest points; a no-fitness user has no fitness cards; an LLM spec layer can later emit
  the same ProgressCard shapes): metric alias normalizer (`distance_m→_km` etc — my own smoke data
  had proven the key chaos), pace only where distance≥1km AND duration in the SAME log, load
  parser over "55 lb" strings keyed by activity title, count/countdown/consistency/latest-vs-
  target cards (reads confirmed+committed — a books goal never needs plan activities to be
  trackable), History = session summaries + 🏁 events reverse-chron. `GET /progress`; ProgressView
  with inline-SVG sparklines (no chart lib); `get_goal_progress` retrieval fn (chat answers
  "how am I doing on books?" with computed numbers). postgres.js Date-object trap hit on
  goal_events.at → `at::text` in the repo.
  **P3 (settings/manage/start-over):** SettingsSheet from the gear (email/slug; sign out;
  password = `resetPasswordForEmail` link, v1 skips in-app updateUser reauth; both hidden in dev
  mode). ReviewScreen `mode='manage'` (no lock step, no stepper, "✕ close"/"Done ✓"); manage-
  added goals insert as CONFIRMED via `POST /review/goals {confirm:true}` — closing BOTH holes
  (captured goals are invisible to replan AND eaten by capture churn); on manage exit the
  AdjustSheet is OFFERED (never auto-replan). `DELETE /me/data` (routes/me.ts): real-auth
  allowed, server re-verifies the typed phrase `"start over"` (400 otherwise), order
  purgeUserAiData → resetUserData → clearTrace (provider purge first = a mid-flight failure
  leaves local data intact + retryable); honest copy that the login survives; dev mode keeps
  /dev/reset. Real-auth corner sign-out control removed from App (Settings owns it).
  **Verified:** tsc both apps ×3 phases; vitest 19/19; staleness rules driven by SQL time-travel
  (idle→'idle', pre-first-commit→'graduated', restored→false); live browser on account-2 — tabs
  switch, Coach tab restored yesterday's real conversation with no onboarding chrome + mic
  present, Adjust pill → sheet with scrim covering the tab bar, Progress tab rendering the count
  card (2/100 books + bar + "+ add one"), consistency card, History (weigh-in → session → 🏁
  events); weigh-in 196.5 lb → 89.1 kg on the occurrence + baseline current/unit updated (404 on
  non-weigh-in rows); manual events 200 after the FK fix; capture-immunity regression PASSED
  (manage-added confirmed goal survived a live chat turn's capture churn); /me/data 400 wrong
  phrase / 200 right → stage 'new' / 401 unauthenticated; manage walk (Step 1 of 3, Done ✓ →
  adjust offer → declined) — zero console errors throughout. account-2 left rich for demo:
  committed plan, logged sessions, adapted Wednesday, 2/100 books, a weigh-in, history.

- **Capture trust + coaching-depth cut 1 — "commitments know their objective" (2026-07-15):** two
  batches after the deploy config. (1) **Capture trust:** fixed intra-run goal duplication with a
  deterministic `selectCapturedGoals` backstop and extracted the trust-critical transforms into a
  pure, unit-tested `services/capture-normalize.ts` (weight canonicalization + goal dedup) — see
  section C. (2) **Objective→commitment linkage:** `synthesize_plan` now tags each activity with
  `goal_title`; `services/plan-match.ts` `matchGoal` resolves it to a real `goal_id` (exact-norm,
  then UNIQUE-containment, never ambiguous); `goal_id` flows synth→preview→commit→`activities` (the
  column + insert already existed, just unpopulated). The "Set your rhythm" preview groups
  commitments under the objective they serve ("Toward …", foundational/system work under
  "Foundations"). Because occurrences already read `a.goal_id` via join and `session.ts` rides it
  onto `goal_events`, progress auto-linking falls out for free — zero occurrence/session change.
  **Verified:** tsc both apps; vitest 33/33 (+9 capture, +5 matchGoal); a live `synthesizeAndVet`
  linked Easy Run→Run a 10k and Daily Reading→Read 100 books, weekly check-in left unlinked. Not yet
  screenshot-walked: the grouped lock preview (needs a fresh onboarding synth). On branch `feat/cadence`.

- **Coaching depth cut 2 — "the coach asks where you are, and says why" (2026-07-16):** two
  halves of the same coached instinct. **(1) Per-commitment rationale:** `synthesize_plan` now
  emits a `why` per activity — ONE warm line (≤20 words) tying the commitment to its goal and
  their starting point — capped app-side at 160 chars, carried on `PendingPlanActivity` (display-
  only through preview/pending_plan, no DB column), rendered under each commitment in the grouped
  "Set your rhythm" preview (`.cs-why`). **(2) Deterministic dynamic intake:** `GoalMeasure.start`
  ("where they are today"); capture-extract extracts it only from a STATED current number (body
  weight explicitly excluded — baseline owns it); pure `services/intake.ts` `startingPointGaps`
  (target + numeric target + no start + non-weight metric, cap 3) feeds `onboardingReadiness` as
  "where they are today on \"X\"" need-lines + a never-as-a-form nudge; synthesize_plan calibrates
  week one FROM start toward target instead of guessing (no start → week one stays discovery).
  **Verified:** tsc both apps; vitest 38/38 (+5 intake); config JSON validated; sync-jobs 13/0;
  live capture smoke ("about 35 minutes right now" → START=35; "read 3 so far" → START=3); live
  synthesis smoke (every activity carried a coach-voiced why; goal links intact); live readiness
  render on account-2 (books gap flagged, weight goal correctly skipped; account-1 empty state
  clean). On `feat/cadence`.

- **Coaching depth cut 3 — the coach walks the ladder in chat (2026-07-16):** closes the
  coaching-depth thread. **(1) `why` persists** (migration 0012 `activities.why`; insertActivities
  writes it; commitActivities passes it) — the rationale survives commit instead of dying with
  pending_plan. **(2) The dossier renders the ladder**: `Current plan v1 (3 commitments, committed
  today): / Toward "goal": / - Easy Run … · why: …` with foundations last and commit recency, and
  the persona (ongoing intent) opens a fresh post-commit thread by walking it and inviting
  pushback ("does any of this feel off?"), answering every "why am I doing X" from the STORED why
  lines — never improvising a contradicting rationale. **(3) Session sheet says why**: occurrence
  detail carries `a.why` ("why this session exists" under the title). **(4) assess-goal intake**:
  `intake[]` (≤3 short coach questions the data can't answer) in the assessment panel. **(5)
  Review start editor**: "starting from …" input on target goals. **Verified:** tsc×2, vitest
  38/38, migration applied (`activities.why exists ✓`), sync-jobs 13/0, persona synced (5585
  chars); scratch-user end-to-end (never touching demo accounts): commit v1 → all 3 activities
  carried why in the DB → dossier rendered the exact ladder above → occurrence detail returned the
  why → cleaned up via resetUserData; assess-goal live returned verdict `stretch` + 3 milestones +
  intake ("Have you trained with speed work before?", "Mornings or evenings work better for you?",
  "Any old niggles that show up when you push pace?"). Not browser-walked (preview server down):
  the start editor / intake panel / sheet-why renders — all tsc-clean simple binds over verified
  API data. On `feat/cadence`.

- **Nutrition module — the Observe phase (2026-07-17):** the module arc's second instantiation
  (design 2026-07-12: "week 1 = SILENT OBSERVATION"), honoring the original ask — observe the food
  log before suggesting changes. **Storage:** `nutrition_logs` existed since 0001 (0002 already
  repointed its FK — checked live this time instead of re-hitting the goal_events trap); migration
  0013 adds `raw_text` (the user's words, ALWAYS kept — a parse failure still stores the meal),
  `flags` jsonb, and widens `meal` to drink/other. **parse-meal** (Broker, 14th job): one meal in
  their words → items (qty/unit ONLY if stated — never estimates grams/calories/macros), flags
  alcohol/caffeine ONLY from explicit mentions, one-line summary; meal kind from the hint or
  honest `other`, never forced. **Service** `logMeal`: parse best-effort → insert → best-effort
  tick of today's pending Food-log system row (`findPendingFoodLogOccurrence`, the weigh-in
  title-test pattern); `parse_meal` ai_log kind. **Deterministic read** (pure, unit-tested
  `nutrition-summarize.ts`): days_logged (THE PHASE SIGNAL), meals/day, top items, alcohol/
  caffeine DAYS (not mentions). **Coach visibility:** dossier line, `get_food_log` retrieval fn,
  replan `recent_activity.food_log`, and the synthesis FOOD LOG rule — eating-focused goal → daily
  Food log (kind=system); <7 logged days → NO eating changes, note says "learning how you eat";
  7+ → exactly ONE gradual change grounded in observed items, stabilize before the next.
  **UI:** Food-log rows open a capture sheet (words + mic + meal-kind select defaulting by time of
  day + the day's meals list; stays open after done — meals accumulate); Progress gains a
  "Food log — N of 7 days" card only when logs exist. **Verified:** tsc×2; vitest 42/42 (+4);
  migration applied (raw_text ✓, drink/other ✓); sync-jobs 1 created + 13 updated / 0 errors;
  scratch-user live smoke — "two eggs, sourdough toast and a black coffee" → itemized + caffeine
  flag; "grilled salmon… couple of IPAs" (dinner hint) → alcohol flag; summary/retrieval/dossier
  all rendered the observe line; scratch reset. Not live-exercised: the occurrence auto-tick (needs
  a committed plan with a Food-log row) and the capture-sheet browser walk (preview server down) —
  both thin binds over verified paths. On `feat/cadence`.

- **Nutrition cut 2 — the Baseline moment (2026-07-17):** the arc's transition OUT of
  observation, composed entirely from existing machinery. `nutrition-baseline` (Coach-tier job
  #15): meals + deterministic summary + goals → `{ read, suggestion, rationale }` — 2-3 warm
  pattern sentences (must name something genuinely good; never calories/macros/shame) + exactly
  ONE small gradual change phrased as a request the user could say. Deterministically GATED:
  `getBaselineRead` returns `ready:false` under 7 distinct logged days (14-day window so slow
  loggers still cross); POST /nutrition/baseline; `nutrition_baseline` ai_log kind. **The bridge:**
  the Food-log sheet computes days-logged client-side from the meals it already fetched (zero
  extra requests) → at 7+ shows "A week of watching is done — want my read?" → renders read +
  suggestion → "Weave it into my plan →" hands the suggestion to PlanView's AdjustSheet as
  `initialSteer` (new prop) — the change rides the EXISTING steer→preview→confirm replan flow;
  suggest-never-auto-apply, zero new commit paths. **Verified:** tsc×2; vitest 42/42; sync-jobs
  1 created + 14 updated / 0; scratch live smoke — seeded 7 observed days → read grounded in the
  actual log ("coffee and sometimes eggs… takeout pizza paired with your IPAs") + one change
  ("add a banana or another piece of fruit alongside your toast one more morning") + rationale;
  PLUS closed the two previously-unexercised paths: an eating goal's synthesis emitted
  `Food log [system] FREQ=DAILY` with no eating-change activities (observation honored), and
  `logMeal` auto-ticked the pending Food-log occurrence (pending→done). Honest wart: the
  suggestion embellished "toast" to "sourdough toast" (never stated) — cosmetic, the change
  itself was grounded; the prompt's use-their-words rule could be tightened later. On
  `feat/cadence`.

- **Fresh-onboarding browser walkthrough — everything at once (2026-07-17):** account-1 reset →
  full live run in the phone UI, closing every "not browser-walked" caveat from the coaching-depth
  and nutrition batches. Welcome → name → chat: "5k under 30 by mid-October, run it in about 35
  now… eat better on weeknights" → coach asked ONE question at a time (knee → where-do-you-run →
  height/weight), acknowledged the knee ("we'll keep an eye on that knee and build around it"),
  then PRESSURE-TESTED ("three months — doable, but… three runs a week; with the knee we need to
  be smart"). Capture: EXACTLY 2 goals (dedup held), measure target 30/start **35**/unit minutes
  from natural speech, age 38 + 5'10" + 190 lbs + "left knee discomfort when pushing hard"
  [plan-around ON] + shoes/kettlebell + Toronto — all from conversation. Review: "starting from
  35" editor live; assess → "A stretch" + START-CALIBRATED ladder (34 → intervals → 32 → 31,
  dated to Oct); intake [] (correct — conversation already answered everything). Lock preview
  GROUPED with whys: "Toward Run 5k under 30" (Easy Run — "finding your comfortable easy pace
  from your current 35-minute 5k"; Knee-Safe Strength — no knee loading), "Toward Eat better on
  weeknights" (Food log daily — "learning your weeknight eating patterns before suggesting any
  changes"), Foundations (check-in). Commit → full week materialized (Food log every day 20:00).
  Meal sheet: "chicken stir fry with rice and a glass of red wine" → parsed items listed, row
  AUTO-TICKED (done:true in the UI). Coach tab: fresh thread (graduation staleness — old
  transcript gone), "why am I doing the strength sessions?" answered FROM the stored why
  ("protect your knee… takes pressure off your left knee"); X-ray showed the turn pulled
  get_active_plan/get_consistency/get_constraints. Progress: "Eat better on weeknights — 1 of 7
  days" + "Food log — 1 of 7 days"; 5k card correctly absent (sparse-but-honest, no runs logged
  yet). ZERO console errors across the entire run. account-1 left in this committed demo state
  (a second rich demo alongside account-2); reset via /dev/reset when a fresh-onboarding demo is
  needed again. Walkthrough-only side effect committed: `.claude/launch.json` gains a cadence-api
  entry. Known tooling quirk (not app): browser screenshots lagged the DOM a few frames; DOM
  reads were used as source of truth and the final frames rendered correctly.

- **Meal photos — snap your plate, capture-first (2026-07-17):** closes the spec's photo-input
  requirement (`input_method='photo'` + `photo_ref` existed since 0001, unused until now). The
  engine can't see images (all integrations are text-only — recorded as the §F multimodal
  enhancement), so the honest cut is CAPTURE-FIRST: photo → client-side canvas downscale (≤1024px
  JPEG ~100-300KB) → data URL → `POST /nutrition/meals {photo}` → pure `photo-validate.ts`
  (jpeg/png/webp only, svg rejected, 1.5MB cap; unit-tested) → PRIVATE Supabase Storage bucket
  `meal-photos` (self-healing create on first upload; path `userId/date/uuid.jpg`) → `photo_ref`;
  caption optional — with one, parse-meal runs as usual; photo-only stores items=[] honestly. Reads
  attach 1h signed URLs (`photo_url`, display-only field, never stored). UI: 📷 button beside the
  mic (`capture="environment"` → rear camera on phones; picker on desktop), preview + remove +
  honest hint ("I can't read plates yet, but the photo is kept"), thumbnails in the day's meal
  list. `resetUserData` (and thus /dev/reset AND DELETE /me/data start-over) now purges the user's
  Storage folder — the "erases everything" promise covers photos. days_logged/phase-gate count
  photo-only meals (a snapped plate is an observed day). **Verified:** tsc×2; vitest 45/45 (+3
  photo-validate); live smoke on account-1 — photo-only POST → 200 with photo_ref (bucket
  auto-created on first ever upload), GET /recent attached a signed URL that fetched 200; browser —
  📷 renders with accept/capture attrs, the photo meal's thumbnail LOADED from the signed URL
  (naturalWidth>0), meal list shows "snack · 📷 photo" beside the captioned dinner; zero console
  errors. Not exercisable in the automated browser: the OS file/camera picker itself (needs a real
  device) — the downscale path is standard canvas code and the server pipeline is proven. On
  `feat/cadence`.

## SPEC — Nutrition v2 + the Visual Today (2026-07-17 · ✅ SHIPPED N1–N4)

> User direction (from MyFitnessPal screenshots): keep the MACRO view (rings, targets, "Xg left");
> make Today visual and "plan for today"-first instead of a week list; the dashboard must span
> module types (fitness, nutrition, habits, reading, spiritual — whatever the user's goals are);
> the AI DISCOVERS/DOCUMENTS nutrition details instead of MFP's database-search-and-pick; ignore
> the Steps card (HealthKit later). Spec first, build after sign-off per phase.

### S1. Philosophy reconciliation — estimates, honestly

The Observe phase keeps "never invent" (it's about learning how you eat, not measuring). But the
ORIGINAL schema anticipated the next step all along: `nutrition_logs.macros`, `ai_confidence`,
`provisional` ("below confirm threshold → excluded from totals", §B2) and `users.macro_targets`
have existed since 0001. Nutrition v2 activates them with three rules:
1. **Estimates are labeled estimates** — rounded values, `~` prefix in UI, per-meal confidence;
   below the threshold (default 0.5, tunable) the row is `provisional`: shown, but EXCLUDED from
   the day's totals until the user taps to confirm or edit. The user's correction always wins
   (sets confidence 1, provisional false, `macros.source='user'`).
2. **MFP inverts to us**: they search a database and pick a serving; we let you say/snap the meal
   and the AI documents it — the human corrects instead of data-enters.
3. **Brand guard**: "Xg left" framing (count what's left, never what broke); hitting a target says
   "target reached", over-target never turns red or scolds; no calorie-first moralizing — kcal is
   shown quietly, macros lead.

### S2. Vision through AI Admin — UNBLOCKED (engine work, promoted from backlog §F)

Devs.ai accepts `ComplexMessageContent` arrays — `prompt: [{type:'text',text}, {type:'url',url}]`
or `{type:'id', id}` after `POST /v1/files` (docs.devs.ai/api-spec). So plate-reading can flow
through the auditable machinery; my earlier "engine is text-only" was the provider layer's
implementation, not an upstream limit. Grounding (read today):
- v1 client `sendChatMessage` already types `prompt: string | unknown[]` → parts likely pass
  through the chats path unmodified.
- Job execution calls `llmClient.chatCompletion(model, msgs)` — v1 hits `/api/v1/chat/completions`
  (OpenAI-compat; upstream compat endpoints accept `content: parts[]`), v2 builds
  `/api/v2/responses` bodies from string-content `ChatMessage`s in `request-builder.ts` — that
  builder is the one real gap.

Engine changes (AI Admin — its own repo conventions, tests, prepush):
- **E1** Canonical `ContentPart = {type:'text',text} | {type:'image_url',url}` in engine types;
  `ChatMessage.content: string | ContentPart[]`.
- **E2** Request builders map parts per provider dialect: v2 → Responses `input_text`/`input_image`;
  v1 compat → OpenAI-style content array; native chats path → devs.ai `{type:'url'}`.
- **E3** `executeJob(slug, { images?: string[] })` — URLs appended as image parts AFTER template
  interpolation (templates stay text; no `{{image}}` pseudo-variables). Diagnostics/ai_log record
  the URL REFERENCES, never base64 payloads.
- **E4** Vision-capable model check: broker default gpt-4.1-mini is vision-capable — confirm via
  the live catalog (`list-v2-models`) during N1, with gpt-4o as the verified fallback.
- **E5** Tests: builder unit tests + one live smoke (an image containing only the words "eggs and
  toast" must come back as those items — proves the image round-trip without needing real food).
- **Non-goal (cut 1)**: the file-ID upload path. Cadence already mints short-lived signed Storage
  URLs — `{type:'url'}` with a 1h signed URL is the zero-new-infra route. If N1's smoke shows
  Devs.ai can't fetch them reliably, fall back to `POST /v1/files` + `{type:'id'}`.

### S3. parse-meal v2 — vision + macro documentation

- Accepts `meal_text` (optional), one image (optional; at least one of the two), `meal_hint`.
- Output grows: per-item optional `est {kcal, protein_g, carbs_g, fat_g}`, meal-level
  `est_macros` totals, `confidence`. Portion honesty: from a photo, qty only when visually
  unambiguous; estimates ROUNDED (no false precision); unknown → omitted, never guessed.
- Service: totals land in `nutrition_logs.macros` (+ `ai_confidence`, `provisional` per S1).
- **Retro-backfill**: a script re-parses photo-only rows (`photo_ref` set, `items=[]`) — every
  plate snapped since capture-first shipped becomes data the day vision lands.
- **Correction**: `PATCH /nutrition/meals/:id` (items, macros, meal kind) — the tap-to-confirm/
  edit path that graduates provisional rows into totals.

### S4. Targets the coach discovers (`users.macro_targets`)

- New coach-tier job `nutrition-targets`: baseline (age/height/weight incl. start), goals (weight
  target, movement load), observed-week summary → proposed `{kcal?, protein_g?, carbs_g?, fat_g?}`
  + a short rationale in coach voice ("protein up because two strength days…").
- **Gates**: only offered after the observe window (≥7 logged days) AND an eating/weight goal
  exists. Suggest-never-auto-apply: surfaces as an extension of the existing Baseline moment
  ("want my read?" → read + one change + PROPOSED TARGETS), user confirms/edits → saved. A
  Settings editor covers later tweaks. No confirmed targets → no rings, observe card persists.

### S5. Daily rollup — `GET /nutrition/day?date=`

`{ meals[], totals, provisional_totals, targets?, left? }` — pure deterministic sums
(unit-tested; confirmed rows only in `totals`), `left` clamped at ≥0. This endpoint feeds the
rings and the coach (`get_food_log` gains the day totals line once targets exist).

### S6. The Visual Today — a module dashboard, not a week list

Principle (same as Progress): **stable chrome, cards derive from the user's own goals** — a
books-and-prayer user never sees a macro ring. Today tab becomes a card dashboard; the week list
moves behind a `Today | Week` segment (MFP-style pager dots considered; segment is simpler v1).

Card registry — deterministic eligibility by (area, goal type, data presence); inline SVG only:
1. **Today's rhythm** (always, first) — the day's occurrences as a visual checklist: module icon,
   time chip, done/skip states. The anchor card.
2. **Nutrition** — pre-targets: observe card (7-dot days-logged row, today's meal count, snap
   shortcut); post-targets: MACRO RINGS (carbs/fat/protein, "Xg left" captions, kcal quiet).
3. **Movement** — weekly consistency ring + next-session chip; pace/load sparkline when ≥2 points.
4. **Counts** (books etc.) — progress bar (20/100) + "+1".
5. **Practice/mind** — 7-day dot row (done / rest / missed-as-neutral — never red).
6. **Weight** — sparkline + latest vs target (only when a weight goal or weigh-ins exist).
7. **Milestone countdown** — days left + next stepping-stone.
Data: compose from existing `GET /plan` + `/progress` + `/nutrition/day` client-side first; add an
aggregate endpoint only if phone latency demands it. No LLM anywhere in the dashboard.
Explicitly out: Steps (HealthKit later), social feed, ads (obviously).

### S7. Phasing + verification

| Phase | Scope | Size | Verify |
|---|---|---|---|
| **N1** ✅ 2026-07-17 | Engine vision E1–E5 (AI Admin repo) — SHIPPED: `ContentPart` + `ChatMessage.content: string \| parts[]`, `lib/message-content.ts` helpers, v2 builder → `input_image`, v1 compat → OpenAI dialect (non-stream + stream), gemini text-extracts + drops images w/ debug note, `executeJob({images})` post-interpolation, diag `imageUrls` / metadata `imageCount`. S8 #3 RESOLVED: signed-URL transport works — no file-ID path needed. | M | ✅ backend tsc 0; +6 unit tests (builder mapping, helpers, string-shortcut guard); LIVE: signed Storage URL of words-in-image → gpt-4.1-mini replied "eggs and toast" verbatim (vision confirmed on the broker default — no gpt-4o fallback needed) |
| **N2** ✅ 2026-07-17 | SHIPPED: parse-meal v2 (words and/or PHOTO via N1 `images`; per-item `est` + `est_macros`, rounded, omit-over-invent), pure `nutrition-day.ts` (`sanitizeMacros`/`sumDay`/`computeLeft`), provisional gate (<0.5 conf → listed, excluded from totals), `GET /nutrition/day` (confirmed vs provisional + targets/left plumbing), `PATCH /nutrition/meals/:id` (user wins: source 'user', conf 1), `scripts/backfill-meal-photos.ts`, sheet UI (day-totals bar, ~est chips, tap-✓ on provisional, "I'll read what I can" copy) | M | ✅ tsc×2 0; vitest 49/49 (+4); sync 15/0. LIVE: photo-only plate → [grilled chicken, rice] + ~450 kcal P39 C45 F8 @0.9 conf; text meal → ~340 kcal; day totals split; PATCH {500 kcal} replaced AI numbers in totals; backfill 1/1; browser totals bar + est chip, zero console errors |
| **N3** ✅ 2026-07-17 | SHIPPED. **Deviation from spec S4:** targets proposed by EXTENDING the existing `nutrition-baseline` job (not a separate `nutrition-targets` job) — the spec itself says targets surface *inside* the Baseline moment, so one coached read + one LLM call is truer to intent; deterministic `propose_targets` gate + `sanitizeTargets` (round kcal→50/g→5, range-check, DROP out-of-range never clamp) are the wall. `getBaselineRead` gains `proposed_targets`/`targets_rationale` (null unless eating/weight goal AND no targets yet); `setTargets`/`clearTargets` + `PUT`/`DELETE /nutrition/targets`; `GET /nutrition/day` `left` now populates; baseline-box "Use these targets" (suggest-never-auto-apply) + day-totals "left" line + Settings `NutritionTargets` editor (load/edit/clear). | S–M | ✅ tsc×2 0; vitest 50/50 (+1); sync 15/0. LIVE scratch: eating goal+7d+baseline(86kg) → proposal {2200/110/250/70} + coach rationale; confirm→day LEFT {1700/76/205/54} (math ✓); GATE — books-only user got `proposed_targets:null` (WITHHELD ✓). Browser (account-1, targets 2100/140/210/65): food sheet "left" = 1650 kcal · P101 C165 F57 (math ✓); Settings editor loaded live targets + Clear; zero console errors. Honest wart: rationale said "two strength days implied" (none existed) — LLM embellishment; numbers themselves grounded in baseline weight. |
| **N4** ✅ 2026-07-17 | SHIPPED. The Visual Today — Today tab is now a module dashboard behind a pinned `Today \| Week` segment (S6). ONE backend touch: `area: GoalArea` on every `ProgressCard` (so consistency splits movement-ring vs practice-dots; nourishment consistency is dropped — the Nutrition card owns that area). Everything else is client-side composition over `/plan` + `/progress` + `/nutrition/day` (no LLM, no new aggregate endpoint). New `components/viz.tsx` (shared with Progress): `Sparkline`/`CountBar` extracted + `Ring`/`DotRow`/`MacroRings` added, all inline-SVG. New `features/today/TodayDashboard.tsx` renders, gated by (area, kind, data): rhythm checklist (module glyphs + "Next up") · macro rings post-targets / observe dot-row pre-targets + snap · movement consistency ring · count bar + "+1" · practice dot-row · measured (latest-vs-target + sparkline) · milestone countdown · pace/load trend sparklines. `PlanView` became the segment orchestrator (Today=dashboard default, Week=existing list; shared sheets/proposal/adjust; `reloadKey` refetches aux on log/meal/adjust). **Simplifications (noted):** next-session chip folded into the rhythm card (occurrences carry no area/goal to filter movement); pace/load render as self-contained trend cards rather than nested in the movement ring (trend↔goal title matching isn't reliable). **Bug caught live + fixed:** the API returns `{}` (truthy) not `null` for an unset user, so the rings/observe gate must test a real macro value — else the observe card never shows. | L | ✅ tsc×2 0; vitest 50/50; `/progress` cards now carry `area`. Browser (dev, zero console errors throughout): **account-1** (food+targets) → rhythm (Knee-Safe Strength/Food log + "Next up · Easy Run · Sat") + macro rings P101/C165/F57 **g left**, kcal "450 / 2100 · 1650 left" (matches API `left`); segment→Week renders the rolling list; cleared targets → observe DotRow (7 dots, 1 filled, "1 of last 7 days · 3 today"); restored → 3 rings back. **account-2** (books) → rhythm + count bar "2/100 books"+add, **NO rings**, alcohol nourishment-consistency correctly suppressed. DotRow/Ring/MacroRings SVG all render (6 ring circles, 7 dots); mind-only dot-row uses the same proven DotRow (no mind-only dev persona to seed). |

Order rationale: N1 unblocks everything AI; N2 makes photos meaningful; N3 unlocks rings; N4 is
the visible payoff and lands last so the rings/dots have real data behind them.

### S8. Open decisions (recommendations bold)

1. Ring center: **macros lead, kcal as a quiet number below** (MFP parity without calorie-first).
2. Provisional threshold: **0.5 default**, tunable per user later.
   ⚠️ **Needs recalibration — the model under it changed.** `PROVISIONAL_BELOW = 0.5`
   (`apps/cadence-api/src/services/nutrition-parse.ts`) was calibrated against `gpt-4.1-mini`;
   `parse-meal` now runs on `gemini-3.1-pro`, whose confidence distribution is a different scale.
   Too high → real meals sit provisional and never reach the rings; too low → guesses count as
   fact. **Both fail silently** — the number is plausible either way, so nothing surfaces the
   error. Action: log `ai_confidence` across ~20 real meals (photo AND text-only — they will
   differ), compare against whether the parse was actually right, then set the threshold from
   that distribution instead of inheriting a constant from a retired model.
3. Image transport: **signed URL first**; file-ID fallback only if the N1 smoke fails.
4. Target proposal surface: **extend the Baseline moment** (one coached moment, not a new one).
5. Week view: **segment toggle** v1; swipe pager if the segment feels buried.

### Final step (post-finalization) — the agentic retrieval loop: the coach answers its own questions

**Framing (decided 2026-07-07):** the current context engine is a *workable, shippable* model, not a
detour. Today the Broker curates ONE context pack at session-open (`buildContextPack`: `pack-select` →
governed execute → `pack-summarize`), injected as a single non-triggering `<context>` turn; the
per-turn hook (`services/coach-context.ts` `assembleTurn`) is a **no-op TODO**, and `sendCoachMessage`
is a plain streaming completion with **no tool-call loop**. So the coach's entire grounding is a guess
the Broker makes *before the user says a word*. Finalizing this as-is does NOT move us away from the
agentic coach — it BUILDS its foundation: the semantic-layer registry (`services/retrieval/registry.ts`),
the governed execute boundary (model chooses, app runs — never free SQL), the per-read audit trail
(`ai_log` + dev X-ray), and the injection seam (`assembleTurn`) are exactly the pieces a tool loop
needs. This is the last big architectural move, deliberately sequenced AFTER the living-plan phases.

**The enhancement:** give the coach the registry functions as real tool-use tools and run an actual
tool-call loop around its streaming turn — handle `tool_use`, execute the registry fn (governed,
app-side), feed `tool_result` back, continue streaming — so it can react to what it finds mid-turn
(check consistency → see a dip → fetch constraints → *then* answer) instead of reasoning from a
session-open snapshot. The **coach↔Broker seam** is first-class here: the coach can also hand the
Broker explicit directions ("pull last-30d consistency + active constraints") rather than the Broker
guessing — a cheaper middle gear than a fully autonomous loop.

**Interim (before the full loop) — shrink the guessing without a rebuild:** two low-risk hops on the
*existing* workflow that close most of the accuracy gap while keeping the cheap curator:
1. **DONE (2026-07-07)** — implemented `assembleTurn`'s TODO as a per-turn `context_select` (Broker).
   Repurposed the `context-select` job from opaque need-strings (`goal:<id>`) to the same
   `{calls:[{fn,params}], reason}` shape as `pack-select`, scoped to THIS turn + the fn catalog (synced
   live). New `services/turn-context.ts` `injectTurnContext(userId, sessionId, message)`: Broker
   turn-select → validate against the registry → execute app-side → inject as a NON-triggering
   `<context source="turn-context">` turn right before the user's message (NOT prepended — a prepend
   would leak into `/coach/current` + the capture window, both of which drop `<context`-prefixed
   turns). Best-effort: any failure/empty-select leaves the turn untouched. Every turn records the
   chosen fns BY NAME into the X-ray (`DevTrace.turnSelect`, rendered in the DevPanel Broker card) +
   durable `ai_log` (`context_select` kind) — including the empty case, so a turn that fetched nothing
   is still visibly assessed. Verified: tsc + vitest 19/19; `scripts/smoke-turn-context.ts` over the
   real HTTP route — data question → chose `get_consistency`, executed, injected; "thanks!" → chose
   `[]`, injected nothing; `context_select` logged by name; NO leak into the restored transcript. Live
   browser X-ray shows the per-turn fns by name. **Known nit (prompt tuning, not a bug):** the Broker
   sometimes calls `get_consistency` with the default 7-day window even when the turn asks about "two
   weeks" — it doesn't always pass `{days:14}`. Fine for a first cut; tighten the prompt later.
2. A single deeper mid-conversation re-fetch — when the coach itself signals it's missing something
   (vs. the pre-turn Broker guess), re-run selection for that turn only. Not yet built.
Both reuse the registry + jobs already in place; neither requires the coach's streaming path to
become a tool-runner yet.

**Trade-offs (accuracy is the goal, not latency):** a tool loop buys accuracy ONLY when the model
chases its uncertainty; it adds round-trips and new failure modes — wrong tool, hallucinated args,
and (most common) stopping one hop too early and answering confidently on an incomplete picture.
Mitigation is discipline, not infra: tool DESCRIPTIONS that say *when* to call (not just what they
return), and a hard coach-persona grounding norm — *never state a number/date/status you didn't just
retrieve this turn* — the same "verify, don't fabricate" stance as `plan-vet`, applied to the coach's
factual claims. It belongs in the coach job's `config.systemPrompt` (synced, auditable), not code.

**Sequencing:** finalize the current single-shot engine first (it's correct and working); then
optionally add the interim hops to reduce guessing; the full tool-runner loop is the final
enhancement, NOT a prerequisite for anything above it. Companion write-up:
`docs/cadence/blog/04-letting-the-coach-ask-its-own-questions.md`.

> **First concrete tools for this loop → the food layer (Req 5, 2026-07-24 direction).** USDA/OpenFoodFacts
> as deterministic providers ✅; coach retrieval `lookup_food` ✅ (read-only, no LLM HTTP wrap).
> `resolve_food` / `log_meal` / `build_recipe` still designed as services now + tools later — one
> implementation, two entry points. Long-term objective + milestones in
> **`docs/cadence/REQ5-food-and-recipes.md` §12**. Guardrail stays: even agentic, writes are suggest-then-confirm.

## Req 4 — Disrupted mode + streaks that don't punish you (design, 2026-07-24)

The "missed days / disrupted mode" requirement, designed in full and now being built. Req 4 was
already ~60% plumbed (see the inventory below); this section is the design of the *gap* + the
product decisions that shape it. **Approach decisions this session (Matt/Jeff):** streaks return
with a **freeze economy** (not a hard reset); build **all three** disrupted-mode entry paths.

### What already existed (the 60%)
- **Tripwires** — `services/tripwires.ts` `detectTripwires` (pure, no LLM): `missed_threshold`,
  `consistency_drop`, `consistency_outcome_divergence`, timezone/location/weather (last three are
  stubs — undefined signals never fire). 
- **Weekly assess gate** — `services/situation.ts` `assessIfDue` runs tripwires → `situation_assess`
  Broker job → stores a `PendingProposal`; also the monthly deterministic-rebuild checkpoint.
  `situation_assess` **already returns `enter_disrupted` / `open_checkin`** recommendations — they
  were read-but-unconsumed pending this build.
- **Proposal → accept** — `POST /plan/proposal/accept` → `replanPlan`. One action only today
  (full re-plan).
- **Episode substrate** — `cadence.episodes` table (migration 0001), `DisruptedEpisode` type,
  `disrupted_plan` job (provisioned), `CoachIntent 'disrupted'` + a context-pack selection.

### What Req 4 builds (the gap)
No episodes repo, no lifecycle (`plan-synthesis.ts` hard-codes `active_episode: null`), the
`disrupted_plan` job is never called, nothing triggers the `'disrupted'` intent, no on-return
prompt, no ad-hoc/alternate logging, and **streaks are still retired** (`rollingConsistency`
"5 of 7"). 

### Streaks as a rhythm counter, not a scoreboard (the freeze economy)
Three coexisting layers — the honest metric stays; the streak sits on top:

| Layer | Behavior | Resets to zero? |
|---|---|---|
| **Rhythm metric** (`rollingConsistency`, "5 of 7") | honest underlying number, always shown | never — just dips |
| **Streak** (consecutive kept days) | the motivational counter | only when freezes run out *and* the slip is un-acknowledged |
| **Freezes** | earned buffer, auto-spent to save the streak on a slip | — |

**Day classification (finalized through *yesterday*; today is provisional — a due-but-not-done
today is not yet a slip):**
- `due` = ≥1 occurrence that day with status in (`pending`,`done`,`missed`). **`skipped` does NOT
  create due-pressure** — an acknowledged skip is a free pass (Phase B).
- `engaged` = ≥1 `done` occurrence that day **OR** an explicit check-in that day.
- `slip` = `due && !engaged && !inEpisode` · `kept` = `engaged` · `neutral` = everything else
  (rest day, or in-episode with no engagement — the episode shields it).

**Advance (per finalized day, ascending):** kept → `current++`, earn 1 freeze per **7** consecutive
kept days (cap **2**); neutral → unchanged (run continues); slip → spend a freeze if any (stays
kept, record `last_saved_by_freeze`), else `current = 0`. **Seed 1 freeze** at state init so the
first streak has a cushion. Forward-only (`last_evaluated` advances, never re-finalizes a past
day) ⇒ idempotent + a past freeze decision is frozen in time without a separate event log.

**The brand-critical property:** disrupted-mode days and check-ins **never consume freezes** —
inside an episode the base occurrences are `paused` (not due), so there's no slip to absorb. A
rough patch never drains the buffer you earned; freezes exist only for the ordinary "too busy,
said nothing" day. When freezes finally run out the streak resets, but the coach *checks in*
warmly (never guilt) and the rhythm metric underneath never moved — you never actually start over.

**Storage:** `users.streak_state` jsonb (migration 0015), `{current,longest,freezes,freeze_credit,
last_evaluated,last_saved_by_freeze}`, defaulting `freezes:1` (the seed). NOT `goal_events` — its
`kind` CHECK is `('completion','note')` and it feeds the user-facing History feed. Pure
`advanceStreak`/`computeStreakView` in `metrics.ts` (heavy unit tests, mirrors `progression.ts`);
thin `services/streak.ts` `evaluateStreak` builds the day list + persists; `GET /plan` surfaces
`streak: StreakView` alongside `consistency`.

### Disrupted-mode lifecycle (enter → additive overlay → end)
- **Enter** creates an `episodes` row, optionally confirms available equipment (hotel-gym photo →
  existing parse path), then calls the **`disrupted_plan` job** (AI Admin machinery — no
  hand-authored prompts) → `temp_activities` + `overrides`.
- **Additive overlay via occurrences:** materialize temp activities as occurrences tagged
  `episode_id`; set base occurrences in the window to a new **`paused`** status (not `missed`).
  Reuses the whole occurrence-centric stack; `paused` reads as "not due" so it can't break the
  streak. **End** = drop future temp occurrences, un-pause base from today forward; history stays
  honest. Base plan resumes untouched.
- Feed the live episode into `plan_vet` (replace the hard-`null` `active_episode`). **Naming
  correction (found during Phase C):** migration `0006` already renamed `protect_streak` →
  `protect_momentum`, so the type and live DB match — no rename. The streak protection is
  **structural** (the `inEpisode` shield in `evaluateStreak`), not a boolean read, so `protect_momentum`
  stays. The `PendingProposal.action` generalization (`replan | enter_disrupted | rebaseline`) moves
  to **Phase D**, where the proactive/on-return entry paths actually consume it.

### Logging honesty
`POST /plan/occurrences/adhoc` — log an unscheduled thing you did → a `done` occurrence (optional
`episode_id`); feeds streak/consistency honestly ("did hotel yoga instead"). Acknowledged **skip**
affordance writing `status='skipped'` (vs. silent `pending`) — distinguishes "I chose to skip"
(neutral, no slip) from "went dark" (slip). Both statuses already exist in the enum; nothing wrote
them before.

### Entry paths (originally three; a fourth added 2026-08-04)
1. **On-return "was this a detour?"** — open after N dark days (default **4**) → ask, offer to
   enter. The specific 2026-07-24 refinement; deterministic gap-detection on session/plan load.
2. **Manual "I'm traveling/disrupted"** — a self-declare entry; covers disruptions no tripwire
   catches (a wedding, a rough week). Since 2026-08-04 the picker is a three-question check-in
   (type → how long → what you've got): the two facts a re-plan cannot run without.
3. **Proactive tripwire proposal** — reuse `assessIfDue` so `missed_threshold` etc. proposes
   `enter_disrupted` (via `PendingProposal.action`) instead of only a full replan.
4. **Telling the coach (2026-08-04)** — "why shouldn't telling the coach I'm travelling start a
   detour?" (owner). It does now: the coach runs the exchange in chat (how long, what you'll
   have), confirms what it heard, and **the user's plain yes is the trigger** — no banner
   re-asking what they just said. BRAND's "confirm before you commit" happens IN the
   conversation; the banner stays only for tripwires, where the system is guessing and a guess
   does need a separate confirm. Mechanically the two-speed split holds: the coach only talks;
   after the turn a deterministic keyword gate (`detour-signal.ts`, the tripwires pattern applied
   to chat — no signal, no LLM call) runs the `capture-detour` Broker job over the same window
   ambient capture uses, and it emits an agreement ONLY on explicit assent — a mention is
   conversation, a retracted yes is a no. Normalized app-side (type whitelist, days clamp,
   equipment cap), then the existing `enterEpisode`; an active episode short-circuits before the
   job, which also makes re-reading the same exchange next turn a no-op. Its own job rather than
   a seventh key on capture-extract — already the widest schema in the system (REQ10 §11), and
   one job/one surface is the law for exactly this reason.
   **The arrival model (owner, same day):** a detour agreed in ADVANCE is *scheduled*, not
   started — "I'm travelling Thursday" said on Monday pauses nothing until Thursday (the contract
   carries `start`; `enterEpisode` honours it; before it the card reads "Detour ahead", and the
   plan runs as normal). On the start date the card becomes the **arrival check-in** — "Have you
   arrived? What have you got?" — because that is where the equipment answer actually lives:
   gear chips, **"Snap the gym"** (photos → `parse-gym-photo` vision job → names; PLAN §424
   finally built), an explicit **"No gym here"** (an empty list is an answer and re-drafts to
   equipment-free days), or **"Not yet"**, which pushes the start a day — today's shelved
   sessions come back, the end stays put, and a push past the end cancels (a window with no days
   left is not a detour). All three doors — words in chat, chips on the card, photos — feed ONE
   revision machine (`reviseEpisodeEquipment`): re-draft the remaining days only, lived days stay
   as history, and a deterministic same-names guard stops the rolling chat window re-drafting the
   week every turn. `gearKnown` (equipment present, or `constraints.gear_confirmed`) is what
   tells "answered: nothing" from "never answered".

**Week-gap re-baseline:** after ~**7**+ dark days (or a long episode), offer a coach re-baseline
(`action:'rebaseline'`) rather than silently resuming the old plan.

### Build phasing
- **A — streak + freeze economy** ✅ DONE — metric layer; `metrics.ts` pure engine + `streak.ts` +
  `users.streak_state` (migration 0015); surfaced in PlanView + a Week-tab "rhythm" line.
- **B — logging honesty** ✅ DONE — ad-hoc off-plan log (`POST /plan/occurrences/adhoc` →
  `adhoc-log.ts` → "Off-plan" bucket activity). Acknowledged skip was ALREADY shipped pre-Req-4
  (OccurrenceRow skip button + status endpoint); "ran 2km not 5km" already worked via `logOccurrence`.
- **C — episode engine** ✅ DONE — migration 0016 (episodes FK `auth.users`→`cadence.users`;
  occurrences `+paused` status `+episode_id`; `check_ins` table). `repos/episodes.ts` +
  `repos/check-ins.ts`; `services/episode.ts` enter/end + pure `episode-overlay.ts`; `disrupted_plan`
  job wired (best-effort); additive overlay = pause base user occurrences + materialize temp
  (episode-tagged) options; `evaluateStreak` now shields `inEpisode` days + counts check-ins as
  engaged; `active_episode` fed into `plan_vet`; `POST /plan/{episode,episode/end,checkin}`; PlanView
  gains `activeEpisode`; web detour banner + paused render.
- **D — the three entry paths** ✅ DONE — `PendingProposal.action` (`replan|enter_disrupted|rebaseline`)
  + `episode_type`; accept-route branches (enter_disrupted → `enterEpisode`, else re-plan). (1)
  On-return: `assessIfDue` proposes a detour when `lastEngagementDate` gap ≥ 4 days (uses
  `getLastDoneOccurrenceDate` + `getLastCheckInDate`); (2) manual: Week-tab "Life happened? Take a
  detour" type-picker → `POST /plan/episode`; (3) proactive: `assessIfDue` now consumes
  `situation_assess`'s `enter_disrupted` (infers `travel` from timezone/location tripwires). Banner
  copy branches on action. **NB:** on-return shares the weekly `last_assessed_at` throttle, so a
  short gap right after an assess can delay it up to ~a week (acceptable; the tripwire path also
  catches the dark stretch). **Deferred:** the `'disrupted'` COACH intent (client passes `intent`
  to `/coach`; wire `activeEpisode → intent:'disrupted'` in the web coach-open) — small follow-up.
- **E — week-gap re-baseline** ✅ DONE — `rebaseline` is proposed (1) on return after a **≥7-day**
  gap (vs. a detour for a 4–6-day gap) and (2) on `endEpisode` after a **≥7-day** detour (surfaces as
  the normal proposal banner). Accepting it runs `replanPlan(userId, REBASELINE_STEER)` — a
  coach-driven fresh-look synthesis (reassess the starting point, gentle on-ramp) rather than a
  silent resume. Banner reads "Welcome back / Take a fresh look".

**Req 4 COMPLETE (2026-07-24)** — A–E all built on `feat/req4-disrupted-streaks`, 236 api tests +
all three workspaces green (tsc/lint/format). Deploy items outstanding (user's call): apply
migrations **0015** + **0016**; branch uncommitted/unmerged; auth-gated so verified by tsc/tests not
the browser. Remaining polish (noted, not built): the `'disrupted'` coach intent wire; a richer
conversational re-baseline (today's is a steered one-shot re-plan).

### Brand reconciliation
BRAND.md retired streaks and bans "streak mechanics that reset to zero." The founder reversed the
retirement ("our brand is about building better habits"). This design is what makes streaks
brand-safe *by construction*: freezes + check-ins + disrupted-mode `paused` days mean the streak
never resets **because life happened**, and the honest 5-of-7 metric always coexists. BRAND.md is
updated to reframe the ban as *"streaks that punish you for life happening"* — which this design
structurally cannot do.

## Tool catalog — the coach's single source of truth (REQ8 harness, built 2026-07-28)

The coach can only build sessions from tools it knows exist; the client can only render tools it has
code for; the api only accepts a whitelist. Those three lists were hand-kept in three files and
drifted. `packages/cadence-shared/src/tool-catalog.ts` is now the ONE source of truth:

- `COACH_TOOLS: Record<SessionItemTool, …>` (read · timer · checkoff · reps · photo · journal) +
  `SET_FLOWS` (straight · circuit). Typed as a total Record → a new tool won't compile without an
  entry, each carrying its when / trap / fields / example.
- The api whitelist (`session-normalize.ts`) derives from `SESSION_TOOL_KINDS` / `BLOCK_MODE_KINDS`.
- `renderCoachToolCatalog()` renders a hierarchical GUIDED/CAPTURE + SET-FLOW block, injected into
  `prescribe-session` as the **runtime `{{tool_catalog}}` variable** (session-generate.ts) — the
  coach's prompt always equals the deployed catalog, so adding a tool never needs a prompt re-sync.
- A compile-time `never` guard fails the build unless every coach tool also has a client renderer.

`measure` / `rings` / `insight` stay out on purpose (app-attached, not coach-emitted). Edit the tool
once in `tool-catalog.ts` → prompt + whitelist + compile-check all move together.

**Chosen access = runtime variable**, over the two alternatives (bake the catalog into the synced
prompt; or a devs.ai knowledge resource) — devs.ai holds only the placeholder, so zero drift.

**Description discipline (audit 2026-08-04 — the catalog reviewed as what it is, a
function-calling toolset):** four rules, each bought with a live failure:

1. **Examples are canon.** A worked example outweighs any rule — "a 5-min meditation" living in
   timer's examples taught timer-for-mind-practices for weeks despite a trap saying otherwise, and
   photo's lone "Photo your plate" pointed session photos at the food module's job. Every example
   must be the tool's most *unmistakable* case, never a neighbour's.
2. **Every confusable pair carries its tiebreak on at least one side.** The audit found three
   uncovered: timer↔checkoff (watch a clock vs confirm it happened), read↔checkoff (a cue inside a
   step vs a step of its own), journal↔feeling_log (sentences worth rereading vs one word and a
   size). All covered now; a NEW tool's review question is "which existing entries could this be
   mistaken for, and where does that tiebreak live?"
3. **Summaries lead with the discriminator.** The first clause is what a selector model reads;
   operational detail (banks, fields, variants) comes after or lives in the trap.
4. **Inference must honour the preamble.** The catalog tells the coach `tool: null` is safe, so
   `inferTool` now checks tool-specific fields (journal_bank, grounding_game, meditate_bells,
   breath_pattern) BEFORE quantities — previously a journal item with a duration and no tag
   silently became a bare timer, and a bank with no duration became `read`. Unambiguous fields
   outrank ambiguous numbers.

Also retired with its rationale: the probe's "no feeling_log straight after grounding" check —
its whole reason was grounding ending on its own question, which the owner removed. A rule must
not outlive its why.

**Future — revisit the catalog architecture (owner steer 2026-07-28):** create a **devs.ai-managed
agent** and maintain its data sources through devs.ai instead of injecting an app-side variable —
"much more efficient," and it centralizes upkeep on the platform the coach already lives on. Revisit
once the runtime-variable version is proven; keep code as the type/whitelist authority and sync the
LLM-facing copy to devs.ai's data sources.

## Plan shape — how many things a day holds (owner steer 2026-08-03 · canonical: REQ10 §12)

The day's trail renders **one node per scheduled activity**, so the coach's choice between "one
activity with many steps" and "several activities" is what the user actually sees. A 4–5 step mind
session is one button on an otherwise empty day; the same work as 4–5 activities is a day with a
rhythm. Strength is the opposite case — sets and exercises must bundle or the trail is unusable.

**The rule, in `synthesize-plan`: split by OCCASION, not by subject.** Would they do these
back-to-back in one go? Then one activity. Different times of day, or either could happen without
the other? Then separate activities with their own `time_of_day`. Meals already worked this way
(four logs, never one lumped "Food log") — this generalizes it. `prescribe-session` carries the
matching rule so a single-practice activity stays ONE item instead of being padded into a ritual.

**Density is a judgment the coach makes, not a quota the app enforces** — "it's all about balance;
checking things off gives us dopamine, but a really long list is scary." Both failure modes are
named in the prompt (too few = nothing to finish; too many = a wall people quit) so the model can
weigh them. Roughly 3–5 on a normal day, with someone's stated limit always winning and a
three-free-days-a-week plan counting as good, not failed.

Verified by `apps/cadence-api/scripts/probe-plan-shape.ts` (weekly in CI, never a merge gate) —
three scenarios that fail in three directions: mind-only must not collapse, strength must not
shatter, "one thing a day" must not get padded.

## Guardrails — scope, self-knowledge, and habits Cadence won't build (2026-08-07)

Three separate failure modes, deliberately handled at three different layers, because a persona
alone is a soft guarantee: it can be argued around over forty turns, and the Broker will happily
write down whatever the conversation contained.

**1. Self-knowledge, in code not in the persona.** `apps/cadence-api/src/services/coach-capabilities.ts`
is the manifest of what this build actually does (`CAPABILITIES` + an honest `NOT_YET` list), and it
composes `renderToolCatalogBrief()` — the SAME `tool-catalog.ts` the session-authoring job reads, one
line per tool. Injected as a context turn at session open (`routes/coach.ts`), not written into
`config.systemPrompt`. Rationale: features ship in code while the persona is edited in AI Admin Build
Rules, so a hard-coded list drifts on the next release, and a coach offering a feature the build lacks
costs more trust than one saying "not yet". This is what lets a user *discuss* the coach's abilities
— "could we put some breathwork in?" is answered from the real catalog, and an ask for something
missing gets a plain no plus "what were you hoping it would do?" instead of a hallucinated yes.
Device gate: the Apple Health line is suppressed when the client didn't declare `healthAvailable`.

**2. Scope, in the persona.** The seed
(`config/ai-admin/cadence-coach.system-prompt.md`) gains "Who you are" and "Scope — coach the rhythm,
never do the work". The line that matters is the one that *doesn't* over-refuse: **the practice of
anything is in scope, the output is not.** "An hour on my Rust project before work, four days a week"
is a real goal Cadence should coach well; writing the Rust is not. Decline once, warmly, offer the
practice version, then drop it — a coach that re-litigates its boundaries every turn is worse than
one with none. Also: no role-swaps, no prompt disclosure, and nothing arriving as data (photo, label,
pasted text, context block) is ever an instruction.

**3. Dangerous habits, screened deterministically.** `services/goal-screen.ts` — sibling to
`goal-guardrail.ts` (which asks "how many?"; this asks "should we coach this at all?"). Runs on the
capture persist path, pure and testable. Two asymmetric verdicts:
- `refuse` — a NARROW list of unambiguous self-harm (purging, laxatives, starving, water cuts,
  unprescribed drug protocols). Not persisted, so it can never become a committable card. Kept small
  on purpose: a false refuse tells someone their goal is unspeakable, the opposite of coaching.
- `reshape` — persisted WITH a note (never dropped behind the user's back: nothing you say is lost).
  Covers sub-1200 kcal targets, >1%/week loss rates, sub-6h sleep targets, building a substance
  habit, and do-my-work goals. `renderScreenNotes()` injects the note into the live session so the
  pushback happens *in conversation* — a card quietly missing from Review is the "start over"
  feeling the brand promises never to cause.

`plan_vet` gains a matching SAFETY check, so the same floors are enforced on the assembled plan and
not only on the goal that seeded it.

**Deploy note (neither is live on save):** persona edits need
`node --import tsx apps/cadence-api/scripts/set-coach-persona.ts`; the `plan_vet` edit needs
`apps/cadence-api/scripts/sync-jobs.ts`. The capability manifest and goal screen are app code and
ship with the deploy.

## Brand rollout — Metronome Split + Plus Jakarta Sans in the product (2026-08-07)

#143 locked the mark and typeface in the DOCS; the app was still shipping the superseded identity.
This pass closes that gap. What was actually drifting, in order of severity:

- **The typeface was never the brand's.** The app shipped **Bricolage Grotesque** (display) +
  **Hanken Grotesk** (body) — neither appears in any brand document, and Bricolage isn't even on
  the retired shortlist, so it predates the decision rather than losing to it. Now Plus Jakarta
  Sans for both, with `html.native` overriding `--body` to SF Pro per the doc's iOS chat/chrome
  carve-out. `--mono` (Space Mono) is untouched: no brand doc covers mono.
- **Three marks were live at once.** `Orb.tsx` (sunrise arch), the iOS icon (arch on cream), and a
  bespoke leaf glyph in `TrailHeader` that appears in NO brand document. All three are now the one
  `Orb`; the header's orange disc became a white plate matching the Default icon ground.
- **The icon plate was cream.** The identity doc scopes `#F4EFE4` as an in-app / brand ground and
  sets the Default icon plate to pure white. Fixed, plus a new `icon-dark.svg` on charcoal.

**Mark geometry is TRANSCRIBED, never redrawn.** Source of truth is
`docs/cadence/assets/cadence-mark-metronome-split.svg` (exported from
`cadence-icon-contact-sheet.html` → `conceptMetronomeSplit` / `dayNightC(14, 58)`): C centred
(50,50), outer r=34, counter r=20 (thickness 14), 58° aperture, cut on a 45° line through (60,60).
This is stated in `Orb.tsx` because it was learned the hard way — a mark drawn from the prose
description looked entirely plausible and was wrong twice (too heavy; cut centred rather than
offset). The contact sheet's own note already records both failure modes: centred, the cut "lopped
the top terminal off into a floating shard", and rotating the letter to match "cost the C its
reading altogether". **Change the mark in the contact sheet, re-export, re-transcribe.** The only
edit from the export is expressing each clip half-plane as a triangle instead of the generator's
97-point polyline — verified equivalent (every boundary point lies on x+y=116.6 / x+y=123.4).

**Also removed:** the hero variant's `feTurbulence` "hand-drawn edge". The identity doc's execution
warning is that terracotta + pine tips "farmhouse craft" the moment it meets hand-drawn texture —
the roughening was the exact thing being warned about. The hero now converges the two halves along
the cut instead.

**iOS assets: the SVGs are now the only sources.** `icon-only.png`, `splash.png` and
`splash-dark.png` were deleted, not just regenerated — `icon-only.png` silently WINS over
`icon.svg` in `@capacitor/assets`, so the first regeneration emitted byte-identical arch bitmaps
and looked like a no-op success. Sources are now `icon.svg` / `icon-dark.svg` / `splash.svg` /
`splash-dark.svg`; regenerate with
`npx @capacitor/assets generate --ios --assetPath assets` from `apps/cadence-ios`.

**Deliberately NOT done (each its own reviewed pass):**
- **Palette migration — CLOSED, owner call 2026-08-07: keep the brighter ramp.** The product
  values (`--dawn-3 #e07a5f`, `--forest #2c5545`) sit brighter than the identity doc's `#D85A30` /
  `#0F6E56`, which §9 warns reads as "a Headspace cousin". Raised and **dismissed** — owner prefers
  the brighter terracotta and does not regard the Headspace adjacency as a risk worth designing
  around ("we're better than them anyway"). So §9's "the terracotta never drifts brighter or more
  saturated in any asset" no longer describes the product; treat the shipped ramp as canonical and
  the doc line as superseded. Do NOT re-raise this as drift. `--sun` / `--dusk` remain at the exact
  identity-doc values because the MARK is transcribed from the export and must match it byte for
  byte; that is a fidelity requirement, not a palette position.
- **Dark mode.** The web app has none, so the dark-mode palette values have nowhere to live. They
  ARE used in `icon-dark.svg` / `splash-dark.svg`, where the light dusk `#3E5C76` on charcoal is
  near-invisible at icon sizes and would drop the night wedge entirely.

## BACKLOG — Postgres robustness (raised 2026-08-07)

Not a rewrite proposal; a list of concrete failures the current setup has actually produced, so the
decision gets made on evidence rather than vibes. Supabase Postgres is fine as a database — every
problem below is about **how we reach it and how we test against it.**

**1. Two hosts, one of which silently breaks CI.** Supabase exposes a DIRECT host
(`db.<ref>.supabase.co:5432`, **IPv6-only**) and a POOLER (`aws-*.pooler.supabase.com:6543`). On an
IPv4-only network — GitHub Actions runners, most CI — the direct host fails as `ENETUNREACH`, which
reads as a mystery outage; it cost half a day on 2026-08-04 and `config.ts` now carries a warning
comment about it. **It recurred on 2026-08-07:** `.env` held the direct connection string under
`CADENCE_DB_CONNECTION_STRING` (a name nothing reads) while `CADENCE_DATABASE_URL` held an
`https://` Supabase URL. It worked only because `buildDbUrl()` requires an `@` before trusting
`CADENCE_DATABASE_URL`, so it fell through to the password path. Had someone pasted the direct
Postgres string into the right variable, it would have worked locally and failed only in CI. A
guard that depends on the wrong value being wrong in a *specific* way is luck, not a guard.

**2. Three env vars can specify one connection.** `CADENCE_DATABASE_URL`, `CADENCE_DB_PASSWORD`
(+ host/port/user/name overrides), and — until deleted — a third that nothing read. Precedence
lives in `buildDbUrl()` and is invisible from the `.env` file. Minimum fix, independent of any
migration: **validate at startup** — reject a `CADENCE_DATABASE_URL` that isn't `postgres(ql)://`,
and warn loudly on the direct host rather than only in a comment.

**3. The DB integration suites are effectively untested.** `plan-commit`, `nutrition-service` and
`recipe` talk to REAL remote Postgres: ~1.7s just to connect, seed-and-wipe per test, a 30s
`testTimeout` to stop latency alone failing them — and they **skip entirely in CI** (no `CADENCE_*`
secrets). Observed 2026-08-07: three consecutive local runs of the same unchanged tree gave 1
failure, then 2, then 0. So the suites guarding commit/nutrition/recipe correctness are flaky where
they run and absent where it matters. This is the real cost and the strongest argument for change.

**Options, cheapest first:**
- **Local Postgres in CI** (a service container) + keep Supabase for prod. Fixes #3 outright, makes
  the suites fast and deterministic, needs no migration. Almost certainly the right first move.
- **Startup validation + collapse to one connection var.** Fixes #1 and #2, hours of work.
- **A real migration tool** (the `apply-migration-00NN.ts` scripts are hand-rolled and now number
  ~16); worth it independent of provider.
- **Migrate off Supabase Postgres** (Neon, RDS, Fly Postgres). Only worth pricing AFTER the above —
  note Supabase is also doing **auth** (Google/Apple sign-in, JWT validation in `requireCadenceUser`)
  and **storage** (meal photos), so "migrate off Supabase" and "migrate the database" are different
  sizes of job. Moving just Postgres is plausible; moving auth means redoing everything provisioned
  on 2026-08-07.

**Recommendation:** do the CI Postgres container first. It converts the flaky-and-skipped suites
into a real gate, and it is the prerequisite for confidently changing anything else here.

## Build Plan is a coach tool, not a destination (owner report + fixes, 2026-08-12)

Four things reported from a real device run after a fresh install. All four are fixed; the two
prompt fixes are synced live (`set-coach-persona.ts`, `sync-jobs.ts` — 28 jobs, 0 errors).

**1. The stale review screen — the big one.** Someone added a goal *after* the confirmation turn
and the coach could not re-offer the build: she said "I've got what I need, head to the review
section", which has not existed since the v2 redesign. Root cause was a one-shot design, in three
places at once. The pick protocol said of `layout: "confirm"` — **"use it exactly once"**; the
persona seed literally instructed her to "tell them they can head to Review to confirm and set
their rhythm"; and the client swapped the composer for a Build/Change **bar**, which by
construction can only exist once because it owns the bottom of the screen.

The ruling: **building a plan is something the coach DOES, in the conversation, as many times as a
plan needs building.** There is no screen to send anyone to and the protocol now says so in those
words. `confirm` is documented as her BUILD PLAN tool — repeatable, every intent — plus three
rules: *build is something you do, not somewhere you send them* (bans naming a screen), *reach for
it whenever building is the next thing* (a new goal, a changed goal, a different week, a lifted
constraint, "this is too much"), and *never leave a change agreed and unbuilt* — with the
corollary that a change is never described as done before they have tapped it. Talking it through
is the agreement; the card is the commit.

Client side the button moved **onto the card** (`ConfirmCard`) and the composer never disappears.
Two silent bugs died with the bar: "Change something" and "Did I miss something?" only called
`setInput`, so with the composer gone they prefilled an input that was not on screen and did
literally nothing — at the one turn where being ignored costs most. And the Coach tab never passed
`onBuild` at all, so "Build it" there was already dead; it now opens the whole-plan rebuild
(`AdjustSheet mode="rebalance"`).

**The trap in wiring the rebuild:** re-plan reads goals at `confirmed`/`committed`, but a goal the
Broker captured two minutes ago in chat is still `captured`. So the card would read "Write a novel"
back to them, they would tap Rebuild, and the week would return without it. Tapping build IS the
confirmation — the same thing onboarding's build does before it locks — so the coach's card path
sets `adoptCaptured` and promotes them first. Deliberately NOT set for the automated re-plans,
where nobody has agreed to adopt anything.

**2. Sign in with Apple "froze" — a gate with no exit.** The sheet closed, the identity linked,
and the app sat on the sign-up gate; force-quitting and relaunching landed on the plan. The screen
is chosen ONCE, in App.tsx's mount effect, from `stage === plan && anonymous` — signing up updates
the *session*, not the screen, so nothing ever moved off `gate`. Relaunching "fixed" it by re-running
the mount effect. Fixed with an effect keyed on `anonymous` going false (so Apple, Google and a
confirmed email all land the same way), and `isAnonymousSession` now lets a **linked provider
identity outvote a stale `is_anonymous` flag** — whether the token in hand already reflects the
link depends on when it was minted, and the one place this is read is the gate.

**3. Injury picks for a novelist.** Asked what they were working around, the coach offered "an
injury" to someone whose goal was writing a novel. The intake script hard-coded *"an injury, a day
that is always gone, a hard stretch"* regardless of area. The question stays the same; **the
examples now follow the goal.** Physical-first for movement/nourishment/body; for mind and practice
goals it leads with what actually blocks *practising* (no room in the week, nothing left by
evening, nowhere quiet, focus gone). A physical constraint is still real for a practice — wrists
for a writer or a musician, eyes for long study — so it goes **last, in those words, never as "an
injury"**. Same change in the persona.

**4. One daily writing task for "write a novel".** Too thin, and the existing shape rules did not
cover it: `MIND WORK SPLITS BY DEFAULT` handles breath/sit/journal, but nothing said a months-long
body of work has more than one kind of occasion. New `synthesize-plan` rule, **LONG-FORM WORK IS
MORE THAN ITS SITTING**: drafting stays the core and the most frequent, but PLANNING (outlining,
mapping the next chunk), INPUT (reading in the form, study) and REVIEW (revising what has
accumulated — also where they SEE it getting closer) each get their own activity, own day, own
`time_of_day`, never steps inside the drafting session. Someone who explicitly asked for one small
commitment still wins; absent that, one daily task for a novel is a reminder, not a plan.

**Unverified:** 3 and 4 are prompt changes. They are live and asserted by tests, but no live model
run has yet been watched producing a better novel plan or an area-fitted constraints question —
`probe-plan-shape.ts` is the natural place to add a long-form scenario.

### The quick picks you couldn't reach (device report, 2026-08-12)

"The options are available to select, but I can't actually get to them all, and they overlap with
the goals." Screenshot: a four-tile grid with only its first row visible, the second row behind the
capture pills, and the pills' label painted over the tiles.

Not a CSS problem — a **dependency problem in `useStickToBottom`**. The follow effect was keyed on
the turn array, and the last two things that grow the transcript both happen on renders where the
turns are already final. Quick picks are deliberately withheld until the stream ENDS (`livePicks`
returns null while streaming), so they mount on a `streaming` flip. The Broker's capture pills land
~900ms later again (`setTimeout(refreshCaptured, 900)`), on a fetch of their own, and they make the
floating stack taller — which grows the chat's reserved bottom padding underneath them. The effect
sat out both. The transcript stayed resting where the bottom *used* to be, so the newest content
was below the fold with nothing to suggest it was there.

**Fixed by following on every render** — a layout effect with no dependency array, the same argument
`useFloatingInset` already makes for its own measurement: every growth in this stack is caused by a
render, so a layout effect catches all of them, and catches them before paint. It is one property
read and one write, and the write is a no-op when already at the bottom. Every guard survives
untouched — a finger down, a scroll away, or the hands-off window all return before the viewport is
touched — so this cannot resurrect the can't-scroll-while-she-replies bug the rest of that file
exists to prevent. `useStickToBottom` no longer takes a `dep`, and is now declared AFTER
`useFloatingInset` in `OnboardingChat` so the follow scrolls against the padding that render
actually lands on rather than chasing it on a second pass.

Also deleted: `.chatscreen:has(.cappills) .chat { padding-bottom: 182px }`. A second hard-coded
allowance for the pills, dead since `useFloatingInset` started setting the padding inline (an inline
style beats any selector) and actively misleading — it read like the thing keeping the last turn
clear of the pills.

**Verified in the browser, not just in jsdom** (which has no layout, so geometry is unassertable
there): with a 4-tile grid and the pills present, the grid's bottom sat **302px behind** the floating
stack; after one render that changes no turn, `scrollTop` lands at the true bottom and the grid
clears the stack by exactly the intended 14px, all four tiles visible. The unit test was
mutation-checked — restoring the dependency array turns it red.

**Not verified:** the live conversation that produces this state. The local Devs.ai key returns 401
on v2 streaming, so the coach cannot reply on this machine; the reproduction drove the same React
render path with the picks and pills injected instead.

### Fallout: "start over" was not erasing everything

Purging the five test accounts by hand meant enumerating the schema, which is how this surfaced:
`DEV_CHILD_TABLES` in `services/dev-reset.ts` listed **15** per-user tables and the cadence schema
has **22**. Missing: `daily_checkins`, `device_tokens`, `health_digests`, `journal_entries`,
`notification_prefs`, `notifications`, `session_feedback`. That list backs BOTH `/dev/reset` and the
real-auth `DELETE /me/data` behind Settings' typed "start over" — whose own code comment promises it
"erases everything" and which purges Storage meal photos for exactly that reason. So a start-over
left someone's journal entries and Apple Health digests on the server while telling them they were
gone. Privacy-shaped, and invisible: nothing fails when a hand-maintained list drifts from the
`create table` statements it shadows.

**Fixed by reading the schema instead of remembering it.** `dev-reset.test.ts` parses
`migrations/cadence/*.sql` and fails when a table with a `user_id` column is not in the list (and
when the list names a table the migrations don't have). Deliberately parsing migrations rather than
querying Postgres: the DB-backed suites skip in CI for want of `CADENCE_*` secrets (see the Postgres
backlog below), and a guard that doesn't run where it matters isn't a guard. Verified by deletion —
dropping `journal_entries` from the list turns it red with the table named in the message.

**And the fix's own fallout, worth recording.** Completing the list took the reset from 17 sequential
round trips to 24, which pushed the three DB suites' 10s hooks over and turned a correctness fix into
red tests. The repair was not a bigger timeout: the child deletes now go as ONE simple-protocol query,
so the whole wipe is faster than the incomplete version it replaced (full API suite 98s → 58s). Two
details are load-bearing. **Separate statements, not one multi-CTE delete** — several of these tables
cascade into each other (`occurrences` from `activities`, `session_feedback` from `occurrences`) and
data-modifying CTEs share one snapshot, so a cascade racing an explicit delete for the same row is a
production failure that a small fixture would never show. **No explicit `begin`/`commit`** — the
driver rejects them outside `sql.begin` (`UNSAFE_TRANSACTION`), and they're unnecessary: Postgres runs
a simple-protocol query's statements in an implicit transaction. The id is interpolated (the simple
protocol carries no parameters), so `resetUserData` now throws on a non-UUID and the table names are
re-checked against `/^[a-z_]+$/` at module load.

**Still NOT account deletion, by design.** Start-over keeps the Supabase login and the copy says so.
Testing the first-install path — anonymous session, then the sign-up gate — still needs the auth user
deleted, which start-over will never do. The five auth users from this session's testing were removed
directly (`auth.users`, cascading identities/sessions/refresh tokens); note `cadence.users` has no FK
to `auth.users`, so the two deletions are genuinely independent. Also unfixed: `purgeMealPhotos` needs
`CADENCE_SUPABASE_SERVICE_ROLE_KEY`, absent from local `.env`, so a local hand-purge leaves Storage
objects behind even though the server path handles them.

## Present-then-discuss: the plan becomes something you talk through (owner design session, 2026-08-12)

The novel report distilled to one line: **"I pay a coach for the COACHING"** — and today the
product's entire contribution is a schedule, which is the one part the user could have written
themselves. The whys are tautologies (the prompt caps them at 20 words, which only buys a
restatement), the coach gathers but never reasons out loud, and nothing ever presents the plan's
rationale or invites pushback. Meanwhile the sign-up gate asks for an account in exchange for
*storage* ("Save it") when it could offer the far stronger thing: the conversation.

### The settled flow (all owner-ruled this session)

```
gather      pre-login · short turns · quick picks · unchanged
synthesize  now includes ADJACENT activities + a real RATIONALE + uncapped whys
present     a rendered card: the week + her reasoning (tap to reveal) · pre-login
gate        "sign in and let's talk it through" — the ask is for the dialogue
discuss     coaching register · the math · reframes · swap adjacents
rebuild     the build card → plan v2 (shipped earlier today)
```

Rulings, verbatim intent:
- **Phases, not per-turn register-switching**: gather info first (short, tappable), THEN coach.
  "That's actually what most of my coaches have done." One carve-out: a genuine question mid-intake
  ("why reading in genre?") gets a real answer — that's not a phase, that's not being rude.
- **Adjacents are proposed by the coach AS PART OF THE PLAN** (activities in synthesis, not goals,
  not a post-hoc top-up step), then discussed/swapped after login ("I don't really feel comfortable
  with meditation, but walking my dog is where my creativity really gets flowing"). A real coach
  always recommends adjacent practices; a plan without them is why the novel week felt thin.
- **The reframe: practice-as-goal, deliverable-as-milestone.** "The novel is a goal, but
  intrinsically it's a milestone. The real goal is to become an author. Once you're an author, you
  just write." This DISSOLVES the parent/child persistence problem — no cascade, no orphaned
  children; you tick the milestone and the practice carries on, which is "never resets to zero"
  falling out of the data model for free. The coach OFFERS the reframe (never performs it — their
  words for their goals), and the schema already supports it: `type: 'recurring'` + `milestones[]`.
- **Present = a rendered card, reasoning behind a tap** ("I could potentially click something to
  see the reasoning"). Two levels: plan-level "why this shape" (the arithmetic, the phases — the
  part that earns the signup) and per-activity "why this?". Design is iterating on the existing
  surfaces (brief handed over; LockStep.tsx already renders grouped commitments + whys and is
  orphaned in the Settings wizard — this is iteration, not invention).
- **Gate stays where it is; commit stays collapsed.** No draft/preview un-collapsing — the gate's
  week grid reads committed occurrences, "committed ≠ locked" is already the product's language,
  and a discussion that changes things just produces v2 via the rebuild card. The draft state was
  ceremony. (`plans.status` already permits `'draft'` if this is ever revisited.)
- **Post-login = the discussion, and it IS the MQL payoff**: "Coach has built your plan, login to
  chat through the plan and customize it with them. What makes me want to give you my information?
  You have something to give me and we already worked on it together."
- **Coaching register cap**: none once discussing, but phone-shaped — "some LLMs give you a novel
  to read and you have to write one in return." No bullets/markdown, one question per turn.
- **"Morning pages" is internal jargon** — never Cadence's own vocabulary. One real leak:
  `tool-catalog.ts` journal guidance teaches her the phrase as an example.

### Implementation plan

**Phase A — data + synthesis (unblocks design; no UI dependency).**
1. Migration `0031_plan_rationale.sql`: `plans.rationale text not null default ''`,
   `activities.suggested boolean not null default false`.
2. `synthesize-plan` prompt: (a) ADJACENTS — 1–2 supporting activities per goal where a real coach
   would add them, domain-fitted (research/focus work for a writer; never body-domain work bolted
   onto a non-body goal — the injury-question lesson), `goal_title` set to the goal they SUPPORT
   (so grouping and coverage attach them), `"suggested": true`, and an explicit honor-clause for
   "one small commitment"; (b) `"rationale"` — the coaching reasoning behind the whole shape:
   the arithmetic when the goal has numbers (hedged as "roughly/about"; NEVER a rate outside the
   habits-you-won't-build bounds — a spoken/written projection is a new surface for those, cover it
   explicitly), the phases (draft → revise), why each adjacent earns its slot; (c) `why` uncapped:
   1–3 sentences that EXPLAIN (what it is, why it's here, how it ladders) — the 20-word cap is
   what forced "Study novels and craft to fuel your writing".
3. Code: parse `rationale`/`suggested` in `plan-synthesis.ts` (raise the silent `slice(0, 160)`
   why-cap in `shapeActivity` — uncapping the prompt without this truncates invisibly); thread
   `rationale` through `SynthesizeResult`/`PlanFlowResult`/`PendingPlan` (broker-contracts.ts) →
   `commitActivities` → `insertPlan`; persist `suggested` in `insertActivities`; expose
   `rationale` + per-activity `why`/`goal_title`/`suggested` in `buildPlanView` / GET /plan
   (`PlanViewActivity` today carries NONE of these — the card would have nothing to render).
   Both synthesis paths share `runSynthesize`, so fan-out inherits the parse; the reduce may dedup
   colliding adjacents (correct) and its rationale is the one kept.
4. `tool-catalog.ts`: replace the "morning pages" example with non-jargon phrasing (catalog is
   runtime-injected — no job sync needed).
5. Sync jobs; verify LIVE with a read-only probe (novel scenario) — jobs run remote against prod
   AI Admin, so this is testable locally; only coach CHAT isn't.

**Phase B — present + gate (with design; they have the brief and repo access).**
6. Merge LockStep-style grouped content into `SignUpGate`: goal-grouped commitments with whys,
   plan rationale behind the reveal, suggested-rows distinguishable, new copy ("sign in and we'll
   talk it through" — the offer, not the toll). Functional structure ours; visuals design's.
   Card renders COMMITTED data via GET /plan (commit precedes the gate) — hence Phase A first.
7. `AuthScreen` upgrade-mode CTA copy to match. Keep honest: the week is saved either way.

**Phase C — the discussion.**
8. Routing: after gate-upgrade (and after building, for the already-signed-in) land MainTabs on
   the COACH tab with a one-shot walkthrough nudge (App-level flag → MainTabs prop →
   `nudge()` — the `HEALTH_SHARED_NOTE` pattern). The persona's ongoing-intent walkthrough has
   never fired because nothing ever routed there. Verified: the onboarding thread goes stale as
   'graduated' after commit, so the discussion starts on a fresh `ongoing` thread — no intent
   mismatch. Fallback when the flag is lost (app killed first): the canned greeting, documented.
   Already-signed-in users skip the card entirely — it is a conversion device; the coach presents
   conversationally instead (she has the same data).
9. Persona: the two registers (gather short; coaching turns fuller, phone-shaped, no lists, one
   question); goal math out loud with the same safety bounds as planning + simple rounded
   arithmetic presented as approximation; the reframe move; walkthrough wording adjusted for
   card-first arrivals (they've SEEN the week — discuss it, don't re-recite it).
10. Pick protocol: proposals that restructure (the reframe, an adjacent swap) must compose their
    FULL content into the pick's `say` — the user's send then carries the specifics in a User:
    line, so the Broker's who-said-it rule captures it without loosening (a bare "yes" to a coach
    proposal deliberately captures nothing; the pick text is the elegant way around).
11. `capture-extract`: add optional `milestones: [{label, target_date}]` per goal (mirror the
    0008 shape). The MERGE side already handles milestones (`capture-goal-merge.ts`) — only the
    Broker's output schema fails to emit them; without this the affirmed reframe loses its date.
12. Sync persona + jobs; live-test the conversation on the phone build (chat can't run locally).

**Phase D — verify + close.** Long-form scenario in `probe-plan-shape.ts` (weekly CI, never a
merge gate); PLAN.md updates; scratch-account cleanup after live tests.

### Data contract for the card (design builds against this, lands in Phase A)

```
GET /plan additions:
  rationale: string                    — plan-level "why this shape" (2 sentences … 2 paragraphs)
  activities[].why: string             — 1–3 explanatory sentences (no longer 20-word stubs)
  activities[].goal_id?, goal_title?   — grouping ("Toward Write a novel"; null → Foundations)
  activities[].suggested: boolean      — "she suggested this" vs "you asked for this"
```

### Gotchas (found while planning, so nobody re-finds them)

- **Commit precedes the gate**, so the card reads persisted data — `note` today is returned in the
  HTTP response and NEVER stored; anyone bouncing off the gate and returning would get a card with
  no reasoning. The `rationale` column is mandatory, not nice-to-have.
- **`shapeActivity` silently truncates `why` at 160 chars** — uncapping the prompt alone would be
  invisibly undone at the exact moment the text got good.
- **The rationale is unauthenticated-visible model text.** Render as plain text only, and the
  safety bounds live in the PROMPT because no human reviews it before a prospect reads it.
- **WHO-SAID-IT vs the reframe**: the Broker (correctly) refuses to capture a coach proposal
  affirmed with a bare "yes". Don't loosen the rule — route the content through the pick's `say`.
- **Walkthrough nudge repetition**: one-shot flag, and the persona's own guard ("committed today
  or in the last couple of days AND a fresh conversation") bounds the blast radius.
- **synthesize-plan carries no expectedSchema** (it's not on the native-schema list), so adding
  `rationale`/`suggested` keys is backward-compatible lenient-parse territory — absent → defaults.
- **Cost/latency**: richer output roughly doubles synthesis tokens; the building screen already
  says "a couple of minutes", and the spend lands at the single highest-value moment.

### Open questions (owner)

1. `suggested` badge post-commit too (Week/Today views), or card-only? (Persisting it either way.)
2. Reframe capture (milestones in capture-extract) rides in Phase C as written — or defer to its
   own PR if Phase C runs long? The discussion loses data without it, so deferring means shipping
   the discussion after it, not before.
3. ~~Gate + CTA copy~~ — RESOLVED (owner, 2026-08-12): headline **"Here's my proposed plan"**,
   framing **"Sign in and we'll talk it through"**, button **"Signup and we'll tailor it"** (the
   upgrade-mode auth button — it attaches an identity to the anonymous session that owns the plan,
   so "signup" is the honest word for the primary path). Ships with Phase B.

### Phase A — SHIPPED and live-verified (2026-08-12)

Migration 0031 applied (`plans.rationale`, `activities.suggested`); rationale + suggested threaded
through both synthesis paths → pending_plan → commit → GET /plan (contract types updated web-side
too); the 20-word why cap replaced with EXPLAIN-DON'T-LABEL (code backstop raised 160→600 — the old
slice would have silently undone it); ADJACENT SUPPORT + PLAN RATIONALE prompt blocks synced; the
"morning pages" example dropped from the tool catalog ("a first-thing morning brain-dump").
81 files / 777 tests green; lint clean.

**Live-verified per pillar** (read-only probes against prod AI Admin — the owner's steer: the novel
was the *novel* case, this has to work regardless of goal):

- **Practice (novel):** rationale does the honest math — "roughly 80,000 words; four mornings a
  week at around 500 words a sitting puts you near 40,000 by year's end… finishing might extend
  into early 2027, and that's a real novel timeline, not a failed one." Reading-in-genre now
  EXPLAINS itself ("tunes your ear for pacing and dialogue… permission to call reading work") and
  carries [SUGGESTED].
- **Nourishment (unsafe timeline):** 30 lbs in 7 weeks → "I need to say this plainly… that's twice
  the safe rate" → right-sized to ~2 lbs/week with the reunion still honored (~14 lbs by the date,
  "still going strong after it"). The safety extension to SPOKEN/WRITTEN projections works.
- **Movement (marathon):** no meal logs bolted on (the FOOD-LOG conflict was real — first probe
  category, patched: food support for training is a conversation to raise, never a silent
  schedule); [SUGGESTED] runner strength & mobility with a mechanism-naming why; 14-vs-16-week
  timeline pressure-tested; week one built FROM the stated 20 km floor.
- **Mind (burnout):** the domain rule needed its second patch — "never body work on non-body
  goals" overcorrected; now body ADMIN is banned (weigh-ins, logs, measurements) while gentle
  movement as mood support is allowed. Probe: [SUGGESTED] evening walk framed exactly that way,
  load light, discovery framing, no admin.

**Found live, fixed live:** the vet↔adjacents collision (flagged in the plan as a dry-run item)
fired on the first probe — a 60-min core + 10-min support stacked into a single 60-min morning
window drew a veto. Fix on the synthesize side (FIT THE TIME THEY GAVE YOU: support shares the
core's budget or moves days), which is the brand-true reading — honor the time they actually gave.

**Watch items:** one probe rationale mentioned weather ("clear and warm this week") — plausibly
real API weather via the dev account's home_location, but if it recurs on accounts with no
location, the no-invented-weather rule needs reinforcing. Model coined "Evening pages" as an
activity title in the mind probe — the catalog no longer teaches the term, but the model knows it
from the world; watch, don't chase. Dev-account ai_log rows from the probes get cleared by the
normal post-merge `cleanup:test-data`.

Next: Phase B (the card — design has the brief, the approved copy, and now real data behind
GET /plan), then Phase C (routing + persona registers + reframe capture).

### Phases B + C — SHIPPED (2026-08-12, autonomous per owner: "continue with the next phases")

**Phase B — the card, from design's file.** Design delivered "Cadence Plan Card Gate" (claude.ai
/design project) and it was implemented as specced: `SignUpGate` is now the plan card — week strip
with AREA-coloured dots (server now sends `area` per activity, from its goal), the plan-level
rationale as HER SPEECH BUBBLE (collapsed = her first words clamped to two lines + "See my
thinking ▾"; a cut sentence sells continuation, a chevron sells furniture), per-activity whys as
quoted italic insets (whole row = tap target; rows stay put when one opens), suggested rows with
the hollow dashed dot + MY ADDITION chip, "Toward <goal>" headers only at ≥2 goals, and the
sparse rule (≤2 activities → everything arrives open). Auth is a pinned footer: coach line ("Sign
in and we'll talk it through — push back on any of it"), providers untouched, email folded behind
"or continue with email" (`AuthScreen compact` — same logic, nothing forks; provider errors render
OUTSIDE the fold so a closed form can't eat an already-taken dead end). Email CTA = the approved
"Signup and we'll tailor it →".

New: `features/gate/` (planCard.ts helpers + WeekStrip + RationaleBubble + PlanReasonRows, each
its own file per the size rule), `styles/gate.css`, and `?preview=plancard` (+`&state=sparse|dense`)
— the gate sits behind a full onboarding run, so the preview harness is how its states get looked
at. All three states verified in-browser at phone width: collapsed/open bubble, long+short whys,
chip, headers, folded email unfolding to the CTA, no horizontal overflow.

Divergences from the design file, both deliberate: the ghost "not yet" row (frame 4) needs data
synthesis doesn't emit — logged below as an open follow-up, not silently skipped. The draft-expiry
line ("I'll keep this draft for 7 days") states a behaviour that doesn't exist; shipped copy says
only what is true ("No account needed yet — this draft lives only on this phone"). Expiry itself
stays the design's open proposal. Design's headline ("Here's the rhythm I'd build — and why.")
was kept over the earlier-approved "Here's my proposed plan" — design iterated with full context
and the owner forwarded the file as the spec; flagged for veto regardless.

**Phase C — the discussion actually happens.** The persona's walkthrough has been scripted since
v2 and never once fired — nothing ever routed there. Now: leaving the BUILDING screen (signed-in)
or the GATE (by signing in — including the resume path, app killed at the gate and reopened) lands
MainTabs on the COACH tab, and OnboardingChat fires a one-shot walkthrough nudge into the fresh
post-graduation thread. TWO notes, because there are two honest arrivals: 'card' (they SAW the
week + reasoning at the gate — never re-list, go straight to pushback) and 'fresh' (signed-in
users skip the gate and the card entirely — she presents conversationally first). Not persisted
by design: killed before the coach tab opens → next launch lands on Today as ever.

Persona (synced, verified live): the TWO REGISTERS — gathering (short, one question) vs coaching
(walking a plan, answering why, doing the math, right-sizing, reframing: a paragraph or two,
phone-shaped, never trading essays) — switched by what the turn is FOR, not by phase; "Coaching
the math" (arithmetic out loud, rough/rounded/hedged, spoken projections bound by the same limits
as plans — an unsafe rate is never spoken as an option); the REFRAME move (the goal behind the
goal: deliverable = milestone on a practice that outlasts it — always OFFERED, never silently
restructured); the ongoing-intent card-arrival exception.

Pick protocol (synced): A PROPOSAL IS CAPTURED FROM THEIR SEND — restructuring proposals attach a
pick whose `say` spells out the whole arrangement, because the Broker's who-said-it rule
(correctly) captures nothing from a bare "yes". capture-extract (synced, schema + prompt): goals
may carry `milestones [{label, target_date}]`, user-stated only, milestone-inside-the-goal never
a separate goal; `capture-goals.ts` mints the `id` each milestone needs (every other writer is
the client, which mints ids at creation — consumers key on them). **Live-verified end to end:**
the reframe conversation, accepted via a pick-composed user line, captures as `type: recurring`
practice + milestone "Novel finished" @ 2026-12-31 — exactly the owner's data model ("the novel
is a goal, but intrinsically it's a milestone").

**Phase D:** long-form scenario added to `probe-plan-shape.ts` (≥3 occasions for a novel goal —
"a reminder, not a plan" is now a flagged failure) + a rationale-presence check on every scenario
(the card renders it to a prospect; a plan without one ships an empty "See my thinking"). **Run
live, all four scenarios behaved** — including the two interactions most at risk from the new
prompt rules: `minimal` stayed at ONE commitment (the adjacent-support rule's honor-restraint
clause held against padding), and `strength` gained a hip-mobility adjacent WITHOUT its lift
session shattering. Probe hardening rode along: `CALL_TIMEOUT_MS` 120s→240s (the richer synthesis
output blew the old ceiling twice — a ceiling the happy path can hit turns the retry into a
crash), and a scenario that errors now flags-and-continues instead of killing every scenario
after it.

**Open follow-ups:** the ghost "not yet" row (needs a `deferred` concept in synthesis output —
design's best idea, not free); draft expiry (product call + real machinery); design's headline vs
the earlier-approved one (owner veto pending); walkthrough nudge fires only on the arrival session
(accepted limitation, documented in App.tsx).

### Device test round 2 → the half-deployed diagnosis, and the guided hand-off (2026-08-12, evening)

The owner ran the full flow and reported five items. The diagnosis reframed four of them: **the
phone talks to the DEPLOYED cadence-api (ai-manager-cadence-api-2f4j.vercel.app), built from
origin/main — every API-side line of the present-then-discuss work was uncommitted local code.**
The web bundle was new (routing worked) and the prompts were live in AI Admin (responses got
longer — the model even emitted the adjacents: the owner's Spartan plan contained "Prehab &
mobility – knee and elbow", but the deployed `shapeActivity` DROPS the `suggested` flag it rode
in on, so nothing was marked as her addition), while GET /plan served no rationale/whys/areas —
the design card rendered starved, reading as "the old UI". **None of the API work exists for
users until it ships through main.**

The one genuinely new bug, found from the report's exact symptoms: `recoverFromServer` — the
SSE-drop healer — ignored `stale`. The post-signup walkthrough nudge's first call died against a
cold Vercel lambda → recovery resurrected the GRADUATED onboarding thread (confirm card and all)
and silently re-pointed the session at it: "I felt like nothing happened; I just logged in."
Verified locally that graduation computes TRUE on the owner's exact rows — the server said fresh,
the healer overrode it. Fixed: recovery refuses stale threads, and a failed app-initiated note
(echo=false) now retracts its pending bubble instead of erroring at someone about a message they
never sent.

**Owner rulings implemented:**
- **Landing (replaces land-on-Coach after one day):** land on TODAY — "landing on the actual plan
  was more effective" — with a guided overlay: scrim over the whole shell, her callout ("I built
  your plan — head to the Coach tab and we'll fine-tune it together"), and ONLY the Coach tab
  tappable (lifted above the scrim + pulse ring; doubles as the app's one navigation lesson).
  Tapping it dismisses the guide and fires the walkthrough. Browser-verified.
- **The plan card is one surface with several hosts:** extracted `PlanCardView` from the gate;
  new `PlanCardSheet` opens it OVER the coach conversation with a toggle back — shown
  deterministically when a rebuild commits (the result appears where it was agreed), and always
  reachable via a "Your week ↗" pill in the coach tab. "Viewable anywhere in the app" beyond
  these hosts stays open.
- **Adjacents are the DEFAULT, not an option** ("nobody will come back to this app for a single
  button a day. Nobody will buy it"): prompt strengthened from "consider" to ADD-by-default, with
  exactly two skip reasons (explicitly-asked-minimal, week genuinely full) and "zero suggested
  support should be the rarity". Synced.
- **Depth over speed in intake:** persona — "staying superficial to stay short is the worse
  failure"; protocol — the narrowing cap is a SCHEDULING budget, understanding the goal (history,
  what stopped them, what the thing demands) is a worthier one repetition-bounded, not
  depth-bounded. Synced.
- **Backlog:** saved chats with a history toggle (owner item 4, future iteration).

**The blocker for everything server-side: ship main.** Rationale/suggested/area on GET /plan,
the graduated fix's client half, milestone capture plumbing, the reset completeness — all inert
for real users until the branch lands and Vercel redeploys.

### Device test round 3 — the tripled goal, and the doom-scroll contract (2026-08-13)

The card worked (rationale bubble, MY ADDITION, whys, headers — all live on device). Two problems:

**1. Goals multiplied.** The account ended with THREE Ultra Beast cards ("Run an Ultra Beast
Spartan Race" / "Run a Spartan Ultra Beast" / "Spartan Ultra Beast" — the third inserted minutes
AFTER commit, by the walkthrough conversation's capture) and TWO weight cards ("Drop weight to
improve race performance" / "Lose weight"). Five goals → the fan-out drafted five → 29 activities,
two weigh-ins, eight meal logs — and a ~4-minute build. Three distinct failures, three fixes:
- **"a" ≠ "an".** The word-containment test shared every content word of the two Run titles and
  failed on the article. `normTitle` now folds "an" into "a" — a normalization, not a loosening;
  every keep-apart guard in goal-identity.test.ts still holds.
- **The confirmed-goal filter was identity-strict** ("Run a 10k this spring" beside a confirmed
  "Run a 10k" was 'a more specific goal the user is entitled to state separately') — and that
  strictness is what let capture mint a third copy of a COMMITTED race. Ruling reversed:
  `selectCapturedGoals` now uses full `sameGoalTitle` containment against confirmed titles; adding
  a genuinely new dimension to a committed goal is a coach conversation + rebuild card, never a
  silent second card.
- **"Lose" vs "drop" is meaning, not spelling** — no synonym-free matcher can see it, by design.
  Fixed at the source: capture-extract now receives `<current_goal_cards>` (every captured/
  confirmed/committed title) with a TITLE ANCHORING rule — re-expressions of an existing goal must
  reuse its exact title, character for character. The lexical matcher stays the backstop. Synced.

**2. "Building a plan takes forever… normally I'd navigate away and get a notification."**
Two halves. SHIPPED — leaving is now safe: `useBuildPlan` was a client-orchestrated three-call
pipeline (confirm → preview → lock), and iOS suspending the app killed it between steps. It is
now ONE self-sufficient server call (`lockPlan` confirms + synthesizes + commits server-side, and
the serverless invocation runs to completion whether anyone is listening); a dead fetch POLLS for
the committed plan for up to 5 minutes instead of declaring failure. The building screen says so:
"you don't have to watch me work — leave the app if you like." Dedup also directly attacks the
latency: five goals was ~double the work of the real two.

NEXT (specced, not built) — **the push**: "your week is ready 🎉" via APNs when commit lands. All
plumbing exists (push-apns.ts, device_tokens, notify/); the missing piece is PERMISSION — the
first build happens pre-signup, so no push permission has been asked. The natural moment is the
building screen itself ("Want a ping when it's ready?"), which needs a small permission card +
token registration there, and a post-commit send hook in confirmLock. One increment, mostly UI.

Account purged again (5 goals / 29 activities / 206 occurrences; auth back to zero) for a clean
round 4.

### The push, and leave-safety everywhere (2026-08-13, owner: "that's the bigger problem")

Every long model call driven from the phone had the same disease the build had — iOS suspends the
webview, the fetch dies, the app calls it a failure while the server finishes the work. Fixed as a
CONTRACT now, per surface:

- **The build** (previous round): one self-sufficient server call + poll-for-committed.
- **Coach replies + the walkthrough nudge**: GET /coach/current now reports `generating` (from
  0029's in_flight_response_id — the relay drains dropped streams to completion, so the server
  KNOWS). Recovery is patient: quick polls for ordinary blips, then as long as the server says
  "still writing" it keeps waiting (2 min ceiling) instead of the old fixed ~5s that told someone
  their connection dropped while the reply was arriving fine. Still refuses stale threads.
- **The rebuild preview** (AdjustSheet): previewReplan persists pending_plan the moment synthesis
  finishes; new GET /plan/replan/pending lets a dead fetch poll for the stored proposal (3 min)
  instead of reporting a failure — or re-paying for synthesis.

**The push — "your week is ready" — SHIPPED.** Server: confirmLock sends APNs on FIRST commit only
(version 1; a rebuild is agreed in a live conversation, and pinging the phone in their hand is
noise), best-effort, never able to un-commit anything. Client: the building screen asks — "🔔 Ping
me when it's ready" — because the wait is the one moment the permission's value is self-evident;
the enable dance is extracted (enablePush.ts) and shares PushToggle's token key + prefs flag, so
Settings tells the truth about the answer wherever it was given. Denied is respected quietly.
Copy: "Your first week is ready / Come take a look — and push back on anything."

## Round 4 + the architecture ruling: the coach gets hands (2026-08-14)

Owner: "Coach should always appear to be aware of the previous conversations... know about the
workouts a user has had, even before the user has told the coach... They should be like a real
coach. And obviously they should be able to read, create, modify, or completely change a routine
at any time when in consultation with the user. **Even if this means changing our architecture...
or improving it.**"

### The diagnosis: every big-one failure is ONE disease

The coach is a narrator over injected context. The app GUESSES what she'll need (pack-select),
writes down what she said after the fact (the Broker), and renders her formatting conventions as
UI (the picks fence). Each round-4 failure is that shape failing somewhere:
- She asked for a weight captured 15 minutes earlier → the guess was wrong (pack built at 07:41,
  weight landed 07:56, `users` writes never invalidated the pack, and pack-select had CHOSEN a
  function list without get_weight).
- "Coach can't update the plan at all" → she has no read on plan state ("Fix nutrition" sat
  `confirmed` and unplanned, invisible to every context block).
- The build "popup" and missing pick buttons → her only ways to act and to render are
  conventions she may or may not follow, with no affordance the app can rely on.

### Shipped now — retrieval-first hardening (the current architecture, made honest)

- **Migration 0032**: `cadence.users` gets a pack-touch trigger (its own BEFORE-trigger function —
  0022's reads `new.user_id`, which users doesn't have), conditional on the dossier-real columns
  (baseline, name, macro_targets, dietary_profile, home_location, timezone) so streak/pending
  churn can't kill pack reuse. Probed live: a baseline write moves the watermark.
- **get_weight is MANDATORY** in every pack, beside identity + constraints — body facts cost ~20
  tokens and their absence costs "never makes you repeat yourself"; that is not a trade a model
  gets to optimize. `get_health_history` joins the ongoing fallback: a coach who must be TOLD
  about workouts her own tools recorded is the owner's failure, verbatim.
- **The plan-gap healer** (`planGapNote`): agreed-but-unplanned goals ride every non-onboarding
  pack — "Agreed but NOT YET IN THE PLAN: … raise it yourself, end that turn with the build card"
  — until built or let go. Heals the stranded round-4 state and every future dismissed rebuild.
- **Persona**: NEVER RE-ASK A FACT THE SYSTEM HOLDS — check the dossier first; if absent, say
  "let me check your file" (the app retrieves); ask the user only when retrieval comes back empty.
- **The density hard line, in code**: `plan-density.ts` measures the synthesized week (round 4
  measured MO-TH 2, FR 1, SA 2, SU 1 — with adjacents working); when most active days hold <3
  user items, ONE repair synthesis adds anchored 5-10 min routines (post-coverage, re-vetted,
  never looped; unchanged-on-minimal accepted; found+fixed en route: coverage recovery never
  reassigned `normalized`, so density would have re-vetted away recovered goals).
- **Intake asks about other habits to keep on the rhythm** (owner suggestion) — each yes becomes
  an anchored routine, not a goal. **Picks are for every conversation** (protocol: the ongoing
  chat asked its questions bare on device). **Tabs**: Today+Week → one **Plan** tab, day/week
  toggle inside PlanView. **Travel**: on load, a silent location re-check; >50 km of real
  movement updates home location (+ timezone, + reverse-geocoded label).

### The north star: the coach as a governed tool-user (the architecture change)

The owner's "MCP to our database" instinct is right, and the migration is INCREMENTAL because the
semantic layer already exists: `retrieval/registry.ts` is a governed function catalog the app
executes — today only the app calls it, on a guess. The change is to let the COACH call it, in a
tool loop the AI Admin relay owns:

1. **Read tools** = the existing registry (identity, plan, weight trend, health history,
   consistency, goal progress, past conversations). She pulls what the turn needs instead of the
   app pre-guessing — "let me check your file" becomes literal.
2. **Act tools** = the plan verbs, still suggest-never-auto-apply: `propose_plan_change(steer)`
   returns a vetted preview the CLIENT renders as the crafted card; committing stays a user tap.
   Read any time; write only in consultation — the owner's sentence, as an API.
3. **Show tools** = picks and the plan card stop being formatting conventions and become calls
   the app renders deterministically — the round-4 "no buttons" class dies structurally.
4. **Governance unchanged**: every tool call logged in AI Admin beside the jobs (the CLAUDE.md
   auditability contract), the registry stays the only DB surface, constraint safety stays in
   the vet.

**Open dependency to verify first**: Devs.ai v2 function-calling through the in-process SSE relay
(the relay must intercept tool_call events, execute app-side, and continue the stream). If v2
cannot, the fallback is a relay-side loop over structured pause-turns — same contract, more
plumbing. Verify before building anything on it.

**Sequenced next** (each useful alone): ① proposal-as-card — the rebuild PREVIEW renders as the
design card (AdjustSheet still shows the old list; this is the remaining half of round 4's "not
our new screen"); ② the build card carries the coach's own `steer`; ③ the tool loop, reads
first; ④ write tools behind it.

### VERIFIED: Devs.ai v2 function-calling — the tool-loop coach is GO (2026-08-14)

Probed LIVE through AI Admin (`probe-tool-loop.ts`, kept as the regression probe; e2e entities
created and swept). Three findings, in descending certainty:

1. **The upstream half works.** Tool definitions ride the v2 request; the model — the coach's own
   `anthropic-claude-4-5-sonnet` — emitted a genuine `function_call` (`echo_word`, a `toolu_*`
   call id) in the response output. Better still, AI Admin already SHIPS the whole feature
   surface: `ai_profiles.config.toolJobs[]` exposes processing jobs as tools
   (`tool-jobs.ts`/`tool-fulfillment.ts`), the SSE ingestion accumulates function_call events
   (`v2-stream-events.ts`), and the HTTP route layer drives fulfillment + continuation
   (`runInternalToolJobLoop`, MAX_TOOL_ROUNDS). It had simply NEVER RUN — zero profiles have ever
   declared toolJobs, which is exactly why finding #2 survived to be found.

2. **The continuation half is broken, precisely.** The v2 response arrives `"status":"completed"`
   WITH the function_call in its output; `submitV2ToolOutputs` then calls
   `POST /responses/{id}/resume` on a TERMINAL response → `409 "Response … is already terminal"`.
   The resume endpoint evidently serves paused/interactive tools, not completed-with-function-call
   responses. Fix candidate: issue a NEW response threaded via `previous_response_id` carrying
   `function_call_output` input items — the threading metadata plumbing already exists for normal
   turns. Whether Devs.ai accepts function_call_output inputs is the one remaining unknown, and it
   is answered by implementing the candidate and re-running the probe.

3. **The Cadence gap is exactly where predicted.** `sendChatMessage` (the in-process entry the
   coach relay uses) already attaches tool definitions from the profile — but the loop DRIVER
   lives in the HTTP route layer Cadence bypasses. `relayAndAccumulate` has no tool handling: a
   coach profile with toolJobs today would stream function_call events through unfulfilled. The
   port = drive the exported loop pieces from the relay.

Also learned: tool parameter schemas come from `job.config.variables[]` (NOT template scanning) —
the probe's minimal job declared none, so the model was correctly offered a parameterless tool and
called with `{}`. Coach tool jobs must declare their variables.

**Sequenced tool-loop increment**: ① fix the continuation (new-response + function_call_output;
re-run the probe to all-green), ② drive the loop from Cadence's relay, ③ first read tools from
`retrieval/registry.ts` as tool jobs with declared variables, ④ act tools behind it.

### Tool-loop continuation FIXED and probed ALL GREEN (2026-08-14, #190)

`/resume` replaced with the Responses-dialect continuation: a NEW streamed response threaded on
`previous_response_id` carrying `function_call_output` items keyed by the model's own call_id,
tools re-attached for chaining (`toolOutputsToV2Request` — shape pinned in tests —,
`DevsAiV2Client.continueWithToolOutputs`, `submitV2ToolOutputs` switched). Probe re-run against
the deployment: function_call ✓ · arguments filled once the job declared `config.variables`
(`{"word":"pineapple"}`) ✓ · continuation streams clean, no 409 ✓ · final answer carries the
result ✓. Port note for the relay work: `message.complete` events carry EMPTY text — the reply
rides deltas. E2E entities swept (3 sessions, 3 profiles, 1 job).

**The tool-loop coach's foundation is now fully verified.** Next: drive the loop from Cadence's
`relayAndAccumulate`, then read tools from the retrieval registry (with declared variables).

### The tool loop is IN THE RELAY — the coach can check the file mid-reply (2026-08-14)

Increments ② and ③ of the sequenced plan, shipped together: the coach's turn is now a bounded
tool loop inside Cadence's own relay, and its first tools are the retrieval registry's read
functions. "Let me check your file — one sec" is literal.

**The wire (engine → relay):** `sendChatMessage` accepts `extraTools` (merged into the profile's
tools in both v1 and v2 request paths — `chat-messaging-stream.ts`); core exports
`extractFunctionCallsFromOutput` + `submitV2ToolOutputs` for the in-process consumer. Cadence's
`sendCoachMessage` attaches `coachToolDefinitions()`; `submitCoachToolOutputs` wraps the #190
continuation.

**The tools (`coach-tools.ts`):** ten zero-arg reads over `RETRIEVAL_FUNCTIONS` — identity,
objectives, active plan, consistency, constraints, weight, equipment, dietary profile, health
history, goal progress. Governance unchanged BY CONSTRUCTION: same registry (the model still
never touches the DB), same `executeCalls` path as the pack (same logging/provenance,
`logLabel: 'coach-tool'`), and the model receives each function's own `render()` — a fact reads
identically whether it arrived by pack or by call. Empty render → "(nothing on file for this
yet)" so the model says so instead of re-asking. READ-ONLY on purpose; act tools
(`propose_plan_change`, suggest-never-auto-apply) are the next increment.

**The loop (`coach-tool-loop.ts` + `coach-stream.ts`):** `relayCoachTurnWithTools` pumps rounds
of `relayAndAccumulate` over one accumulate state. Each round: collect completed
`function_call`s off `message.complete.output` (the probe's port note — text rides deltas, calls
ride output), fulfill the ones whose names are ours, submit as a #190 continuation threaded on
that round's `currentResponseId` (first-seen `responseId` still names the turn for logging;
`onResponseId` re-fires per round so Stop always targets the response generating NOW), pump the
next stream to the same client connection. `MAX_COACH_TOOL_ROUNDS = 3`; a model that keeps
calling gets its last stream as the answer; execute/submit failures end the turn with what
streamed. **The terminal contract is the sharp edge:** the web client resolves the whole turn on
the FIRST `data: [DONE]`, so every round runs `suppressDone` (line-wise forward, upstream
terminals held back) and only the loop writes the one real terminal — in a `finally`-shaped
tail, whatever happened above. Hermetic tests fabricate the probe-captured stream shapes and pin
all of it: single-[DONE], continuation stitching, per-round response-id threading
(`r1→r2→r3`), unknown-name passthrough, cap, failure tail.

**Persona nudge (synced with the deploy):** the memory paragraph's retrieval promise flipped
from passive ("the application will inject") to active — check the dossier first, then CALL THE
FILE TOOL in the same turn; ask the user only when the tool comes back empty; tools are how you
check, never a thing you name, and never an excuse to recite the file.

Answers the round-4 ruling's read half ("coach should always appear aware… like we need an MCP
to our database — or coach asks broker to retrieve before asking the user": it now asks the
registry itself). Live verification is the next device conversation — coach chat has no local
harness. Remaining from the ruling: act tools (propose/modify plan in consultation), the rebuild
preview as the design card.

### The coach reads YOUR logs too, and health data tightens to chat-open (2026-08-14)

Owner follow-up to the tool loop: "getting health history" has layers — HealthKit only holds
cardio-shaped workouts (type/duration/distance; it has NO set/rep/load schema), while the sets
& reps someone logs through Cadence are the differentiated half. And the silent digest refresh
was too slow for "she knows about this morning's run."

**Shipped now:**
- `get_recent_logs` joins the coach's tool set (one line — the registry function already
  existed over `occurrences.log`, which stores `OccurrenceLogItem`s: name/sets/reps/load/
  duration/distance/felt, plus the user's raw words). The coach can now pull what they
  ACTUALLY did, in their words, with the numbers. Zero-arg call runs its defaults (14d, 6
  entries); parameterized `{days}` waits on the parameterized-retrieval increment.
- Chat-open refresh tier (web): `maybeRefreshHealthDigest` gains per-call
  staleMs/minIntervalMs/throttleKey; OnboardingChat mounts a tight pass (2h staleness, 15min
  throttle, OWN localStorage key so the app-launch stamp can't eat it). POST carries the live
  sessionId when a thread was recovered (mid-conversation injection); before first send,
  storing alone suffices — the watermark makes the opening pack fresh. Both throttles are OURS
  (HealthKit foreground reads are local and unmetered; Apple imposes no rate limit — the only
  freshness bound we don't control is Watch→iPhone sync lag). Reaches the phone on next
  `cap run`.

**Direction set (owner, this conversation) — the unified workout history:**
1. **HealthKit as a dataset, not just a digest.** The pipe already fetches full `Workout[]`
   every refresh and discards detail post-aggregation. Plan: `cadence.workout_history` table
   (source `healthkit|strava|cadence`, started_at, type, duration, distance, avg_hr, dedup
   key), capability seam gains the HK workout UUID for clean dedup, device pushes rows
   alongside the digest, registry gets `get_workout_history` (parameterized) over it. Digest
   stays as the summary layer.
2. **Strava lands in the same table** — server-side (OAuth + activities API + webhooks; no
   device needed, unlike HealthKit). Cross-source dedup is mandatory: Strava↔HealthKit
   double-sync is common (match start±tolerance/duration/type, prefer richer source, keep
   provenance).
3. **Cadence-logged strength sessions are already the third source** (`occurrences.log`) — the
   market note is the owner's: HealthKit can't represent strength properly, so our structured
   set/rep/load history alongside coaching is differentiated data. Consider writing our
   sessions BACK to HealthKit as plain workouts later so rings/summaries reflect them.
4. **Client-fulfilled `refresh_health_data` tool** (owner: "the approach I was asking for") —
   the relay forwards the coach's call down the open SSE stream, the phone reads HealthKit and
   POSTs, the loop awaits the round-trip with a timeout before continuing the reply.
   Sequenced AFTER the dataset shape so the payload it refreshes is rows, not just the digest.

### workout_history: the dataset lands — HealthKit as rows, not just a digest (2026-08-14)

Increment 1 of the unified-workout-history direction, green-lit by the owner ("yes!").

**Schema (0033, applied live):** `cadence.workout_history` — one row per recorded workout,
`source in (healthkit|strava|cadence)` naming the door, unique `(user_id, source, source_id)`
as the dedup key (HealthKit's per-workout UUID / Strava's activity id / the occurrence id),
bounded measures (duration/distance/avg_hr), `raw` jsonb for door-specific extras (today: the
recording app's name — the hook a Strava↔Health double-sync dedup will hang off). RLS + per-row
pack_touch like 0024; `on conflict do nothing` rows fire no trigger, so steady state is 0–2
fires per refresh. `dev-reset`'s schema-coverage guard caught the missing table listing — that
test earns its keep.

**No Swift needed:** capacitor-health's `queryWorkouts` already returns `id` (the HK UUID) and
`sourceName`; the seam's `Workout` now carries both (`id`, `recordedBy`), so the whole client
change is web code.

**The doors that write it (all three client paths):** the onboarding offer card seeds the
dataset at first share (rows first, best-effort — the digest stays the only failure the card
surfaces); both silent-refresh tiers (app-launch and chat-open) push rows whenever HealthKit was
actually read — deliberately BEFORE the digest-equality early-out, because "digest unchanged"
cannot prove the rows ever landed on a table that postdates them. Idempotent server-side, so
re-pushing the whole 90-day window is a no-op request. `toHistoryEntries` is the one mapper:
UUID or deterministic composite key, digest-grade bounds, 0-km = "not recorded" (same rule as
everywhere), newest-first cap at the server's 500.

**The coach reads it:** `get_workout_history` joins the registry AND the coach's tool set —
session-by-session log (date · type · duration · distance · avg hr), newest first, `{days}`
param defaulting to 30. The digest (`get_health_history`) stays the summary; this is the log
behind it, for "which days" questions: what did I do this morning, this week's actual runs, the
gap since the last one.

**Deploys:** API + registry live on merge; the three client doors ride the next `cap run`.
Next increments unchanged: cadence bridge (occurrences.log → rows), client-fulfilled
`refresh_health_data` tool, Strava OAuth import.

### The backgrounded phone, finally diagnosed: fire-and-forget lost the reply (2026-08-14)

Owner, fifth report: "I ask Cadence to build my plan, switch apps because it's taking a while,
and get the error asking me to try again. It's like the app has to be in focus for the prompts
to complete... we put in a notification for this, but the application itself is failing."

**Reproduced from a terminal, not a phone.** New scratch harness (real Supabase JWT, prod
cadence-api, SSE read killed at 2.5s = iOS suspending the webview), which is the thing four
rounds of device testing never had:

| | client stays | client vanishes at 2.5s |
|---|---|---|
| reply generated | ✅ 1485 chars | ✅ 1452 chars (`ai_log` has it) |
| relay drained to completion | ✅ | ✅ (`clientDropped` never even flipped) |
| **assistant turn in chat history** | ✅ in 5s | ❌ **never** |

So the reply was written, paid for, and logged — and then thrown away. The app came back to a
conversation missing her answer and said "connection dropped, send again". `capture` completed
2 minutes later in the same invocation, proving the platform had not killed anything.

**Root cause: `recordCoachReply` was fire-and-forget.** Everything started after the handler
returns is racing the platform reclaiming the instance, and with nobody left on the socket that
race is lost reliably. The comment in `useBuildPlan.ts` stated the opposite as fact — "the
serverless invocation runs to completion whether or not the client is still listening" — an
assumption nobody had tested. It is now corrected in place.

**The fix, four parts:**
1. **Await the persistence** (`routes/coach.ts`). The reply is written down BEFORE the handler
   returns. Costs the user nothing — the client resolved on the `[DONE]` the relay already
   wrote. Capture is awaited for the same reason: it is where what you said becomes what she
   remembers, and the brand promise depends on it.
2. **Clear `in_flight_response_id` AFTER persisting**, not before. Clearing first opened the
   exact window the bug lived in: a returning client sees `generating: false` with no new
   message and concludes the turn died — while it was being written down.
3. **`useAppResume`** (new): Capacitor `appStateChange` + `visibilitychange`. The missing half of
   leave-safety — recovery only ever ran when a dead fetch got around to rejecting, and a fetch
   killed by iOS suspension may never settle at all. Now coming back is itself the signal, in
   both the chat (`useResumeHealer` collects the finished reply, silences the corpse fetch,
   returns the composer) and the build (checks for the committed plan directly).
4. **Bound `generating` by age** (5 min). The flag is only cleared by the handler that set it,
   so an invocation that dies mid-turn poisoned every future recovery in that conversation.

Persist failures now log durably to `ai_log` with `persistFailed: true` — a console line on a
reclaimed serverless instance is not evidence, and this is the failure that silently costs
someone the reply they waited for.

`useCoachChat` hit the 150-line function gate on the way; recovery moved to `coach-recovery.ts`
(`recoverTurnFromServer` + `useResumeHealer`) rather than onto the allowlist.

### Why the ready-ping never arrived (2026-08-14, owner: "I didn't get a notification")

Two independent causes, both now addressed — and the second explains why five rounds of testing
produced no evidence either way.

1. **There has never been a device token.** `select count(*) from cadence.device_tokens` → 0,
   for the whole database. `sendPushToUser` with no devices is a silent skip by contract, so the
   push had nowhere to go. Tokens cascade-delete with the user, and this account has been purged
   repeatedly, so history can't say whether registration ever succeeded — the next onboarding
   will, because of (2). (No bell is CORRECT: the owner's 2026-08-13 ruling made the ping the
   default; `NotifyWhenReady` asks iOS on mount and renders only a reassurance line.)
2. **The send was fire-and-forget AND unrecorded** — the same defect as #195, in the one place
   designed to reach someone who left. `lock.ts` called `sendPushToUser` directly, bypassing the
   dispatcher whose entire purpose is a ledger row for every outcome, and its `.catch()` wrote to
   a console on an instance about to be reclaimed. So "I never got a notification" had literally
   nothing to look at.

**Fixed:** `sendReadyPush` awaits, and claims/settles a `cadence.notifications` row for every
outcome including `not_configured` and `no_devices`. Deliberately NOT routed through `notify()`:
that dispatcher enforces the nudge policy (opt-in default, quiet hours, daily cap), which is
right for ambient coaching and wrong for this — the person asked for a plan and the screen told
them they could leave, so a build finishing at 9:05pm still has to reach them. Claiming the slot
first also makes it idempotent: a retried commit cannot double-ping.

**Next test is diagnosable:** after a build, `select kind, status, detail from
cadence.notifications where kind = 'plan_ready'` answers "why didn't I get it?" directly —
`no_devices` (registration is the bug), `not_configured` (APNs env missing on Vercel), a `400
BadDeviceToken` (dev-signed build against production APNs — `APNS_ENVIRONMENT` must be
development/sandbox for a `cap run` install), or `sent`.

Also: root-level `npm run probe:backgrounded` added, matching the `cleanup:*` convention — the
`-w apps/cadence-api` form only resolves from the repo root.

### Everything she can look up, she can now look up (owner ruling 2026-08-14)

Owner: "Cadence needs access to the food log, the journal, as well as the mind-pillar task
summaries (words/pages written, minutes meditated) … Recipes should be reachable too."

Five additions, and one correction that mattered more than any of them:

- **`get_food_log`, `get_journal`, `lookup_food`** already existed in the registry and were simply
  never wired into the coach's tool list — she could be asked about your eating and had no way to
  look at it.
- **`get_recipes`** (new): their own recipe book, saved dishes and per-serving macros, searchable
  by name — so "what can I make?" reaches what they already have before inventing something.
- **`get_practice_totals`** (new): the countable side of a practice, added up. Session logs have
  always captured whatever numbers someone reports (`occurrences.value`, free-form metric keys
  from the parser) and nothing ever totalled them — "how much have I written this month" had no
  answer even though every session knew its own. Metric-agnostic on purpose: words and minutes
  are why it exists (mind and practice, where progress is not a weight or a pace), but reps and
  pages ride the same path for free.
- **Parameters, at last.** v1 declared every tool parameterless and the executor threw the
  model's `arguments` away — so "what did I do THIS WEEK" ran on a default window and
  `lookup_food`, which is nothing without its query, could not be called usefully at all. Tools
  that take params now declare them, and `executeCoachToolCalls` parses what comes back
  (malformed JSON falls to defaults rather than failing the turn).

`registry.ts` hit its 500-line cap on the way; split at a real seam (`food-health-functions.ts`
owns the group with its own data sources, `types.ts` holds the shared contract, `registry.ts`
still composes the one map every caller reads) rather than onto the allowlist.

**Naming, owner-ruled:** these are `ai_harness_tools` — what the model can call. Distinct from
`user_action_widgets` — what she can put in front of the user (the build card, quick picks, the
health offer, the session-step tools in `tool-catalog.ts`). "Act tools" is retired.

### The harness-tool description audit (owner: "run the audit… make sure we aren't using internal jargon", 2026-08-14)

All 17 `ai_harness_tools` descriptions rewritten to the tool-catalog discipline (the 2026-08-04
four rules), for their real readers — the coach picking a tool mid-reply and the Broker choosing
pack functions from `renderCatalogDoc`, both reading cold. The owner's instinct was exactly
right: `get_consistency` said "How the user showed up over a window: scheduled vs done
occurrences. Params: { days }." — "window" is ambiguous, "occurrences" is our table name, and
"Params:" was shorthand only we understood.

**What changed, per rule:**
- **Jargon out, plainly said:** occurrences → "sessions scheduled/happened"; window → "the last
  N days"; "plan-around flags" → "the plan must respect"; "wear status" → "how used up (distance
  so far vs replacement point)"; "Baseline weight" → "current weight and the weight they started
  at"; "deterministic food-log summary" → "a short summary"; "cache + shared DB (incl. USDA on
  cache miss)" → "their saved foods plus a public food database"; "(Food tab handles OFF)" →
  "the app's Food tab handles those" (OFF = Open Food Facts read as the word "off");
  "captured/confirmed/committed" statuses → "from ones just mentioned to ones committed into the
  plan".
- **Params as worked examples**, readable by both consumers: `Pass {"days": 30} to look further
  back (default 7, up to 90).` — the Broker never sees the JSON schema, so the description must
  teach the param name itself.
- **Tiebreaks on every confusable cluster:** history trio (summary / device sessions / their own
  words), progress trio (showed up / how it's going / one counted thing), food quartet (ate /
  could make / facts about one / can-and-won't-eat), plus objectives↔progress and plan↔consistency.
- **Accuracy pass caught two live errors:** `get_consistency` defaults to 7 days, not the 30 its
  parameter description claimed; and the rewrite itself briefly reintroduced "locked" — the
  pre-rename status word — which `registry.render.test.ts`'s nomenclature guard caught.

**Enforced from now on** (`description-audit.test.ts`, 6 assertions): banned-jargon list over
every registry description (now including `locked`); a use-cue on every coach-exposed tool; every
declared param taught in the description as a `{"key": value}` example; param descriptions
jargon-free with defaults stated (or omission behavior); tiebreak present on at least one side of
each known confusable pair; 520-char compactness cap. A description drifting back into shorthand
now fails CI instead of quietly mis-teaching a model for weeks.

No sync needed: the coach's definitions ride each request and the Broker's catalog is rendered at
runtime — the API deploy carries all of it.

### The MCP-best-practice check: the missing layer was the SERVER instructions (2026-08-14)

Owner: "if you consider how MCP instructions are usually written, do these follow best practice?"
Verdict after the audit: tool-level yes; toolset-level no. A well-written MCP server carries two
layers — per-tool descriptions AND server-level `instructions` about using the toolset as a
whole. We had rebuilt the first and simply didn't have the second: nothing told the coach the
loop is capped at three rounds per reply, that one round can fetch several tools at once (so
batch, don't dribble), that results are injected context the user never sees (so never read one
back verbatim or name a tool), that "(nothing on file for this yet)" is a designed sentinel and
IS the answer, or that re-fetching what the session-open context already handed her wastes a
round. And three descriptions hid their truncation (food log lists 10, recipes 15, practice
totals a dozen) — an unstated cap invites "you only have 15 recipes."

**Fix:** a "Using your file tools, mechanically" paragraph in the persona (batch under the
three-round budget · results are for your eyes only · the empty sentinel is the answer · don't
re-fetch the fresh context), plus truncation notes in the three descriptions. Persona synced to
prod; descriptions ride the deploy. With this, the harness matches both halves of the MCP
pattern, and the change tools start from a toolset whose usage contract is actually written down.

### She can change the plan now — propose_plan_change, and the card that applies it (2026-08-14)

The other half of the round-4 ruling. She could read everything and change nothing: the ONLY
route to a different plan was the build card, and on device the owner dismissed it and she was
left articulate and powerless.

**The first action tool.** `propose_plan_change` takes structured edits — move / retime / resize
/ remove / add — and applies them **in code** (`plan-edit.ts`), not by re-synthesis. That
distinction is the feature: a rebuild can quietly restructure six things nobody asked about and
takes minutes, so it stays the right tool for "my life changed" and the wrong one for "move
Thursday's run to Friday". The model picks WHICH and WHAT; the engine does the doing, so the diff
shown is exactly what commits and an unasked-for change is impossible rather than unlikely.

**Suggest-never-auto-apply is structural, not remembered.** The tool writes `pending_plan` — by
definition uncommitted — and returns a summary. The plan moves only when the person taps Apply,
which runs the same `POST /plan/lock` path a first build runs (`confirmPendingPlan` commits an
existing pending plan without re-synthesizing, so a precise edit rides the tested commit path and
lands as a normal new version with its occurrences). **There is no code path from a tool call to
a committed plan.**

**The card shows what the TOOL computed, not what the turn claimed.** New `change` pick layout
(no options, like `confirm`); `ChangeCard` reads the diff back from `GET /plan/pending-change`.
So a reply that describes the change loosely — or wrongly — cannot alter what the user is
agreeing to. "Not now" drops the proposal and she can offer again in the same conversation.

**Ambiguity is a rejection, never a coin flip:** "run" matching both Easy run and Long run is
refused with its reason rather than guessed, because changing the wrong session is worse than
asking. Same for an edit that would empty the week.

Protocol rule added (`coach-picks-protocol.ts`, rides the deploy — no sync): two sizes of change,
and which to reach for. The description audit caught the new tool immediately — it declared
`edits` without teaching it in prose — and it now carries a worked example, which is the audit
gate doing its job on the very next tool added.

Next in this seam: goals (retarget, re-date, complete, drop), constraints (add/lift), and fixing
a log the user says is wrong — same propose-then-tap shape, same engine pattern.

### update_goal and correct_log — and the rule for which changes wait for a tap (2026-08-14)

Two more action tools, plus the distinction that decides the shape of every future one.

**`update_goal`** — retarget, move the date, mark finished, stop working on it. **`correct_log`** —
fix a session recorded with the wrong numbers, or one that never happened. Both write immediately.

**The rule: a change waits for a tap when a person cannot CHECK it in a sentence.** A plan change
is many rows and materializes a week of occurrences, so it gets rendered and tapped. A goal target
or a mis-logged distance is one legible fact the coach says out loud ("100 books down to 50 —
done"), and the persona already settled this shape for detours: *"their plain yes is enough…
never ask them to confirm again elsewhere."* A card that asks someone to re-confirm the sentence
they just said is friction pretending to be safety. What holds instead is the gate in each
description — act only on what the user has plainly decided, never your own read that a goal looks
too hard — plus a `goal_events` row on every change, so it is visible and attributable after.

The protocol rule was reconciled to match: "never say a change is done before they tap" is now
scoped to the PLAN, with an explicit counterpart saying goals and log fixes ARE done on the spot
and she must not invent a confirmation step that does not exist.

**Constraints deliberately NOT built, and the reason is a bug worth fixing first.** Constraints
are already captured ambiently (`capture-extract` → `baseline_updates.constraints`), and
`mergeBaseline` is a shallow jsonb merge — so the array is REPLACED wholesale by each capture. A
constraint tool would be silently clobbered by the next turn's Broker run. Worse, the same
mechanism means a session that mentions one constraint replaces the whole stored list with just
that one, so constraints from earlier sessions can be dropped. That is a data-loss path against
the core promise; fix the merge before adding a writer.

**The audit gates earned their keep immediately.** They caught all three new tools on the way in:
no "Use when" cue on two, `unit`/`date` never taught in prose, and five parameters that never said
what happens if omitted. The last surfaced a category the rule had not anticipated —
CONDITIONALLY required params ("Required for retarget"), where the honest answer is "it depends
which action you chose" — so the gate learned it rather than being waived. Also extended: the
jargon ban now covers action tools too (it only read the registry before), and action tools get
their own bounded cap (800 chars, more room than a read because each carries a safety gate) plus
a new assertion that every one states whether it takes effect immediately or waits for a tap.

### The constraint merge bug — the app was forgetting what it must never forget (2026-08-14)

Found while scoping a constraint tool; fixed instead of built around. Ambient capture wrote
constraints through `mergeBaseline`, a shallow jsonb merge (`baseline || patch`), so the WHOLE
constraints array was replaced by whatever the current conversation happened to mention. The
capture window is ONE session's history — so a chat in week three about a shoulder silently
deleted the knee, the night shifts and the grief recorded in week one, and the next plan was
built confidently around a knee the app no longer knew about. Constraints are the safety input to
planning and sit in the MANDATORY context pack, so this was the worst-placed data loss in the
system.

A second, quieter half: `normalizeBaseline` mints `randomUUID()` on every capture, so even the
SAME constraint changed identity every turn — anything holding a reference watched it churn.

**Fixed** with `constraint-merge.ts` + `mergeCapturedConstraints`:
- **Nothing is dropped by silence.** A constraint not mentioned today is still true today.
- **A returning constraint keeps its id**, matched on the label rather than replaced.
- **The newest telling wins the details** — `plan_around`, `status`, `until` — which is how "my
  knee's fine now" (`status: 'quiet'`) actually lifts, and how a trip gets its end date.
- Atomic: read-modify-write inside a transaction with `for update`, because two turns landing
  together would otherwise reproduce the same loss in miniature.

**Settings still replaces wholesale, on purpose** (`PATCH /review/baseline`): a delete there is
deliberate, and a merge that resurrected the row would be its own bug.

**Matching needed one deliberate divergence from goals.** `sameGoalTitle` requires two words
before it calls containment a match — right for goal names ("Row" must not swallow "Grow
strong"), wrong for constraints, where the commonest shape is exactly what it rejects: "knee" on
Monday becoming "left knee — patellar tendinopathy" on Friday. Constraints additionally accept
single-word containment floored at four characters. The cost asymmetry justifies it — a false
split accumulates duplicates forever (the bug being fixed), a false merge keeps the fuller label
— and multi-word labels still need every word present, so "knee pain" and "back pain" stay two
things. Caught by the test that expected "burnout" to absorb "burnout — signed off work".

With this, a constraint writer (the tool deferred in #202) is safe to add later.

### update_constraint, and the line between history and a mis-capture (owner ruling 2026-08-14)

Owner: *"an injury can be latent or recovered from, and this is different from 'you captured that
injury wrong, I don't have a knee injury and I never did'. Only that explicit correction should
actually delete a thing."*

That distinction is now the shape of the tool. Four verbs, and only one of them erases:

- **lift** — it has eased. Status goes `quiet`, the row STAYS. It happened, it may come back, and
  a coach who forgets it entirely is a coach you have to re-teach.
- **flare** — it is back. Status `active`, plan works around it again.
- **add** — genuinely new.
- **remove** — *the only delete*, reserved for "that was never true". A mis-capture is not
  history, it is an error, and leaving it on file keeps shaping plans around something that never
  existed.

**The same line runs through `correct_log`, and it needed a real fix.** "I didn't actually run
Sunday" means different things depending on whether Sunday was ever asked of them:
- the day WAS scheduled → mark it not-done; the slot is real and the plan did ask for it
- the day was NEVER scheduled → **delete the occurrence**; it existed only because something
  logged it into being

Getting this wrong is not cosmetic: marking a never-scheduled occurrence `skipped` invents a
missed session on a day nothing was asked of them, which then counts against their consistency —
punishing someone for correcting our mistake. The test for it uses the owner's own example.
Detection is `expandRecurrence` over the occurrence's own date, so the off-plan bucket (empty
recurrence) and a log dated onto an unscheduled day are both handled by one rule.

Safe to build now only because #203 fixed the merge — before it, any constraint writer would have
been clobbered by the next turn's ambient capture.

The audit caught this tool too: `kind`/`plan_around`/`until` were described in prose but the rule
wants them taught by QUOTED worked example (`{"kind": "life"}`), which is the better convention —
so the example now carries every parameter.

### Why CI could not catch the "hiccuped" bug — and where the guard actually belongs (2026-08-15)

The device round that looked like a broken coach was a broken BUILD: the bundle was made with a
plain `vite build` instead of `--mode ios`, so `VITE_CADENCE_API_BASE` came from `.env` (`/api`)
instead of `.env.ios` (the deployed host). The Capacitor shell has no Vercel rewrite, so every
call hit the webview's own localhost origin, returned a 65-byte non-JSON body, and `res.json()`
threw `SyntaxError: The string did not match the expected pattern` — surfacing as "Something
hiccuped on my end" on every turn. It survived an uninstall and three reinstalls because nothing
was wrong with the device.

**Owner asked the right question: how did testing and CI miss it?** Four reasons, and the honest
answer is that CI structurally could not:

1. **CI never builds the iOS bundle.** No workflow touches `cadence-ios`, `--mode ios`, or
   `build:web`. It builds `cadence-web` in default mode — correct for the Vercel web deploy — and
   the artifact that reaches the phone is never produced in CI at all.
2. **Nothing in code was wrong.** `/api` is right for web (Vercel rewrites it); absolute is right
   for native. Both env files were correct. A human picked the wrong mode on a local machine,
   which no CI job can observe.
3. **Every unit test mocks `lib/api.ts`**, so `BASE` is never read. Correct for those tests, but
   it means the one value that mattered is invisible to the whole suite.
4. **The build had no guard** — `npm run sync` built and synced without checking the output could
   reach anything.

**So the guard went where the mistake happens: the build.** `apps/cadence-ios/scripts/verify-bundle.mjs`
runs as the last step of `sync` and asserts (a) `.env.ios` declares an ABSOLUTE base — a relative
one cannot work in the shell — and (b) that host actually appears in the built JS, proving
ios-mode env reached the artifact. Verified both ways: passes the good bundle, and fails the
exact wrong build with a message naming the correct command.

The lesson generalizes: for anything built on a developer's machine and carried to a device by
hand, CI is the wrong place for the check — it never sees that artifact. The build script is.

### The mic you could only use once (owner report 2026-08-15)

Owner: "you can only use it once. if you press stop and modify what it wrote, it basically
disappears and you can't use it again. or, if you start typing, you can't use it either."

Two bugs, one visible and one waiting.

**1. The mic was CSS-hidden whenever the field had text** (`mic-slot is-hidden`, applied when
`value.trim() && !dictating`). That rule was added for a good reason — the mic used to be the
`else` branch of the send button, so the first dictated word unmounted it and its cleanup
`abort()`ed the pending final, killing dictation after one word. Mounting it permanently fixed
that, but hiding it whenever there is text just moved the trap: stop talking and your own words
hide the button; fix a misheard word by hand and it hides; type a sentence first and it was never
there. In an app whose tagline is that you can just talk to it, that is the worst possible moment
for the mic to leave. It is now always visible; mic and send coexist in the flex row, which costs
34px and is what every dictation-first app does.

**2. A stopped recognizer could rewrite the field behind you.** `stop()` left `onresult` attached,
and WebKit can deliver one last final AFTER stop. That handler's closure still holds `baseRef` as
it was when dictation STARTED, so a late event recomposed from the stale base and overwrote
anything typed since — the user watches their own edit vanish under a transcript, which is
indistinguishable from the app eating their words. `stop()` now detaches `onresult`/`onend`/
`onerror` and clears the ref before stopping.

Tests: mounted was never the same as reachable, and the old test only asserted mounted (jsdom
finds `display:none` nodes happily). Added — the slot carries no `is-hidden` with text present,
a second dictation creates a second recognizer after a stop, a stopped session is detached, and
dictation APPENDS to existing text rather than replacing it.

### Device round: four findings, three bugs, one working-as-designed (2026-08-15)

**Leave-safety WORKS.** The owner navigated away mid-build, came back, the plan was done. That is
#195 doing its job on a real phone.

**1. No ready-notification — and the #197 ledger answered it instantly.**
`plan_ready / failed / no_devices`. Zero device tokens have ever been registered. The cause is
self-inflicted and rather neat: `NotifyWhenReady` asks for permission on the BuildingScreen, whose
own copy invites you to leave the app — and **iOS cannot show a permission dialog to a backgrounded
app**. Take the screen at its word and the ask silently never happens. The feature defeated itself
on precisely the behaviour it exists to support. Fixed: the ask now also fires on app resume, which
is when a returning user CAN answer it. Retrying is safe rather than naggy — iOS surfaces its
dialog once per install and every later request resolves from the stored answer without showing
anything, so a decline stays declined and a MISSED prompt gets its second chance. (This is also
the first time the ledger paid for itself: before #197 there was nothing to look at.)

**2. "Allow localhost to use your location" — and it re-prompted after a restart.** Two symptoms,
one cause: `useTodayHeader` called `navigator.geolocation` directly, bypassing the
`capabilities.location` seam that exists for exactly this and says so in its own comment. The
webview prompt asks on behalf of its ORIGIN (`capacitor://localhost`), and WKWebView web-geolocation
grants do not survive an app launch — whereas the native plugin raises a real CoreLocation prompt
carrying the app's name and Info.plist reason, and iOS remembers it like any other app permission.
Both call sites now go through the seam.

**3. Tasks scheduled in the past on day one.** Onboarding finished at 9am; the plan arrived with a
6:30 meditation and a 6:30 long run already on it, which the app would shortly count as missed. A
first morning with a coach that opens with two failures it invented itself. `ensureHorizon` now
skips a TODAY slot whose clock time has passed. It only affects rows being written LATE, so a day
already materialized keeps everything it had; and an unknown timezone (or a worded time like
"morning") skips nothing, because a task you can still do is a far smaller harm than one quietly
missing.

**4. The weekly check-in — working as designed.** It IS deterministic and it IS in the plan:
system activity, `category: reflection`, `FREQ=WEEKLY;BYDAY=SU` at 20:00, materialized. The owner
just hadn't reached it — day one was Saturday, and it lands Sunday evening. No change.

### The nutrition module's device round — four fixes (owner report 2026-08-15)

**1. Camera crashed the app.** Missing `NSCameraUsageDescription` — iOS kills the process outright
when the camera opens without one, and every food camera path (`<input capture>`) hit it. Same
class as the mic keys before it. Key added; the string says what the camera is for and that a
photo is shown before anything counts.

**2. "Say" and "Type" were two tiles opening the identical field** — a mode switch that changed
nothing. The meal capture now has ONE omnipresent composer (typing is the default, the mic lives
inside the box — Say IS Type with the mic pressed), and the tiles that remain are the ones that
actually differ: Snap and Scan.

**3. "Scan" was a digit field on every iPhone.** WebKit has no `BarcodeDetector`, so the one
platform this app lives on always fell through to typed digits. zxing-wasm now decodes there —
same detect-a-frame interface, so `useBarcodeScan` can't tell which engine it got; ~1MB of WASM
lazy-loads on first frame and ships IN the bundle (capacitor://localhost + CDN = CSP hole +
offline failure). Frames are downscaled to 800px for decode speed, one decode in flight at a
time. The panel is scanner-FIRST now: camera starts on open, digits demoted to the fallback row.

**4. The five-ingredient smoothie asked for a serving size.** The Food surfaces funnelled ALL
text into the single-food resolver, which treats the whole string as one food name — so someone
who typed exact quantities for five ingredients was asked a question their message had already
answered. The itemizing path (parse-meal) existed but only in log-immediately form. Now:
- `POST /nutrition/meals/preview` — parse WITHOUT logging (`previewMealParse`); confirm posts the
  same payload back as `parsed`, inserted verbatim with no second AI pass, client numbers passing
  the same `sanitizeMacros` caps as the AI path (a confirm is not a door around the caps).
- `looksLikeMultiItemMeal` — deterministic split: ≥2 quantified segments (digits, unicode
  fractions, or measure words) → the meal parser; a single food with a portion or a bare dish
  name → the resolver, unchanged. The owner's smoothie is the first test case, verbatim.
- `MealParseCard` — every ingredient a row with the quantity THE USER GAVE; no serving picker
  anywhere on it; the only question left is which meal, prefilled from the clock. Escape hatch
  both ways ("just one food? match it instead"), because the split is a heuristic and the user is
  the tiebreak.

Noted for later (owner, same report): recipe selection from the say flow — "there is no recipe
selection ability here". The resolver does surface saved recipes as candidates; making them
prominent in the say panel is a follow-up.

### The food module had no front door (2026-08-15)

Owner device report on nutrition, and one line explained most of it. `TrailFoodStrip` returned
`null` unless a kcal target existed — and that strip is the ONLY door to `TodayFoodSheet`, which
is where Recipes / This week's meals / The shop moved when the Food tab was dropped (`7004aad`).
Targets are `null` for every new user (the coach proposes them later, and never had). So:

```
no targets → no strip → no sheet → no recipes, no week planning, no shop, no targets shown
```

The entrance was gated on the thing the entrance leads to. That commit's own note predicted it —
"FoodView kept dormant… the honest fallback if the strip goes untapped" — and it went untapped
because it was never rendered. **The strip now always renders**, with honest copy for the unset
case ("Recipes, your week, and what to aim for" / what they've eaten so far). The ring already
drew track-only without a target, so nothing has to be decoded.

**Plate advice reached the typed path.** "A READ, NOT A RULING" was wired only inside the photo
branch, so describing a meal instead of photographing it meant the advice did not exist for you.
`plate-advice` now takes a photo OR a description (`meal` variable added to the job; the template
reads whichever it was given and never asks for the other), and `MealParseCard` carries the same
"want a read before you eat?" affordance on both the meal-task sheet and the Food-tab say panel.
**Needs a prompt sync after merge** (`sync-jobs.ts`).

**Deliberately NOT fixed here — with design** (`docs/cadence/DESIGN-BRIEF-nutrition.md`): the IA
across the owner's three surfaces — quick log (the meal sheet), manage nutrition (the ex-tab), and
the coach actually holding a food-habits/weight-loss conversation. Plus: where targets come from
(owner wants coach-proposed, not a settings form), where allergies are ever ASKED rather than
inferred, "matching" as leaked vocabulary, "log it" → "assess, then confirm", and adding a
forgotten item to a multi-ingredient meal.

### The coach's food plan: what exists, what shipped, what's left (owner 2026-08-15)

Owner: "Coach needs to build a food plan… macro targets. If I follow them to a tee and don't
lose/gain — or do it too quickly to be healthy — coach needs to start adjusting the macros. This
is the whole point of the coaching. We should track micronutrients as well (maybe I'm just trying
to find a healthy transition to a vegetarian diet)."

**Finding: the adaptive loop was already built and had nowhere to happen.** `nutrition-baseline`
proposes initial targets when a goal warrants them, and — once targets exist and a weigh-in trend
is trustworthy — computes `actualWeeklyRate` vs `safeWeeklyKg`, classifies the pace, and asks for
ADJUSTED targets, throttled weekly by `last_reviewed`. Exactly the loop described. It surfaces in
one place: a card inside a meal task. The coach's harness has no target read and no target action,
so the party that should own the food plan is the only one that cannot touch it.

**Answering the owner's question — is the weigh-in part of the weekly check-in? NO.** Two
unconnected Sunday system activities (weigh-in 08:00 `body`, check-in 20:00 `reflection`). The
weigh-in writes `value.weight_kg`, which feeds the nutrition trend math. The check-in is a
checkbox: `weekly-readout` exists in the job config with **no caller anywhere in the codebase**.
That is almost certainly where the adaptive review belongs — one weekly moment that reads the
weigh-in and the week's food and proposes the change.

**Shipped now (the unblocked data layer):**
- `Macros` widened past the four macros to carry fibre, sodium, iron, zinc, vitamin C, calcium,
  potassium and **B12** (new — the nutrient a plant-based transition actually turns on). Micros
  were computed per food by `macrosForLog` and then **explicitly copied out and discarded** in
  `nutrition-log-saved.ts`, and `MACRO_KEYS` stopped at fat — so a day could never show iron and a
  target could never contain B12, with every number already in hand.
- Rollup keys + per-meal caps widened; micro rounding to 2dp, because B12's entire daily reference
  is 2.4µg and rounding it like a gram erases the nutrient.
- `micronutrientTargets(sex, age)` in `@cadence/shared` — published DRI figures as a LOOKUP, with
  age bands (iron drops for women 51+, calcium rises), and a `floor`/`ceiling` distinction so
  sodium is never drawn as a goal to reach. Unknown sex/age takes the cautious figure.
- `sanitizeTargets` explicitly REFUSES a proposed micronutrient target: those are a fact about
  human biology, not a judgement about this person, and a model emitting one is exceeding its brief.

**Left to build:**
1. **Coach tools** — `get_macro_targets` (read) + `propose_macro_targets` (action, confirm-first,
   same propose-then-tap contract as `propose_plan_change`). This is what makes "the coach builds
   your food plan" literally true.
2. **A non-weight target mode** — adequacy-based (protein/iron/B12 held) rather than scale-based,
   for the vegetarian-transition case that has no weight goal at all.
3. **The weekly check-in as the home for the adaptive review**, wiring the orphaned
   `weekly-readout` and folding the weigh-in into it.
4. **Rendering micros** — floors vs the sodium ceiling, and honestly showing that micro totals are
   a floor (only foods with real data contribute).

Design prompt for 2–4: `docs/cadence/DESIGN-PROMPT-food-plan.md`.

### Micros ARE estimable — the "labels only" rule was wrong (owner ruling 2026-08-15)

Owner: "why would a typed meal not contribute micros? surely an llm can approximate vitamin c in
1 cup of strawberries… it doesn't have to be perfect (and we need to specify that things are
approximate, really), this is why the coach monitors and tweaks and makes adjustments over time.
I'm sure the bag of strawberries I have in the fridge, with a barcode, has approximated the total
vitamin c per cup as well."

Right on every count, and the rule that said otherwise was inherited and repeated as if it were a
law. `estimate-food`'s prompt carried it explicitly — "MACROS ONLY — never fiber, sodium, vitamins,
or other micros (those come from labels/databases, not estimates)" — and
`sanitizeCaptureNutrients` gated micros behind an `allowMicros` flag only the label reader passed.
So a typed meal contributed a blank column, which is not more honest than an approximation; it is
just less useful. The number printed on a package is an approximation too.

**Changed:** both `parse-meal` and `estimate-food` now estimate the eight micronutrients alongside
the macros, with the reasoning in the prompt (a cup of strawberries ≈ 90mg vitamin C, a cup of
milk ≈ 300mg calcium), rounded like a person would and OMITTED where there is no real basis rather
than reported as 0. `sanitizeCaptureNutrients` keeps them from any source; micrograms hold 2dp
because B12's whole daily reference is 2.4µg. What keeps this honest is provenance (`source: 'ai'`
already rides on the macros) and saying so out loud — the meal card now reads "The nutrition is an
estimate — close enough to coach from, and I'll adjust as I learn how you eat."

**Two findings from the same device round, NOT yet fixed:**
1. **The latte never logged.** `estimate_food` ran at 14:15 on "One small latte" and returned a
   clean candidate (240ml, "1 small cup") — and no `nutrition_logs` row exists. The parse worked;
   the flow died at the portion-confirm step. The single-food path still demands a confirm the
   multi-ingredient path no longer does.
2. **The food classifier fired on a coach chat turn about a RUN.** At 17:01 `estimate_food` was
   called with "That last run was good but I had a really hard time keeping my Hr in zone 2…" and
   dutifully returned `{"name":"That last run","serving_label":"1 run"}`. This is the exact failure
   `useCoachChat`'s comment already warns about (the Spartan Beast logged for breakfast); the
   guards in `classifyFoodIntent` are not catching training talk.

### The classifier that priced a run as food, and meals that are more than one thing (2026-08-15)

**1. `classifyFoodIntent` fired on a workout message.** "That last run was good but I had a really
hard time keeping my Hr in zone 2" reached `estimate-food`, which returned
`{"name":"That last run","serving_label":"1 run"}`. The guard was a list of adjectives immediately
after "had a" — one adverb ("a **really** hard time") walked straight past it. That is the second
shipped failure of the same shape (the first: "I HAD TO skip it" → a Spartan Beast logged for
breakfast, ~2000 kcal).

A blocklist of phrasings cannot win against English, so the rule changed shape: "had" must now be
UNCONTRADICTED — the turn must not carry training/sleep/mood vocabulary (`NOT_FOOD_CONTEXT`), and
the thing had must not be a noun nobody eats (`NOT_FOOD_NOUN`, matched however it is modified).
`ate`/`drank` need no help; they are specific verbs. An explicit meal word ("after my run I had
breakfast") still wins over the activity veto. When the only evidence is "had", silence is correct
— a wrong draft interrupts a conversation to ask someone to affirm something absurd, which is how
confirm-first loses trust rather than earning it. 30 cases, every real failure verbatim.

**2. A meal is almost always several things, and the UI didn't believe it.** Owner: "people will
eat multiple things for a meal (almost always) and currently it feels like we don't really support
that." The single-food draft card had "＋ Add another thing"; the multi-ingredient card had
nothing, and a meal already logged gave no sign it existed. So the latte died: `estimate_food` ran
cleanly at 14:15 and no row was ever written.
- `MealParseCard` gains "＋ Add another thing" — back to the composer, meal held open.
- `mergePreviews` joins two reads: items concatenate (parser cap respected), totals add across
  nutrients only one side had, raw text keeps BOTH halves so the log still holds their own words,
  and confidence takes the LOWER — a meal is only as sure as its least sure part.
- The sheet now shows what is ALREADY on this meal today ("Anything you add now joins it"), so a
  second tap on breakfast reads as adding rather than as nothing happening.

**Also fixed:** the client's own `MealMacros` still stopped at fat, so widened `Macros` values
would not typecheck through the web layer; and the zxing `?url` import moved inside the lazy
loader — a top-level WASM asset import made the whole module graph unloadable in the test runner.

**Found, not yet fixed:** `onTalk` in `PlanView.tsx:463` is `setStartOcc(null); onCoach();` — the
post-session "Talk to me" switches tabs and passes NOTHING about the session just finished, so the
coach opens with no idea what you did. Owner hit this exact path.

### Reading health is a deterministic check, not a conversation (owner ruling 2026-08-15)

Owner: "coach told me that 'a prompt will show up for you to confirm' — the prompt didn't show up.
The prompt also didn't need to show up. But coach thinks they need the popup to access the health…
we only need to pop that up if we don't have the permissions. So there's a multiple step process
here, with deterministic steps interwoven."

Exactly the diagnosis. Three things all said the same wrong thing:
- **The refresh was gated on the in-chat offer** (`HEALTH_OFFER_FLAG_KEY !== 'done'`), so reading
  someone's own health data was conditional on the coach having said the words "Apple Health" in
  conversation. Miss the magic phrase → permission never requested → `get_workout_history` returns
  nothing forever.
- **The capability block told her a card would appear** ("it will appear for them to confirm").
- **The persona made the offer a required ritual**, magic phrase and all.

**The conditional already exists and belongs to iOS.** `requestPermissions` shows its sheet the
FIRST time and resolves silently from the stored answer every time after — and iOS deliberately
refuses to report whether READ access was granted, so there is nothing else to check. Asking
before each read IS "only pop it up if we don't have permission". The only honest signal about
data is whether the read returned anything.

So: the app ensures access inline (`ensureAccess` on both refresh call sites), and the coach is
told plainly that she READS IT HERSELF — never ask, never offer to connect, never say a prompt is
coming, and an empty read means nothing recorded yet rather than a missing permission.

**Also: "Talk to me" carried no context.** `PlanView`'s `onTalk` was `setStartOcc(null); onCoach();`
— it switched tabs and passed nothing, so someone who finished a session and tapped the button
standing right there met a coach with no idea what they had just done. It now hands over an
app-authored note naming the session and telling her to read their own report with
`get_recent_logs` / `get_workout_history` rather than asking them to repeat it. Reuses the same
invisible-note channel as the plan walkthrough; `MainTabs` holds it, the chat fires it once on a
quiet moment (not an empty thread, since this arrives mid-history).

### Finished is finished, however you finished it (owner 2026-08-15)

Owner ran 77 minutes; the watch recorded it; the plan still showed the run as pending. Then: "the
thing is I never clicked done because I clicked talk to me — because I wanted to give coach my
feedback (that feedback needs to get logged against the workout, so we can track it persistently
and review it during the weekly checkin)", and "talk to me should be a completion path that logs
what you actually said you did", and "the coach can review and update when you speak with them".

Two completion paths were declared and neither was implemented.

**1. `completion_source: 'healthkit'` was written and never read.** Every synthesis validated it,
`plan-synthesis` has it in `COMPLETION_SOURCES`, the owner's long run carried it — and no code
anywhere turned a recorded workout into a done session. All the data was already correlated: the
run was in `workout_history` (10:57–12:14 local, 77 min, 8.78 km) and the occurrence sat pending.
`workout-match.ts` (pure, 11 tests) + `autoTickFromWorkouts`, run when rows arrive. Conservative
by design, because a wrongly-ticked session writes a false record of someone's week they may never
notice: the activity must SAY it completes from a device, the kind must match, and **ambiguity
ticks nothing** — two runs planned the same day means the person is asked rather than guessed at.
Grouped by LOCAL day so a 22:30 run belongs to that evening. Never un-ticks, never overwrites a
log someone wrote themselves.

**2. Talking about a session is now logging it.** New `log_session` action tool: their report is
parsed onto that session and it is marked done — which is what "Talk to me" actually means. It
also REVISES a session already logged, so the coach can review and correct one later. This is what
gives the weekly check-in something to read: feedback that used to live only in a chat transcript
now sits on the session itself.

Note the ordering that makes both worth having: the watch ticks the box, and the conversation
supplies the words. Neither replaces the other.

The audit caught the new tool three ways (the word "occurrence" is banned schema jargon, `date`
untaught, no immediacy statement) — fixed, not waived.

### The coach can finally set and adjust macro targets (2026-08-15)

The gap named earlier: the adaptive engine existed (`nutrition-baseline` computes actual weekly
rate vs a safe rate, classifies pace, proposes adjusted targets on a weekly throttle) and the
coach could not reach any of it — no read, no action. "If coach isn't supplying macro targets,
then we have no baseline… this is the whole point of the coaching."

- **`get_macro_targets`** (read): current targets, today's intake and what is left, when they were
  last reviewed, and — the part that makes it a LOOP — the weight trend rendered as a verdict
  ("losing 1.1 kg/wk, FASTER than the safe 0.6 — the targets are too aggressive"). No targets set
  renders as exactly that, which is her cue to work some out rather than guess at portions.
- **`set_macro_targets`** (action, immediate): sets or adjusts, through the SAME `sanitizeTargets`
  range check the proposal path uses, so an absurd number is dropped rather than clamped into
  looking deliberate. `why` is REQUIRED — a target nobody can explain later is one they will not
  keep, and it is what makes the next review possible. Merges rather than replaces, so
  `eatback_pct` and other settings survive a target change; stamps `last_reviewed`; leaves a
  goal-event trail naming the before, the after and the reason.

The tool's own output tells her to speak it as a decision she made rather than a setting that
moved — this adjustment IS the coaching, and it should not sound like a form.

Deferred by the owner: the weekly check-in ("we can build it when we get closer — next Saturday is
our check-in"). Everything it needs now exists: ticked sessions, their words on those sessions
(`log_session`), the weigh-in trend, and a coach who can act on all three.

### "It never replies" — it was replying, at 271 seconds (owner report 2026-08-15)

> "I clicked 'Custom — let's talk' and I told Cadence that they're overly protecting my elbow…
> It says it's working on options … it never replies — I can't tell if it's working or not."

**Measured, not guessed.** A new live probe (`scripts/probe-replan-preview.ts`, `npm run
probe:replan`) mints a throwaway user with four committed goals — the owner's shape — and times
the real request against the deployed API: **HTTP 200 after 271.5 seconds.** The gateway does not
cut it off, the proposal is real, and the work always landed. Every part of the failure was on our
side of the wire:

- The sheet showed **one unchanging line** — "Looking at your options…" — for four and a half
  minutes, with no elapsed cue. Indistinguishable from a hang, and the owner read it correctly as
  one. Nobody watches a phone for four minutes on faith.
- Its recovery poll gave up at **180s — ninety seconds before the pipeline could possibly
  finish**. So a backgrounded phone could not be rescued *even in principle*; the window was
  shorter than the job.
- **No `useAppResume`.** A fetch killed by iOS suspension may never reject, and a suspended
  webview's poll timer isn't running either. Nothing looked for the finished proposal on return —
  the same gap `useBuildPlan` closed for the first-lock build and this path never got.
- **No push**, so leaving was pure loss.
- And the whole reason for the change — the user's own sentence — was fed to synthesis and
  **thrown away**, so the week changed and nothing anywhere recorded why.

Why it is slow at all is not a bug: with N goals the server fans out one `synthesize_plan` draft
per goal, reduces them into a coherent week, then vets it. It is the most expensive thing Cadence
does, and it grows with every goal added. So the fix is not to make the wait shorter — it is to
stop pretending it is short.

**What shipped**

- `useReplanPreview` (new) owns the whole wait: honest phase copy that moves with the clock, a
  live elapsed counter (the part that proves the screen is alive), an **8-minute** recovery
  window, and `useAppResume`. By a minute in the copy stops implying "any second now" and starts
  giving permission to leave — which is only honest because of the next bullet.
- **The ping.** `previewReplan` sends "Your adjusted week is ready" the instant it persists. The
  first-lock ready-push was extracted to `plan-ready-push.ts` and both flows now share it —
  ledger, idempotency slot and all.
- **`plans.steer` (migration 0034)** — the ask, in the user's words, stored on the plan VERSION it
  produced. `get_active_plan` now renders it with a relative "when", so general chat knows the
  person asked for this week and does not re-litigate the elbow next Tuesday. (A trigger on
  `cadence.plans` already moves `pack_touched_at`, so the pack invalidates on commit and she sees
  it.) NOT a substitute for a constraint change — the ask and the fact are different things.
- **The box you can type in.** `SteerBox` (new) grows with the text to nine rows then scrolls to
  the caret, and the caret starts at the END of Cadence's prefilled prompt rather than in front of
  it. The sheet gets `sheet-compose` (92% max / 58% min) for the whole adjust flow — no resize
  jump mid-wait — because the ask is the point of that screen and it had two fixed lines.

### The leave-the-screen contract (owner rule, 2026-08-16)

> "If I send a chat message to Cadence and I leave the screen:
> * Cadence always keeps running / working on the prompt
> * Cadence always sends a notification when done (just like Claude)
> * This is true regardless of phase or where I'm chatting"

Stated as an absolute, and correctly so — this has been re-reported across many device rounds
under different symptoms ("it asks me to try again", "it never replies", "I never got a
notification"), and each time it was fixed as its own bug on its own surface. It is one contract.

**The finding that explains all of it: `cadence.device_tokens` was EMPTY in production.** Not
stale — empty. Every push Cadence has ever sent settled as `failed / no_devices`. The cause was
scope: the *only* place that ever asked for permission was the onboarding build screen, so the ask
happened once in a person's life, at the busiest moment of it, and anyone past their first week
could never be reached again short of finding the Settings toggle. The half of the contract that
was already true (the work surviving, #195) was invisible, because nothing could tell anyone.

- **`usePushRegistered`** (new, mounted in `App`) — registration is core setup now, not a feature
  any screen opts into: from launch, on every screen, retried on resume. Safe by iOS's own rules
  (the system dialog appears once per install; later requests resolve silently from the stored
  answer, so a decline stays declined). `unavailable` is the only permanently-final outcome — a
  denial can be reversed in Settings and a `failed` can just be an offline launch, so both get
  another try. The resume retry is what catches the case the build screen proved is real: a
  prompt cannot appear to a backgrounded app, which is exactly where someone is when they take up
  "leave the app if you like".
- **Coach chat now pings.** `POST /coach/sessions/:id/messages` already tracked `clientAlive` for
  the relay; when the socket went away mid-turn and her reply is on file, it sends "Cadence
  replied" with her opening sentence as the body — a notification that says only "you have a
  reply" makes someone open the app to learn nothing. Someone still watching gets nothing, because
  they can already see it. Awaited, like all post-stream work (#195).
- **No conditional copy.** An earlier pass gated the "I'll ping you" line on whether the device
  could actually receive one. Owner: *"I don't know what you mean by making a promise… this is
  just core functionality."* Right — the answer is to make registration work, not to write copy
  that degrades around it.

Remaining surfaces to hold to this rule as they land: food estimate/parse (fast today, so no
ping), and the weekly check-in when it is built.

### She described the tool instead of using it — and there was no tool for what he asked (2026-08-16)

From the owner's chat, in order:

> **User:** "Let's start by changing the farmer carries to dead hangs"
> **Cadence:** *(coaching advice; no tool call)* "Do you want this as a permanent swap in the plan?"
> **User:** "Just trying it today, we can decide after"
> **User:** "Can you change the plan? Like in the app?"
> **Cadence:** "Yes — right here. We talk through what should change, I put up a card showing the
> edit, and you tap to apply it… **What do you want to adjust?**"

Owner: *"She can't (or doesn't know she can) — I thought she had tools to do this? And then it
almost feels like she forgets what adjustments I'm asking about."* Both halves are real, and they
are two different bugs.

**1. There was genuinely no tool for that edit.** `propose_plan_change` only did move / retime /
resize / remove / add — all *structural*. "Swap farmer carries for dead hangs" changes what a
session CONTAINS, and nothing could express it. She was right that she couldn't; she was wrong not
to say so.

The home for it already existed and was empty: `activities.how_to` is read by `prescribe-session`
on every session it writes, and **nothing has ever written it**. A dormant column with a live
reader — which is exactly what "make it permanent" needs, since writing it changes every future
session of that commitment.

- New edit action **`rework`**: sets `how_to` (and optionally the title), leaving the slot alone.
- `how_to` now rides `PendingPlanActivity` through preview and commit. Latent bug found on the way:
  `commitActivities` never mapped it, so *any* commit or re-plan would have erased an instruction
  the user gave. Invisible only because nothing wrote the column yet.

**2. She recited the capability manifest instead of acting on it.** Her answer to "can you change
the plan?" is `coach-capabilities.ts` read back near-verbatim — and then she asked him to name the
change he had named two turns earlier. The capability was real; the reach for it was not.

- The manifest now ends with **"DO THESE, DO NOT DESCRIBE THEM"**: call the tool in the same reply;
  explaining the mechanism is not doing it and reads as a no; never make them repeat a change they
  already named — propose it and let the card be what they correct.
- `propose_plan_change`'s description says the same at the point of use, and carries a worked
  `rework` example. Still ≤800 chars and still passes the description audit, which caught two real
  slips while writing it (a missing "Use", and the dropped "does NOT change anything" safety gate).
- The manifest's size budget went 4000 → **4600**. It was already sitting at 3988, so it was a
  saturated guardrail, not a lax one; raised deliberately, with the reason in the test, because it
  is injected once per session (~1.1k tokens per conversation) and the text buying the increase is
  the text that stops her narrating it. Ceiling kept — the next addition has to cut something.

**Not fixed by this, and worth being clear about:** `plans.steer` (0034) records the ask only once
a change *commits*. It does nothing for a change still being discussed. The fix for the
"forgetting" is the instruction above, not the column.

### The coach's Apple Health reads returned "nothing on file" for 30 recorded workouts (2026-08-16)

Found while auditing the harness, not from a report — though the owner *had* reported it, one layer
up: *"Coach wasn't able to actually read from healthkit."* That was answered by fixing the
permission story. The read itself was broken the whole time.

Run through the real coach tool path for the owner's account:

```
[get_workout_history] "(nothing on file for this yet)"
[get_health_history]  "(nothing on file for this yet)"
```

He has thirty recorded workouts, including the 8.78 km run he and Cadence discussed that morning.

**Cause.** `postgres.js` returns `timestamptz` as a JavaScript **Date**. Our row types are
hand-written generics on the query, so `WorkoutHistoryRow.startedAt` is declared `string`, is a
Date at runtime, and TypeScript never objects. `w.startedAt.slice(0, 10)` threw on every row.

**What turned a crash into a lie.** `executeCoachToolCalls` swallowed a throwing render as
`'(nothing on file for this yet)'` — reasoning that a render which crashes found nothing usable.
It does not follow. The coach asked for his runs, was told there were none, and said so: a false
statement in her voice, from a bug, with no trace anywhere that a tool had failed.

**And why the tests were green.** `registry.render.test.ts` fed `startedAt` a *string* — the type
the row declares. A test that only ever feeds the declared type can only prove the declaration is
self-consistent with itself. The new fixture is a Date, because that is what the database sends.

Fixed:
- `isoDay()` (new) takes `string | Date | null` and returns a day or ''. Used at all four
  `.slice(0, 10)` sites on database timestamps. A bare `"2026-08-15"` is sliced, not re-parsed —
  re-parsing as UTC midnight and re-formatting can roll it back a day west of Greenwich.
- Tool errors no longer masquerade as empty results. A throwing render now returns *"this is a
  fault on our side, NOT an empty record — do not tell the user they have nothing here"*, and logs.
- Regression tests on Date-shaped rows for `get_workout_history` and `get_journal`, plus `isoDay`.

Verified after: `Recorded workouts (last 30d, newest first): - 2026-08-15 · running · 77 min ·
8.78 km …` and `30 workouts, ~2.3/week overall`.

### She *did* change the plan. The card never rendered. (owner, 2026-08-16)

> "If you check my latest conversation with Cadence, she's still not adjusting my plan. It's very
> frustrating."

She adjusted it. The proposal was sitting in `users.pending_plan`, written at 13:26:10, with
exactly the right content:

> "Hill intervals + grip finisher: Dead hangs for the grip finisher, not farmers carries — 3–4 sets
> of 20–30 seconds to start, see how the elbow responds"

All fifteen commitments preserved, the slot untouched. `propose_plan_change`'s new `rework` action
worked on its first real use. **The card was gated on something else entirely.**

`OnboardingChat` rendered `<ChangeCard>` only when the coach ALSO emitted a
`cadence-picks {"layout":"change"}` tag in her prose. So applying a change was two independent
things the model had to get right, and only one of them was ever checked. She did the hard one and
skipped the tag, so four turns of "can you change the plan?" → "yes, let me swap it now" produced
nothing on screen. The tool's own output had already told her *"the user now has a card showing
exactly this"* — a sentence that became false the moment she omitted a formatting marker.

The owner named the fix before I finished writing it: *"There don't need to be 2 tools for this —
one tool changes the plan and also presents the results back to the user."*

- `ChangeCard` now mounts on every finished last turn. It asks the server what is pending and
  renders nothing when the answer is nothing, so it is self-correcting; keyed on the turn so a new
  proposal remounts and refetches, and gated on `!streaming` so it reads after the tool has run.
- The `change` pick layout is now ignored — the stored proposal is the only trigger.
- Two tests: the card appears from stored state with **no tag anywhere in her reply**, and no empty
  frame appears when nothing is pending.
- The general rule is now §6 of [TOOL-HARNESS.md](TOOL-HARNESS.md): a tool whose effect depends on
  the model doing a second thing is two tools wearing one name, and a tool's return text must never
  claim an effect the tool did not itself produce.

Still open from the same conversation, logged not fixed: her reply arrived **duplicated** — two
complete drafts concatenated — which points at the tool-loop accumulator carrying round-one content
into the continuation. And `renderCapabilities` is injected at SESSION OPEN, so the
"do these, do not describe them" instruction shipped that morning never reached this thread; a
long-running conversation keeps the instructions it was born with.

### The Broker had a veto. Now it has a floor. (2026-08-16)

`context-select` runs before every coach turn, decides which registry functions matter, and injects
the rendered results as a `<context>` turn. It could also decide **nothing** — and then the turn ran
on whatever the session-open pack happened to hold. Worse: a select that **failed outright** took
the identical code path as a considered "nothing needed". A silent breakage and a deliberate
decision were indistinguishable, in the logs and in the outcome.

It fired the same day. On *"let's start by changing the farmer carries to dead hangs"* the selector
returned `calls: []` — *"a straightforward exercise substitution"* — on the exact turn where naming
the commitment as the plan lists it **is** the job (`propose_plan_change` matches activities by
title). It worked because the session-open snapshot was still good. That is luck, not design.

So the cheapest model in the stack was making an unreviewable judgment about what the strongest one
needs, with no minimum. Now it can only ever **add**:

**`TURN_FLOOR = get_identity · get_constraints · get_active_plan`** — 1,057 chars ≈ **286 tokens**
per turn against the owner's real dossier. The three whose absence is a product failure rather than
an inconvenience: she must not ask a returning user their name; nothing about training is safe to
say without the constraints; and the plan is the one dossier fact that changes *during* a
conversation, because she changes it herself.

Cheaper than it looks, because re-injecting identical content is marked `unchanged` by the freshness
classifier — a reminder she already has, not news (the fix that stopped her reading the same numbers
back three times). We do not skip re-sending: surviving AI Admin's session compaction is the whole
reason the mechanism exists.

Failure and decision are now different: a failed select falls back to the floor and *says so* in the
injected block and the trace (`selectFailed`), instead of reading as a clean call.

Eight tests, all on the invisible failure — nothing errors, nothing logs a fault, the coach simply
knows less than she should and answers anyway.

**Why the Broker stays at all** (owner asked, 2026-08-16 — could structured files replace it?):
the argument is **push, not price**. The saving from a cheap selector is real but thin — the content
tokens land in the strong model either way and they dominate. What files cannot do is deliver a fact
she did not think to ask for, and "never makes you repeat yourself" is a push requirement. A pull
model is right for the long tail, which is exactly what Layer 2 of [HARNESS-V2.md](HARNESS-V2.md)
is. Also: she streams to a phone, and every pull is a visible pause before she says anything.

### Two complete answers in one reply — and the number that names the cause (2026-08-16)

Her last two turns came back as two full drafts concatenated. Measured across the session:
**2 of 2 turns that ran the tool loop, 0 of 6 that did not.** That correlation is the diagnosis.

A Responses-API continuation is a **fresh generation**. It carries `previous_response_id` and the
`function_call_output`, but the model writing it does not know what already streamed to the user.
So: she writes a complete answer, calls the tool, and the continuation writes the complete answer
again — and the relay accumulates both, because from its side both are content on the same turn.

The lever we actually own is the length of what she writes *first*. A one-line preamble that gets
restated is invisible; a full answer that gets restated is the bug. So the capability manifest now
says: **say at most ONE short line before a tool call — your real answer comes after the result,
and a full answer written first gets repeated.**

Honest about what this is: a mitigation at the root, not a guarantee. Two things will tell us more
than another round of reasoning:

- **The model changed underneath it.** Sonnet 5 became primary an hour before this was written
  (it had been the *failover*). Every duplicated reply on record was generated by Sonnet 4.5.
- **Session-open injection** means this instruction reaches new conversations only — the standing
  limitation already logged against the harness work.

If it survives both, the code-side answer is to stop treating pre-call prose and post-result prose
as one stream. Deliberately not built yet: a de-duplication heuristic against behaviour that may
have already changed is a fragile thing to own.

### Applying a plan change deleted the day he was standing in (owner, 2026-08-16)

> "I applied it — clicked on plan to validate the plan was updated, but the activity for today
> disappeared…?"

It did. After the commit, 2026-08-16 held the evening journal, the three later meal logs and the
weekly check-in — and **no hill intervals, no grip finisher, no breakfast log.** Every commitment
scheduled EARLIER than the moment he tapped Apply was gone. Only the evening survived, which is what
made it look like a partial glitch rather than a rule doing exactly what it said.

`commitActivities` deletes the old plan's pending occurrences from today forward, then calls
`ensureHorizon` to re-materialize. `ensureHorizon` carries this line:

```ts
if (date === today && startsAt < nowMinutes) continue;
```

Correct for the **rolling top-up** — nobody wants a 6am session materialized at 3pm. Exactly wrong
after a **commit**, where today's rows have just been deleted and the day has to be rebuilt whole.
He applied the change in the afternoon, so the afternoon is where his morning went.

Fixed with `ensureHorizon(userId, days, { keepElapsedToday: true })`, set by the commit path and
nowhere else. Four tests pin both halves: the top-up still skips an elapsed slot, the commit still
rebuilds it. His day was re-materialized by hand afterwards — the grip finisher is back, carrying
the dead-hangs `how_to` from the change that deleted it.

### Switching tabs threw away the reply that switching apps survives (owner, 2026-08-16)

> "I can switch applications, the replies keep coming, but if I switch tabs in Cadence all is lost."

`MainTabs` rendered the coach as `{tab === 'coach' && <OnboardingChat …/>}`. Tapping Plan
**unmounted** it — killing the in-flight fetch, the poll behind a dropped one, the resume listener
and the transcript. Every piece of leave-safety built this week defends against iOS suspending the
app; none of it survived React removing the component. Tapping "Plan" was more destructive than
locking the phone.

The coach now stays mounted and is hidden with `display: none`. The fetch stays alive, the listeners
stay subscribed, the scroll position holds, and coming back is instant instead of a re-restore. Plan
and Progress stay conditional — they hold no in-flight work and remounting is how they refresh.

### Notifications: allowed on the phone, still no device registered

`cadence.device_tokens` is **still empty** with notifications switched on and previews enabled. The
registration path resolved every failure to a bare `null` that the caller reported as "denied", so
three quite different faults — iOS refusing, APNs refusing, or us giving up after ten seconds —
were indistinguishable and none of them was written down anywhere.

Not fixed, made **visible**: each path now logs which one it was, where Safari's Web Inspector can
see it on the device that failed. The likeliest cause is an App ID without the Push Notifications
capability — signing succeeds against the local entitlement (`aps-environment: development` is
present and wired) and APNs refuses at runtime. That is the second invisible failure this week; the
coach's health reads were the first.

### Why no notification has EVER arrived: the app delegate never forwarded Apple's answer (2026-08-16)

The device finally said it out loud, once the registration path stopped swallowing its own failures:

```
[push] no APNs token after 10000ms — neither event fired
```

Neither. Not a refusal, not a denial — *nothing came back at all.* That signature has one cause.

`AppDelegate.swift` had no `didRegisterForRemoteNotificationsWithDeviceToken` and no
`didFailToRegisterForRemoteNotificationsWithError`. Capacitor's PushNotifications plugin learns
about Apple's answer **only** through the two `NotificationCenter` posts those methods make. So
`register()` asked iOS for a token, iOS came back with one, the app delegate ignored it, and the
JavaScript `registration` event never fired.

**This is why `cadence.device_tokens` has been empty since the app existed** — every push settling
as `no_devices`, every round of device testing producing another "I never got a notification". It
was never the entitlement (`aps-environment: development` is present and correctly wired), never the
App ID, never the permission. The app was simply never told it had been given a token.

Two methods, and they are app-level callbacks, so they stay on the app delegate even under the
scene-based lifecycle this project uses.

Worth naming the pattern: this took four rounds to find because the failure was *silent at every
layer* — no token, no error, no log, and a caller that reported all of it as "denied". Making the
three paths speak (that morning's change) turned a four-round mystery into one line of console.

### The wrapper that froze the app (same round, my regression)

Keeping the coach mounted meant wrapping it in a `<div>` — and `.app` is `display: flex;
flex-direction: column`, so that wrapper became a flex child with no sizing of its own and collapsed
the chat: composer gone, tab bar pushed off, the app apparently frozen.

`display: contents` when showing (and `none` when hidden) removes the wrapper from layout entirely,
so the chat is a direct flex child exactly as it was before it was wrapped.

### Harness v2, part one: 24 tools every turn became 9 (2026-08-16)

The spec is [HARNESS-V2.md](HARNESS-V2.md); this is what landed.

**Before:** 24 definitions on every coach turn, 18,380 chars ≈ **5,000 tokens**, growing linearly
with a toolset the owner intends to expand — *"if we scale to 100 tools, we eat our context window
just finding the tool."*

**After:** 9 definitions, 11,477 chars ≈ **3,102 tokens**, and **flat as reads are added.**

Honest about the number: the spec projected ~1,100 and it is 3,102. The six actions are 4,190 chars
between them and now dominate the total — which is the arithmetic making the design's own point out
loud. Reads are free; actions are not, deliberately, and if we ever have twenty of them the cost
will be impossible to ignore rather than easy to.

**Three layers.**

- **Layer 0 — the dossier, injected as text, not tools.** Seven reads deleted from the tool list
  outright: identity, objectives, constraints, consistency, weight, dietary profile, health history.
  The pack already injects every one of them, so a tool for them was a second path to a fact she was
  holding and one more decision on a turn that needed none. The owner's framing is why the grouping
  question dissolved: the plan is built *out of* the objectives and *around* the constraints, so
  they are one thing — and the answer is not to group them as tools but to stop making them tools.
- **Layer 1 — always on.** All six actions (owner ruling: they are core capabilities and she should
  never be caught not knowing she can do them), `get_active_plan` — the one dossier fact that
  changes *during* a conversation, because she is the one who changes it — and the two meta tools.
- **Layer 2 — on demand.** Ten reads at zero cost until asked for.

**`find_tools` + `use_tool`, not one tool.** A function call can only name a tool that was DECLARED
for that request, so a `find_tools` that merely *described* something would leave her able to read
about a tool she still could not call. Re-declaring mid-turn needs the continuation to accept a
changed tool list, which is provider behaviour we do not control. Sentry's shipped server splits it
the same way.

**A bug this build produced and the tests now forbid.** `use_tool` was declared to the model and
missing from the executable set — the model could emit a call the harness would drop on the floor,
ending the turn mid-thought with nobody told. Declared and executable must be the same set, and two
tests now assert it in both directions. It is precisely the negative-assertion habit the harness
research recommended, and it caught a live defect within an hour of being written.

Verified end to end against real data: `find_tools("workouts")` returns `get_workout_history` with
its instructions, and `use_tool` then returns the 8.78 km run. 928 cadence-api tests green, and the
description audit accepted both new tools only after catching a missing "Use" and a parameter that
never said what omitting it does.

### Harness v2, part two: 5 tools a turn, and a hierarchy she can drill into (2026-08-16)

| | tools/turn | chars | tokens |
|---|---|---|---|
| Before | 24 | 18,380 | ~4,968 |
| After part one | 9 | 11,400 | ~3,081 |
| **After part two** | **5** | **5,682** | **~1,536** |

**A — four actions demoted.** The first cut kept all six on the owner's ruling that they are core
capabilities she should never be caught not knowing about. Measuring revised it: the six were 4,190
characters of description and ~4,600 of schema — the entire remaining cost. What the ruling and the
implementation had conflated is **knowing** and **carrying**. The manifest already tells her what
she can do at ~15 characters a line; a 750-character definition is only needed at the moment of
calling.

`propose_plan_change` and `log_session` stay (daily, hourly). `update_goal`, `update_constraint`,
`correct_log` and `set_macro_targets` are one `find_tools` call away — weekly-or-rarer acts paying
about a second.

**Categories, because a search box is not a hierarchy.** Owner: *"it's about giving the coach the
categories — this is about hierarchy and her having the context to drill down."* Five named groups —
training, body, food, writing, changes — named in the manifest so she knows what KINDS of thing
exist, and usable directly as a `find_tools` query. Knowing there is a category for their food is
enough to go looking, and going looking is the whole bet.

**Looking and saying no beats not looking.** Owner: *"it would be better for her to look and tell
the user 'I don't actually have a tool for that today' than to not look; to not report; to pretend
she's doing something she's not."* A miss used to fall back silently to the whole list, which invites
exactly that pretence — she asked for sleep tracking, got ten unrelated tools, reaches for the
nearest. `find_tools` now flags a miss and says: if none of this is what they asked for, say so
plainly. The manifest carries the same rule.

Demoted ACTIONS keep their contract: `use_tool` runs the tool's own `run()`, `find_tools` returns
the tool's own description including its safety sentence, and the catalog marks them
`[changes their data]`. Reaching a thing through a door does not soften what it does.

**The manifest budget went 4600 → 5300**, and the arithmetic is in the test because it is the point:
definitions ride every TURN, the manifest rides once per SESSION. A ten-turn conversation pays ~576
characters to save ~127,000. It is only a good trade because what it buys is exactly what makes the
demotion safe — she cannot drill into a hierarchy nobody told her exists.

**The risk, stated plainly and left measurable.** Under-triggering is our commonest failure and
"she never went looking" is how this would fail. That is what `npm run eval:tools` exists for; run it
after any change to the always-on list. 933 cadence-api tests green.
