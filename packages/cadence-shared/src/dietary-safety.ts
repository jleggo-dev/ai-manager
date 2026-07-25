/**
 * Pure allergen / dietary safety pass (Req 5 §5.2 / §10).
 *
 * Hard-flags profiled allergens so resolve / capture / recipe build never
 * silently suggest something that contains them. Dislikes and diet conflicts
 * are soft flags — visible, not blocked.
 *
 * No I/O. Safe to call from API, web, and tests.
 */

import { EMPTY_DIETARY_PROFILE, type DietaryProfile } from './types/dietary.ts';

export type DietaryFlagSeverity = 'allergy' | 'dislike' | 'diet';

export interface DietaryFlag {
  severity: DietaryFlagSeverity;
  /** The profile term that fired. */
  term: string;
  /** The substring / synonym that matched in the candidate text. */
  matched: string;
}

export interface DietarySafetyAssessment {
  /** False when any allergy flag is present — never silently suggest. */
  safe: boolean;
  flags: DietaryFlag[];
}

/** Synonym clusters for common allergens (normalized keys → match terms). */
const ALLERGEN_SYNONYMS: Record<string, readonly string[]> = {
  peanut: ['peanut', 'peanuts', 'peanut butter'],
  'tree nut': [
    'tree nut',
    'tree nuts',
    'almond',
    'almonds',
    'walnut',
    'walnuts',
    'cashew',
    'cashews',
    'pecan',
    'pecans',
    'pistachio',
    'pistachios',
    'hazelnut',
    'hazelnuts',
    'macadamia',
  ],
  shellfish: [
    'shellfish',
    'shrimp',
    'prawn',
    'prawns',
    'crab',
    'lobster',
    'crayfish',
    'scallop',
    'scallops',
    'clam',
    'clams',
    'mussel',
    'mussels',
    'oyster',
    'oysters',
  ],
  fish: ['fish', 'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'trout', 'anchovy', 'anchovies'],
  dairy: ['dairy', 'milk', 'cheese', 'butter', 'whey', 'casein', 'yogurt', 'yoghurt', 'cream', 'lactose'],
  egg: ['egg', 'eggs', 'egg white', 'egg yolk', 'mayonnaise'],
  soy: ['soy', 'soya', 'tofu', 'edamame', 'tempeh', 'soybean', 'soybeans'],
  wheat: ['wheat', 'gluten', 'flour', 'breadcrumbs'],
  sesame: ['sesame', 'tahini', 'sesame seed', 'sesame seeds'],
};

/** Soft diet-conflict tokens (normalized diet → terms that conflict). */
const DIET_CONFLICTS: Record<string, readonly string[]> = {
  vegan: [
    'meat',
    'beef',
    'pork',
    'chicken',
    'turkey',
    'lamb',
    'fish',
    'salmon',
    'tuna',
    'shrimp',
    'shellfish',
    'egg',
    'eggs',
    'milk',
    'cheese',
    'butter',
    'yogurt',
    'yoghurt',
    'cream',
    'whey',
    'honey',
    'gelatin',
  ],
  vegetarian: [
    'meat',
    'beef',
    'pork',
    'chicken',
    'turkey',
    'lamb',
    'fish',
    'salmon',
    'tuna',
    'shrimp',
    'shellfish',
    'gelatin',
  ],
  pescatarian: ['meat', 'beef', 'pork', 'chicken', 'turkey', 'lamb'],
  'dairy-free': ['milk', 'cheese', 'butter', 'yogurt', 'yoghurt', 'cream', 'whey', 'lactose', 'dairy'],
  'gluten-free': ['wheat', 'gluten', 'barley', 'rye', 'flour', 'breadcrumbs'],
};

/** Lowercase, collapse whitespace, strip simple punctuation. */
export function normalizeDietaryToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Expand a profiled allergen into concrete match terms (synonyms + itself). */
export function expandAllergenTerms(allergen: string): string[] {
  const key = normalizeDietaryToken(allergen);
  if (!key) return [];
  const fromTable = ALLERGEN_SYNONYMS[key];
  const terms = new Set<string>([key, ...(fromTable ?? [])]);
  // Also match when the user wrote a synonym as the allergy itself ("shrimp").
  for (const [canonical, syns] of Object.entries(ALLERGEN_SYNONYMS)) {
    if (syns.some((s) => s === key) || canonical === key) {
      terms.add(canonical);
      for (const s of syns) terms.add(s);
    }
  }
  return [...terms].sort((a, b) => b.length - a.length); // longer first → better match labels
}

function haystackText(parts: string | readonly string[]): string {
  const joined = typeof parts === 'string' ? parts : parts.join(' ');
  return ` ${normalizeDietaryToken(joined)} `;
}

function findTermMatch(haystack: string, term: string): string | null {
  const n = normalizeDietaryToken(term);
  if (!n) return null;
  // Word-boundary-ish: spaces around the padded haystack.
  const needle = ` ${n} `;
  if (haystack.includes(needle)) return n;
  // Allow hyphenated compounds ("peanut-butter" already normalized to spaces).
  return null;
}

/**
 * Assess a candidate (food name, ingredient list, recipe text, …) against a profile.
 * Allergy hits → `safe: false`. Dislikes / diet conflicts are soft flags only.
 */
export function assessDietarySafety(
  profile: DietaryProfile | null | undefined,
  candidateText: string | readonly string[],
): DietarySafetyAssessment {
  const p = profile ?? EMPTY_DIETARY_PROFILE;
  const haystack = haystackText(candidateText);
  const flags: DietaryFlag[] = [];

  for (const allergy of p.allergies) {
    for (const term of expandAllergenTerms(allergy)) {
      const matched = findTermMatch(haystack, term);
      if (matched) {
        flags.push({ severity: 'allergy', term: allergy, matched });
        break; // one flag per profiled allergy is enough
      }
    }
  }

  for (const dislike of p.dislikes) {
    const matched = findTermMatch(haystack, dislike);
    if (matched) flags.push({ severity: 'dislike', term: dislike, matched });
  }

  const diet = p.diet ? normalizeDietaryToken(p.diet) : '';
  if (diet) {
    const conflicts = DIET_CONFLICTS[diet] ?? [];
    for (const term of conflicts) {
      const matched = findTermMatch(haystack, term);
      if (matched) {
        flags.push({ severity: 'diet', term: diet, matched });
        break;
      }
    }
  }

  return { safe: !flags.some((f) => f.severity === 'allergy'), flags };
}

/** Split candidates into safe vs hard-flagged (allergens). Soft flags stay in `safe` with notes. */
export function partitionByDietarySafety<T>(
  profile: DietaryProfile | null | undefined,
  items: readonly T[],
  getText: (item: T) => string | readonly string[],
): { safe: T[]; flagged: Array<{ item: T; assessment: DietarySafetyAssessment }> } {
  const safe: T[] = [];
  const flagged: Array<{ item: T; assessment: DietarySafetyAssessment }> = [];
  for (const item of items) {
    const assessment = assessDietarySafety(profile, getText(item));
    if (assessment.safe) safe.push(item);
    else flagged.push({ item, assessment });
  }
  return { safe, flagged };
}

/** Coerce untrusted JSON (API / coach) into a DietaryProfile; null if unusable. */
export function sanitizeDietaryProfile(raw: unknown): DietaryProfile | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const allergies = stringList(o.allergies);
  const dislikes = stringList(o.dislikes);
  const diet = typeof o.diet === 'string' && o.diet.trim() ? normalizeDietaryToken(o.diet) : null;
  const notes = typeof o.notes === 'string' && o.notes.trim() ? o.notes.trim() : null;
  return { allergies, diet, dislikes, notes };
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t) continue;
    const key = normalizeDietaryToken(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
