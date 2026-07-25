/* ════════════════════════════════════════════════════════════════
   §5.6 Nutrition  (+ §B2 macro targets)
   ════════════════════════════════════════════════════════════════ */

export interface Macros {
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
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

export interface ShoppingListItem {
  name: string;
  qty: string;
  category: string;
  checked: boolean;
}

export interface MealPlan {
  meal_plan_id: string;
  week_of: string;
  days: { day: string; meals: { slot: string; recipe_id: string }[] }[];
  shopping_list: ShoppingListItem[];
}
