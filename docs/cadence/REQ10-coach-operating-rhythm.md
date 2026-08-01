# Req 10 — The coach's operating rhythm: horizons, triggers, and memory

**Status:** design, 2026-07-31, from an owner working session ("give the coach the tools they need
— how do we get them to use all of them? what's our plan to help them get to their plan? how do we
get around the forgetfulness of context limits?"). Companions: `PLAN.md` §5a/§5b (coaching
architecture), `MEMORY-ARCHITECTURE.md` (packs/memory), `REQ8` (tool catalog),
`REQ9-mind-tools.md` (mind toolkit + the shell law), REQ7 (reflection layer; on branch history).

---

## 1. The question this answers

The coach must operate at five horizons at once — the goal, the month-by-month path to it, the
weekly routine, the daily composition, and the disruptions — using every tool it has, without
ever making the user repeat themselves. LLM calls are stateless and context windows are finite.
Are we set up for this?

**Answer: yes, structurally — the spine is proven — with three named gaps** (§5–§7). This doc
writes down the operating model so it stays deliberate instead of implicit.

## 2. The two laws

**Law 1 — the harness owns every trigger; the LLM judges inside calls, never between them.**
The coach doesn't "remember" to do things. Every coaching act is: a deterministic trigger → a
deterministically composed context pack → one stateless job call → structured output →
normalize, clamp, persist. "The coach uses all its tools" reduces to an auditable question:
*does the trigger map (§4) have holes?* Never rely on model initiative; encode initiative in
the harness. (The tool catalog is the same law applied to composition: the coach picks only
from an injected, compile-locked palette — it never free-recalls what tools exist.)

**Law 2 — the ledger is the memory; packs re-brief; nothing pillar-flavored ships in the frame.**
State lives in the database, never in a conversation. Raw logs are kept forever; rollups and
case notes are caches over them; every call is re-briefed by the pack composer. The brand
promise ("never makes you repeat yourself") is implemented as **pack discipline, not model
memory**. Corollary for chrome (from the now-door correction, REQ9 §3): the shell offers
neutral doors; the coach decides what's behind them per person.

## 3. The five horizons — what runs each today

| Horizon | Machinery (as built) | Status |
|---|---|---|
| **Goal** (months→years) | goals + milestone/target/recurring, Scribe capture, goal cap + focus budget | ✅ |
| **Path** (month by month) | — nothing first-class. Per-activity progression exists; the *phased arc* between goal and week does not | ❌ gap §5 |
| **Week** (routine) | the living plan: synthesize → vet → commit; RRULE occurrences; consistency; the weekly check-in **as a plan occurrence** | ✅ |
| **Day** (composition) | day-recap (request+cache), prescribe-session (request+cache, catalog-fed), per-meal tasks, goal-aware ＋ (past tense), the now door (present tense — REQ9 §3, being designed) | ✅ + §6 |
| **Disruption** | detours, replan endpoint, situation-assess + tripwires, streak freezes/episode shielding, weather substrate | ✅ but see §7 |
| **Reflection** (cross-horizon) | REQ7: rollups, notable_deltas, the read-only Analyst, experiments | 📄 designed, not built |

## 4. The trigger map (as built — verified 2026-07-31)

Three trigger species exist today. **There is no autonomous clock**: the only cron in the
deployment is an AI Admin infrastructure health tick (`vercel.json` → `/api/cron/tick/health`,
daily). Nothing coach-side fires on a schedule.

| Species | Mechanism | What uses it |
|---|---|---|
| **Request-time + cache** | user opens a surface → job runs once, result cached (per user+day / per occurrence) | day-recap, prescribe-session, context packs, plate advice |
| **The plan as scheduler** | the coach schedules its *own future triggers* by putting occurrences on the committed plan — the user taps them | weekly check-in, weekly weigh-in, daily meal logs, every practice |
| **Explicit endpoints** | user or app action | replan, lock flow, capture jobs, `/did` ad-hoc logging |

The plan-as-scheduler species deserves naming because it's the elegant one: the coach's
"initiative" is *visible, consented, and on the calendar* — exactly the brand's posture (the
coach proposes, the user disposes). Its limit is the third gap:

**Everything above requires the user to show up.** `situation.ts` + `tripwires.ts` reason about
absence ("days since the user did anything real") — but they only *run* at request time, so a
tripwire about silence can only fire when the silent person returns. Silence is invisible (§7).

## 5. Gap 1 — the path object (month by month)

The bridge between a goal ("half-marathon in November") and this week's plan is currently
implicit in the synthesize prompt's judgment. Make it first-class:

- **`path`** on the goal: an ordered list of **phases** — `{name, intent, weeks, checkpoint}`
  ("Base — build the aerobic floor — 4 wks — 20km week comfortable"). Authored by a job at
  goal-commit (vetted like plans), **consulted by** synthesize (the week serves the current
  phase), day-recap ("week 2 of base"), and the weekly check-in (**advanced by** recap: phase
  checkpoint met → next phase; missed → the phase bends, REQ4-style, never resets).
- Deterministic spine, AI surface (the REQ6/REQ9 principle): phase advancement is a rule over
  rollup numbers; the *narrative* of it is the coach's voice.
- Area-neutral by construction: a practice path ("sit daily → longer sits → a retreat day") and
  a strength path phase the same way.

## 6. Gap 2 — the now-menu composer (the door's kitchen)

The generalized now door (REQ9 §3, `design/now-door-brief.md`) needs its menu composed ahead of
the tap — **zero LLM calls at tap time**; nobody mid-spiral waits eight seconds for a menu.

- **`compose_now_menu`** (Broker-tier job): reads plan + goals + case notes + recent logs →
  3–5 menu items, each bound to **a catalog tool with params** (`breath(box,6)`,
  `reps(pushups,20)`) or **a plan activity** (stretch session), + one optional **pinned express
  item** for users whose coach wants one tap between them and one action. Free-text line
  ("something else — tell me" → chat) is always appended app-side.
- **Rebuilt on:** plan commit/replan, weekly check-in close, and any coach-chat exchange that
  changes the situation; cached like day-recap otherwise. Normalize clamps items to
  tools-that-exist + activities-that-exist (the catalog law).
- **Accepted from Design 2026-08-01:** the composer **may emit zero items** — an empty menu hides
  the section rather than inventing filler (a user with nothing sensible to offer right now is a
  real state, not an error). **Stale rows are dropped, never rendered** — an item referencing a
  deleted activity or a since-completed occurrence disappears at read time rather than failing on
  tap. And **promotion to the trail happens only after repeated use** from the sheet — the menu
  observes what someone actually reaches for before the coach schedules it, so the trail stays a
  record of agreement rather than of inference.
- Menu items log through the same rails as everything (occurrence log / `did`), so extra work
  credits progression and the day footer ("also today: 6 breaths").
- **Second consumer — "Something else?"** (REQ9 §3.4): a practice that isn't landing opens the
  same menu, filtered to what can be done right now (a different breathing pattern, a grounding
  game, a walk). One composer, two entry points. **It carries no emergency content** — the
  escalation ladder was withdrawn 2026-08-01; see REQ9 §8 for the scope ruling.

## 7. Gap 3 — the clock (acting when the user is gone)

The one trigger species we lack: **wake-without-the-user**. Proactive check-ins are already
designed (PLAN §5a: configurable cadence, opt-in) but nothing can fire them. Add **one Vercel
cron → a Cadence tick endpoint** (daily), which walks users and evaluates *deterministic*
wake-rules: silence tripwires (situation-assess finally runs on absence), recap-due nudges,
path-checkpoint dates, freeze-expiry warnings. Each rule's *action* is the existing machinery
(a nudge job, a proposed detour) — the tick contributes only the clock. Guardrails: opt-in,
capped frequency, hearth-not-scoreboard copy, and the tick *evaluates rules* — it never gives
an LLM standing permission to message people.

## 7b. Check-ins are calibration, and re-entry is not resumption (owner ruling 2026-08-01)

**What a check-in is for.** A check-in — weekly, or after an absence — is not a status report and
not a compliance review. It is **calibration**: fine-tuning the plan, and honestly seeing how the
person is doing. The weekly check-in already exists as a plan occurrence (§4, the
plan-as-scheduler); this ruling is about what it's *for*, and it applies to the coach's framing
of every check-in.

**Re-entry must never silently resume.** Someone who drops off for three weeks and comes back
should not be handed the plan they abandoned, ticking along as if nothing happened. Fitness fades,
life moves, and a plan built for who they were a month ago may not fit who they are today —
resuming a stale plan sets them up to fail at it. The coach instead: says it's good to see them
**without guilt** (never "you missed 14 sessions", never making them account for themselves),
asks what's changed, finds an honest baseline, and **re-calibrates the plan to meet them there** —
smaller if that's the truth — before getting them going again.

**Gap: there is no `returning` intent.** `coach-context.ts` defines
`onboarding | initial | ongoing | disrupted`. `disrupted` handles a *described* episode (travel,
illness) and builds an additive temporary plan — the wrong shape for silent re-entry, where the
coach knows nothing and the base plan itself may be stale. Add **`returning`**, selected when the
gap since the last real activity crosses a threshold; the `missed_threshold` tripwire already
detects the condition, and the system prompt now carries the intent's framing. Its outcome is a
re-calibrated plan (an ordinary replan), not an additive overlay.

**Already built, worth naming:** the `consistency_outcome_divergence` tripwire (`tripwires.ts`,
`highConsistency: 0.8`) fires when someone is showing up but the outcome isn't moving — which is
exactly the "you've done everything right and nothing's changed; worth asking a doctor" pattern
that REQ9 §8 puts *in* scope. The detection exists; the coaching move on top of it is the work.

## 7c. Nudges — stickiness without guilt (owner steer 2026-08-01)

We want Duolingo-grade stickiness with none of the shame: notifications, and eventually email and
SMS. Today Cadence can only speak when the app is open, so **every nudge depends on the §7 tick**.

- **Channels:** push first (Capacitor iOS is already the planned wrapper), then email, then SMS —
  each opt-in, each with quiet hours, each rate-capped. Never a channel the person didn't choose.
- **Content is coaching, not scolding** — "your run is still there if you want it" beats "you're
  falling behind." Count what happened, never what broke (BRAND); a missed day is information.
  **Absence earns a warm re-entry invitation, never a wellbeing inference** (REQ9 §8).
- **Deterministic rules pick the moment; the coach writes the sentence** — same split as
  everything else. Escalation decays: a couple of nudges, then it goes quiet rather than nagging.

## 8. Forgetfulness — why context limits don't threaten this design

- **The ledger is the memory.** Raw logs (`raw_text` always kept) outlive every summary.
- **Packs are the working set.** Every call is re-briefed: plan, case notes, per-topic rolling
  summaries, recent logs. The model never needs recall, only briefing.
- **Rollups are a cache, never a replacement** (REQ7). Compression loses nothing permanently
  because the granular ledger stays.
- **The Analyst is the escape hatch** (REQ7, to build): "something from eleven months ago no
  pack would think to include" — slow, out-of-loop, read-only, derive-and-cache.
- **The real risk is pack curation, not model memory:** the coach is exactly as good as what
  the composer shows it. That makes REQ7's case-notes + derived-metrics the right next big
  build after Mind — and makes "the user can correct her case notes" (REQ6 open fork) matter.

## 9. Build order

1. **Now-menu composer + generalized door** (§6) — unblocks the Mind build order (REQ9 §6);
   breath ships as a payload behind it.
2. **Path object** (§5) — small schema + one authoring job + two consult-points; the biggest
   coaching-quality jump per unit work.
3. **The tick** (§7) — one cron + rule walk; turns tripwires real.
4. **REQ7 reflection layer** — rollups → case-note correction → Analyst → experiments.

## 10. Open questions

- Path storage: on the goal vs. on the plan vs. its own table (leaning: own table, FK goal).
- Phase advancement rules: how much rollup evidence before a checkpoint "counts"?
- Tick cadence + quiet hours; per-user opt-in surface (Settings? the coach asks?).
- Does the now-menu learn from taps (rank by use) or stay purely coach-authored? (Leaning:
  coach-authored, use-signal in the pack.)
- When chat *changes the situation* mid-week, what marks the now-menu stale — Scribe emitting a
  `situation_changed` flag, or re-compose on every chat close? (Cost vs freshness.)
