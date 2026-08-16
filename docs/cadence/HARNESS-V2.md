# Harness v2 — progressive disclosure, and getting presentation out of the model's hands

**Status: SPEC, not built.** Written 2026-08-16 for review before implementation.
Companion to [TOOL-HARNESS.md](TOOL-HARNESS.md), which holds the rules; this holds the plan.

---

## Why now

Three failures in two days, all the same shape — the model was asked to do something a machine
should have done:

| What happened | What the model was asked to get right |
|---|---|
| She recited the capability list instead of calling the tool | choose a tool from 24 sent every turn |
| She changed the plan; no card appeared | call the tool **and** emit a formatting tag |
| Her Apple Health reads said "nothing on file" over 30 workouts | (nothing — this one was ours, and it hid inside the same silence) |

And the load is about to grow. Owner: *"I'm concerned that if we scale to 100 tools, we eat our
context window just finding the tool."* That concern is correct and the arithmetic is below.

## Where we are, measured

- **24 tools, ~5,000 tokens of definitions on every coach turn** (18,380 chars serialized).
- Linear scaling. At 100 tools: **~20,000 tokens per message** before she does any work.
- Anthropic's published finding: tool-choice degrades past **30–50 tools**. We are at 24.
- `context_select` **already runs before every turn** — a Broker call that reads the turn and picks
  retrieval functions. We are already paying for the selection pass. It just doesn't select tools.

That last line is the whole opportunity: the expensive part exists and is running.

## What the field actually does (researched 2026-08-16, primary sources)

No convergence — this is a live argument, and knowing that is worth more than a false consensus.

- **Sentry**: 9 tools visible, ~45 behind `search_sentry_tools` + `execute_sentry_tool`. Written
  rule: *"Target ~20 publicly visible tools. Never exceed 25."*
- **GitHub**: built dynamic discovery, then **deleted it** (PR #2512, May 2026) as too complex.
  Answers with static config instead: 101 → 52 tools, 64.6k → 30.3k tokens. *"Defaults matter."*
- **Cloudflare**: 2,594 tools = 585% of a 200K window with full schemas; their code-mode answer is
  3 tools and ~1,100 tokens.
- **Anthropic**: server-side tool search — 49%→74% (Opus 4), 79.5%→88.1% (Opus 4.5), ~85% fewer
  definition tokens. **Not available to us** — an Anthropic-API feature, and we run through AI
  Admin → Devs.ai.

We take Sentry's shape, GitHub's warning about complexity, and build it on the selection pass we
already run.

---

## The architecture

### Three families, named and separated

They are already three things; we have been calling them one.

| Family | Count | Who invokes | Where it lives |
|---|---|---|---|
| **`ai_harness_tools`** | 24 | the model, mid-turn | `retrieval/registry.ts` + `coach-actions.ts` |
| **AI Admin jobs** | 28 | app code, deterministically | `ai-admin.config.json` — already separate |
| **`user_action_widgets`** | catalog | the model *presents* | `renderCoachToolCatalog` |

Only the first is in scope. The jobs family is already correct and is not touched.

### Part 1 — Tiered disclosure

Three tiers. Every turn sends **tier 1 + whatever tier 2 the selector chose**, and nothing else.

**Tier 1 — always on (~6 tools, ~1,200 tokens).** The ones whose absence is a product failure, not
an inconvenience: `get_identity`, `get_constraints`, `get_active_plan`, `get_objectives`,
`propose_plan_change`, `find_tools`. These already have precedent — `MANDATORY` in
`context-pack.ts` exists for exactly this reason ("body facts cost ~20 tokens and their absence
costs the product's core promise").

**Tier 2 — selected per turn (~3–6 tools).** Chosen by the existing `context-select` Broker pass,
extended to answer one more question. It already reads the turn and returns retrieval calls; it
will also return the tool GROUPS to expose.

**Groups, not individual tools.** `RetrievalFunction.domains` already exists on every entry — we
group on it rather than inventing a taxonomy. Fewer decisions for the selector, better recall, and
the same shape as GitHub's toolsets:

| Group | Contains |
|---|---|
| `plan` | active plan, consistency, recent logs, goal progress, `propose_plan_change` |
| `body` | health history, workout history, weight, constraints |
| `food` | food log, macro targets, dietary profile, recipes, lookup, `set_macro_targets` |
| `practice` | journal, practice totals |
| `record` | `log_session`, `correct_log`, `update_goal`, `update_constraint` |

**Tier 3 — the escape hatch.** `find_tools(query)` is a tier-1 tool that returns full definitions
for anything the selector missed. This is the piece that makes preselection safe: a wrong guess
costs one extra round-trip, never a capability. GitHub's stated reason for deleting dynamic
toolsets was complexity, not failure; one meta-tool is the cheap end of that trade.

**Projected: ~1,200 (tier 1) + ~1,000 (tier 2) ≈ 2,200 tokens/turn, from 5,000 — and flat as the
toolset grows**, because tier 2 is a fixed budget of groups, not a fraction of the catalog.

### Part 2 — Presentation stops being the model's job

Owner: *"some of these are really just UI. We could have Cadence return a list and then
deterministically figure out how to render them based on the number of options or amount of text.
Cadence doesn't need to know the specifics."*

Today she authors a fenced `cadence-picks` block **including its `layout`** — `list`, `chips`,
`confirm`, `change`. Every layout is a second thing she has to get right, and the `change` layout
already cost us a day.

The change:

- She emits **content only**: a lead line and options (`label` + `say`). No `layout`.
- The client **derives** the layout: ≤4 options with short labels → chips; anything longer → list;
  and so on, in one pure function with tests. Deterministic, testable, and it cannot be forgotten.
- **State-backed cards are never triggered by prose.** `ChangeCard` already reads the stored
  proposal (fixed 2026-08-16); `ConfirmCard` moves to the same rule. If a tool wrote something
  durable, the client reads the store.
- `layout` is accepted and ignored for one release, so live sessions carrying the old protocol
  degrade to content rather than breaking. (Sessions keep the instructions they were born with —
  see the open issue below.)

### Part 3 — Consolidation

Not a separate phase — it makes the groups small enough to be worth selecting. Two candidates,
both following GitHub's `issue_read` pattern (one tool, a `method` enum, the menu in the
*parameter* description):

- `get_health_history` + `get_workout_history` → **`get_activity(view: 'summary' | 'sessions')`**.
  These are the pair the audit's tiebreak list works hardest to separate; the tiebreak is the
  symptom.
- `get_food_log` + `get_macro_targets` → **`get_nutrition(view: 'log' | 'targets')`**.

Each consolidation deletes a `TIEBREAK_PAIRS` entry. **That list should shrink, never grow** — it
measures ambiguity we chose to document instead of remove.

### Part 4 — The eval, built alongside, not after

Without this we cannot tell whether any of the above helped, and the whole point is measurable
tool-choice.

- **20–40 cases from real failures**, sourced from PLAN.md — which is already a catalogue of them.
- **Balanced trigger sets**: should-fire *and* should-not-fire, which is how both Anthropic's
  `skill-creator` and OpenAI's `eval-skills` build this. A set of only positive cases measures
  recall and silently ignores false triggering.
- Scored as **precision/recall on tool selection**, plus tokens per turn.
- Run against prod AI Admin, like the existing probes; a gate for harness changes, not for CI on
  every commit (it is stochastic and costs real money).

Anthropic's caution, worth heeding: a bad score is a suspect grader until proven otherwise
(CORE-Bench went 42% → 95% on grader fixes alone).

---

## Implementation plan

Four workstreams. **1 and 2 are independent** and can run in parallel; 3 depends on 1; 4 needs 1
to be measurable but its cases can be written immediately.

| # | Workstream | Depends on | Touches |
|---|---|---|---|
| 1 | Tiered disclosure + `find_tools` | — | `coach-tools.ts`, `retrieval/`, `turn-context.ts`, `context-select` job |
| 2 | Presentation derived client-side | — | `coach-picks-protocol.ts`, `QuickPicks`, `OnboardingChat` |
| 3 | Consolidation (`get_activity`, `get_nutrition`) | 1 | `registry.ts`, `food-health-functions.ts`, audit |
| 4 | Selection eval | (1 to measure) | new `scripts/eval-tool-selection.ts` |

**Sequencing:** land 1 and 2 in parallel → verify on device → 3 → 4 as the gate that says whether
any of it worked.

**Non-negotiables for every workstream:**

- Every rule in [TOOL-HARNESS.md](TOOL-HARNESS.md) still holds; the description audit must stay
  green and gains a check that tier-1 membership is explicit.
- No file over 500 lines, no function over 150 — split, never allowlist.
- A wrong preselection must never be able to cost a capability. `find_tools` is what guarantees
  that, so it ships in the same PR as the tiering, not after.
- Nothing here changes what the model can DO, only what it is shown. Consolidation changes call
  shapes; it must not remove a capability.

## Known issues this does not fix

- **Session-open injection.** `renderCapabilities` and the pick protocol are injected once, at
  session open, so a prompt fix never reaches a live conversation — the "do these, do not describe
  them" instruction shipped the morning of 2026-08-16 and never reached the thread it was written
  for. Needs a re-injection path on protocol change. **Logged, not in scope here.**
- **Duplicated replies.** A turn that runs the tool loop can come back with two complete drafts
  concatenated, which points at the accumulator carrying round-one content into the continuation.
  **Logged; fix before the tiering lands**, since tiering will make tool rounds more common.

## The measure of success

1. Tokens of tool definitions per turn: **5,000 → under 2,500**, and flat as tools are added.
2. Tool-selection precision/recall on the eval set: **a number, where today there is none.**
3. `TIEBREAK_PAIRS` shrinks.
4. On the device: she calls the tool, the card appears, first time.
