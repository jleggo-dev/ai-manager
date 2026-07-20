import type { EquipmentCategory, Goal, GoalArea, GoalAssessment, GoalType } from '@cadence/shared';

export type Step = 'goals' | 'you' | 'gear' | 'lock';

export const ONBOARD_ORDER: Step[] = ['goals', 'you', 'gear', 'lock'];
/** Manage mode (from Settings): same curation surface, NO lock step. */
export const MANAGE_ORDER: Step[] = ['goals', 'you', 'gear'];
export const LABELS: Record<Step, string> = {
  goals: 'Goals',
  you: 'About you',
  gear: 'Tools',
  lock: 'Set your rhythm',
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
