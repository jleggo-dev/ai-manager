/* ════════════════════════════════════════════════════════════════
   §5.1 User & baseline
   ════════════════════════════════════════════════════════════════ */

/**
 * Life areas a goal can live in (BRAND.md nomenclature). Every kind of goal gets a
 * first-class home day one: a Spartan race (movement), better meals (nourishment),
 * burnout recovery (mind), daily prayer or morning pages (practice). Broaden by enum
 * ADDITION only (craft, spirit, learning) — never a migration. 'weight' is not an area:
 * a weight target is a numeric measure.target on a goal, not an area of life.
 */
export type GoalArea = 'movement' | 'nourishment' | 'mind' | 'practice';

/** The canonical `GoalArea` values, kept in one place so a Scribe-extraction
 *  guard (`isGoalArea`) and any UI area picker never drift from the type above. */
export const GOAL_AREAS: readonly GoalArea[] = ['movement', 'nourishment', 'mind', 'practice'];

/** Narrows an untrusted value (e.g. raw Scribe/model output) to a `GoalArea` —
 *  "the app asserts before committing, never trusts raw model output" (see file header). */
export function isGoalArea(value: unknown): value is GoalArea {
  return typeof value === 'string' && (GOAL_AREAS as readonly string[]).includes(value);
}

/**
 * Something the user is working around — physical or not (BRAND.md: "What we work
 * around"). A torn ACL, burnout, grief, and a night shift all fit. `plan_around: true`
 * means the coach must design around it, never ask the user to push through.
 */
export interface Constraint {
  id: string;
  label: string; // e.g. "left knee — patellar tendinopathy", "burnout", "night shifts"
  kind?: 'physical' | 'life' | 'other';
  plan_around: boolean;
}

export interface WeightTrend {
  current: number;
  start: number;
  source: 'healthkit' | 'manual';
  updated_at: string; // ISO date
}

export interface Baseline {
  age?: number;
  height_cm?: number;
  weight_kg?: WeightTrend; // canonical store (kg); the UOM the user prefers is weight_unit
  weight_unit?: 'kg' | 'lbs';
  height_unit?: 'cm' | 'ft'; // canonical store is always height_cm; this is the display UOM
  /** Unified "what we work around" list — replaces the old injuries[] + free-text constraints[]. */
  constraints: Constraint[];
  preferences: {
    dietary?: string[];
    nudge_tone?: 'warm' | 'neutral' | 'firm';
  };
}

export interface Connection {
  source: 'apple_health' | string;
  scopes: string[];
  status: 'connected' | 'disconnected';
}

export interface SteerBack {
  aggressivity: 'gentle' | 'balanced' | 'firm';
  missed_threshold: number;
}

export interface UserProfile {
  user_id: string;
  name: string;
  /** Coarse home location captured at onboarding (§B1), permission-gated. */
  home_location?: { lat: number; lon: number; label?: string };
  timezone?: string;
  baseline: Baseline;
  connections: Connection[];
  steer_back: SteerBack;
}
