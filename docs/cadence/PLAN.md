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
  entry. Photo input SHIPPED capture-first 2026-07-17. REMAINING: per-topic thread continuity;
  vision parse + `macro_targets` day view + rings — now fully specced in "SPEC — Nutrition v2 +
  the Visual Today" (phases N1–N4).
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
