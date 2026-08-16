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

#### First, a correction to this spec's own first draft

The draft said: extend the `context-select` Broker pass to also choose which TOOLS to expose.
**That is not what any of the best harnesses do, and it is the wrong shape.**

- **Anthropic's tool search is model-driven** — Claude writes the regex or BM25 query itself.
- **Sentry's is model-driven** — the model calls `search_sentry_tools`.
- **GitHub's is static config** — the operator picks toolsets; no model involved.
- **Cloudflare's is code** — the model writes code against tools-as-a-filesystem.

Nobody puts a second, cheaper model in front of tool selection. The reason is sound: the model
asking for what it needs is **self-correcting**, because it knows what it is about to do. A
preselector guesses from the same words with less context and no recovery inside the turn. It is a
second point of failure in a chain that already has one, and its failure mode is the expensive one
— a capability silently missing.

**But our Broker is not doing tool selection. It is doing PREFETCH, and that is a different,
legitimate thing.** `turn-context.ts` runs `context-select` every turn, executes the chosen
retrieval functions app-side, and injects the rendered results as a `<context>` turn before the
user's message. Wrong prefetch costs a few tokens and she calls a tool. Wrong preselection costs a
capability. Keep the Broker exactly where it is; do not give it a gate.

#### The finding that reframes everything

**Eight of our eighteen read tools describe how to fetch facts that are already in her context as
text.**

`buildContextPack` injects the dossier at session open — identity, objectives, active plan,
consistency, constraints, weight, dietary profile, health history — and `turn-context` re-injects
whatever this turn needs. Then we spend ~2,200 characters of tool definitions, every single turn,
teaching her to go and get them again.

So this is a context-engineering problem before it is a tool-selection problem. The first and
largest win is not smarter tiering. It is **deleting the second path to a fact she already has.**

#### The three layers

**Layer 0 — The dossier. Injected text. Not tools at all. (0 definition tokens.)**

Who they are, what they are working toward, what we work around, what the plan says, how the week
has gone, what they weigh, what they eat, what their devices saw.

The owner's read is exactly right: *"constraints, active plan, objectives are all related to the
same thing. The active plan is built out of the objectives and built around the constraints."*
They are one thing — the dossier — and the answer is not to group them as tools. It is to stop
making them tools. This layer is **already built**; the only change is removing the duplicate
tool-shaped path to it.

`get_constraints` returns `baseline.constraints[]` — each `{ label, kind: physical | life, status,
plan_around }`. The owner's own row today: knee, physical, quiet, plan-around false.

**Layer 1 — Always on: the ACTIONS, plus one way to find everything else. (7 tools, ~1,100 tokens.)**

`propose_plan_change`, `update_goal`, `update_constraint`, `log_session`, `correct_log`,
`set_macro_targets`, `find_tools`.

Actions cannot be prefetched — being chosen IS what an action is. And every failure this week has
been **under-triggering an action**: she described `propose_plan_change` instead of calling it. Of
all the things to put a token budget behind, "she can always act" is the one. It also matches the
field's most common failure class: Scale AI's MCP-Atlas finds 63.3% of failures are cognitive
rather than tool-call errors, dominated by **no-tool-use**.

**Layer 2 — Searchable reads. Loaded on demand. (~12 tools, 0 tokens until asked for.)**

Everything else — workouts, journal, recipes, food lookup, equipment, practice totals, and the
richer views of the dossier when she wants one fresher than the injection. `find_tools(query)`
returns full definitions; she then calls what she got. Model-driven, one round-trip, and a
preselection can never cost a capability because there is no preselection.

#### What that costs

| | Now | After |
|---|---|---|
| Definition tokens per turn | ~5,000 | **~1,100** |
| Growth per new READ tool | +~110 tokens/turn, forever | **0** |
| Growth per new ACTION tool | +~190 tokens/turn | +~190 tokens/turn |
| Decisions she must make to reach a dossier fact | 1 (which tool) | **0** (it is already there) |

Reads become free to add, which is the property we actually want — the owner's 100-tool worry is
mostly a 100-*read* worry. Actions stay expensive on purpose: they are the ones that need her full
attention, and if we ever have twenty of them, that is a consolidation problem worth being forced
to confront.

#### The one rule for deciding where a new tool goes

**Does calling it change the user's data?**
- Yes → Layer 1. It is an action; she must always be able to reach it.
- No, and the dossier already carries the fact → Layer 0. Not a tool. Inject it.
- No, and it is a long-tail read → Layer 2. Searchable.

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
