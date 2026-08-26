# The check-in — the coach's half of the week

**Status:** designed, not built. Owner rulings 2026-08-25.
**Branch:** `investigate/activity-panel-latency` (started as a latency investigation; the latency
turned out to be a symptom of this).
**Read first:** [BRAND.md](BRAND.md), [TOOL-HARNESS.md](TOOL-HARNESS.md),
[MEMORY-ARCHITECTURE.md](MEMORY-ARCHITECTURE.md).

> **The governing sentence, and the one this document got wrong once already:**
> the check-in is **not a feature and not a flow**. It is a conversation the coach knows how to
> have, entered by a sentence the user sends, backed by one deterministic tool she calls and one
> card she emits. Every phase-shaped design of it is the pipeline-calls-the-model inversion
> sneaking back in wearing a wireframe.

---

## How we got here: the tap that took two minutes

The owner tapped a meditation and a run on 2026-08-25 and waited ~63 seconds across the two. The
measurement (163 runs of `prescribe-session`, 14 days) says the wait is real and structural:

```
total ≈ 12.6s fixed + 8.4ms per output character
```

App-side work — every DB read, the weather call, normalization — averages **76–153ms**. The database
is 0.4% of the wait. The rest is one live coach call, at tap time, authoring the session the button
has been promising since the plan was committed.

**The bug is not the latency. The bug is *when* the work happens.**

| | What it is | Built when | Stored |
|---|---|---|---|
| The button | "Easy run", Tuesday 7am | plan commit (`synthesize_plan`) | `activities` + `occurrences` |
| **The shape** | blocks, sets × reps, the note | **first tap** (`prescribe-session`) | `occurrences.session` |

Owner:

> "The activity isn't just the button, it includes the shape of the activity. If the button is on the
> screen, the activities it represents should also be there."

Author the shape when the button is born. Which raises the question this document answers — *when is
a button born, and who decides?*

---

## The horizon has been extending itself

Three clocks, none of which talk to each other:

| | Today | Where |
|---|---|---|
| What the user *sees* | 7 days | `buildPlanView(userId, 7, …)` |
| What *materializes* | **14 days**, silently, on every plan load | `DEFAULT_HORIZON_DAYS`, [plan-horizon.ts:8](../../apps/cadence-api/src/services/plan-horizon.ts) |
| Check-in cadence | 7 days, consent-gated | `ASSESS_INTERVAL_DAYS`, [situation.ts:13](../../apps/cadence-api/src/services/situation.ts) |

Two consequences:

1. **The edge is invisible by construction.** The horizon always runs a week ahead of the view, so
   nobody can scroll to the end of their plan. There is no moment at which the coach can ask "shall
   we make another week?" because there is never an end in sight.
2. **The horizon is decoupled from the check-in.** `ensureHorizon` is void-fired from
   [plan-view.ts:98](../../apps/cadence-api/src/services/plan-view.ts) and
   [coach.ts:123](../../apps/cadence-api/src/routes/coach.ts) with no user involvement.

Owner:

> "Just infinitely generating a plan doesn't really ensure success and success is what we're after."

**The horizon should end where the week ends, and reaching it should be the moment the coach gets
your attention.**

---

## What the check-in is today: a receipt

[`recap.ts`](../../apps/cadence-api/src/services/recap.ts), in its own words:

> *"code computes, the model narrates. Every number here comes out of Postgres and arithmetic; the
> job turns them into a warm paragraph… **Nothing it writes can change a number.**"*

The coach arrives with **no tools, nothing to pull, and nothing she can change.** She is handed a
finished report and asked to read it aloud warmly.

### Why that is the miss

The owner has this ritual with three real coaches. Every one **ends in a change**:

| | The review | The change |
|---|---|---|
| Piano teacher | checks progress on current pieces | **new song when one is mastered, new scale** |
| Fitness coach | weigh-in | **adjusts the plan** |
| Boss (1:1) | reviews the week's work | **unblocks, angles at career growth** |

A readout that ends in a paragraph is not a check-in. It is a receipt for a week you already lived.

---

## The architecture: she runs it, we don't

**Owner ruling, 2026-08-25** — and it corrected this document's first draft, which had specced a
three-phase screen flow:

> "The coach can and should call these tools itself… When we call the coach for a weekly check-in
> this is just a pre-baked user prompt (hey I want to do my checkin, or I'd love to look back on the
> past few months with you). They should be able to invoke the tools they need."

The first draft had **Phase 1 → Phase 2 → Phase 3**: the app renders a confirm screen, then hands to
the coach, then commits. That is the pipeline-calls-the-model shape — the exact inversion CLAUDE.md
forbids — redrawn as a wireframe. It also broke a protocol rule that already ships in
[`coach-picks-protocol.ts`](../../apps/cadence-api/src/services/coach-picks-protocol.ts):

> *"BUILD IS SOMETHING YOU DO, NOT SOMEWHERE YOU SEND THEM. There is no review screen and no other
> route to a plan: never tell anyone to 'head to Review', to confirm somewhere, or to go to any
> screen."*

### The four pieces, and three of them already exist

| Piece | What it does | Status |
|---|---|---|
| **A sentence** | The check-in is entered by a user message: *"I'd like to do my check-in."* | **Exists** — picks carry a `say` that "is dropped into their composer and they can edit it" |
| **One fat tool** | `review_period(from, to)` returns the whole assembled review in ONE call | **To build** |
| **A card she emits** | The week's facts rendered by the app, with corrections inline | **Pattern exists** — the build card and the `propose_plan_change` card both work this way |
| **Knowing the cadence** | She knows a weekly check-in is due, or a quarterly | **To add** — context, not a pipeline |

### The sentence, not the mode

There is no "check-in mode". The trail-edge affordance and the due-nudge both do exactly what every
other pick does: **drop an editable sentence into the composer.**

- *"I'd like to do my check-in"*
- *"I'd love to look back on the past few months with you"*
- *"I missed last week's — can we do it now?"*

The last one is not a special case. It is a sentence, and she handles it by calling the tool with a
different window. **Nothing expires, because there is no object to expire.**

### One fat tool, not seven small ones

Owner:

> "Maybe they call the tool themselves, based on the kind of request the user has — and it is a
> deterministic job that grabs all of the relevant data for them (rather than a series of specific
> queries they need to call to do it themselves)."

She should not have to assemble a check-in out of `get_consistency` + `get_goal_progress` +
`get_weight` + `get_recent_logs` + `get_practice_totals` and remember all five. One call returns the
review.

**Precedent in this repo:** the nutrition facade, described in
[`coach-tool-tiers.ts`](../../apps/cadence-api/src/services/coach-tool-tiers.ts) as *"Covered by a
facade… never listed to her, because **choosing between them WAS the problem**."* Same reasoning,
same shape.

The tool is **windowed and deterministic** — no model inside it. That is what makes it serve every
case at once:

| Window | Serves |
|---|---|
| Last 7 days | The weekly check-in |
| An arbitrary 7 days | "I missed last week's" |
| A quarter | The quarterly ritual |
| Anything | *"How am I doing?"*, asked at 11pm on a Tuesday |

`buildRecapFacts` already computes most of this deterministically and is the obvious core to grow.

### The card, not the recital

She does not read the numbers out. The protocol already states the rule for the change card, and it
transfers verbatim:

> *"That change card renders the edit the TOOL computed, not your description of it, so let it do the
> listing. Say in one line what you have put up… never recite the diff."*

So: one warm line, then the card. The app renders the week; corrections happen on the card via
`correct_log`, which already exists.

**Owner ruling on friction:** show the whole week, edits opt-in, **silence is agreement**, with
explicit confirmation only on anomalies — a gap, a provisional meal, a missed weigh-in.

### Reviewing your own data, any time

Owner: *"A user should be able to review their data (honestly, probably at any time)."*

Two doors to the same facts, and neither is a mode:

1. **She pulls it up** — mid-conversation, whenever it would help, the same way she emits any card.
2. **The user opens it** — a plain review surface, no coach required.

The same deterministic tool backs both. Nobody has to start a conversation to look at their own week.

---

## The loop: the check-in *is* the horizon extension

> Your week ends → you say so → she pulls the review and puts it up → you talk → she proposes → you
> accept → that commit builds next week → sessions warm at commit → every tap is instant.

There is no separate "extend my week" button. **Checking in is how the next week gets made.**

It also resolves the cost objection against pre-warming: warming is no longer speculative. You warm
exactly one week, at a moment the person explicitly asked for.

---

## The data she gets

Owner's specification: detail near, compression far.

| Window | Resolution |
|---|---|
| Last 7 days | Full detail |
| Previous 5–6 weeks | Week-over-week |
| Earlier | Month-over-month summaries |

Today's `ROLLING = 28` (4 weeks) is the whole long view. This ladder extends it and should reuse
[MEMORY-ARCHITECTURE.md](MEMORY-ARCHITECTURE.md)'s compression rather than growing a parallel one.

---

## Three cadences, one machinery

| | Trigger | Difference |
|---|---|---|
| **Weekly** | Due nudge, or any time | Window = the week |
| **Ad-hoc** | A sentence, whenever | Window = whatever they asked about |
| **Quarterly** | Due every ~13 weeks, **replaces** that week's check-in | Wider window, plus re-measurement and goal revision |

**She knows the cadence.** That a weekly is due, or a quarterly, is a fact in her context — the same
way identity, goals and constraints already arrive. It is not a mode the app puts her in, and it does
not stop her doing one whenever asked.

### Quarterly is a different ritual, not a bigger weekly

The owner's models: a fitness test with real measurements, a piano teacher revisiting what you're
ultimately working toward, a performance review of wins and opportunities. All three are
*re-measurement plus goal revision*. `rebaseline` already exists as a `pending_proposal` action.

---

## Skipping, lateness, and regret

**Owner ruling:** skippable, but the default. The opt-out is easy, obvious, and **not a dismissal**:

> "I trust the coach, I don't need to chat with them, let them just auto-generate and I'll keep on
> keeping on."

Copy is about trust, never about skipping. *"Just build my week — I trust you."* Never *"Skip"*,
*"Not now"*, *"Dismiss"*.

Note what the opt-out actually **is**: the existing **build card**, emitted without the conversation.
It is not a new mechanism.

### The one the architecture has to earn

Owner:

> "…the user who is paranoid haha, or who maybe skipped a weekly or quarterly checkin because they
> were making their kids lunches and they have regret about it."

Two people, one requirement: **a check-in must never be a thing you can be late for.**

- **The anxious one** wants to look more often than weekly. They say so; she pulls the review. No
  ceremony, no "your next check-in is Sunday."
- **The one who missed it** says *"I missed last week's."* She calls the tool with last week's window
  and they have the conversation. She does **not** open with "you missed your check-in."

This is why the check-in **must not be a scheduled row with a status**. The moment it becomes an
object with a state, it can be `overdue`, and `overdue` is a red mark — exactly what BRAND.md
forbids. Track the cadence the way `last_assessed_at` already does (a timestamp that decides whether
to nudge), never as a task that can fail.

**Skipping never counts as a miss.** Count what happened, never what broke.

---

## The risk this design must survive

[coach-tool-tiers.ts](../../apps/cadence-api/src/services/coach-tool-tiers.ts) records a measured
failure — same evening, same user, same model:

| tool | reached how | called |
|---|---|---|
| `log_session` | always-on | **4 of 4** |
| `update_constraint` | behind `find_tools` | **0 of 3** |

She *found* it every time and **told the owner it was done instead of doing it.** Diagnosed as
structural — *"a continuation is a FRESH generation."*

For a check-in whose value is that it **ends in a change**, this is fatal, and worse than today: a
warm conversation, an unmoved plan, and a person who believes something happened.

**The mitigation is already the house pattern, not a new invention:** the plan changes when a card is
tapped, so she cannot *claim* it. The protocol says it outright — *"Talking it through is the
agreement; the card is the commit"*, and *"never say a PLAN change is done… before they have tapped
the button."* A check-in that agreed on something and ended without a card is the bug, and it is
detectable without a human: **assert the card, not the prose.**

Needs an eval before ship (`npm run eval:tools`) asserting **cards emitted / acts fired**, never acts
described.

---

## What changes in code

| # | Change | Notes |
|---|---|---|
| 1 | **Warm sessions at `commitActivities`** | Independent of all of this; removes the 21–35s tap. Ship first. |
| 2 | `DEFAULT_HORIZON_DAYS` 14 → **7** | View, horizon and check-in cadence become one number. |
| 3 | Drop speculative `ensureHorizon` | Remove [plan-view.ts:98](../../apps/cadence-api/src/services/plan-view.ts) + [coach.ts:123](../../apps/cadence-api/src/routes/coach.ts). **Keep** [plan-synthesis.ts:426](../../apps/cadence-api/src/services/plan-synthesis.ts) (commit path). |
| 4 | **`review_period` tool** | One deterministic call, windowed. Grow from `buildRecapFacts`. Facade over the small reads. |
| 5 | **A review card she emits** | App renders the facts; corrections inline via `correct_log`. Same family as the build card. |
| 6 | **Cadence in her context** | She knows a weekly/quarterly is due. Context, not a mode. |
| 7 | Entry affordances emit a `say` | Trail edge + due nudge drop an editable sentence in the composer. No new mechanism. |
| 8 | Standalone review surface | The user's own data, openable without a conversation. |
| 9 | Retire `weekly-readout` | The narrate-only job has no place once she runs the check-in herself. |
| 10 | Data ladder: 7d / 5–6w / monthly | Extends `ROLLING = 28`; reuse memory compression. |
| 11 | Prefetch demoted to a backstop | Repair-only: filter `kind === 'user' && !session` before batching, order by date, rolling pool. A cron may **repair** failed generations, never **extend** the horizon. |

### Not in this document

The **12.6s fixed floor** on every `prescribe-session` call (`claude-sonnet-5` via the Devs.ai v2
relay) is a separate track — roughly half of every generation is relay overhead producing nothing. It
blocks nothing above, but it is the difference between a background job costing 25s and 12s, which
matters once a full week generates at commit.

---

## Open

- **Where the standalone review lives** — Progress screen, coach tab, both?
- **Quarterly trigger** — fixed 13-week clock, or anchored to when the goals were set?
- **The empty week** — someone who logged nothing. There is nothing to confirm, and *"0 of 7"* is
  exactly the streak-shame BRAND.md forbids. Most likely to hurt someone if we get it wrong.
