# Meal logging — the meal is the unit of the write

Canonical build spec for the 2026-09-02 nutrition-logging rework. Source: the owner's design
project, canvas **"Cadence Meal Logging"** (three design turns; turn 3 is final), plus four owner
rulings taken at build kickoff. Where this doc and the canvas disagree, the canvas wins; where
either is silent, the rulings ledger below wins.

## The model (turn 3 — final)

**A meal contains items and recipes. Nothing else.** There is no "group" object:

- Bracketing rows together *is* making a recipe — at first unnamed, scoped to that meal.
- Naming it and saving it are the same act: give it a name and it's in the cookbook.
- One object, one number: a recipe has a **yield**. Yield 1 is what a person would call a saved
  meal ("Chia bowl"); yield N is what they'd call a recipe ("Chickpea stew, makes 4"). The
  meal-vs-recipe fork evaporates.
- The word "recipe" is never used at creation time. The card asks **"What do you call this?"**
  Only the cookbook shelf and the coach say "recipe".

**The meal is the unit of the write.** Four foods land as one meal with four rows — never four
meals, and never four "where should it sit?" questions. `MealSlotChoice` is deleted, not demoted.

**A meal is a window, not a transaction** (4F, previously ruled). A meal stays open for a stated,
visible window (e.g. "adds until 10:30"); the 09:40 latte joins breakfast instead of becoming an
orphan snack. Later food starts a new meal.

## Owner rulings (2026-09-02, build kickoff)

1. **Structure: 1b — the meal is the screen.** You open *Breakfast*, not *Log*. The draft meal is
   a real, persistent object; pickers are sub-sheets that return into it. **Constraint added by
   the owner: the greater Food screen (Day/Week/Kitchen) must stay reachable — the meal screen is
   the logging surface, not a wall.** A one-food express lane survives.
2. **Add flow: B2 — ＋ on the row.** Search results and recents carry a ＋ that adds at the food's
   default serving and becomes a stepper in place. The serving sheet only opens for foods with
   genuinely ambiguous servings (marked ›). The sheet that does open never dismisses to nowhere:
   its button says *Add to breakfast* and returns to search with the field cleared and the
   keyboard up.
3. **Gestures: the full set now**, plus every gesture's "boring twin" in the ⋯ menu. Pull the
   notch down over rows → they bracket into a recipe. Drag a row left out of the indent → it
   leaves. Drag a loose row right into the indent → it joins. Grab either end of the bracket →
   resize. Last one out ungroups automatically. Menu twins: *Group things · Take something out
   (tick-list) · Add to this · Ungroup · It makes several portions (yield)*.
4. **Scope: everything in one push**, including the Sunday sweep (S3) and the retroactive tidy
   (S4).

## Rulings ledger (from the canvas — binding)

**The bracket grammar** (one mark, learned once, drawn identically in the meal, the diary, the
cookbook, and coach proposals):
- Open bracket: name pill at the head, member rows indented beneath.
- Collapsed: one row — `Chia bowl · 4 things · 348` with a ⌄.
- Loose item: no bracket, no indent.
- Yield on the same mark: green bracket = one portion; butter bracket = makes several, and the
  diary shows `1 of 4 servings` with **no new row type**.
- Refused: nested brackets, brackets spanning meals, a bracket carrying a separate total into the
  day.

**Making and unmaking:**
- Grouping changes no numbers, ever ("it's counted either way — this only changes how your day
  reads back").
- Naming is skippable; unnamed reads as "4 things" and still collapses.
- Suggested names come from the user's own raw words (she typed "chia bowl" → first chip is
  *Chia bowl*). Nothing invents a cheerful name.
- Grouping is not saving. Saving to the cookbook is a separate, refusable act.
- Ungrouping never removes food from the day — same kcal, read as five things instead of three.
- A recipe of one item isn't a recipe: taking the second-to-last member out dissolves the bracket.

**The add flow (B2 + the non-closing sheet):**
- The field clears, the keyboard stays. Focus never leaves search between adds.
- **Added is not logged.** Items land in the open meal; the meal is what commits. The strip reads
  `4 things · not counted yet`.
- Undo lives on the strip (pull the last add straight back out).
- Barcode and photo return to the same place — the fix is on the return path, every door inherits.
- The serving picker's internal rules are untouched (volume leads for produce/cooked-from-scratch;
  brands and meat lead with printed weight; both always offered; package servings borrow the
  volume words).
- No "add another?" confirmation, ever.
- A food is "ambiguous" (opens the sheet instead of one-tap ＋) when it carries several serving
  sizes worth asking about.

**The meal screen (1b):**
- Header chip carries the meal kind, inferred from the clock, changeable in one tap, asked once.
- Open, then closed by the clock; the window is visible on-surface, never a silent rule.
- An empty draft leaves no trace — no ghost diary row, nothing for the coach to see.
- Open fork adopted as drawn: **the open meal counts toward the day immediately, marked OPEN.**
- The one-food express lane skips the meal screen and writes a single-item meal.
- Amounts rule kept verbatim: an amount the user gave is never re-asked; a missing one is asked as
  chips, never a keypad. One unsettled amount holds the commit (MealParseCard's existing gate).
- Save-as comes after the meal exists. The on-the-spot offer (B3) appears after several quick
  adds — "Four things, one after another. Do they go together?" — a preview of the bracket, not a
  dialog. Declining is free; the Sunday sweep is the fallback.

**Editing a saved recipe does not reach backwards.** A logged meal keeps the recipe *as it was*;
the cookbook version moves on. (Designer's proposal, adopted — snapshot at log time.)

**The cookbook shelf (S2):** one shelf, no Recipes/Meals/Foods tab triple. Bracketed rows; the
only on-screen distinction is yield ("ONE PORTION · TAP AND IT'S LOGGED" vs "MAKES SEVERAL · PICK
A PORTION"). This is the *logging-side* picker (the meal screen's "start from one of yours" /
My meals door). The Kitchen tab keeps its prep framing and its own no-logging ruling — the two
surfaces read the same data.

**The front door (S1):** saved meals become first-class rows under "YOU USUALLY HAVE AT THIS
TIME", drawn with the same bracket — a five-item breakfast is two taps.

**The Sunday sweep (S3) — deterministic finds, the model judges, the coach proposes:**
- Deterministic: which item sets co-occur, how often, in which slot; whether a cooked thing was
  eaten more times than it was logged as made. Counts, not opinions.
- The model's job: naming from the user's own words, "a two-item set isn't worth a row", spotting
  yield, knowing a muffin is a passenger not a member.
- Never: save without asking, propose more than three, propose something seen once, change a
  logged number, silently regroup the past.
- Rails: ride-along proposals with toggles and one commit — never per-proposal accepts, never
  auto-applied.
- **Retro tidy (S4)** is opt-in and reversible: accepting a recipe offers to re-read the week
  behind you (five flat breakfasts → five bowls, same numbers; days with an extra item keep it
  loose, outside the bracket).

## Nomenclature (schema/prompts vs UI)

| Canonical (code/DB/prompts) | User-facing |
|---|---|
| `recipe` with `yield_servings` (existing `servings`) | "recipe" only on the cookbook shelf and in the coach's mouth |
| meal `parts` (a recipe instance inside a meal) + loose `items` | the bracket; "4 things" |
| `draft` / `open` / `closed` meal state | "OPEN · adds until 10:30" |
| sweep `candidates` → coach `proposals` | "What I noticed" |

Banned words stay banned ("captured" in user copy; no streak-shame; the sweep proposes, never
applies).

## Contracts (authored first, single hand)

- **Migration** [`migrations/cadence/0053_meal_parts_and_draft.sql`](../../migrations/cadence/0053_meal_parts_and_draft.sql):
  `nutrition_logs.parts jsonb`, `state open|closed` (legacy = closed), `closes_at`; partial index on
  open; `users.pending_food_sweep` + `last_food_sweep_at` (the practised pending-jsonb rail).
- **Shared types** (`packages/cadence-shared/src/types/nutrition.ts`): named `MealItem` (+`part?`),
  `MealPart`, `MealState`, `NutritionLog.parts/state/closes_at`, `FoodSweepProposal`,
  `PendingFoodSweep`.
- **Client API** (`apps/cadence-web/src/lib/api/meal-draft.ts`): the full endpoint contract —
  draft open/rejoin (idempotent per slot+date), append food/recipe/parsed, remove, amount, slot,
  close (empty → deleted), parts ops (`group/ungroup/rename/set_yield/add/remove`),
  save-part-as-recipe, sweep get/commit/tidy/revert/dismiss. Server routes are built to match.

Key semantics the contract fixes: append-recipe snapshots the recipe's scaled ingredients into the
part (cookbook edits never reach backwards); parts ops work on open AND closed meals; a part below
two members dissolves; an emptied DRAFT stays open (only expiry/close deletes an empty draft);
`logMealFromRecipe`'s old positional item[0] convention is superseded by parts — legacy rows get a
reader-side adapter, no data migration. Draft window: `closes_at = opened_at + 3h`, lazily
enforced (reads close overdue drafts; empty ones are deleted). Draft dates respect
`X-Cadence-Timezone` where present.

### Contract addenda (P1, signed off at integration)

- Draft mutations (append/remove/amount/slot) on a non-open meal → **409**; a touch past
  `closes_at` enforces the window in place (closes or deletes) before refusing. Parts ops stay
  legal on closed meals.
- appendRecipe on a recipe with no per-ingredient numbers snapshots as ONE summary row inside the
  part (name, qty = servings, est from macros_per_serving) — the bracket never puts an uncounted
  meal on the day.
- `servings_logged` defaults to `yield_servings` when unsent, so yield × per-serving always equals
  the plate.
- `FoodSummary.ambiguous` flows through the client parser (type + pass-through, no behavior).
- Meal totals recompute as the item-est sum with micros (`sumItemNutrients`), not the four-key
  rounding.

### Contract addenda (P3, signed off at integration)

- Commit writes a tidy residue into the same `pending_food_sweep` jsonb (`proposals: []` +
  `tidy_ready[]`); `GET /nutrition/sweep` reports null once proposals are empty, so the residue
  never re-surfaces the card and never blocks next week's sweep. External contract unchanged.
- "Cooked more than logged" ships as the identical-meal signal (`identical_meal_days ≥ 3` → yield
  hint). Bracketing flat logs onto an *existing* cookbook recipe is a different commit contract —
  logged as a follow-up, not built.
- The `sweep-food-recipes` job is in config but **not synced** — `sync-jobs.ts` is a post-merge
  step, called out in the PR.

## Parcels

Wave 1 (parallel, disjoint files):
- **P1 SERVER-CORE** — migration apply, draft lifecycle + parts services, routes, day-read
  integration (open meals counted, marked open), `ambiguous` flag on food summaries, tests.
- **P2 BRACKET-UI** — the bracket grammar as props-only components + the full gesture set +
  select-mode + ⋯ twins + naming/yield cards, own CSS family (`.mb-*`), tests. No API calls.
- **P3 SWEEP-SERVER** — deterministic candidate detection, `sweep-food-recipes` AI job (gpt-class,
  strict schema), pending rail + routes, tidy/revert, tests. Own route file; no shared-file edits.

Wave 2 (after wave 1):
- **P4 MEAL-SCREEN** — `useMealDraft`, `MealScreen` (1b), `MealAddPanel` (B2), door rewires
  (photo/chat/voice/barcode append into the draft), B3 offer, express lane.
- **P5 INTEGRATION** — mount-point rewiring (FoodHome, MealCapturePanel, quick-add), deletion of
  `MealSlotChoice`/`mealSlotting` and the settle flow, orphaned CSS.
- **P6 READS** — diary parts rendering + legacy adapter, cookbook shelf (S2), front-door usuals
  (S1).
- **P7 SWEEP-CLIENT** — "Your week in food" (S3) + retro tidy (S4) surfaces.

Wave 3 — integrator: mounts, gates (tsc/eslint/vitest per workspace), browser verification,
brand pass, PR. Job sync (`sync-jobs.ts`) is a post-merge step and is called out in the PR.
