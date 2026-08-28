# The food engine — architecture, gaps, and the parallel build plan

Written 2026-08-25, after the meal-prep gap-map (78 agents, 40 verified gaps, 30 refuted). This is
the **software** design: how the pieces fit and who owns what. UI design lives in the Claude Design
docs and in PLAN.md §"Food Journey".

Companion documents: [PLAN.md](PLAN.md) §"Meal prep, end to end" holds the requirements (MP0a–MP39)
and the owner rulings; [TOOL-HARNESS.md](TOOL-HARNESS.md) holds the governing principle and the
rules for adding a tool.

---

## 1. Evaluation — what the plan actually is now

The gap-map produced 40 verified gaps. After three owner rulings the shape changed considerably, and
it is worth being blunt about how:

**It got smaller, twice, because we were solving problems we did not have.**

- **MP36 (a yield model) is closed.** Two entries in PLAN.md talked themselves into an elaborate
  volume/mass reconciliation with cooking-loss modelling. The owner's ruling — a recipe's servings
  are *user-stated*, and per-serving is Σ ÷ servings — dissolves it. Even division is immune to
  evaporation: Σ/4 is the same number whether the pan gave up 600 g of steam or none. The density
  question only ever existed because we were trying to price a *cup*, which nobody asked for.
- **Two requirements were rebuilds.** MP9 wanted batched ingredient resolution; `priceMealItems`
  already is exactly that, in production. MP24 wanted a portion picker; `RecipeLogConfirm.tsx` is
  already a complete one with a 0.25-step servings input. Both M → S, both now *wiring*.
- **The rejection-channel question was answered by refutation.** Four channels already exist and are
  tested. What is missing is that two call sites do not use them.

**What did NOT get smaller is the part nobody had looked at: the units are wrong in production.**
That is now the whole first wave, and it is the only work that blocks everything else.

**And one thing got bigger.** I had MP21 down as blocked on a conflict between the 2026-08-19
withdrawal of `log_nutrition` and the test case's *"just tell Cadence in chat that they ate it."*
There is no conflict — see §7. The withdrawal was about a bad surface, and chasing that down found
the last place in the food stack where a regex drives the software and the Coach is managed into not
contradicting it. MP21 is unblocked; MP40 is new and is the real work.

---

## 2. The architecture

### 2.1 The defect at the centre

There are **two independent unit resolvers**, and they disagree.

| | Log path | Recipe path |
|---|---|---|
| Where | `food-pricing-portion.ts` → `portionFactor` | `recipe-macros.ts` → `macrosForIngredientAmount` |
| Mass/volume gate | **absent** — `absoluteAmount(unit, qty)` runs whenever `base_unit` is g *or* ml, so `500 ml` of a `base_unit:'g'` food returns 500 "grams" (MP0a) | present and correct — `ml` only converts when `base_unit === 'ml'` |
| Serving match | `inferServingIndex(text, food)` | exact unit, then `label.includes(unit)` — unbounded substring, so `ml` matches `15ml (16g)` (MP0b) |
| **When the unit is not understood** | `servings[index] ?? servings[0]` | `macrosForLog(food, { quantity })` — the **default serving** |

**The last row is the root cause of every mispricing in the audit.** Both resolvers, having failed
to understand a unit, silently substitute the food's default serving and multiply by the quantity.
That is why `1 tbsp rosemary` lands on a 100 g default and `3 shallots` lands on three of them. The
failure is not that the tables are incomplete — it is that *not knowing* is expressed as *a plausible
number* instead of as a question.

We already know the correct behaviour, and it is already written down twice in this codebase:

> *"A food that has a cup serving should use its own cup, and one that doesn't should not have a
> volume invented for it."* — `ABSOLUTE_UNITS`, `food-pricing-portion.ts`

`resolve_portion` exists precisely to be the thing asked when that happens. Neither resolver calls it.

### 2.2 The target design

**One portion path. No silent fallback. An unknown unit is a question, not a guess.**

```
        a person's words
               │
               ▼
     parseMeasure()                    portion-measure.ts — pure, no I/O
     mass? volume? count? qty?
               │
               ▼
     matchMeasure(food, measure)       food-source-report.ts — unit-word match, never substring
               │
       ┌───────┴────────┐
    found              not found
       │                    │
       │                    ▼
       │        listFoodPortions()     this user's corpus (0043)
       │                    │
       │            ┌───────┴────────┐
       │         found            not found
       │            │                    │
       │            │                    ▼
       │            │        resolve_portion  →  model returns GRAMS, guarded by density,
       │            │                            recorded privately, promoted on consensus
       │            │                    │
       │            │            ┌───────┴────────┐
       │            │        resolved          refused / unknown
       ▼            ▼            ▼                    ▼
   ┌──────────────────────────────────┐   ┌────────────────────────────────┐
   │ grams  →  priceFood(food, grams) │   │ UNRESOLVED, with the reason.   │
   │ code does the arithmetic         │   │ Never a default serving.       │
   └──────────────────────────────────┘   └────────────────────────────────┘
```

Both the log path and the recipe path call this. `macrosForIngredientAmount` stops being a second
implementation and becomes a caller.

### 2.3 The layers, and what each may decide

| Layer | Files | May decide | May NOT |
|---|---|---|---|
| **Measure vocabulary** | `portion-measure.ts` | what a phrase means; whether a weight is physically possible | anything requiring a database or a model |
| **Source adapters** | `food-sources/*` | how one publisher's payload maps to a `Food` | which source wins |
| **Report** | `food-source-report.ts` | how a `Food` reads at a measure; what the guards *observed* | to drop a candidate for failing a guard |
| **Fan-out** | `food-source-fanout.ts` | which rungs are eligible and what actually ran | to rank, filter, or pick |
| **Portion resolution** | `portion-resolve.ts` | whether to buy an answer; whether to keep it | to return nutrients |
| **Pricing** | `food-pricing*.ts` | the arithmetic | to invent a unit |
| **Recipe** | `recipe.ts`, `recipe-macros.ts` | Σ ÷ servings | how many servings — the user states it |
| **Harness** | `retrieval/*`, `coach-actions.ts` | what to expose and how it reads | the answer itself |

The invariant across all of them, from TOOL-HARNESS: **software returns facts, the Coach
adjudicates; guards report as evidence; the model says WHAT and the store says HOW MUCH; whatever
she works out is written back so the deterministic rung hits next time.**

### 2.4 Two engines that already exist and must not be re-implemented

- **`priceMealItems(userId, items[], opts)`** (`food-pricing.ts:302`) — one call that prices N named
  ingredients with shared per-user ranking context loaded once. Recipe capture must call this
  instead of its own per-ingredient loop.
- **`RecipeLogConfirm.tsx`** — a complete portion-aware confirm: servings input, min 0.25, step 0.25,
  live macro scaling. The one-tap log surfaces must route through it instead of hardcoding quantity.

---

## 3. The parcels

Nine parcels, grouped **by file ownership** so that agents working in parallel cannot collide. The
ownership column is the contract: an agent edits only its own files, and a parcel that needs a change
in someone else's file states it as a dependency instead of making it.

| # | Parcel | Owns (exclusively) | MPs | Size | Wave |
|---|---|---|---|---|---|
| **P1** | **Portion engine** — one resolver, no silent fallback | `food-pricing-portion.ts`, `recipe-macros.ts`, `portion-measure.ts`, `food-source-report.ts` | MP0a, MP0b, MP0c, MP1, MP26 | L | 1 |
| **P2** | **Rejection channels & research gating** | `food-research.ts`, `food-sources/normalized.ts`, `food-pricing.ts` | MP35, MP37 | M | 1 |
| **P3** | **Schema, validation, job prompts** | `validation/food.ts`, `config/ai-admin/ai-admin.config.json` | MP28, MP12 | S | 1 |
| **P4** | **Harness plumbing & token discipline** | `retrieval/select-and-run.ts`, `coach-stream.ts`, `session-compaction.ts`, `eval-tool-selection-cases.ts`, `TOOL-HARNESS.md`, `HARNESS-V2.md` | MP0e, MP30, MP33, MP34 | M | 1 |
| **P5** | **Web portion & plan surfaces** | `apps/cadence-web/**` | MP3, MP18, MP19, MP20, MP24, MP39 | M | 1 |
| **P6** | **Recipe capture & the coach's write surface** | `recipe.ts`, `coach-food-classify.ts`, `coach-actions.ts`, `repos/foods.ts` | MP2, MP5, MP6, MP8, MP9, MP10, MP27 | L | 2 |
| **P7** | **Images into chat** | `routes/coach.ts`, `backend/ai-manager/chat-messaging.ts`, new `retrieval/label-function.ts` | MP13, MP14 | L | 2 |
| **P8** | **Meal plan & logging tools** | `retrieval/`, meal-plan services, `coach-actions.ts` (after P6) | MP16, MP17, MP21†, MP38 | M | 3 |
| **P9** | **Composition** — sub-recipes, recipe-aware pricing | `types/nutrition.ts`, `recipe.ts`, `recipe-macros.ts`, `food-pricing.ts`, migration | MP7, MP11, MP22, MP23, MP25, MP15 | L | 3 |

† **MP21 is blocked on an owner ruling** and must not start without it.

**Why the groupings are what they are.** MP26 (micros truncated) lives in `recipe-macros.ts`, which
P1 already rewrites — splitting it would mean two agents editing the same functions. MP2 (wire
`resolve_portion` into the recipe path) is a call-site change in `recipe.ts`, so it belongs to P6
even though P1 supplies the function. Every edit to `ai-admin.config.json` is serialised into P3
because it is one large shared file. P9 waits because it re-enters `recipe-macros.ts` and `recipe.ts`
after both have settled.

### Wave structure

```
WAVE 1  (5 agents, fully parallel — no shared files)
  P1 portion engine ·  P2 rejection channels ·  P3 schema/prompts
  P4 harness/tokens  ·  P5 web surfaces
        │
        ├── P1 merged unblocks ─────┐
        ▼                           ▼
WAVE 2  (2 agents)            P6 recipe capture   P7 images
        │
        ▼
WAVE 3  (2 agents)            P8 plan & log tools   P9 composition
```

Wave 1 is where the value is: it stops the mispricing, closes the audit's original question, and
fixes the token accounting that currently reports **zero for the most expensive turns**.

---

## 4. How each parcel is briefed

Every agent gets the same frame, and it matters more than the task list:

1. **Read first, in order:** `CLAUDE.md` (engineering conventions + the governing assertion),
   `docs/cadence/TOOL-HARNESS.md` (the principle and the tool checklist), this file §2, and the MP
   rows in PLAN.md that it owns.
2. **The principle it is serving**, stated in the brief, not just the change: *deterministic code is
   a tool the Coach calls; guards report rather than veto; the model says WHAT and the store says HOW
   MUCH; write back so the fast rung hits next time.*
3. **Its exclusive file list.** Touching a file outside it is a review rejection, not a merge
   conflict to resolve later.
4. **The failing-first requirement.** Every behavioural fix ships with a test that fails on the
   current code with the observed shape. The audit's own numbers (`3 shallots` → 300 g,
   `1 tbsp rosemary` → 100 g) are the fixtures.
5. **The size gates.** `max-lines` 500, `max-lines-per-function` 150, enforced in CI. A new
   responsibility gets its own file from day one.
6. **The full local gate before pushing:** `npm run format:check`, `npm run typecheck`, and
   **`npm run lint --workspace=backend` explicitly** — the root `lint` script covers five workspaces
   and *not* backend, which has bitten this project once already.

### Model assignment

- **Sonnet 5 for the parcels.** All nine are bounded, well-specified, and heavily test-guarded. This
  is exactly the shape Sonnet is efficient at.
- **Opus for review.** See §5 — the review questions are judgement, not mechanics.
- **P1 is the exception worth watching.** It is the only parcel with genuine design latitude (how the
  unresolved path threads back through two callers). If its first PR shows the wrong seam, promote it
  rather than iterating.

---

## 5. Oversight — what Opus checks

Per-PR review, on the full diff, against five questions the CI gates cannot ask:

1. **Did it delete the silent fallback, or move it?** The failure mode this whole wave exists to fix
   is *not knowing* rendered as a plausible number. A default-serving fallback reintroduced anywhere
   — including in a helper, or as `?? servings[0]` — fails review.
2. **Does a guard report, or veto?** A new `return null` on a check is a regression against the
   governing principle regardless of how defensible the check is.
3. **Does anything hand back a number the model computed?** The model returns grams and facts; code
   does arithmetic. A tool result carrying model-computed calories fails.
4. **Is the trace still true?** Any new status, skip or timing must describe what actually ran.
   `usdaRung` reporting `miss` for a source it never called is the reference failure.
5. **Error ≠ empty ≠ usage.** Three distinct states, three distinct texts, per TOOL-HARNESS step 4.
   This has now been violated twice in shipped code, both times by whoever had just written the rule.

Plus the standing workflow gates: CI green, tests fail-first, no file added to the `max-lines`
allowlist, and `npm run cleanup:test-data` after any parcel that touches probes or e2e.

---

## 6. What is deliberately not in this plan

- **A yield model.** Closed by owner ruling; recipes divide, they do not measure.
- **`Recipe.servings[]`.** Withdrawn with it.
- **A batch lookup engine.** `priceMealItems` is one.
- **A portion picker component.** `RecipeLogConfirm` is one.
- **A rejection channel.** Four exist; P2 wires two call sites into them.
- **Anything under MP21** until the 2026-08-19 withdrawal is revisited.

---

## 7. Owner ruling 2026-08-25 — MP21 unblocked, and the last inversion in the food path

> *"The main ruling here was just about having a crappy in-chat nutrition module. SaaS design here is
> about the AI invoking the tool. The coach only really needs to know what you logged when you need
> their opinion — during a daily, weekly, quarterly check-in or ad-hoc 'tell me how to make this meal
> healthier'. But yeah, if I tell Cadence 'I ate this thing' can Cadence log it? Yes… in fact Cadence
> does log it when you use the chat. So the question is about how to take this question and invoke
> the right tool to present the right UI to the user."*

I had this backwards. The 2026-08-19 withdrawal was about **a bad surface** — a confirm sheet
competing with the Food home that had just become a real screen — not about whether she may log. So
MP21 is **unblocked**, and the actual question is which UI a tool call puts in front of the person.

### What is there today, and why it is the last thing standing against the governing principle

Food-in-chat does not go through the harness at all. It is a **second, parallel pass over the same
message**, and it is regexes:

1. The client posts the turn to `POST /coach/food-actions`.
2. `classifyFoodIntent` (`coach-food-classify.ts`) runs hand-written patterns — `hasSaveRecipeIntent`
   wants a literal *"save that as a recipe"* or *"I made … makes/serves N"*; `hasDietaryIntent` wants
   *"allergic to"*, *"I'm a vegan"*; and `NOT_FOOD_CONTEXT` **vetoes** a food reading if the sentence
   contains any of ~50 training words, `back pain` among them.
3. For a recipe or a dietary change it returns a draft and the client draws a sheet.
4. For food it returns `null`, and the coach is handed `FOOD_CONFIRM_CONTEXT` — a paragraph whose
   first job is to tell her what she is not allowed to say: *"You do NOT log food yourself and no card
   is coming, so never say it is logged, saved or counted."*

**That is precisely the inversion TOOL-HARNESS §"The principle every rule below serves" rejects.** A
regex decides what the software does, and the Coach is then managed into not contradicting it. She
is not in control of this path; she is being worked around on it.

It already fails in ways the audit caught:

- The meal-prep test case's own message **matches none of the recipe patterns** — no literal "I made",
  and *"Yields 3 cups"* is not the *"makes/serves N"* the regex demands. The sauce would never be
  captured, by design.
- *"Had a protein shake, my back's sore"* is vetoed as not-food by `NOT_FOOD_CONTEXT`.

### The redesign

**Delete the classifier. Give her the tools and let her call them.**

| | now | after |
|---|---|---|
| Who decides it was food | a regex, in a parallel request | the Coach, mid-turn |
| How the app finds out | `POST /coach/food-actions` | a tool call in the normal harness |
| What she is told | *"you do NOT log food"* | nothing — she has a tool |
| `FOOD_CONFIRM_CONTEXT` | injected on a regex match | **deleted** |

Each food write tool returns, alongside its result, a **surface** saying what to put in front of the
person. Three, and the third is why the 2026-08-19 ruling existed:

- **`inline`** — it is logged and unambiguous. One line in her reply, no interruption. This is the
  common case and it is what "Cadence does log it when you use the chat" should feel like.
- **`module`** — open the Food home, deep-linked and pre-filled. For anything wanting the screen's
  affordances: a slot to choose, a portion to pick, a photo to attach, an unresolved measure.
- **`card`** — a confirm sheet in chat. **Only for things with no screen of their own**, which today
  means recipes and dietary updates. Never for a plain meal; that is the mistake being avoided.

**Confirmed already correct, and worth not breaking:** the food *log* is not in the always-on
dossier. `get_food_log` sits behind the on-demand `get_nutrition` facade, so she reads it when a
check-in or an ad-hoc question needs it and pays nothing on every other turn — exactly the economy the
ruling describes.

### Owner ruling — same tools, both doors. The "which surface" question was wrong.

> *"If I'm talking to Cadence about my food, or I click 'log breakfast' and choose 'chat', why would
> the experience be different? This is a software harness operated by an AI. Some things the coach
> doesn't need to know about or track all the time — let the software do the logging and Cadence
> doesn't always need to weigh in. This is why I said she should just invoke the existing tools. The
> question is: does she know the tool, and to what extent? Fundamentally we need a way to bridge the
> experiences so that we're using the same tools and creating a consistent experience."*

This retires the three-way surface vocabulary above. She is not choosing a UI; she is calling the
same operations the Food screen calls, and it is the RESULT that says whether anything is left to do.

**The duplication, precisely.** The Food screen does words → meal in two calls:
`POST /nutrition/meals/preview` (parse, resolve each food, price it, return an itemised meal) then
`POST /nutrition/meals` (commit). Chat touches **neither**: it goes to `POST /coach/food-actions` and
a keyword matcher. The commit is shared; the half that does the actual work is not — and the worse
implementation is the one behind the conversation.

**So she gets exactly two tools, and they are the screen's two.** Read-into-a-meal, and log-it.
Nothing about screens, cards or sheets — those are the client's business. The preview result already
carries what she needs to behave sensibly: the items, their prices, and what could not be settled
(an unresolved measure now says so, since guards report rather than veto). Everything priced → log
it and say one line. Something unsettled → she has a fact to act on, so she asks, or opens the Food
screen with **that same reading** loaded.

**The preview result IS the bridge.** One object, produced by one pipeline, finishable from either
door. Start in chat, finish on the screen; nothing is re-parsed, nothing is re-priced, and the two
experiences cannot drift because there is only one implementation left.

**Logging is bookkeeping, not coaching.** She invokes it and moves on; she does not comment on every
meal. Her opinion belongs at a check-in or when asked — *"tell me how to make this healthier."*
Already true structurally and worth not breaking: the food log is not in her always-on context, it
sits behind the on-demand `get_nutrition` read.

### She hands over STRUCTURE, not prose (owner, 2026-08-25)

> *"Cadence kind of needs to invoke the tool and pass to it the string about the food the user wants
> to log? Cadence needs to determine if a food is being logged and call the tool. But she can't just
> call the tool because… the user doesn't want to retype what they typed from one AI to another AI or
> app. That's the inherent tension. The good news is that the coach is smart."*

The tension is real and it dissolves on the last sentence. Chaining her to `parse-meal` would mean
she reads the turn, summarises it, and a second, weaker model reads the summary — lossy twice over,
and when it comes out wrong the person is re-explaining to a model they never addressed.

**She has already done the reading.** So she does not pass prose to another parser; she passes the
items she understood. `[{ name: 'chicken salad', qty: 1, unit: 'bowl' }]`. The software takes it
from there: match each name against the ledger and the sources, price it, write it.

This is the governing principle at its cleanest — **the model says WHAT, the store says HOW MUCH** —
and `parse-meal` turns out to have existed only because there was no strong reader in the loop.
There is now.

**The door is already built.** `POST /nutrition/meals` accepts `parsed`
(`validation/body.ts:53`) — `{ meal, items: [{name, qty, unit, est}], macros, confidence, flags,
raw_text }` — and its own comment reads *"A previewed parse the user confirmed — logged verbatim,
**no second AI pass**."* Someone already built the idea that structure from a trusted reader is not
re-parsed. Today the Food screen fills it from `/meals/preview`; she can fill it directly.

**Correcting the previous note in this file:** I recorded that retiring the keyword matcher would
cost more thinking per turn. It does the opposite — it REMOVES a model call from every conversational
log, because the parse step disappears for anything she has already read. Better and cheaper. And the
matcher was never cheap in any useful sense: `NOT_FOOD_CONTEXT`'s fifty-word veto list is scar tissue
from precisely the false positive the owner describes — talking about learning to cook and being
offered a meal log.

**The bridge is the ITEM LIST, not the reading.** Two producers, one consumer:

```
  conversation ──▶ the Coach reads it ──┐
                                        ├──▶ items[] ──▶ resolve · price · write
  typed box ─────▶ parse-meal ──────────┘        (one implementation, both doors)
```

`parse-meal` survives for the typed box on the Food screen, where nobody has read the words. It has
no business in the chat path.

### Plan changes

| ID | Change |
|---|---|
| **MP21** | **Unblocked.** Two coach tools that ARE the screen's two calls: read-into-a-meal and log-it. No new pipeline, no chat-specific parsing |
| **MP40** *(new)* | **Retire `classifyFoodIntent`, `FOOD_CONFIRM_CONTEXT` and `POST /coach/food-actions`.** The keyword matcher is a second implementation of a job the preview endpoint already does properly. **M**, and it is the last SaaS-drives-AI seam in the food path |
| **P6** | Gains MP40's deletions (`coach-food-classify.ts` is already its file) |


