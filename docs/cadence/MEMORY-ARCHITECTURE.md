# Cadence — Context & Memory Architecture

> Status: design spec (v0.1). Owner: Cadence. Implements PLAN §5a "context & memory".
> This is the detailed design for how the Coach stays grounded in a user's life over
> months without overflowing the context window — an **agentic memory layer** over a
> longitudinal relational store, built on devs.ai models behind the AI Admin
> orchestration/audit layer.

## 1. Problem

The Coach is stateless between turns. The authoritative picture of a user lives in the
relational store (`cadence.*`). Early on we rendered that store deterministically into a
"dossier" string and put it in the chat **system prompt**. That breaks down fast:

1. **Context overflow.** A user accumulates months of workouts, meals, check-ins, and
   episodes. The full picture cannot — and should not — ride in every prompt.
2. **Cache destruction.** Putting mutating data in the system prefix defeats prompt
   caching. A documented case went from a **7% → 84% cache-hit rate** purely by moving
   working memory out of the system prefix into an end-of-prompt block.
3. **Hidden, untunable construction.** String-building in app code gives an admin no way
   to see how context was assembled or to tune it.

We need a context layer that is **selective** (fetch only what matters), **bounded**
(fits a token budget), **auditable** (every retrieval + summary logged), **tunable**
(prompts live in AI Admin job templates), and **refreshable** (kept current as the user's
life changes) — without re-querying the whole database on every turn.

## 2. Design principles

- **Semantic layer over free SQL.** The model never writes arbitrary SQL against the DB.
  It selects from a registry of **parameterized retrieval functions** (a bounded,
  governed action space). Safer, deterministic, consistent, cheaper to cache.
- **Agent-curated working memory.** A cheap/fast Broker reads a metadata catalog, decides
  what to pull, and summarizes results into a compact **context pack** — the working-memory
  block the Coach reasons over.
- **Structured store is the source of truth.** The pack is a *view*; the relational store
  stays authoritative. Exact records are always re-fetchable on demand.
- **Cache-aware placement.** Stable persona = cacheable system prefix. Dynamic context
  pack = end-of-prompt block.
- **Provenance everywhere.** Every pack records which functions/params produced it and when.

## 3. Architecture overview

```
                         ┌─────────────────────────────────────────────┐
   cadence.* (SoT)       │           CONTEXT / MEMORY ENGINE            │
   goals, plans,         │                                             │
   occurrences,   ──────▶│  ① Catalog: retrieval-function registry +    │
   nutrition_logs,       │     per-domain volume/recency stats          │
   checkins, ...         │                 │                            │
                         │                 ▼                            │
                         │  ② Broker "select" step  ──▶ {fn, params}[]  │
                         │                 │  (app validates+executes)  │
                         │                 ▼                            │
                         │  ③ Broker "summarize" step ──▶ context pack  │
                         │     (sections + rendered block + provenance) │
                         │                 │                            │
                         └─────────────────┼────────────────────────────┘
                                           ▼
   persona (job systemPrompt, cacheable prefix)  +  context pack (end block)  +  turn
                                           │
                                           ▼
                                   Coach chat (devs.ai)
```

The loop (§7) refreshes ③ on TTL or reflection triggers, enriching it between rebuilds.

## 4. Components

### 4.1 Retrieval-function registry (the semantic layer)

A curated set of **safe, parameterized, indexed** queries. The model selects functions
and params; **the app executes them** (validated against the registry) — the model never
touches the DB directly.

```ts
interface RetrievalFunction {
  name: string;                 // e.g. "get_consistency"
  description: string;          // LLM-facing: what it returns + when to use it
  params: ParamSpec[];          // typed, validated (e.g. days:int(1..90), kind:enum)
  domains: string[];            // ["movement","consistency"] — used for staleness checks
  returns: string;              // shape description for the summarizer
  maxRows: number;              // bounded result
}
```

Initial Cadence registry:

| Function | Returns |
|---|---|
| `get_objectives()` | active high-level objectives + status |
| `get_active_plan()` | current plan + activities (the weekly/daily commitments) |
| `get_consistency(from,to,kind?)` | scheduled vs done occurrences (how they showed up), % by kind |
| `get_weight_trend(days)` | weight series + trend |
| `get_recent_nutrition(days)` | calorie/macro summary + notable gaps |
| `get_injuries()` | baseline injuries + `plan_around` flags |
| `get_equipment()` | equipment + wear status |
| `get_recent_checkins(n)` | recent feedback/check-ins |
| `get_streaks()` | current streaks |
| `get_disrupted_episodes(active?)` | travel/illness/life episodes |

Free-form SQL is **out of scope for v1** (a later, sandboxed, read-only escape hatch only
if a real need appears).

### 4.2 Catalog / metadata doc (LLM-consumable)

Generated periodically (and cheap to regenerate). Two parts:

1. **Function registry** (names, descriptions, params) — what the Broker can call.
2. **Per-domain stats** — row volume + latest-record date per domain, so the Broker can
   (a) decide what's worth pulling and (b) judge whether the existing pack is stale.

```
## Domains (as of 2026-06-29)
nutrition_logs : 412 rows · latest 2026-06-28 · +14 since last pack
occurrences    :  88 rows · latest 2026-06-29 · +6  since last pack
checkins       :   9 rows · latest 2026-06-27 · +2  since last pack
## Functions
get_recent_nutrition(days:int 1..30) → {date, kcal, protein_g, ...}
...
```

### 4.3 Broker "build-context" (two steps)

A 2-step Broker workflow, fully auditable in AI Admin (`{stepKey}.prompt/response`,
diagnostics):

- **`select`** — input: `{objective/intent, topic?, catalog, prior_pack_summary?}`.
  Output (JSON): `{ calls: [{ fn, params }], reason }`. The app **validates** each call
  against the registry (unknown fn / bad param ⇒ rejected) and **executes** it.
- **`summarize`** — input: the executed results. Output: the **context pack** sections +
  a compact `rendered` block, within a token budget.

### 4.4 Context pack (the working-memory block)

```sql
create table cadence.context_pack (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references cadence.users(id) on delete cascade,
  topic         text,                       -- null = global; else nutrition/training/...
  sections      jsonb not null,             -- {identity, objectives, plan, adherence,
                                            --  nutrition, injuries, signals, open_threads}
  rendered      text not null,              -- the end-of-prompt block
  provenance    jsonb not null,             -- [{fn, params, rows, at}]
  token_estimate int,
  built_at      timestamptz not null default now(),
  expires_at    timestamptz not null,       -- TTL
  version       int not null default 1,
  status        text not null default 'fresh' -- fresh | enriching | stale
);
create index on cadence.context_pack (user_id, topic, built_at desc);
```

### 4.5 Refresh policy

- **TTL** — default 7 days (per-domain overrides; e.g. nutrition shorter).
- **Reflection triggers** (rebuild before TTL):
  - **Volume** — `+N` new rows in a relevant domain since `built_at` (from §4.2 stats).
  - **Staleness signal** — the Coach/Broker detects mid-conversation that the pack lacks a
    referenced fact (a `context_select` miss) → flag for refresh.
  - **Event** — lock / replan / disruption changes the plan → invalidate affected topics.
- **Enrichment** — between rebuilds, append high-signal new items (today's check-in, a
  logged workout) without a full rebuild; mark `status='enriching'`.

### 4.6 Cache-aware prompt assembly

```
[system]  persona            ← from coach job config.systemPrompt (STABLE → cacheable)
[user]    <context pack.rendered>   ← dynamic, end-of-prompt block
[user]    <the actual turn>
```

This is the direct fix for the 7%→84% caching finding and cleanly separates **what AI
Admin owns** (persona) from **what the engine injects as data** (the pack).

## 5. AI Admin mapping & gaps

| Concept | Today (app-side) | Ideal (AI Admin primitive) |
|---|---|---|
| Retrieval functions | TS registry + app executor | governed "tools" registry, logged per call |
| build-context | `cadence-build-context` workflow (2 Broker steps) | same — already native |
| Context pack | `cadence.context_pack` table | first-class **context/memory store** (per user+app, TTL, provenance) |
| Cache placement | app assembles prefix+tail | native "stable prefix + dynamic tail" |
| Cross-session memory | the pack table | longitudinal memory store (not per-session vars) |

The build/summarize steps are already expressible as an AI Admin workflow (auditable). The
**memory store** and **cache-aware placement** are proposed AI Admin enhancements (PLAN
"AI Admin critique").

## 6. Relationship to MemGPT / Letta

**Similar:** the pack is MemGPT's "human" memory block; the structured store is archival;
refresh ≈ Letta's reflection heartbeat; we treat the context window as scarce working
memory to be curated, not a transcript to be replayed.

**Where Cadence diverges:**

| Dimension | MemGPT / Letta | Cadence |
|---|---|---|
| Retrieval | agent self-searches archival (semantic search) | **governed semantic layer** — parameterized functions over a relational store, app-executed |
| Who curates memory | the agent self-edits via tools | a **separate Broker** curates; the Coach only *signals* staleness |
| Memory format | free-text blocks | **structured sections + rendered block + provenance** |
| Refresh | agent/heartbeat decision | **TTL + data-volume + conversational staleness** triggers |
| Substrate | a framework | **devs.ai models behind AI Admin** — every retrieval, prompt, and token audited + tunable |
| Data safety | search tools | **no free SQL**; bounded, validated functions |

In short: MemGPT lets the agent manage its own memory; Cadence puts a **governed,
auditable retrieval+curation pipeline** between the agent and a relational longitudinal
store, because it's health data and an admin must be able to inspect and tune it.

## 7. Lifecycle (the loop)

1. Regenerate/refresh the **catalog** (functions + per-domain stats).
2. Broker **`select`** → validated function calls; app **executes**.
3. Broker **`summarize`** → write a new `context_pack` (provenance + TTL).
4. Coach turns reuse the pack (end-of-prompt block); enrich it with high-signal events.
5. On TTL or a reflection trigger → back to 1 (for the affected topic only).

## 8. Failure modes & mitigations

| Risk | Mitigation |
|---|---|
| Hallucinated function/param | app validates against the registry; reject unknown/out-of-range |
| Stale pack | TTL + volume/staleness triggers; `built_at` surfaced to the Coach |
| Summarization loss | SoT stays authoritative; `context_select` re-fetches exact records on demand |
| Cost / latency | cache-aware placement; pack reuse; incremental enrichment; Broker = cheap model |
| Privacy | data minimization (pull only needed domains); provenance; `on delete cascade` |

## 9. Phasing

- **P0 ✓** persona = cacheable system prefix; dossier moved to a provenance-stamped
  end-of-prefix context turn (`injectCoachContext`).
- **P1 ✓** retrieval-function registry (`services/retrieval/registry.ts`) + catalog doc
  (`catalog.ts`) + `context_pack` table; app executes; pack persisted with provenance.
- **P2 ✓** Broker curates: `pack-select` (chooses functions from the catalog) → app validates
  + executes → `pack-summarize` (renders the block). Deterministic fallback at each LLM step;
  identity + injuries always retrieved (safety net). Auditable as two AI Admin jobs.
- **P3:** refresh policy (TTL reuse via `getFreshContextPack` + volume/event triggers) + enrichment.
- **P4:** conversational staleness trigger + cross-session/topic memory.

## 10. Open questions

- Topic scoping granularity (global pack vs per-topic packs vs hybrid).
- Token budget per section + truncation policy under pressure.
- Whether the catalog stats live in a materialized view vs computed on demand.
- When (if ever) a sandboxed free-SQL escape hatch earns its keep.
