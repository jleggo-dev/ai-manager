import type { EquipmentCategory, Goal, GoalArea, GoalAssessment, GoalType, TimeOfDay } from '@cadence/shared';

export type Step = 'goals' | 'you' | 'gear';

/** The manage wizard (Settings → "Edit goals & equipment"): curation only — committing a plan
 *  and picking a portrait live elsewhere (the chat and the Settings portrait row). */
export const MANAGE_ORDER: Step[] = ['goals', 'you', 'gear'];
export const LABELS: Record<Step, string> = {
  goals: 'Goals',
  you: 'About you',
  gear: 'Tools',
};

/** How availability reads in the UI. "Flexible" is a real answer, not a missing one. */
export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: 'Mornings work best',
  midday: 'Middays work best',
  evening: 'Evenings work best',
  flexible: 'Any time works',
};

/** The same slots, said briefly. Someone who gave two windows gets a list, and "Mornings work
 *  best · Evenings work best" is not a sentence anyone would say out loud. */
export const TIME_OF_DAY_SHORT: Record<TimeOfDay, string> = {
  morning: 'mornings',
  midday: 'middays',
  evening: 'evenings',
  flexible: 'any time',
};

export const GOAL_AREAS: GoalArea[] = ['movement', 'nourishment', 'mind', 'practice'];
export const AREA_LABELS: Record<GoalArea, string> = {
  movement: 'Movement',
  nourishment: 'Nourishment',
  mind: 'Mind',
  practice: 'Practice',
};

export const GOAL_TYPES: GoalType[] = ['milestone', 'target', 'recurring'];
export const TYPE_LABELS: Record<GoalType, string> = {
  milestone: 'A day you’re aiming at',
  target: 'A number you’re moving toward',
  recurring: 'Something you keep doing',
};
export const TYPE_HINTS: Record<GoalType, string> = {
  milestone: 'A dated one-off — a race, an exam, a trip.',
  target: 'A number to reach — a goal weight, ≤2 drinks/day, 8 glasses of water.',
  recurring: 'An ongoing habit — meditate daily, eat more veg, journal.',
};

export const VERDICT_LABELS: Record<GoalAssessment['verdict'], string> = {
  on_track: 'On track',
  stretch: 'A stretch',
  unrealistic: 'Worth right-sizing',
};

export const EQUIP_CATS: EquipmentCategory[] = [
  'footwear',
  'cardio',
  'strength',
  'accessory',
  'reading',
  'practice',
  'craft',
  'study',
  'other',
];
export const EQUIP_LABELS: Record<EquipmentCategory, string> = {
  footwear: 'Footwear',
  cardio: 'Cardio',
  strength: 'Strength',
  accessory: 'Accessory',
  reading: 'Books & reading',
  practice: 'Practice',
  craft: 'Craft supplies',
  study: 'Study & learning',
  other: 'Other',
};

/** Render a target goal's measure as a plain phrase ("Reach 170 lbs", "Reduce to 2 drinks/day"). */
export function measurePhrase(m?: Goal['measure']): string {
  if (!m || m.target == null || String(m.target).trim() === '') return '';
  const val = [m.target, m.unit].filter((x) => x != null && String(x).trim() !== '').join(' ');
  const verb = m.direction === 'increase' ? 'Reach' : m.direction === 'decrease' ? 'Reduce to' : 'Toward';
  return `${verb} ${val}`;
}
