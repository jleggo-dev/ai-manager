/* ════════════════════════════════════════════════════════════════
   Req 5 §5.2 — Dietary profile (allergies / diet / dislikes)
   ════════════════════════════════════════════════════════════════ */

/**
 * First-class dietary safety input. Captured in Settings + coach;
 * consumed by the allergen safety pass (resolve / capture / recipes).
 */
export interface DietaryProfile {
  /** Hard excludes — never silently suggest. */
  allergies: string[];
  /** Soft dietary pattern, e.g. "vegan", "vegetarian", "pescatarian", "halal". */
  diet: string | null;
  /** Soft avoids — flagged, not hard-blocked. */
  dislikes: string[];
  notes: string | null;
}

export const EMPTY_DIETARY_PROFILE: DietaryProfile = {
  allergies: [],
  diet: null,
  dislikes: [],
  notes: null,
};

/** Common diet labels the Settings UI offers; free-text still accepted. */
export const DIET_OPTIONS = [
  'vegan',
  'vegetarian',
  'pescatarian',
  'halal',
  'kosher',
  'gluten-free',
  'dairy-free',
] as const;

export type DietOption = (typeof DIET_OPTIONS)[number];
