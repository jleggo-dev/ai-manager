# Design — the consistent ledger and the calibrated check-in

**Opened 2026-08-21 (owner + Claude working session). Status: PHASE 1 COMPLETE (1a, 1b, 1c) and
PHASE 2a/2b SHIPPED, all 2026-08-22. Remaining: 2c (daily weigh-in opt-in), Phase 3, Phase 4.**

> **Two deploy steps, both required.** (1) `node --import tsx apps/cadence-api/scripts/sync-jobs.ts`
> — the three meal prompts now ask for a per-item `brand` and are inert until synced (dry-run shows
> exactly `parse-meal`, `describe-meal-photo`, `parse-meal-description` updating, no other drift).
> (2) **Migration 0039 must be applied before this code ships.** `searchFoods` uses the
> pg_trgm `%` operator and the resolver reads `cadence.food_usage_ctx`. Run
> `node --import tsx apps/cadence-api/scripts/apply-migration-0039.ts` against each environment
> (additive, idempotent, safe to re-run).

Companion docs: [`DESIGN-BRIEF-nutrition.md`](DESIGN-BRIEF-nutrition.md) (where the food surfaces
live), [`DESIGN-PROMPT-food-plan.md`](DESIGN-PROMPT-food-plan.md) (the coaching loop that runs
through them — this doc builds the engine that loop needs). Backlog entry: PLAN.md §12 **A23**.

---

## The problem, in the owner's words

> "Every day I hit microphone and I say 'I had a venti latte from Starbucks'. And every day the
> LLM returns nutritional information that changes, because it's an LLM and it's VERY fuzzy.
> There's no consistency. And also, it's a lot of latency."

> "The consistency is more important than the accuracy. Over time the coach can recognize that you
> have to lower your *perceived* calorie intake to lower your weight. Because all of this is
> estimation. The magic is in creating a calorie deficit based on perceived consumption — the
> 'accurate' calculations really are a red herring. So we need **consistent estimation** and
> **scientific weekly check-ins**."

> "That yogurt parfait is from a café near my work called Materia Prima. We should always 'charge'
> the same kcals for that parfait. But I only go in on Wednesdays, some weeks I'm travelling —
> unless there's context to my food selection, I just have a really long list and I'll never see
> the food."

Three failures, one root cause: **a model is doing a job that belongs to code.** Today the lazy
paths (voice, text, photo) let `parse-meal` both *identify* the food and *invent* its numbers, and
the log stores whatever it invented. Same latte, new numbers every day. Meanwhile the check-in that
should close the loop against the scale is a checkbox.

## The principle

**Models identify and narrate. Code resolves, prices, and computes.**

- LLMs are good at "this is a Starbucks venti latte" (stable) and bad at "that's 190 kcal… no,
  250" (fuzzy). Identification stays on models; **pricing moves to the database**.
- The food ledger is an **internal currency**; the scale is the only ground truth. Systematic bias
  calibrates out (a ledger that under-prices everything by 20% just means *your* maintenance is
  2,000 ledger-kcal). **Variance never calibrates out.** Pinning every estimate converts the
  model's variance (fatal) into bias (harmless) — which is what makes Phase 3's calibration
  mathematically possible at all.
- The weekly check-in computes in app code and hands the numbers to a job that **only narrates** —
  exactly what the orphaned `weekly-readout` job's own config description already demands.

## Rejected alternatives (so they stay rejected)

| Idea | Why not |
|---|---|
| Feed logs back into a Devs.ai agent as a datasource so it "remembers" the parfait | Asks a model to remember consistently — the one thing models are bad at. A Postgres row is the deterministic version of that memory. |
| Fine-tune a model toward the user's food vocabulary | Bakes the fuzz into weights; chases consistency inside the least deterministic component. Matching is a retrieval problem. |
| One agentic lookup tool that decides on its own whether to hit the DB or reason with web search | Taxes every common query with LLM latency, gives up determinism, and is the "app-built prompt" pattern CLAUDE.md bans. AI stays in named jobs on the fallback rung. |
| Store FatSecret data wholesale like USDA rows | USDA is public domain, OFF is ODbL; FatSecret's terms restrict retention. Live-by-ID instead (Phase 4). |
| Let LLM-estimated foods into the **shared** pool | MFP's disease: hallucinated macros presented as authoritative at scale. LLM rows stay private (`owner_user_id` set); promotion to shared is a separate, explicit, offline decision — out of scope here. |

## What exists today (verified 2026-08-21 — do not design around its absence)

- **The deterministic half is built.** `cadence.foods` is the cache-through store (USDA rows shared
  on `fdc_id`, OFF rows shared on `off_id`, `source` check-constrained); `searchFoodsWithUsda`
  (`services/food-sources/usda-enrich.ts`) is local-first with the 0.78 gate; `resolveFoods`
  (`services/food-resolver.ts`) ranks own foods + recipes + shared DB with dietary demotion and a
  preselect margin; the coach reads it via `lookup_food` under the `get_nutrition` facade.
- **The LLM prices meals anyway.** `logMeal` (`services/nutrition.ts`) free-text/photo branch
  stores `parse-meal`'s `est_macros` straight into `nutrition_logs.macros` (`source:'ai'`); the
  photo path (`meal-photo-read.ts` → `parse-meal-description`) does the same. `items[].food_id`
  exists in the type and **is never set by any parse path** — the resolver is only wired to the UI
  composer flow (`POST /nutrition/foods/resolve`).
- **The check-in is a checkbox.** `weekly_readout` job: fully specified in
  `config/ai-admin/ai-admin.config.json`, **zero callers**. `rollingConsistency()`
  (`services/metrics.ts`) names the recap as a consumer in its docstring; nothing consumes it.
  Weigh-in (08:00) and check-in (20:00) are two unconnected Sunday system occurrences.
- **Weight trend is a first-to-last slope** (`services/weight-trend.ts` `actualWeeklyRate`) — one
  water-weight morning pollutes it. Series lives in `occurrences.value->>'weight_kg'`
  (`repos/occurrences.ts` `listWeighInSeries`).
- **An adaptive loop exists but is a pace controller, not energy balance.** `getBaselineRead`
  (`services/nutrition.ts`) compares actual weekly rate to `safeWeeklyKg` (0.75%/wk) and asks
  `nutrition_baseline` for ±100–150 kcal, suggest-never-auto-apply, throttled by `last_reviewed`.
  It **never reads logged intake** — zero hits for TDEE/expenditure/energy-balance in the repo —
  so it cannot learn the user's maintenance in ledger units.

---

## Phase 1 — the deterministic ledger (identify → resolve → pin)

### 1a. Route the parse paths through the resolver — **SHIPPED 2026-08-22**

What landed, and the decisions taken while building (the spec below is what was designed; these
are the deltas):

- **`services/food-pricing.ts`** (`priceMealItems`, `priceParsedMeal`) + **pure
  `food-pricing-portion.ts`** for the portion/pinning arithmetic. `food-resolver.ts` gained
  `loadResolveShared` / `rankedFoodsFor` so a plate loads ranking context once and resolves its
  items concurrently.
- **Four call sites, not two.** Words (`logMeal`) and the photo read (`logMealFromReading`) as
  planned — plus the two the design missed: `previewMealParse` prices the card **with pinning
  off** (a preview walked away from leaves no food behind — the photo read's rule), and
  `logMeal({parsed})` re-prices **server-side** on confirm, because the browser's `MealPreview`
  wire shape drops `food_id` and the ledger link would otherwise be lost on every Food-tab log.
  Pricing is deterministic, so the confirmed row still equals the card.
- **Acceptance is stricter than the UI preselect**: `PRICING_MIN_SCORE = 0.7`, plus the existing
  margin — a near-tie between strangers goes unpriced, but the user's **own** food wins a tie
  against a stranger's row (the pinned parfait beating a generic one).
- **`Macros.source` gained `'ledger'`**; a mixed meal stays `'ai'`. A fully ledger-priced meal is
  exempt from the `PROVISIONAL_BELOW` gate.
- **Under-counting guard:** the item sum replaces the model's meal total only when every item
  carries numbers; otherwise the parse's total stands.
- **`nutrition.ts` crossed the 500-line gate**, so the Baseline moment + adaptive review moved to
  `services/nutrition-baseline.ts` — the file Phase 3 grows.
- **Free quality win:** USDA/OFF matches now carry micronutrients into logged meals, which an AI
  estimate never could.
- **Baseline metric run:** `npm run metrics:food-ledger` works, but the dev DB holds 6 logs and
  **zero repeat groups** — there is no meaningful before-number yet. Re-run it after real
  on-device use; that is when the trust metric becomes readable.

### 1a as designed

New file `apps/cadence-api/src/services/food-pricing.ts` (new responsibility = new file, per the
size rule) exporting `priceItems(userId, items, {mealHint})`:

1. Load rank context **once** per meal (today `resolveFoods` reloads it per call — a batch variant
   that shares `loadRankContext` across items keeps a 5-item plate at one round of queries).
2. Per item, resolve `"${name} ${brand ?? ''}"`. Accept **only** a `preselected` winner (the
   existing `PRESELECT_SCORE_MARGIN` + dietary-safe rule — a tie is not a match). On accept:
   set `item.food_id`, price via the existing `macrosForLog(food, serving, qty)` /
   `servingFactor` (`packages/cadence-shared/src/types/food.ts`), respecting the item's
   `qty`/`unit` through `inferServingIndex`.
3. Unresolved item → **pin it**, so the estimate is made once and reused forever. Two rungs, and
   the cheap one is the common one:
   - **Pin the parse's own per-item estimate** (`items[].est`, which `parse_meal` already
     returns). Derive per-base nutrients from it — divide by the eaten quantity, using the same
     unit logic as step 2 — and `insertFood` with `owner_user_id = userId`,
     `visibility:'private'`, `source:'llm'`, brand from vendor capture (1b), the parse's
     confidence. **Zero extra model calls**: these are numbers the run already produced and the
     user is about to confirm; pinning only makes them *reusable*.
   - **`estimate-food` only when the parse gave no usable `est`** for that item (broker profile,
     schema-based, gpt-class per the CLAUDE.md rule) → pin the same way.

   Then `touchFoodUsage` and set `item.food_id`. **Dedup guard before pinning:**
   `lexicalMatchScore` the canonical name+brand against the user's own private foods above a
   reuse threshold → reuse that row instead of inserting; otherwise every travel week mints
   "yogurt parfait (2)".

   *(Revised during build, 2026-08-22 — the doc originally sent every miss to `estimate-food`,
   which would have added a model call to the first log of every food. Pinning the parse's own
   estimate buys the same consistency for free and keeps the miss path no slower than today.)*
4. Meal `macros` = sum of item prices (reuse the `logMealFromItems` summing path). Micros ride
   along for free wherever the matched food is `usda|off|label_photo` — `scaleNutrients` already
   carries the full `FoodNutrients` — which widens real-micro coverage without touching
   `REAL_MICRO_SOURCES`.

Call sites: the free-text/photo branch of `logMeal` (after `parseMealResult`), and
`logMealFromReading` (after `parse-meal-description`). The parse's own `est_macros` becomes the
**fallback display value only** — kept during transition (below), never preferred over a resolved
price.

**Provenance & provisional semantics.** `Macros.source` gains `'ledger'`
(`packages/cadence-shared/src/types/nutrition.ts` — currently `'ai' | 'user'`): set when every
item was priced from a food row. Item-level provenance is already legible from `food_id` presence.
`provisional` keeps its meaning but tightens: a fully-ledger-priced meal is never provisional; the
confidence gate (`PROVISIONAL_BELOW`) applies only to meals still carrying LLM-priced items.
`correct_log` and the `source:'user'` overwrite path are untouched.

**Pinning is the parfait fix.** First "yogurt parfait from Materia Prima": no match →
`estimate-food` runs **once** → private row → every later log resolves to it. Same kcal charged
forever, until the user corrects the row. Variance drops from *every log* to *at most the first
log per (user, food)* — and from day two the lazy path's pricing is a Postgres read, not a model
call.

**Transition plan for `parse_meal`.** Do not strip `est_macros` from the job yet — it is the
fallback for unresolved items and for `priceItems` failures (a pricing error must degrade to
today's behaviour, never lose the meal; same contract as the existing parse-failure path). Once
the repeat-hit metric (below) holds, shrink the job to identification-only in a follow-up —
smaller output, faster parse, and the last incentive for the model to invent numbers gone.

### 1b. Vendor capture — **SHIPPED 2026-08-22**

- **Prompts:** `parse_meal` and `parse_meal_description` gained a per-item `brand`, with an
  explicit rule against guessing a chain from a cup or promoting a description into a brand
  ("homemade", "the place near work" are not vendors). `describe_meal_photo` gained a step for
  reading legible branding — the logo on the cup, the name on the bag. **Not live until synced.**
- **The ask fires on a simpler rule than designed.** Rather than a keyword list of
  "restaurant-shaped" foods, it asks about items that **matched nothing already on file** — which
  is precisely the set about to be pinned from a guess, needs no vocabulary to maintain, and
  self-selects (an apple matches a USDA row and is never asked about). Capped at two per card.
- **No "already asked" state was needed.** Whatever they answer — or skip — is pinned on confirm,
  so the same words come back matched and the question never returns. The design's "ask once"
  falls out of the ledger rather than out of bookkeeping.
- **It never gates the log**, unlike the amounts rule beside it. An unanswered vendor is a fine
  outcome.
- **The load-bearing fix was plumbing:** `brand` had to survive preview → browser → confirm. The
  wire type dropped it and `useMealAmounts.toPreview()` rebuilt items without it, so a vendor the
  model heard would have died between the card and the row it pins. Now carried on the shared item
  type, `AmountRow`, and `toPreview()`, with a test at each seam.
- Files: `MealVendorAsk.tsx` (component) + `vendorAsk.ts` (the pure rule, split out so the
  `react-refresh/only-export-components` gate stays green).

### 1b as designed

- **Prompt changes** (NOT live until `sync-jobs.ts` runs — CLAUDE.md): `parse_meal` and
  `parse_meal_description` items gain optional `brand` — *"only when the user said it or the
  packaging shows it; never guess"*. `describe_meal_photo` (free-prose stage 1) is told to name
  visible branding — cups, wrappers, logos, a café's sleeve — so stage 2 has it to extract. The
  `identify_food` job already proves name+brand from a photo works on this vision profile; adding
  a field to an existing JSON job costs nothing new.
- **Ask-once rule** at confirm time (the parse preview / `PhotoReadPanel` confirming phase, and the
  coach's confirm-first flow via `prepareCoachFoodAction`): item looks prepared/restaurant-shaped
  **and** nothing confident matched in history **and** no brand extracted → one light, skippable
  question — "From somewhere, or homemade?" The answer lands on the pinned row's `brand` and is
  never asked again for that food. One question max per meal; skipping costs nothing. The
  economics are the anti-MFP: MFP makes you search every time; Cadence asks once and pins.

### 1c. Ranking — **SHIPPED 2026-08-22**

Landed as designed, with these specifics:

- **Migration 0039.** `pg_trgm` in the `extensions` schema (matching pgcrypto/uuid-ossp, already on
  the search_path), GIN trigram indexes on `lower(name)` and `lower(coalesce(brand,''))`, and
  `cadence.food_usage_ctx (user_id, food_id, dow, meal)` with RLS. No backfill — the histogram
  earns its rows from the next log, and an empty one scores nothing.
- **`searchFoods` orders for RECALL, not final rank.** Similarity first with a `+0.15` own-food
  bonus, rather than yours-first outright, because `rankFoods` re-scores anyway and at 450k rows
  the `LIMIT` decides what the ranker is even allowed to see.
- **Two rhythm signals, not one:** exact weekday+meal slot (`SLOT_BOOST_MAX = 0.15`) and
  meal-across-all-days (`MEAL_BOOST_MAX = 0.05`), both saturating at 3 occurrences. The slot boost
  is deliberately *larger* than `PRESELECT_SCORE_MARGIN` so a reliable slot food wins the
  pre-select outright — one answer, not a list. Rhythm applies only where a lexical hit already
  exists: it breaks ties, it never creates a candidate.
- **`usageSlot(date, meal)`** in `nutrition-parse.ts` derives dow from the UTC date, matching every
  other Cadence day-stamp. Every write path teaches the histogram — spoken, photo, food picker,
  recipe, plate — and `POST /nutrition/foods/resolve` takes an optional `meal` so the Food tab's
  own resolve gets it too (the web hook now sends its `mealKind`).
- **`dev-reset.ts`** gained `food_usage_ctx`, so test users clean up.

Still deferred to Phase 4 as planned: **cross-user popularity** in the SQL ordering (it only starts
mattering when Branded lands) and **location** context (backlog A21).

### 1c as designed

The owner's Wednesday problem is not a search-UI problem ("I use MFP's *web* interface because the
screen is bigger" = the user doing retrieval). The design goal: **the user describes, the system
retrieves**, and the visible candidate set is almost always length 1 with the existing `new`
escape hatch.

- **Trigram search.** Migration: `create extension if not exists pg_trgm;` + GIN indexes
  `on cadence.foods using gin (lower(name) gin_trgm_ops)` (and `brand`). `searchFoods`
  (`repos/foods.ts`) moves from `LIKE` to a similarity/ILIKE hybrid, keeping yours-first → usage →
  name ordering as the tiebreak. (Prereq for Phase 4's Branded import — 450k rows behind `LIKE`
  would make "greek yogurt" chaos.)
- **Rhythm context.** New table:
  `cadence.food_usage_ctx (user_id, food_id, dow smallint, meal text, use_count int,
  last_used_at timestamptz, primary key (user_id, food_id, dow, meal))` — the existing
  `food_usage` stays as the unconditional projection. `touchFoodUsage` gains an optional
  `{dow, meal}` and upserts both. `FoodRankContext` (`food-resolver-rank.ts`) gains a
  context-count map; the boost is small and saturating (proposal: `+0.15 × min(1, ctxCount/3)`) —
  enough that *Wednesday + breakfast + "parfait"* preselects the Materia Prima row, tuned with a
  fixture test in `food-resolver-rank` exactly like the existing rank cases. This is the brand
  made mechanical — the system learning that Wednesdays are parfait days *is* "a rhythm you can
  keep". Travel weeks need no special case: no context match → normal waterfall → first-time flow,
  vendor question fires, the travel set builds itself.
- **Location context is Phase 4**, and it already has a designed home: backlog **A21** (where you
  live vs where you are). Day-of-week + meal slot covers the stated case without GPS.

---

## Phase 2 — the check-in becomes real (parallel with Phase 1)

### 2a. A trend, not a slope — **SHIPPED 2026-08-22**

- `smoothedSeries` (EWMA, weighted by **elapsed days** so weekly and daily cadences are
  comparable), `trendWeightKg`, `smoothedWeeklyRate` (least-squares fit over the smoothed series
  inside a 28-day window), and `trendConfidence`.
- **`paceRead(points, currentKg)`** is the composed read both callers now use — rate, safe rate,
  verdict, **confidence**, and the trend weight. `nutrition-baseline.ts` and the coach's
  `get_macro_targets` both migrated; the coach's render now hedges out loud on a thin series.
- **Falls back to `actualWeeklyRate` rather than going silent** on thin data — switching the
  adaptive loop off for anyone with two weigh-ins would be worse than labelling it low-confidence.
  `actualWeeklyRate` is kept and marked deprecated for exactly that.

### 2a as designed

`services/weight-trend.ts` stays pure/no-clock and gains:

- `smoothedSeries(points, halfLifeDays = 10)` — EWMA with irregular-interval weighting
  (`w = 1 − exp(−Δdays/τ)`), so weekly and daily cadences use the same code.
- `smoothedWeeklyRate(points, windowDays = 28)` — least-squares slope over the smoothed series;
  null under the same data-sufficiency rules as today (<2 points or <7-day span, and now
  <windowDays/2 of coverage). `actualWeeklyRate` stays for compatibility until callers migrate
  (`nutrition.ts`, `food-health-functions.ts`, `progress.ts` sparkline).

Week-over-week the coach reads little into it (water weight is a known variable — the owner's
words); month-over-month the slope is the signal. The EWMA makes that stance mechanical.

### 2b. The recap — **SHIPPED 2026-08-22**

- **`services/recap.ts`**: `buildRecapFacts` (pure SQL + arithmetic, no AI) and `getWeeklyRecap`
  (facts + narration). `POST /plan/recap`. `RecapPanel.tsx` mounted from `OccurrenceSheet` via a
  shared `isWeeklyCheckin` matcher, so the sheet and `notify/local-plan.ts` cannot disagree about
  which row is the check-in.
- **The figures render without the narration.** A failed coach call returns `note: ''` and the
  panel shows the week anyway — the same rule the photo path learned on 2026-08-20.
- **`days_logged` and `days_counted` are reported separately** (4 logged, 3 with numbers we trust).
  They were one field until a test caught the average dividing by a different set than the count it
  sat beside — an invitation to multiply the wrong pair. The model-facing payload spells it out as
  `avg_is_over_days`.
- **The weigh-in rides along**: when the week's weigh-in is still pending the panel leads with the
  scale. `findWeighInOccurrence` is its own query because `listOccurrences` deliberately omits the
  activity title. This answers `DESIGN-PROMPT-food-plan.md`'s closing question.
- `AiLogKind` gained `weekly_readout`, so the check-in is auditable like every other AI call.

### 2b as designed

New `apps/cadence-api/src/services/recap.ts`, pure assembly in app code:

| `weekly_readout` variable (already declared in config) | Computed from |
|---|---|
| `period` | the check-in occurrence's week window |
| `consistency` | `rollingConsistency(occurrences, today, 7)` — finally its documented consumer |
| `goals_progress` | the `progress.ts` card inputs, reused |
| `outcomes` | week's nutrition read: `countNutritionDays`, avg kcal over non-provisional days vs targets, protein adherence; `smoothedWeeklyRate` + pace class |
| `episodes` | `cadence.episodes` rows in-window |
| `rolling_window` | 28-day trend context |

The job **narrates only** (120–180 words, count-what-happened voice — the prompt already enforces
this). Route: occurrence-scoped read (shape alongside `POST /nutrition/baseline`). UI: a
`RecapPanel` in `features/plan/occurrence/` mounted from `OccurrenceSheet` for the weekly check-in
occurrence — the `findWeeklyCheckin` matcher in `notify/local-plan.ts` moves to a shared helper so
the sheet and the notification agree on what a check-in *is*. The existing `weekly_checkin` local
notification becomes the door to a real room.

**One Sunday moment, not two.** This answers `DESIGN-PROMPT-food-plan.md`'s closing question: if
the week's weigh-in hasn't happened, the recap panel *leads* with the `WeighInPanel` input, then
shows the readout. Weigh-in 08:00 and check-in 20:00 collapse into one two-way moment: report,
then ask how the week went.

### 2c. Daily weigh-ins: opt-in, and the user never sees today's number

Opt-in setting (alongside `notification_prefs`); the plan synthesizer keeps scheduling weekly by
default. The display rule does the mental-health work: **the headline is always the smoothed
trend** ("trending down, about 0.3 kg a week"), today's reading just feeds it; raw points render
muted under the trend line in `MeasuredCard`. Count what happened (the trend), never what broke
(this morning's spike). Users who opt in get faster Phase-3 convergence; the coach says so
honestly instead of pretending one week of data is a verdict.

---

## Phase 3 — calibration: close the loop in ledger units (needs 1 + 2)

New pure module `apps/cadence-api/src/services/energy-balance.ts`:

```
impliedMaintenanceKcal(days: {date, kcal, complete}[], weights: WeighPoint[])
  → { maintenance_kcal, complete_days, window_days, confidence: 'low'|'medium'|'high' } | null

maintenance = mean(kcal over complete days) + (7700 × lossKgPerWeek) / 7 per-day equivalent
            (lossKgPerWeek from smoothedWeeklyRate; sign handled so a gain lowers maintenance)
```

- **Gates (all app-side, all deterministic):** ≥21-day window; ≥3 weigh-ins spanning ≥14 days;
  ≥60% of window days *complete*. A "complete day" = has non-provisional logs and clears a
  plausibility floor (tunable constant, start ~800 kcal) — half-logged weeks widen the error bars
  (confidence drops), they never corrupt the estimate. This is why Phase 1 is a hard prerequisite:
  without pinned pricing the intake series is noise and this never converges.
- **Wire-in:** `getBaselineRead`'s adaptive mode adds `implied_maintenance` to the payload it
  already sends `nutrition_baseline`; the prompt's ADAPTIVE REVIEW clause upgrades from
  pace-nudging (±100–150 kcal blind) to anchoring: *targets = implied maintenance − the deficit
  for the safe pace*. While in that config block, **declare `weight_trend` and `current_targets`
  in the job's `variables` array** — the service passes both today and the config omits them.
- **Guardrails move from prose to code.** "Never more than ~15% below maintenance" is currently a
  sentence in a prompt; once maintenance is a number, `sanitizeTargets` enforces it
  (`kcal ≥ 0.85 × implied_maintenance` when known), on top of the existing absolute floor
  (1000) and rounding. Add a ratchet cap: cumulative adaptive kcal cuts ≤ ~300 per rolling 4
  weeks — a calibration loop that keeps ratcheting a plateauing user downward is the failure mode
  to design against, and a plateau past the cap becomes a coach *conversation*, not a deeper cut.
- Suggest-never-auto-apply, the weekly `last_reviewed` throttle, and the `propose === false`
  server wall are all unchanged. The proposal's home moves from the meal-log sheet to the Phase-2
  recap panel — the check-in is where "here's what I'm seeing, here's what I'd change" belongs.

The existing pace controller keeps running until this lands; Phase 3 upgrades it in place rather
than replacing anything.

---

## Phase 4 — coverage, strictly on demand

- **USDA Branded**, only behind 1c's ranking. Not a one-liner: `usda-gate.ts` currently rejects
  barcode-ish and long-label queries by design, and `WHOLE_FOOD_DATA_TYPES` excludes Branded on
  purpose. Proposal: include `Branded` in the search `dataType` when the query carries brand-ish
  tokens or 1b captured a vendor; whole-food-only otherwise. Public domain — cache rows exactly
  like today's USDA imports.
- **FatSecret, live-by-ID, for restaurant/chain foods** (the "venti latte" query USDA will never
  answer). `food-sources/fatsecret-http.ts` modeled on `usda-http.ts` (single-flight, in-flight
  cap, 429 cooldown; OAuth2 client-credentials). Store a **thin reference row** —
  `foods.fatsecret_id`, name, brand, serving labels — and fetch nutrients by ID at pricing time.
  Consistency comes from re-reading the same record, not from storing it; their data barely
  changes. If (and only if) the current ToS permits performance caching, add nutrients with a
  `fetched_at` + short TTL. **Verifying the ToS is the first task of this phase, before any
  code.** Nutritionix is the fallback vendor if the terms don't work — stronger on restaurants
  anyway.
- **Location context** — joins backlog A21 when that builds; coarse home/work/travelling tags,
  never precise GPS in the ranker.
- **Embeddings** in the resolver — last resort, only if lexical + rhythm-context measurably fails
  (`food-resolver.ts` has carried the "embeddings later" note since Req 5; keep it later).

## Test plan

Three things must be true at every step: **quality does not regress, consistency improves, speed
does not.** Each gets its own layer, and each layer is cheap enough to run on every commit.

### Layer 1 — pure unit tests, no DB, no AI (`food-pricing-portion.test.ts`)

The portion/pinning arithmetic is where a silent 170× error would live, so it is a separate pure
module with its own tests:

- Mass/volume units (`g`, `ml`, `oz`) are **absolute amounts**, not serving multipliers — "170 g
  yogurt" against a per-100 g food is 1.7×, never 170×.
- Serving-word units (`bowl`, `container`, `cup`) pick a `servings[]` index; quantity multiplies it.
- Missing/junk qty and unit fall back to the food's `default_serving` × 1.
- **The round-trip invariant, which is the whole pinning contract:**
  `price(pin(est, qty, unit), qty, unit) === est`. Pin an estimate for 3 eggs, price 3 eggs back
  out of the pinned row, get the same numbers. Property-style over a table of unit/qty cases.

### Layer 2 — orchestration units, mocked repos + AI seam (`food-pricing.test.ts`)

- **Hit:** an item matching an existing food gets `food_id` + ledger-priced `est`, and **no AI job
  runs**.
- **Miss with a parse estimate:** a private food row is pinned (`source:'llm'`, owner set) and
  **still no AI job runs**.
- **Miss with no estimate:** `estimate-food` runs exactly once, then pins.
- **Dedup guard:** an estimate whose canonical name matches an existing own food reuses that row —
  `insertFood` is not called.
- **Wrong-food guards:** below `PRICING_MIN_SCORE`, or two candidates inside
  `PRESELECT_SCORE_MARGIN`, or an allergen-flagged candidate → **never** ledger-priced. A wrong
  confident price is worse than no price.
- **Never lose the meal:** resolver throws → items come back untouched; estimate throws → the item
  keeps its parse estimate. Both are the existing parse-failure contract, extended.

### Layer 3 — the consistency invariant, real DB (`nutrition-service.test.ts`)

The owner's bug, encoded as a test. Log the same words three times while the **mocked parse
returns a different estimate each time** (190 → 250 → 220 kcal — simulated LLM drift):

- Logs 2 and 3 carry **byte-identical macros to log 1**. This is the trust metric as an assertion.
- All three carry the same `items[0].food_id`.
- Exactly **one** food row exists for that user afterwards (the dedup guard, end to end).

Plus the provenance/gating rules: `source:'ledger'` only when every item priced (mixed meals stay
`'ai'`); a fully-priced meal is never `provisional` even at low parse confidence; an unpriced
low-confidence meal still is; a USDA-matched item contributes **micros** to the log, which an AI
parse can never do (a quality *gain* this project gets for free).

### Layer 4 — speed, asserted not assumed

Latency is guarded by counting the expensive things rather than timing them (fast, deterministic,
CI-safe):

- **AI call count:** a repeat log makes exactly **one** job call (`parse-meal`) — the pricing layer
  adds none. A first-time log with a parse estimate also adds none.
- **Query count:** rank context loads **once per meal**, not once per item — a five-item plate is
  one context load. Asserted with a spy on the loader.
- Per-item resolution runs concurrently, so a plate costs roughly one item's latency.

Honest accounting: **Phase 1a does not make logging faster** — it makes it *consistent at the same
cost*, and caps the worst case by making `estimate-food` rare. The real speed win is the follow-up
that shrinks `parse_meal` to identification-only (fewer output tokens on the one call that
dominates the path), which is gated on the repeat-hit metric below.

### Layer 5 — the before/after measurement (`scripts/food-variance-baseline.ts`)

Run against real logged data before Phase 1a lands and after it has been live a while. Reports
repeat-price variance (the headline), repeat-hit rate, and estimate-call rate. Not a CI gate — the
evidence that the project worked.

### What runs when

`npm run ci` (typecheck → format → lint → test) covers layers 1–4; layer 3 skips cleanly without
`CADENCE_*` DB env, exactly like the existing suite. Layer 5 is run by hand.

## How we know it's working

All measurable from existing tables, before/after per phase:

1. **Repeat-hit rate** — share of logged items carrying `food_id` (from `nutrition_logs.items`).
   Should climb toward the "same latte every day" reality; gates the `parse_meal` shrink.
2. **Repeat-price variance** — for items resolving to the same `food_id` (and, pre-pin, matching
   on normalized name+brand), the spread of logged kcal. **Target: zero.** This is the trust
   metric — the owner's complaint, quantified.
3. **Time-to-log on the lazy path** — resolved repeats skip `estimate-food` entirely; the parse
   remains the long pole until it slims to identification-only.
4. **Calibration convergence** — week-over-week delta of `implied_maintenance` shrinking, and its
   confidence tier rising, for users with complete weeks.

## Dependencies and sequencing

```
1a pricing ──► 1c ranking ──► 3 calibration ──► 4 FatSecret / Branded
1b vendor  ──►     ▲                ▲
2a trend ──► 2b recap ──► 2c daily opt-in
        (2a/2b feed 3; Phases 1 and 2 run in parallel)
```

Already in flight, related: the **B12 USDA-map gap** (spawned as its own task 2026-08-21 —
`vitamin_b12_ug` is in `FoodNutrients` and the DRI table but absent from `USDA_NUTRIENT_NUMBERS`,
so USDA imports can never fill it; matters more once Phase 1a starts pricing meals from USDA
rows).

## Standing constraints (unchanged, restated so nobody relitigates them)

- All AI through AI Admin jobs; prompt edits are dead until `sync-jobs.ts` runs; schema-based jobs
  stay on gpt-class models (`estimate-food` already complies; `parse_meal` is on the pinned Gemini
  vision profile and stays there).
- Confirm-first for anything that changes targets; never judge food; count what happened. The
  calibration loop inherits the safety floors and adds its own (the 15% rule in code, the ratchet
  cap, trend-not-raw display).
- New files for new responsibilities (`food-pricing.ts`, `recap.ts`, `energy-balance.ts`,
  `fatsecret-http.ts`) — the size gates are at `error`, and none of these belong inside
  `nutrition.ts`, which is already carrying a lot.
