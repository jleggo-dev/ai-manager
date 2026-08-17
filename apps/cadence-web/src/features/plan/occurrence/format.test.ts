import type { SessionItem } from '@cadence/shared';
import type { OccurrenceDetail } from '../../../lib/api.ts';
import {
  downscaleDimensions,
  isFoodRow,
  isWeighInPending,
  leftLine,
  macroLine,
  mealForNow,
  qty,
  sheetMinutes,
  ytSearch,
} from './format.ts';

const item = (partial: Partial<SessionItem>): SessionItem => ({ name: 'x', ...partial });

const detail = (partial: Partial<OccurrenceDetail>): OccurrenceDetail => ({
  occurrence_id: 'o1',
  activity_id: 'a1',
  date: '2026-07-20',
  status: 'pending',
  title: 'Session',
  kind: 'user',
  ...partial,
});

describe('occurrence formatters', () => {
  it('qty composes only present fields', () => {
    expect(qty(item({ sets: 3, reps: 8, load: '55 lb' }))).toBe('3×8 · @ 55 lb');
    expect(qty(item({ sets: 4 }))).toBe('4 sets');
    expect(qty(item({ reps: 12 }))).toBe('12 reps');
    expect(qty(item({ duration_min: 12, distance_km: 5 }))).toBe('12 min · 5 km');
    expect(qty(item({}))).toBe('');
  });

  it('ytSearch builds a search URL and collapses whitespace', () => {
    expect(ytSearch('  goblet   squat  ')).toBe('https://www.youtube.com/results?search_query=goblet%20squat');
  });

  it('leftLine omits ~ and rounds macros; empty when no macros', () => {
    expect(leftLine(null)).toBe('');
    expect(leftLine(undefined)).toBe('');
    expect(leftLine({ kcal: 1400, protein_g: 0.4, carbs_g: 110.2, fat_g: 35.6 })).toBe('1400 kcal · P0 C110 F36 left');
  });

  it('macroLine prefixes estimates with ~', () => {
    expect(macroLine({})).toBe('');
    expect(macroLine({ kcal: 320, protein_g: 18.4, carbs_g: 34, fat_g: 12 })).toBe('~320 kcal · P18 C34 F12');
  });

  it('mealForNow picks kind from hour-of-day buckets', () => {
    expect(mealForNow(new Date('2026-07-20T08:00:00'))).toBe('breakfast');
    expect(mealForNow(new Date('2026-07-20T12:00:00'))).toBe('lunch');
    expect(mealForNow(new Date('2026-07-20T15:30:00'))).toBe('snack');
    expect(mealForNow(new Date('2026-07-20T19:00:00'))).toBe('dinner');
    expect(mealForNow(new Date('2026-07-20T22:00:00'))).toBe('snack');
  });

  it('downscaleDimensions caps the longest side at 1024 and never shrinks below 1px', () => {
    expect(downscaleDimensions(2048, 1024)).toEqual({ width: 1024, height: 512 });
    expect(downscaleDimensions(800, 600)).toEqual({ width: 800, height: 600 });
    expect(downscaleDimensions(0, 0)).toEqual({ width: 1, height: 1 });
  });

  it('isFoodRow matches system food/meal/nutrition titles only', () => {
    expect(isFoodRow(null)).toBe(false);
    expect(isFoodRow(detail({ kind: 'user', title: 'Meal prep' }))).toBe(false);
    expect(isFoodRow(detail({ kind: 'system', title: 'Log your meals' }))).toBe(true);
    expect(isFoodRow(detail({ kind: 'system', title: 'Food check-in' }))).toBe(true);
    expect(isFoodRow(detail({ kind: 'system', title: 'Nutrition observe' }))).toBe(true);
    expect(isFoodRow(detail({ kind: 'system', title: 'Weigh in' }))).toBe(false);
  });

  it('isWeighInPending requires system + weigh title + pending', () => {
    expect(isWeighInPending(detail({ kind: 'system', title: 'Weigh in', status: 'pending' }))).toBe(true);
    expect(isWeighInPending(detail({ kind: 'system', title: 'Weigh in', status: 'done' }))).toBe(false);
    expect(isWeighInPending(detail({ kind: 'user', title: 'Weigh in', status: 'pending' }))).toBe(false);
    expect(isWeighInPending(detail({ kind: 'system', title: 'Log food', status: 'pending' }))).toBe(false);
  });
});

/**
 * The sheet used to show `schedule.duration_min` in its header and the walkthrough's block sum on
 * the Start button twenty lines below, with nothing saying they measured different things. Now the
 * header names both, and the total it names is the one the button uses.
 */
describe('sheetMinutes', () => {
  const run = detail({ schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', duration_min: 40 } });

  it('shows the effort and the prescribed total, agreeing with the Start button', () => {
    expect(sheetMinutes(run, { total_min: 50 })).toBe('40 min (allow 50)');
  });

  it('shows the effort alone when no session has been prescribed to measure', () => {
    expect(sheetMinutes(run, null)).toBe('40 min');
  });

  it('shows the effort alone when the session adds nothing around it', () => {
    const sit = detail({ schedule: { recurrence: 'FREQ=DAILY', duration_min: 20 } });
    expect(sheetMinutes(sit, { total_min: 20 })).toBe('20 min');
  });

  it('never advertises a total shorter than the effort', () => {
    expect(sheetMinutes(run, { total_min: 25 })).toBe('40 min');
  });

  it('renders nothing when the commitment carries no duration', () => {
    expect(sheetMinutes(detail({}), { total_min: 30 })).toBeNull();
  });
});
