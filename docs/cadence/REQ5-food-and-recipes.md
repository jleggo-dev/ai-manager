# Req 5 — Food & Recipe data layer (design + farm-out plan)

**Status:** design, 2026-07-24 · **Owner decisions captured (Matt/Jeff)** · not built.
Companion to `PLAN.md` (§5.6 nutrition, §12 backlog) and `BRAND.md`. This doc is written to be
**farmed out to several developers in parallel** — §8 defines the workstreams, their interfaces, and
the dependency order.

---

## 1. The problem we're solving (and why)

Cadence already tracks nutrition, but every meal is **estimated from scratch**: you describe or
photograph a meal, an AI guesses the macros, you confirm. That's great for "what did I just eat?"
but it has three gaps that compound daily. (Throughout this doc, **MFP = MyFitnessPal**, the food-
tracking app whose logging model we're matching for value while stripping its friction.)

1. **No memory of foods.** You eat the same yogurt every morning, and Cadence re-guesses it every
   time — different numbers, more taps, no trust. Real nutrition tracking (MyFitnessPal, Cronometer)
   is fast _because_ it remembers foods and lets you re-log in two taps.
2. **No accurate, reusable recipes.** You cook the same chili weekly; there's no way to build it once
   (with real per-serving macros) and log "2 servings" instantly. The `recipes` table exists in the
   schema but has **zero code**.
3. **No structured entities behind a log.** A logged meal is free-form parsed text. Nothing links it
   back to a food or recipe, so you can't "log again," can't correct once and have it stick, and the
   coach can't reason about _what_ you actually eat.

**Why now:** the macro-target loop (targets, rings, eat-back, the Baseline moment) is built and
working — but it's only as good as the data flowing into it. A fast, trustworthy food/recipe layer
is the substrate that makes every downstream nutrition feature (fridge-scan → recipe, meal plans,
adaptive coaching) actually work. This is the foundation; the flashier features sit on top.

**Who it's for:** the launch user is fitness/nutrition-focused (Matt) and will log daily. Fast,
low-friction, trustworthy logging is the make-or-break. But the design stays area-neutral per
BRAND.md — nothing here is fitness-locked.

## 2. How it shows up for the user (the product)

The north star is **MyFitnessPal-fast logging, in a coach's voice — never a scoreboard.** The
existing nutrition philosophy holds: _Observe, never judge; the user's word always wins; low-
confidence numbers are provisional until confirmed._

**The three hero flows:**

- **Fast log (the daily driver).** Open the Food tab → a search bar with your **recents / frequents /
  saved foods** right there → tap a food → pick a serving + quantity → it's logged, rings update. Two
  taps for anything you've eaten before. First time you eat something new, you add it once (below) and
  it's cached forever.
- **Add a food you eat often.** Three ways, all producing the same saved `Food`:
  - **Describe it** ("nonfat greek yogurt, 170g") → an LLM estimate → confirm → saved.
  - **Snap the nutrition label** → Gemini Flash parses the Nutrition Facts panel into exact macros +
    serving → you name the food/brand (typed, or a photo of the front of the package) → saved.
  - **Scan the barcode** → OpenFoodFacts (camera when BarcodeDetector is available; digit entry fallback).
- **Build & log a recipe.** Tell the coach what you made ("chili with 500g beef, 2 cans beans,
  onion, makes 6 bowls") → it structures it into ingredients (resolved to your foods) + servings →
  computes **real per-serving macros** → saved. Then log "2 servings" in one tap, any day.

**Correlation everywhere:** every logging path — photo, chat, manual, recipe — resolves to the same
food/recipe entities, so a day's log is made of _things you can re-log, correct once, and reason
about_, not one-off text. A logged meal shows "from: your Morning Yogurt" with a "log again" affordance.

**The coach angle (brand fit):** all of this is _also_ reachable conversationally — "I had my usual
breakfast" resolves to the saved recipe; "save that as a recipe" works mid-chat. The Food tab is the
fast manual surface; the coach is the natural-language surface; they share one data layer.

## 2a. Design tenet — MyFitnessPal's VALUE, not its FRICTION

**The governing principle (owner mandate):** deliver MyFitnessPal's value — accurate macro tracking
against goals + a memory of what you eat — **without its data-entry tax.** The tenet: **AI does the
work; the user confirms.** Every design choice below is measured against "does this remove friction
a human would otherwise pay?"

| MFP friction                            | How we remove it (AI-first)                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Search + scroll a food database         | **Say it or snap it.** The resolver surfaces the most-likely candidate, ranked by _your_ history — search is the fallback, not the primary path. |
| Pick among many duplicate entries       | The resolver **pre-selects the single best** (your usual yogurt, your saved recipe) and only disambiguates when genuinely ambiguous.             |
| Type serving size + quantity            | AI **infers** it ("a bowl of oatmeal" → a sensible serving; "3 eggs" → qty) and pre-fills the serving _you_ usually use.                         |
| Build a recipe ingredient-by-ingredient | A sentence → AI **drafts the recipe, resolves ingredients to foods, computes per-serving macros.** You tweak, not build.                         |
| Adding a new food = filling a form      | Snap the **nutrition label** (Gemini Flash → exact macros) + name/brand; or just describe it.                                                    |
| Every log is manual, forever            | The system **learns** — recents/frequents/your servings — so week 2 is faster than week 1, and "log my usual breakfast" works.                   |

**The user's residual job is a one-tap confirm** — retained because it's what preserves accuracy and
trust (the nutrition module's _provisional-until-confirmed_ stance carries over), but it is a _tap,
never a chore-with-a-scold_ (Observe, don't judge). The **coach chat is the zero-friction surface**
("just tell me what you ate"); the Food tab is the power-user manual surface. One data layer under both.

**The Resolver is the engine of this tenet** (see §5.6 + WS-R in §8): any input (text / chat / photo)
→ ranked candidates across _your foods, your recipes, and the shared food DB_, disambiguating generic
vs. branded vs. a specific recipe → confirm → log; or "new" → build it. Getting the resolver's
ranking + inference right IS the product; everything else is plumbing.

## 2b. We're a COACH, not a tracker — insight is the point (the differentiator)

**Owner mandate:** _"I'm more interested in insights (you could eat more spinach; you're probably not
getting enough zinc). Because we're not a tracking application, we're a coach."_

Look at what MyFitnessPal puts behind its 👑 paywall: "Foods Highest In Protein," "learn which of your
logged foods…," net carbs, quick-add macros. **MFP treats insight as a paid add-on to a tracker. We
invert that:** the log is only the _input_; the **insight is the whole point, and it's free — that's
what a coach is.** The food/recipe data layer is the _foundation_; the **Insight layer is the payoff.**

**Insight types** (grounded in the deterministic nutrition read — _never fabricated_, same "verify,
don't state a number you didn't just retrieve" norm as `plan-vet`):

- **Macro / goal** — "protein's landed ~20g short most days — want an easy add?" (uses the existing targets/rings).
- **Pattern** — "you eat great Mon–Thu, weekends drift"; "most of your calories are after 8pm."
- **Variety / quality** — "lots of beige lately — a handful of spinach or berries would round it out"
  (the _eat-more-spinach_ example). Groundable today from foods + logs.
- **Micronutrient** — "likely low on zinc this week — pumpkin seeds or chickpeas would help" (the _zinc_
  example). **Needs reliable micro data** (see §5.1 + the tension below).
- **Behavioral, coach-voiced** — alcohol frequency, hydration — Observe-not-judge, never a scold.

Delivered **proactively** (a gentle card on nutrition-Today + the coach surfacing it in chat) and
**on-demand** ("how am I doing?"). Reuses the existing `surface_insights` / `weekly-readout` machinery,
now fed by a far richer food/recipe signal.

**UI principle (from the screenshots): simple upfront, depth on drill-down.** The default nutrition
surface is minimal — rings, "on track / a little over," and _one_ coaching insight — not MFP's four
tabs + four scan buttons + paywalls. The full macro/micro breakdown, per-meal detail, and trends live
**one tap underneath**, never in your face.

**The micro-data tension (a real v1 scoping decision):** micronutrient insights (zinc, iron…) require
per-food micro data. LLM estimates are trustworthy for **macros** but weak on **micros** — so micros
come from **real data** (USDA FoodData Central for whole foods; nutrition labels + OpenFoodFacts for
branded), not the LLM. **v1 ships macro/pattern/variety insights** (fully groundable now); **micro
insights arrive as the food data's micro coverage fills in** (P3+). This _reinforces_ the OFF/USDA
backbone call (§4).

## 3. What already exists (build on this, don't fork it)

The nutrition module (Req 1/1a, shipped) — **reuse all of it:**

- **Meal logging** `POST /nutrition/meals` → `parse_meal` (vision/Gemini) → `items[]` + macros +
  confidence. `services/nutrition.ts` `logMeal`.
- **Provisional/confirm** — low-confidence rows excluded from totals until `PATCH /nutrition/meals/:id`.
- **Daily totals + rings + "left"** `GET /nutrition/day` (`services/nutrition-day.ts`).
- **Macro targets** `users.macro_targets` + `/nutrition/targets`; the Baseline moment; adaptive targets.
- **Net-calorie eat-back** (`eatback_pct`), **plate-advice**, **observe summary**.
- **Storage** `nutrition_logs` — one row/meal, `items` as free-form `{name, qty, unit, est}` jsonb.
- **Vision plumbing** — `parse_meal` / `plate_advice` vision jobs; meal-photo storage in Supabase Storage.

**Unused but present:** `recipes` + `meal_plans` tables and the `Recipe`/`MealPlan` types
(`@cadence/shared`) — modeled, no repo/service/route/UI.

**Latent bug to fix (like episodes):** `recipes`, `meal_plans`, `nutrition_logs` (and the new tables)
FK to `auth.users`; auth was decoupled in migration 0002. Repoint to `cadence.users` or inserts fail
for dev/real users. (See migration 0016 for the pattern.)

## 4. Architecture decisions (resolved)

| Decision                                  | Call                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Guiding tenet**                         | **MFP's value, not its friction** (§2a): AI resolves/estimates/infers; the user's job is a one-tap confirm.                                                                                                                                                                                                                                                                                              |
| **Foods database**                        | **Shared-aware from v1** (owner + visibility on every food; the resolver searches _your foods + the shared DB_). **User-created foods are private by default**; real-data backbone = **USDA FoodData Central** (whole foods — best micros + serving portions, free `api.data.gov` key) **+ OpenFoodFacts** (branded/barcode); user contributions grow the long tail; §12 exposes these as agentic **tools** long-term. Foods are still created on demand (LLM estimate / label photo) and cached. |
| **Serving model**                         | **Match MyFitnessPal**: a food carries **multiple serving units** (e.g. "1 container (170g)", "100 g", "1 cup"), each with a base-unit equivalence; logging = pick a serving + a quantity multiplier, macros scale. AI **pre-selects** the serving the user usually uses.                                                                                                                                |
| **Resolver**                              | **First-class** (§5.6, WS-R): any input → ranked candidates across your foods, your recipes, and the shared DB (generic vs. branded vs. a specific recipe) → confirm → log; or "new" → build a food/recipe. The anti-friction engine.                                                                                                                                                                    |
| **Recipes**                               | **Compositions of foods** (MFP-exact), **user-owned** in v1 (sharing across users is later). Per-serving macros are **computed** (Σ resolved ingredients ÷ servings); a component that isn't a known food is estimated inline (offer "save as food"). Built from a sentence (LLM-structured) or manually.                                                                                                |
| **Barcode**                               | **Phase 3 ✅:** browser → OFF product-by-barcode (`/api/v3/product/{barcode}`) with `X-User-Agent`, then POST mapped food to cadence-api for shared cache (`source='off'`, `off_id`). Prefer DB cache; do **not** proxy OFF through the API. Food tab: camera + `BarcodeDetector` when supported, digit entry fallback. Attribution: ODbL — fill the OFF API usage form before volume. |
| **Label capture (v1 barcode substitute)** | Photo of the **Nutrition Facts panel** → **Gemini Flash** → macros + serving JSON. Plus identify the **name + manufacturer** (typed or front-of-package photo).                                                                                                                                                                                                                                          |
| **Dietary profile**                       | New first-class input (allergies / diet / dislikes) with an **allergen safety pass** (§5.2). Settings + coach; prompt on first recipe.                                                                                                                                                                                                                                                                   |
| **UX home**                               | A **dedicated Food tab** (4th tab) for fast logging + food/recipe management; the Coach shares the data layer for the conversational (zero-friction) path.                                                                                                                                                                                                                                               |
| **Philosophy**                            | Inherit the nutrition module: Observe-not-judge, provisional-until-confirmed, coach-voiced; everything feeds the **existing** targets/rings/eat-back — do not fork the daily-total math.                                                                                                                                                                                                                 |
| **AI machinery**                          | All AI runs through **AI Admin jobs** (per `feedback_ai_admin_machinery`) — no app-side prompt construction. Jobs in §6.                                                                                                                                                                                                                                                                                 |

## 5. Data model

New/changed tables — one migration (`00NN_food_and_recipes.sql`). All per-user, RLS-owner policy,
FK → `cadence.users` (**not** auth.users).

### 5.1 `foods` (new) — shared-aware, MFP-style servings

```
food_id         uuid pk
owner_user_id   uuid null → cadence.users   -- NULL = shared/global (e.g. OpenFoodFacts); set = a user's custom food
visibility      text check ('private','shared') default 'private'  -- user foods private by default; opt-in to contribute
name            text            -- "Nonfat Greek Yogurt"
brand           text null       -- manufacturer ("Fage"); null for generic/whole foods
source          text check ('llm','label_photo','manual','chat','usda','off')  -- 'usda' = FoodData Central; 'off' = OpenFoodFacts
off_id          text null       -- OpenFoodFacts id/barcode (the future backbone)
fdc_id          int null unique -- USDA FoodData Central id (dedicated; do not overload off_id)
-- MFP serving model: macros stored PER BASE, plus named serving options mapping to a base amount.
base_unit       text check ('g','ml','item')   -- g/ml → macros_per_base is per 100; item → per 1
macros_per_base jsonb           -- Macros per 100g / 100ml / per item
servings        jsonb           -- [{ label:"1 container (170g)", unit:"container", amount_g:170 }, { label:"100 g", unit:"g", amount_g:100 }, …]
default_serving int default 0   -- index into servings[] to PRE-SELECT (the anti-friction default)
confidence      real null       -- LLM/vision confidence → provisional-until-confirmed
photo_ref       text null       -- the label photo (Storage ref)
created_at      timestamptz
```

- **Macros for any log** = `macros_per_base × (amount_g / 100)` (g/ml) or `× count` (item), × the user's quantity multiplier. **Validated against MyFitnessPal screenshots** (Serving Size × Number of Servings; a `Select Unit` list of `0.5 cup / 1 cup / 40 g / 1 g`) — the model matches.
- **Nutrients, not just macros.** `macros_per_base` is really a **nutrient blob** — kcal/protein/carbs/fat **plus optional micros** (fiber, sodium, iron, zinc, vitamins…) when the source provides them. Micros power the Insight layer (§2b). **Provenance matters:** micros come from **real data** (USDA / labels / OpenFoodFacts), never LLM guesses (LLM = macros only). Foods with no micro data simply don't drive micro insights.
- **Search spans the user's own foods + `visibility='shared'`** (incl. OFF-sourced). Rank **the user's own foods first** (friction: your usual comes up top), then brand/name match. Indexes: `(lower(name))`, `(brand)`.
- **Recents/frequents are per-user, so they do NOT live on the (possibly shared) food row** — they derive from the user's `nutrition_logs` (`items[].food_id` / `recipe_id`). Optional `food_usage(user_id, food_id, count, last_used_at)` projection for fast ranking.
- **Shared-aware now, populated over phases:** early shared content is thin (opt-in user contributions); **OpenFoodFacts backfills the global layer** in the barcode phase. **Dedup / canonicalization / moderation are explicitly OUT of v1** — confidence + user corrections carry quality; a later curation pass merges/promotes. (This is the cost of "design the shared path now" — the _schema + resolver_ are shared-aware from day one; the _hard data-quality problems_ are deferred, not solved in v1.)

### 5.2 `users.dietary_profile` (new column, jsonb) — safety input

```
{ allergies: string[],            -- hard excludes: "peanuts","shellfish"
  diet: string | null,            -- "vegan","vegetarian","pescatarian","halal",...
  dislikes: string[],             -- soft avoids: "cilantro"
  notes: string | null }
```

Column, not a table (matches `macro_targets`/`steer_back`). Captured via a short Settings flow AND
conversationally by the coach.

### 5.3 `recipes` (exists — wire it up)

Keep the table; **fix the FK**; **user-owned** in v1 (`user_id`; cross-user recipe sharing is later).
Ingredients reference foods (via the Resolver §5.6):

```
ingredients jsonb = [ { food_id?: uuid, name, qty: number, unit } ]   -- food_id set once resolved; ad-hoc allowed
servings    int
macros_per_serving  -- COMPUTED by the app: Σ(each ingredient's macros) ÷ servings (a service, not the model)
```

- A component that resolves to a food → exact macros. One that doesn't → **estimated inline** (`estimate_food`)
  and the UI offers "save as a food." Either way macros are computed, never free-guessed for the whole dish.
- `source` enum has `'user' | 'ai' | 'ai_from_fridge_photo'` — add `'ai_from_chat'`.

### 5.4 `nutrition_logs` (extend for correlation)

- Add `recipe_id uuid null → recipes` (a meal logged as N servings of a recipe).
- `items[]` entries gain optional `food_id` (jsonb — no DDL change): a logged item can point at a `Food`.
- This is **requirement #4 (correlation)** — every input method can now resolve to a saved entity.

### 5.5 `meal_plans` (exists — future phase, just fix the FK now)

### 5.6 The Resolver (the anti-friction engine — the heart of the product)

A pure-ish service (`services/food-resolver.ts`) that turns **any input into a one-tap confirm**:

**Input** (typed text, a coach turn, or a photo) **→ ranked candidates** across _the user's foods, the
user's recipes, and shared foods_ → **the user confirms one** → log; **or "none / it's new" → build**.

- **Ranking signals** (deterministic first, LLM only for loose text): exact/fuzzy name + brand match;
  the user's **recents/frequents (yours first)**; embedding similarity for vague phrasing; the dietary
  profile (allergen candidates flagged/down-ranked). Disambiguate generic vs. branded vs. a specific
  recipe ("fresh blueberries" vs. "President's Choice frozen" vs. "your pannacotta, Jul 2025").
- **Friction rule:** when the top candidate is clearly best, **pre-select it + pre-fill the usual
  serving** → the user just taps confirm. Only show a disambiguation list when candidates are close.
- **AI infers quantity + serving** from the phrasing ("a bowl of oatmeal", "3 eggs") so the user
  rarely types grams.
- **The "new" branch:**
  - new **food** → `estimate_food` (text) or `parse_nutrition_label` (photo) → confirm → save (private).
  - new **recipe** → `structure_recipe` → **recurse the resolver over each ingredient** → compute
    per-serving macros → confirm → save.
- Every confirmed log **teaches** recents/frequents/your-servings, so it gets faster over time.

This service is consumed by BOTH the Food tab (manual) and the coach (conversational) — one resolver,
two surfaces. **Getting its ranking + inference right IS the product; the rest is plumbing.**

## 6. AI Admin jobs (new)

All authored in `config/ai-admin/ai-admin.config.json` + provisioned via `scripts/provision-aim.ts`

- synced (`sync-jobs`). App sends DATA, reads structured output, asserts app-side (never trust raw).

| Job                                  | Model                     | Input → Output                                                                                                                                          |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse_nutrition_label`              | **Gemini Flash** (vision) | label photo → `{ serving_size, serving_unit, serving_label, macros_per_serving, name?, brand? }`                                                        |
| `identify_food` (optional/mergeable) | Gemini Flash (vision)     | front-of-package photo → `{ name, brand }`                                                                                                              |
| `estimate_food`                      | Coach-tier or Flash       | "describe a food" text → `{ name, serving_size, serving_unit, macros_per_serving, confidence }`                                                         |
| `structure_recipe`                   | Coach-tier                | "I made X with A,B,C, serves N" → `{ name, servings, ingredients:[{name,qty,unit}], steps? }` (app then resolves ingredients → foods + computes macros) |

**WS2 status (Phase 1):** Jobs `parse-nutrition-label`, `identify-food`, and `estimate-food` are
authored in `config/ai-admin/ai-admin.config.json`. Vision jobs pin the same Gemini vision profile
UUID as `parse-meal` / `plate-advice`; `estimate-food` uses the Broker (Flash) tier. Runtime:
`runJobBySlug` (no `AIM_JOB_*`). Sync live with jobs-only:
`node --import tsx apps/cadence-api/scripts/sync-jobs.ts` (not `provision-aim`). App wiring:
`services/food-capture.ts` + `POST /nutrition/foods/{parse-label,estimate,identify}` +
deterministic `POST /nutrition/meals` with `food_id`. `structure_recipe` remains Phase 2.

Notes: `parse_nutrition_label` + `identify_food` can be one 2-photo job if latency allows; keep them
splittable. `estimate_food` overlaps `parse_meal` — reuse the estimation prompt style; the difference
is _one food, canonical serving_ vs. _a plated meal_.

## 7. API surface (new / changed)

- `GET  /nutrition/foods/search?q=` — the user's cache, ranked recents→frequents→name match. **Fast, no AI.**
- `GET  /nutrition/foods/recents` · `/frequents` — for the empty-search default list.
- `POST /nutrition/foods` — create/save a food (from any capture path or manual). Deterministic.
- `POST /nutrition/foods/parse-label` — label photo → parsed (unsaved) food candidate (Gemini Flash).
- `POST /nutrition/foods/estimate` — text → estimated (unsaved) food candidate (LLM).
- `PATCH/DELETE /nutrition/foods/:id` — edit/remove a saved food.
- `POST /nutrition/meals` — **extend** to accept `{ food_id | recipe_id, servings|qty, meal }` → logs a
  saved food/recipe **deterministically (no AI)**; keep the existing text/photo path unchanged.
- `GET/POST/PATCH/DELETE /nutrition/recipes` — recipe CRUD; macros computed server-side on write.
- `POST /nutrition/recipes/from-chat` — description → `structure_recipe` → resolve foods → computed recipe.
- `POST /nutrition/dietary-profile` / `GET` — the profile; also settable via the coach.

## 8. Workstreams (for parallel developers)

**Dependency spine:** **WS1** ships the `Food` type + repo interface **day one** (types + a stub) so
everyone builds to a fixed contract. **WS-R (the Resolver)** is the integration hub — it needs WS1's
foods, WS3's recipes, WS2's estimate/parse jobs (the "new" branch), and WS5's dietary filter; stub each
and wire as they land. **WS4** (the tab) consumes WS-R. WS5 is otherwise independent.

- **WS1 · Foods data layer (foundation, unblocks everything).**
  `foods` table + migration (**shared-aware**: owner/visibility; + the FK repoint for
  recipes/meal_plans/nutrition_logs), `repos/foods.ts` (CRUD, **search over own + shared, ranked
  yours-first**, MFP serving math), the `Food` type in `@cadence/shared`, `GET /nutrition/foods/*`.
  Recents/frequents derive from the user's logs (optional `food_usage` projection). **Deliver the type
  - repo interface first.**
- **WS-R · The Resolver (the product's heart — §5.6).**
  `services/food-resolver.ts` — input → ranked candidates across own-foods + own-recipes + shared →
  confirm → log, or "new" → build. Ranking + quantity/serving inference + disambiguation. Consumed by
  WS4 and the coach. Depends on WS1/WS3 repos + WS2 jobs + WS5 filter (all stubbable).
- **WS2 · Food capture (populates the cache).**
  `parse_nutrition_label` + `estimate_food` (+ `identify_food`) jobs; `services/food-capture.ts`
  (photo/text → candidate `Food`, app-side assertion); `POST /nutrition/foods/{parse-label,estimate}`;
  save-to-cache. Feeds WS-R's "new food" branch.
- **WS3 · Recipes.**
  `repos/recipes.ts`, `services/recipe.ts` (build-from-chat via `structure_recipe`; **resolve ingredients
  via WS-R; compute per-serving macros**), CRUD + `from-chat`, and **log-a-recipe-as-a-meal** →
  `nutrition_logs.recipe_id` (the correlation). Depends on WS1 + WS-R.
- **WS4 · Fast-logging UX + the Food tab (web).**
  The 4th tab; **say-it/snap-it first, search as fallback**; the confirm-first flow over WS-R (pre-picked
  candidate + pre-filled serving); recents/frequents; portion picker; "add a food"; recipe list +
  log-N-servings; "log again." Feeds the existing `GET /nutrition/day` rings. Also surface the resolver
  in the coach chat.
- **WS5 · Dietary profile + safety (independent).**
  `users.dietary_profile` column + capture (Settings + coach; prompt on first recipe); the **allergen
  safety pass** (pure, testable) that flags/excludes profiled allergens across resolve, capture, and
  recipe build; wire the profile into the coach context pack.
- **WS-I · Insight layer (the differentiator — §2b).**
  Feed the richer food/recipe/nutrition signal into `surface_insights` / `weekly-readout` (AI Admin) →
  coach-voiced insights (macro/pattern/variety in v1; micronutrient as micro data lands); a proactive
  nutrition-Today **insight card** + on-demand "how am I doing?"; the **simple-upfront / drill-down**
  surface. Grounded in the deterministic read (never fabricated). Depends on WS1 + the logs; independent
  of the tab. **This is the reason the whole feature exists — scope it into v1, don't defer it.**
- **Cross-cutting (WS1 owner / lead):** the single migration; the FK repoint; do NOT fork the
  day-total/eat-back math; carry `provisional`-until-confirmed into foods (low-confidence estimates
  start provisional).

## 9. Phasing / roadmap

- **Phase 1 — Foods foundation + first insights (v1 core).** WS1 + WS-R + WS2 + WS5 + WS4's fast-log
  **+ WS-I's macro/pattern/variety insights**. Low-friction logging (say-it/snap-it, resolve, one-tap
  confirm) with a shared-aware cache, label-photo + describe capture, dietary safety, correlation, and a
  **coach-voiced insight card** — simple upfront, drill-down for depth. _The insight is the point; ship
  it in v1, not "later."_
- **Phase 2 — Recipes (v1 core).** WS3 — build/save/log recipes with computed macros. (Depends on Phase 1.)
- **Phase 3 — Real food data + barcode + micro insights — DONE (foundation).** OpenFoodFacts
  branded/barcode path: browser → product-by-barcode → cadence-api import/upsert shared `foods`
  (`source='off'`, `off_id`); camera scan + digit fallback on Food tab. USDA whole foods (`fdc_id`,
  `source='usda'`, migration `0018`) enrich search/resolve on cache miss. **Micronutrient insights**
  (zinc/iron class) gate on real-data coverage from USDA/OFF/label foods — never LLM macros.
  Coach read tool: retrieval registry `lookup_food` (deterministic search + USDA cache; no LLM HTTP
  wrap). Fill the OFF API usage form + ODbL attribution before production volume.
- **Phase 4 — Fridge/pantry scan → recipe ideas.** Photograph what you have → review ingredients →
  recipe draft ideas grounded in that list + dietary profile (+ optional macro targets). Jobs:
  `parse-fridge-photo` (vision) + `generate-recipe`; API `POST /nutrition/recipes/parse-fridge` →
  `POST /nutrition/recipes/generate` → confirm via existing `POST /nutrition/recipes`
  (`source='ai_from_fridge_photo'`). Food-tab Recipes: **Snap the fridge**. Sync jobs after merge
  (`apps/cadence-api/scripts/sync-jobs.ts`). Hotel-gym `parse_equipment_photo` stays separate (later).
- **Phase 5 — Meal plans + shopping list; recipe discovery.** Jobs `generate-meal-plan` + scoped
  `discover-recipe` (LLM structure — not live web search; cadence-research later). Migration
  `0019` (notes/updated_at + unique user/week). API: `POST /nutrition/meal-plans/generate` →
  confirm `POST /nutrition/meal-plans` (upsert week; creates recipes as needed); CRUD + shopping
  checkoffs via PATCH; `POST /nutrition/recipes/discover` → confirm via existing recipe save.
  Sync jobs after merge (`apps/cadence-api/scripts/sync-jobs.ts`). **UX (web):** Food tab →
  **This week's meals** (also bridged from Recipes) — draft → confirm-before-save → shopping
  checkmarks; Recipes shows **Find a real recipe** only when the discover route probes live.

## 10. Safety & brand (non-negotiables)

- **Allergen safety (WS5):** a food/recipe/suggestion containing a profiled allergen is hard-flagged;
  never silently suggested. This is a safety boundary, not a nicety.
- **No medical/diet prescription.** The coach informs and adapts; it doesn't diagnose or prescribe
  clinical diets. Defer to a professional for medical dietary needs (mirror the mental-health crisis
  boundary in BRAND.md).
- **Observe, never judge; user's word wins; provisional-until-confirmed** — carried from the nutrition
  module into every new path (LLM/label estimates start provisional).
- **Coach-voiced, hearth-not-scoreboard** — fast logging, but no shame, no red marks, no "you blew it."
- **Nomenclature:** boring stable schema words (`foods`, `serving`, `macros_per_serving`), warm UI
  labels; defer to `BRAND.md` for user copy.

## 11. Decisions — resolved 2026-07-24 (owner)

1. **Serving model** — ✅ **Match MyFitnessPal**: per-base macros + multiple named serving options;
   AI pre-selects the usual serving. (§5.1) _Open nuance:_ confirm the exact base-unit/serving model
   against MFP screenshots before WS1 finalizes the schema.
2. **`estimate_food`** — ✅ new dedicated job (shares `parse_meal`'s prompt style).
3. **Recipe ingredients** — ✅ resolve via the Resolver; a non-matching component is estimated inline
   with "save as food." (§5.3, §5.6)
4. **Dietary profile capture** — ✅ Settings + coach; prompt on first recipe. (§5.2)
5. **Foods scope** — ✅ **shared-aware from v1** (owner/visibility), user foods **private by default**,
   **OpenFoodFacts as the shared backbone**; dedup/canonicalization/moderation **deferred** past v1. (§5.1)
6. **Guiding tenet** — ✅ **MFP's value, not its friction** (§2a): AI resolves/estimates/infers; the
   user confirms in one tap.

**Still genuinely open (smaller, for the build team):**

- The Resolver's deterministic-vs-embedding/LLM ranking threshold (a tuning detail — start deterministic,
  add embeddings for loose text if needed).
- Whether recents/frequents need the `food_usage` projection in v1 or a query over `nutrition_logs` suffices.
- The exact `parse_nutrition_label` output contract (serving rows vary by region/label format).

## 12. Long-term objective — the agentic coach & food tools

**Direction (owner):** we're aiming toward a real **agentic harness** — a coach that *calls tools*, not
a single-shot completion. The food layer is a natural place to prove it, and two building blocks already
exist: **AI Admin has jobs-as-tools (v1.4.0)** — the primitive is shipped — and **PLAN.md already designs
the endgame** ("*letting the coach ask its own questions*" — the tool-runner retrieval loop, PLAN §"Final
step"). Cadence's coach is single-shot *today*; this is the path off that.

**Design every food capability as a service the app calls now AND a tool the coach can call later —
one implementation, two entry points.** USDA is the first concrete tool:

- **Now (deterministic):** `services/food-sources/usda.ts` — `/foods/search` → `/food/{fdcId}`; map
  `foodNutrients[]` (macros + micros per 100g) + `foodPortions[]` (household measure → grams, = our
  serving units) into a `Food` (`source='usda'`, shared/global — public authoritative data). Called by
  the Resolver on cache-miss and by the Insight layer for micros. No LLM in the fetch.
- **Now (retrieval tool):** `lookup_food` in the coach retrieval registry — same
  `searchFoodsWithUsda` path the Food tab uses (local + USDA cache). Scribe can select it; the app
  executes it. Deterministic; no LLM job wrapping HTTP. OFF barcodes stay on the browser path.
- **Later (agentic writes):** `resolve_food`, `log_meal`, `get_nutrition_day`, `build_recipe` as
  tools next to non-food ones (`enter_detour`). "Oatmeal and blueberries" → resolve (may call USDA)
  → confirm → log. **No forms, ever** — the coach IS the interface.

**Milestones toward it** (each independently useful, so no big-bang): (1) ✅ USDA + OFF as
deterministic providers behind the Resolver; (2) ✅ first read tool `lookup_food` on the retrieval
registry; (3) wrap resolver/log as AI-Admin **jobs** + tool-runner loop (PLAN §"Final step"), write
tools behind confirm-before-commit. **Guardrail:** even agentic, mutations stay
*suggest-then-confirm* — the coach proposes, the user taps; never silent writes.
