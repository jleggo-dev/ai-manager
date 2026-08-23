/**
 * The Week tab's one rule, stated as tests: a blank day is not a bad day. Days ahead read "not
 * yet", lived days with nothing on them read "nothing logged", and neither is ever a zero to be
 * scored against. Averages leave today alone, because a day in progress is not a result.
 */
import { describe, expect, it } from 'vitest';
import type { Meal } from '../../lib/api.ts';
import { buildWeek, totalsByDate, weekOf } from './foodWeekModel.ts';

const meal = (date: string, over: Partial<Meal> = {}): Meal =>
  ({ log_id: `m-${date}-${Math.random()}`, date, meal: 'lunch', items: [], ...over }) as Meal;

// Wednesday 3 September 2026.
const WED = '2026-09-02';

describe('weekOf', () => {
  it('runs Monday to Sunday, as the frame captions it', () => {
    const days = weekOf(WED);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-08-31'); // Monday
    expect(days[6]).toBe('2026-09-06'); // Sunday
    expect(days).toContain(WED);
  });

  it('keeps a Monday in its own week rather than starting the next one', () => {
    expect(weekOf('2026-08-31')[0]).toBe('2026-08-31');
  });

  it('keeps a Sunday at the end of the week it belongs to', () => {
    expect(weekOf('2026-09-06')[0]).toBe('2026-08-31');
  });
});

describe('buildWeek', () => {
  const meals = [
    meal('2026-08-31', { macros: { kcal: 1880, protein_g: 148 } }),
    meal('2026-09-01', { macros: { kcal: 1910, protein_g: 151 } }),
    meal(WED, { macros: { kcal: 1240, protein_g: 88 } }),
  ];

  it('never reads zero: days ahead are "not yet", a lived blank day is "nothing logged"', () => {
    const week = buildWeek(WED, meals);
    const byDate = new Map(week.days.map((d) => [d.date, d]));
    expect(byDate.get('2026-09-03')?.state).toBe('future');
    expect(byDate.get('2026-09-06')?.state).toBe('future');
    // Tuesday 1 Sep is logged; drop it and the same lived day becomes "nothing logged", not zero.
    const thin = buildWeek(
      WED,
      meals.filter((m) => m.date !== '2026-09-01'),
    );
    expect(thin.days.find((d) => d.date === '2026-09-01')?.state).toBe('nothing');
  });

  it('averages the days behind you and leaves today out of it', () => {
    const week = buildWeek(WED, meals);
    expect(week.avgDays).toBe(2);
    expect(week.avg?.kcal).toBe(1895); // (1880 + 1910) / 2 — today's 1,240 is still happening
    expect(week.loggedDays).toBe(3); // but the week still knows today was logged
  });

  it('has no average at all when today is the only logged day', () => {
    const week = buildWeek(WED, [meal(WED, { macros: { kcal: 900 } })]);
    expect(week.avg).toBeNull();
    expect(week.avgDays).toBe(0);
  });

  it('carries micronutrients through the average, not just the four macros', () => {
    const week = buildWeek(WED, [
      meal('2026-08-31', { macros: { kcal: 2000, iron_mg: 10 } }),
      meal('2026-09-01', { macros: { kcal: 2000, iron_mg: 6 } }),
    ]);
    expect(week.avg?.iron_mg).toBe(8);
  });

  it('marks today so the row can say which day you are standing on', () => {
    expect(buildWeek(WED, meals).days.filter((d) => d.isToday)).toHaveLength(1);
  });
});

describe('totalsByDate', () => {
  it('sums confirmed meals only, exactly as GET /nutrition/day does', () => {
    const totals = totalsByDate([
      meal(WED, { macros: { kcal: 500 } }),
      meal(WED, { macros: { kcal: 400 } }),
      meal(WED, { provisional: true, macros: { kcal: 900 } }),
    ]);
    expect(totals.get(WED)?.kcal).toBe(900);
  });
});
