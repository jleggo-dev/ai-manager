/* ════════════════════════════════════════════════════════════════
   §5.6 Nutrition  (+ §B2 macro targets)
   ════════════════════════════════════════════════════════════════ */

/**
 * What one meal — or one day, or one target — is made of.
 *
 * The four macros, and the micronutrients that decide whether a diet is actually nourishing.
 * Those micros used to exist only on `FoodNutrients` (per food, from USDA/labels/OFF) and were
 * dropped the instant anything was logged, because this type stopped at fat. So a day could never
 * show iron and a target could never contain B12 — which makes "help me move to a vegetarian
 * diet" a goal the app could not coach even though it held every number needed (owner,
 * 2026-08-15).
 *
 * Micros stay OPTIONAL and are never invented: they come from real food data, and an AI-estimated
 * meal simply has none rather than a guess (see FoodNutrients' own note). A day's micro totals are
 * therefore a floor — what we can prove they ate — which is the honest direction to be wrong in.
 */
export interface Macros {
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  sodium_mg?: number;
  iron_mg?: number;
  zinc_mg?: number;
  vitamin_c_mg?: number;
  calcium_mg?: number;
  potassium_mg?: number;
  vitamin_b12_ug?: number;
  source?: MacrosSource;
}

/**
 * The micronutrients that have a published reference intake behind them — the keys
 * `micronutrientTargets` covers and the only ones a target may be set for.
 *
 * Declared here rather than derived from that table so `MacroTargets` can name it without
 * importing it; the table asserts it covers exactly these, so the two cannot drift.
 */
export type MicronutrientKey =
  'fiber_g' | 'sodium_mg' | 'iron_mg' | 'zinc_mg' | 'vitamin_c_mg' | 'calcium_mg' | 'potassium_mg' | 'vitamin_b12_ug';

/**
 * A micronutrient number that came from OUTSIDE the reference table — a doctor's instruction, a
 * prescription, a blood result — standing in for the published figure for this one person.
 *
 * The reference intakes are a fact about human biology and stay a lookup (see
 * `micronutrient-targets.ts`). This is the other case, and the owner ruled it in on 2026-09-01:
 * *"we rely on CNF, but we allow the coach to modify/override it if needed — ex. a user says
 * 'my doctor wants me to get 2000mg of Vitamin C a day'"*. The coach is not inventing a number
 * here, she is recording one she was told, which is why `why` is required and not decorative:
 * a target nobody can attribute later is one nobody can revisit.
 */
export interface MicroTargetOverride {
  /** In the nutrient's own unit — the same unit the reference table reports it in. */
  amount: number;
  /** Where the number came from, in their words. Required. */
  why: string;
  /** ISO date it was set. */
  set_at: string;
}

/**
 * Who produced a set of numbers: a model's estimate ('ai'), the user's own correction ('user'), or
 * the food ledger ('ledger' — every item priced from a saved food, so logging the same meal again
 * reproduces them exactly). A mixed meal stays 'ai': it is only as reproducible as its least
 * reproducible item. 'research' = a web-grounded lookup already ran for this item — never run it
 * twice.
 *
 * The array is the source of truth and the type is derived from it; parse with `isMacrosSource`
 * rather than listing the values again, which is how 'ledger' and 'research' came to be dropped
 * silently by a client parser that still only knew the first two.
 */
export const MACROS_SOURCES = ['ai', 'user', 'ledger', 'research'] as const;

export type MacrosSource = (typeof MACROS_SOURCES)[number];

/** True when a value off the wire names a real provenance for a set of numbers. */
export function isMacrosSource(value: unknown): value is MacrosSource {
  return typeof value === 'string' && (MACROS_SOURCES as readonly string[]).includes(value);
}

/**
 * Every meal slot, in the order a day runs — so a picker built from this reads right without
 * re-sorting it. The array is the source of truth and the type is derived from it; anything that
 * needs all the slots at runtime imports this rather than writing the six values out again.
 */
export const MEAL_KINDS = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'] as const;

export type MealKind = (typeof MEAL_KINDS)[number];

/** True when a value off the wire names a real meal slot. */
export function isMealKind(value: unknown): value is MealKind {
  return typeof value === 'string' && (MEAL_KINDS as readonly string[]).includes(value);
}

export interface NutritionLog {
  log_id: string;
  date: string;
  meal: MealKind;
  /**
   * Optional food_id correlates a free-form item back to a saved Food (Req 5 §5.4). `brand` is the
   * place it came from when the user named it or the packaging showed it — kept on the item so a
   * previewed meal can still pin its vendor after the round trip to the browser (A23 §1b).
   */
  items: { name: string; brand?: string; qty?: number; unit?: string; est?: Macros; food_id?: string }[];
  macros: Macros;
  input_method: 'photo' | 'voice' | 'text' | 'manual';
  ai_confidence?: number;
  /** Below `confirm_below_confidence` the value is provisional and excluded from totals (§B2). */
  provisional?: boolean;
  photo_ref?: string;
  raw_text?: string | null; // the user's own words — always kept (0013)
  /**
   * Sparse row signals. `alcohol`/`caffeine` come ONLY from explicit mentions, never inferred
   * (0013). `needs_enrich` says a vendor-named item matched nothing and a grounded lookup is worth
   * doing; `enriched` says that lookup has since run (whatever it found), which is what makes the
   * enrich endpoint safe to call twice.
   */
  flags?: { alcohol?: boolean; caffeine?: boolean; needs_enrich?: boolean; enriched?: boolean };
  photo_url?: string | null; // display-only: short-lived signed URL attached at read time (never stored)
  /** Set when the meal is N servings of a saved recipe (Req 5 §5.4). */
  recipe_id?: string | null;
}

/** Deterministic Observe-phase read over nutrition_logs — the coach's food-log summary. */
export interface NutritionSummary {
  window_days: number;
  days_logged: number; // distinct dates — the module arc's PHASE SIGNAL (~7 → baseline ready)
  meals_logged: number;
  meals_per_logged_day: number; // rounded 0.1
  top_items: { name: string; count: number }[]; // ≤5
  alcohol_days: number;
  caffeine_days: number;
}

export interface MacroTargets {
  kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  confirm_below_confidence?: number; // provisional threshold; defaults to 0.5 in nutrition.ts when unset
  eatback_pct?: number; // 0–100: % of a day's exercise burn added back to the kcal allowance (net calories); default 50
  last_reviewed?: string; // ISO date the coach last proposed an adaptive target adjustment (weekly throttle)
  /**
   * A short trail of kcal moves (A23 §3). The ratchet guardrail's working memory, not an audit
   * log: without it the loop cannot know it has already cut twice this month, and a plateau —
   * which looks exactly like "the deficit is too small" — would buy a third cut. Trimmed to the
   * last 12 by `setTargets`.
   */
  adjustments?: { date: string; from: number; to: number }[];
  /**
   * Per-nutrient overrides of the published reference intakes, set by the coach when the user
   * reports a number from outside the app. Absent for almost everyone — the reference table is
   * the answer unless somebody was told otherwise. Rides in `macro_targets` because it is the
   * same jsonb blob, merged and never clobbered, so no column and no migration.
   */
  micro_targets?: Partial<Record<MicronutrientKey, MicroTargetOverride>>;
}

export interface Recipe {
  recipe_id: string;
  name: string;
  source: 'user' | 'ai' | 'ai_from_fridge_photo' | 'ai_from_chat';
  servings: number;
  /**
   * food_id set once the Resolver resolves the ingredient; ad-hoc name/qty/unit allowed.
   * est holds contribution macros for unresolved / estimated ingredients (recompute on save).
   *
   * `unresolved`/`reason` are the explicit "this ingredient has no numbers at all" signal (MP10):
   * no field means this on its own — `est` simply being absent was never distinguishable from "we
   * have not looked yet" — and `estimated` (below, on the resolve-time shape only) means something
   * different again: numbers ARE present, they just came from a guess rather than a saved food.
   * `unresolved: true` means the opposite — no `est` was possible — and `reason` says why, so a
   * recipe total can be honest about what it could not count instead of quietly under-summing with
   * no trace. Set by `recipe.ts` and carried verbatim into the saved row (`stripRuntimeFields`).
   */
  ingredients: {
    food_id?: string;
    name: string;
    qty: number | string;
    unit?: string;
    est?: Macros;
    unresolved?: true;
    reason?: string;
  }[];
  steps: string[];
  /** Computed by the app: Σ(ingredient macros) ÷ servings — never free-guessed for the dish. */
  macros_per_serving: Macros;
  tags: string[];
  saved: boolean;
}

/** Grocery aisle bucket for shopping-list grouping (UI may localize labels). */
export type ShoppingListCategory = 'produce' | 'dairy' | 'protein' | 'pantry' | 'frozen' | 'bakery' | 'other';

export interface ShoppingListItem {
  name: string;
  qty: string;
  category: ShoppingListCategory | string;
  checked: boolean;
}

/** Meal slot on a planned day (aligns with common MealKind values). */
export type MealPlanSlotKind = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/**
 * One thing in a planned meal — a recipe, or a loose food.
 *
 * Frame 10a is explicit that a meal is *"recipes, food, or both"*: chicken thighs and lemon orzo,
 * plus a rocket salad, plus the olive oil it was dressed with. A planner that only holds recipes
 * cannot describe most dinners.
 *
 * Macros are DENORMALIZED onto the item on purpose. Frames 10b and 10c show every day totalled
 * against target — "1,880 of 1,940", "4 meals planned · lands on target" — and a week view that had
 * to resolve every recipe and food to add that up would be 28 fetches to paint one screen. What is
 * planned is an intention anyway; the numbers are the ones that applied when it was planned, and a
 * recipe edited afterwards does not silently rewrite last Tuesday's plan.
 */
export interface MealPlanItem {
  kind: 'recipe' | 'food';
  /** recipe_id or food_id, per `kind`. */
  id: string;
  name: string;
  /** Servings for a recipe; an amount for a food. */
  qty: number;
  /** 'serving' for a recipe; 'g' / 'ml' / 'tbsp' … for a food. */
  unit?: string;
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
}

/**
 * A meal in the week's plan.
 *
 * `items` is the shape frame 10a composes. `recipe_id`/`recipe_name` are the ORIGINAL single-recipe
 * shape and are still read and still written by `generate_meal_plan` — every plan saved before
 * 2026-08-21 has them and nothing migrates. Read through `mealPlanItems()` rather than branching on
 * which one is populated; a caller should not have to know how old a plan is.
 */
export interface MealPlanMeal {
  slot: MealPlanSlotKind | string;
  /** What the user called it — "Thighs, orzo & a side salad". Absent on generated/legacy meals. */
  name?: string;
  items?: MealPlanItem[];
  /** Legacy single-recipe shape. Optional now; still the shape the generator emits. */
  recipe_id?: string;
  /** Denormalized name for list UIs (optional; filled when known). */
  recipe_name?: string;
}

export interface MealPlanDay {
  /** Calendar day YYYY-MM-DD within the plan week. */
  day: string;
  meals: MealPlanMeal[];
}

/**
 * Persisted week plan + shopping list (Req 5 Phase 5).
 * Generate returns an unsaved draft; POST confirms and stores recipe_ids.
 */
export interface MealPlan {
  meal_plan_id: string;
  week_of: string;
  days: MealPlanDay[];
  shopping_list: ShoppingListItem[];
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}
