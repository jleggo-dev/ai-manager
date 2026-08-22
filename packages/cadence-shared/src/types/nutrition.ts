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
  /** Who produced these numbers: AI estimate ('ai') or the user's own correction ('user'). */
  source?: 'ai' | 'user';
}

export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink' | 'other';

export interface NutritionLog {
  log_id: string;
  date: string;
  meal: MealKind;
  /** Optional food_id correlates a free-form item back to a saved Food (Req 5 §5.4). */
  items: { name: string; qty?: number; unit?: string; est?: Macros; food_id?: string }[];
  macros: Macros;
  input_method: 'photo' | 'voice' | 'text' | 'manual';
  ai_confidence?: number;
  /** Below `confirm_below_confidence` the value is provisional and excluded from totals (§B2). */
  provisional?: boolean;
  photo_ref?: string;
  raw_text?: string | null; // the user's own words — always kept (0013)
  flags?: { alcohol?: boolean; caffeine?: boolean }; // ONLY from explicit mentions, never inferred (0013)
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
}

export interface Recipe {
  recipe_id: string;
  name: string;
  source: 'user' | 'ai' | 'ai_from_fridge_photo' | 'ai_from_chat';
  servings: number;
  /**
   * food_id set once the Resolver resolves the ingredient; ad-hoc name/qty/unit allowed.
   * est holds contribution macros for unresolved / estimated ingredients (recompute on save).
   */
  ingredients: { food_id?: string; name: string; qty: number | string; unit?: string; est?: Macros }[];
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
