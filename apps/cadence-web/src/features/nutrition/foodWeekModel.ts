import type { Meal, MealMacros } from '../../lib/api.ts';

/**
 * The Week tab's model (Food Journey 08b) — averages against target, then every day of it.
 *
 * The rule the frame states outright: **a blank day is not a bad day.** A day nobody has lived yet
 * reads "not yet", a day that was lived without a log reads "nothing logged", and neither one ever
 * reads zero. Zero is a score, and there is nothing here to score.
 *
 * Averages follow from the same rule. They run over **completed logged days only**: today is still
 * happening, so folding a half-eaten day into the mean would invent a downward trend every morning
 * and quietly read as a scold by lunchtime. If nothing has completed yet, there is no average — and
 * saying so is better than showing one that is arithmetic rather than information.
 *
 * Mon–Sun, per the frame's own caption ("averages, Mon–Sun"). The Day tab's dot row stays Sun-start
 * as frame 02 draws it; the two are never on screen together.
 */

export type WeekDayState = 'logged' | 'nothing' | 'future';

export interface WeekDay {
  date: string;
  /** "Mon" */
  dow: string;
  /** "1 Sep" */
  dayLabel: string;
  state: WeekDayState;
  isToday: boolean;
  kcal: number;
  protein_g: number;
}

export interface WeekView {
  days: WeekDay[];
  /** Averaged across completed logged days — null when none have completed. */
  avg: MealMacros | null;
  /** How many days the average is made of; 0 means there is no average to show. */
  avgDays: number;
  /** Days with anything logged at all, today included — what the week actually holds. */
  loggedDays: number;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parse(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1);
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Monday-start week containing `todayIso`, as seven local dates. */
export function weekOf(todayIso: string): string[] {
  const today = parse(todayIso);
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return iso(d);
  });
}

function addInto(acc: Record<string, number>, m?: MealMacros | null): void {
  if (!m) return;
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === 'number' && Number.isFinite(v)) acc[k] = (acc[k] ?? 0) + v;
  }
}

/**
 * Totals per date over confirmed meals only — the same population `GET /nutrition/day` totals, so
 * a day read here and the same day read there cannot disagree.
 */
export function totalsByDate(meals: Meal[]): Map<string, MealMacros> {
  const out = new Map<string, Record<string, number>>();
  for (const meal of meals) {
    if (meal.provisional) continue;
    const acc = out.get(meal.date) ?? {};
    addInto(acc, meal.macros);
    out.set(meal.date, acc);
  }
  return out as Map<string, MealMacros>;
}

/** Meals grouped by date, confirmed and provisional alike — the honesty count needs both sides. */
export function mealsByDate(meals: Meal[]): Map<string, Meal[]> {
  const out = new Map<string, Meal[]>();
  for (const meal of meals) out.set(meal.date, [...(out.get(meal.date) ?? []), meal]);
  return out;
}

function mean(days: MealMacros[]): MealMacros {
  const acc: Record<string, number> = {};
  for (const d of days) addInto(acc, d);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(acc)) out[k] = Math.round((v / days.length) * 10) / 10;
  return out as MealMacros;
}

export function buildWeek(todayIso: string, meals: Meal[]): WeekView {
  const totals = totalsByDate(meals);
  const logged = new Set([...mealsByDate(meals)].filter(([, m]) => m.length > 0).map(([d]) => d));

  const days: WeekDay[] = weekOf(todayIso).map((date) => {
    const d = parse(date);
    const t = totals.get(date) ?? {};
    const isToday = date === todayIso;
    const state: WeekDayState = date > todayIso ? 'future' : logged.has(date) ? 'logged' : 'nothing';
    return {
      date,
      dow: DOW[(d.getDay() + 6) % 7] ?? '',
      dayLabel: `${d.getDate()} ${MON[d.getMonth()] ?? ''}`,
      state,
      isToday,
      kcal: Math.round(t.kcal ?? 0),
      protein_g: Math.round(t.protein_g ?? 0),
    };
  });

  // Today is still being lived — averaging it in would invent a slump every morning.
  const complete = days.filter((d) => d.state === 'logged' && !d.isToday).map((d) => totals.get(d.date) ?? {});
  return {
    days,
    avg: complete.length ? mean(complete) : null,
    avgDays: complete.length,
    loggedDays: days.filter((d) => d.state === 'logged').length,
  };
}
