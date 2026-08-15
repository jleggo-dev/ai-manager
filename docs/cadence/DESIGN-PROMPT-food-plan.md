# Design prompt — the coach builds a food plan (and keeps adjusting it)

Hand this to design alongside `DESIGN-BRIEF-nutrition.md`. That brief is about **where the food
surfaces live**; this one is about **the coaching loop that has to run through them**. They should
be designed together — the loop is what the IA exists to serve.

---

## The thing that is missing, in the owner's words

> "Coach needs to build a food plan. That doesn't mean recipes/suggested food — but it does mean
> **macro targets**. If coach isn't supplying macro targets, then we have no baseline. If I am
> trying to lose or gain weight and I follow the targets to a tee, and I don't lose/gain weight or
> I'm doing so too quickly to be healthy, then **coach needs to start adjusting the macros** —
> this is the whole point of the coaching. We actually should have a way to track
> **micronutrients** as well, because maybe I'm just trying to find a healthy transition to a
> vegetarian diet (and I'm not trying to lose/gain weight)."

## What already exists in code (do not design around its absence)

- **Initial targets.** `nutrition-baseline` proposes daily macro targets once a goal warrants them
  and none are set. Confirm-first: nothing applies without a tap.
- **The adaptive loop — the actual coaching — is BUILT.** Weekly (throttled by `last_reviewed`), it
  computes the user's *actual* weekly rate from their weigh-in series, compares it against a safe
  rate for their bodyweight, classifies the pace, and asks for **adjusted** targets given the
  trend. Follow the targets, don't move — or move too fast — and it proposes a change.
- **Micronutrients now flow end to end** (shipped with this prompt): fibre, sodium, iron, zinc,
  vitamin C, calcium, potassium and **B12** are carried from real food data (USDA / labels / Open
  Food Facts — never model-guessed) through the log into day totals.
- **Reference intakes exist as a lookup**, not a model output: `micronutrientTargets(sex, age)`
  returns published DRI figures, each marked `floor` ("eat at least") or `ceiling` (sodium only).

**So the engine is real. What it has never had is a place to happen and a voice to happen in.**

## The three problems to design

### 1. The coach cannot see or set any of this
The whole engine surfaces in exactly one place: a card inside a meal task. The coach — who the
owner says should own the food plan — has no way to read targets, propose them, or explain an
adjustment. Where does the target conversation *live*, and what does the hand-off look like when
she proposes a change? (The plan-change card is the established pattern: she proposes, a card shows
exactly what would change, the user taps.)

### 2. Everything keys off the scale
Targets are only proposed when the goals imply weight change, and the adaptive loop reads the
weigh-in trend alone. The owner's vegetarian-transition case has **no weight goal** — so no targets,
no loop, and nothing watching the nutrients that actually matter there. **What is the non-weight
mode?** A plan whose success is *adequacy* (hitting protein, iron, B12) rather than a number on a
scale, reviewed against whether the diet is holding up rather than whether the weight moved.

### 3. Micronutrients have data and no display
Eight nutrients now reach the day totals with real numbers and published targets. Nothing renders
them. Open questions for design:
- Are they always visible, or only when a goal makes them relevant (the vegetarian case)?
- **Floors and ceilings must not look alike.** Sodium is the only ceiling; drawing it as a goal to
  fill would be actively bad advice.
- Micro totals are a **floor, not a measurement** — they only count food we have real data for, so
  a hand-typed meal contributes macros and no micros. How is that honestly shown without making
  the user feel they are being marked down for logging casually?

## Constraints

- **Never judge food.** Count what happened, never what broke (BRAND.md). A met target is silence,
  not a green tick; a missed one is information, not a failure.
- **Confirm-first, always.** Nothing about a target changes without a tap — including an
  adjustment the coach is confident about.
- **Safety is not negotiable.** The adaptive loop already refuses to chase an unsafe rate; the
  design must never make the fast path look like the successful one.
- Micronutrient targets are a **lookup**, and the UI should never imply the coach invented them.

## The one question worth answering first

The owner also asked: *"Is my weekly weigh-in part of the weekly check-in process?"* Today: **no.**
They are two unconnected Sunday system tasks (weigh-in 08:00, check-in 20:00), and the check-in is
currently a checkbox — the `weekly-readout` job exists in config with **no caller anywhere**.

That is very likely where this whole loop belongs: a weekly moment that reads the weigh-in, reads
the week's food, and is the natural place for the coach to say "here's what I'm seeing, here's what
I'd change." Designing the weekly check-in as the home for the adaptive review would give the
engine a body — and would make one Sunday task out of two.
