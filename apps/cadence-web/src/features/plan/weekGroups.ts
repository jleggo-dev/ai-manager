import { budgetNote, sessionBudget, weekdaysFromRrule } from '@cadence/shared';
import { glyphOf } from '../today/glyphs.ts';
import type { Category } from '../today/category.ts';

/**
 * The least a row needs to take its place in the week. Both the pending proposal's activities
 * (PendingPlanActivity) and the committed plan's (PlanActivity) satisfy this structurally — the
 * whole point: the week module is ONE surface whether the week is being proposed, being shown at
 * the sign-up gate, or being reviewed from the chat (owner, 2026-08-31: "let's make sure it's
 * not isolated to re-balancing").
 */
export interface WeekRowLike {
  title: string;
  recurrence: string;
  cadence: string;
  time_of_day?: string;
  duration_min?: number;
  /** Pending-proposal lineage (0036) — absence MEANS new only when siblings carry it. */
  commitment_id?: string;
  /** Committed-plan identity; with commitment_id and title, one of three ways to say "same row". */
  activity_id?: string;
  area?: 'movement' | 'nourishment' | 'mind' | 'practice';
  /** The coach's rationale for THIS commitment — rendered as marginalia on its first appearance. */
  why?: string;
  /** She proposed this herself (adjacent support) — badged at the consent moment only. */
  suggested?: boolean;
}

export type WeekGroupRow<T extends WeekRowLike = WeekRowLike> = {
  a: T;
  /** First appearance of this commitment scanning the week in render order — the one instance
   *  that carries the why/badge, so a four-morning row doesn't repeat its marginalia four times. */
  first: boolean;
};

export type WeekGroup<T extends WeekRowLike = WeekRowLike> = {
  label: string;
  kind: 'daily' | 'day' | 'floating';
  minutes: number;
  rows: WeekGroupRow<T>[];
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Within a day: body first, then food, then mind, closing the day with reflection and practice. */
const FAMILY_ORDER: Record<Category, number> = { movement: 0, nutrition: 1, mindset: 2, reflection: 3, practice: 4 };

/** One identity per commitment across its appearances, whichever id shape the host has. */
export function rowKey(a: WeekRowLike): string {
  return a.activity_id ?? a.commitment_id ?? a.title;
}

/**
 * A row's subline: time · minutes for scheduled rows; the humanized cadence carries the "when"
 * for the floating group. Minutes come from sessionBudget — the effort itself plus "(allow N)"
 * when warm-up/cool-down make the session longer than the work (owner ruling 2026-08-17: the
 * person deciding whether they can afford this rhythm needs both numbers).
 */
export function rowMeta(a: WeekRowLike, kind: WeekGroup['kind']): string {
  const budget = sessionBudget(a.duration_min, a.area);
  const note = budget ? budgetNote(budget) : '';
  const mins = budget ? `${budget.effort_min} min${note ? ` ${note}` : ''}` : '';
  const bits = kind === 'floating' ? [a.cadence, a.time_of_day, mins] : [a.time_of_day, mins];
  return bits.filter(Boolean).join(' · ');
}

/**
 * Every day → each weekday it appears on → a floating group for anything whose recurrence the
 * parser honestly can't place (weekdaysFromRrule returns [] rather than guessing) — those rows
 * keep their humanized cadence string so nothing silently vanishes from the view.
 */
export function groupWeek<T extends WeekRowLike>(activities: T[]): WeekGroup<T>[] {
  const daily: T[] = [];
  const floating: T[] = [];
  const byDay: T[][] = [[], [], [], [], [], [], []];
  for (const a of activities) {
    const days = weekdaysFromRrule(a.recurrence);
    if (days.length === 7) daily.push(a);
    else if (days.length === 0) floating.push(a);
    else for (const d of days) byDay[d - 1]!.push(a);
  }
  const sortRows = (rows: T[]) =>
    [...rows].sort((x, y) => FAMILY_ORDER[glyphOf(x.title, x.area).cat] - FAMILY_ORDER[glyphOf(y.title, y.area).cat]);
  const groups: Array<{ label: string; kind: WeekGroup['kind']; minutes: number; sorted: T[] }> = [];
  if (daily.length) groups.push({ label: 'Every day', kind: 'daily', minutes: 0, sorted: sortRows(daily) });
  byDay.forEach((rows, i) => {
    if (!rows.length) return;
    const minutes = rows.reduce((sum, a) => sum + (a.duration_min ?? 0), 0);
    groups.push({ label: DAY_NAMES[i]!, kind: 'day', minutes, sorted: sortRows(rows) });
  });
  if (floating.length)
    groups.push({ label: 'Whenever it fits', kind: 'floating', minutes: 0, sorted: sortRows(floating) });
  // `first` is decided in final render order, so the why lands where the reader first meets a row.
  const seen = new Set<string>();
  return groups.map((g) => ({
    label: g.label,
    kind: g.kind,
    minutes: g.minutes,
    rows: g.sorted.map((a) => {
      const key = rowKey(a);
      const first = !seen.has(key);
      seen.add(key);
      return { a, first };
    }),
  }));
}
