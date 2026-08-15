# Design brief — the nutrition module has no front door

**Status:** open, for design. Raised by the owner from a device test, 2026-08-15.
**Context you already have:** `docs/cadence/BRAND.md`, `docs/cadence/PLAN.md` (food module slices 2E/2F,
commit `7004aad` "food without a Food tab").

---

## The owner's own framing (this is the spine — please design against it)

> "I think we think of the popup as **quick log** and the other food tab as a more detailed way to
> **manage nutrition**. But coach should be providing a place/manner to actually **discuss food
> habits and put together a weight loss plan**." — and, separately: "they need to know about
> **allergies** etc too."

Three surfaces, three jobs:

| Surface | Job | Today's reality |
|---|---|---|
| **Quick log** (the meal-task sheet) | "I ate this, write it down" — seconds, no navigation | Exists, works, just shipped a big fix (#208) |
| **Manage nutrition** (the ex-Food tab) | Recipes, week's meals, shopping, targets, history | **Unreachable.** See below |
| **Coach** | Discuss habits, build a weight-loss plan, learn allergies | No food-planning conversation exists |

---

## The bug underneath most of the complaints (fix regardless of the redesign)

`TrailFoodStrip` renders `null` unless a kcal target exists. That strip is the **only** door to
`TodayFoodSheet`, which is where Recipes / This week's meals / The shop relocated when the Food tab
was dropped. The owner's `macro_targets` is `null` — as it is for **every new user**.

```
no targets → no strip → no TodayFoodSheet → no recipes, no meal plans, no shop, no targets shown
```

The door is gated on the thing the door leads to. `FoodView.tsx` (the old tab, ~600 lines) still
exists but is referenced only by its own test — dormant by design, as the flagged fallback for
exactly this failure, never activated.

**Design question, not engineering:** what is the permanent home for "manage nutrition"? A restored
tab? A always-visible strip that reads differently before targets exist ("set up your targets ›")?
A door from the quick-log sheet (the owner's own suggestion: *"maybe it should be, but only from
the log meal frame?"*)?

---

## The rest of the owner's report, verified

1. **"I'm not sure what matching does."** The button says *"Match it — I confirm next."* "Match" is
   internal vocabulary (the resolver matches text against saved foods). Needs plain words.

2. **"Instead of 'logging' it should be 'Assess meal — then confirm', because we're actually
   assessing."** An owner copy ruling. It also reframes the whole surface honestly: we estimate,
   they confirm. Worth propagating past this one button.

3. **No way to add a forgotten item to a multi-ingredient meal.** Single-food drafts have "add
   another thing"; the new multi-ingredient card has no equivalent. Re-tapping the meal is the only
   route, and it isn't obvious that it works.

4. **Targets are invisible** — because they are unset, and nothing anywhere offers to set them.
   Settings has `NutritionTargets`, and a baseline proposal flow exists (`useNutritionBaseline`),
   but neither is reachable from any food surface. Per the owner, this is coach work: the coach
   should propose targets as part of a weight-loss conversation.

5. **"I'm supposed to be able to get advice on the meal, but there's nowhere to do that."** Correct.
   `plate-advice` ("A READ, NOT A RULING") is wired ONLY inside the photo branch of the meal sheet.
   Type your meal instead of photographing it and the affordance does not exist.

6. **Re-opening a logged meal shows macros but no progression** — no "of target", no day context.
   Same root cause as #4: with no targets there is no denominator.

---

## What design is being asked for

1. **The information architecture across the three surfaces above** — especially where "manage
   nutrition" lives and how it is reached before a user has targets.
2. **The path into targets**, given the owner wants it to come from a coaching conversation rather
   than a settings form. What does the hand-off look like — coach proposes, card confirms?
3. **Where meal advice belongs** so it is available for typed meals, not only photographed ones.
4. **Allergies/dietary profile**: they exist in the data (`dietary_profile`, `assessDietarySafety`,
   the coach's `get_dietary_profile` tool) and gate recipe suggestions today, but there is no place
   a user is ever *asked*. Where does that conversation happen, and where is it visible afterwards?

## Constraints worth knowing before you draw

- **Confirm-first is non-negotiable** across every food surface: nothing counts until the user taps.
  The card shows what will be logged; the log stores exactly that.
- **Never judge food.** BRAND.md: count what happened, never what broke. No red, no "over budget"
  framing, no streak-shame.
- The quick-log sheet was just rebuilt (#208): one omnipresent composer, Snap and Scan as the only
  other doors, and a multi-ingredient card that keeps the user's own quantities. Iterate on it
  rather than replacing it.
- Everything renders in a phone-shaped webview inside a Capacitor shell.
