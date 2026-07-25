import type { Activity } from '@cadence/shared';
import { toRRule, expandRecurrence } from './scheduling.ts';

/** Same sentinel as `EPISODE_CATEGORY` in repos/activities — kept local so this pure helper never
 *  imports the sql-backed repo module (CI unit tests have no CADENCE_DATABASE_URL). */
const EPISODE_CATEGORY = 'episode';

/**
 * Coerce one `disrupted_plan` temp activity ({ title, kind, schedule, swap_for }) into our Activity
 * shape, tagged `category: 'episode'`. Mirrors normalizeActivity (plan-synthesis) — never trust raw
 * model JSON. Returns null for an entry with no usable title (dropped by the caller).
 */
export function normalizeTempActivity(raw: unknown): Partial<Activity> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 120) : '';
  if (!title) return null;
  const sched = (r.schedule && typeof r.schedule === 'object' ? r.schedule : {}) as Record<string, unknown>;
  return {
    title,
    kind: r.kind === 'system' ? 'system' : 'user',
    category: EPISODE_CATEGORY,
    completion_source: 'self_report',
    schedule: { ...sched, recurrence: toRRule(sched) } as Activity['schedule'],
  };
}

/**
 * The dates to materialize a temp activity on across the episode window [start, end]. A temp
 * activity with a real recurrence expands over the window (anchored to `start`); a one-off (empty
 * recurrence) is a single option on the episode's start day. Pure.
 */
export function computeTempOccurrenceDates(recurrence: string | undefined, start: string, end: string): string[] {
  const rec = (recurrence ?? '').trim();
  return rec ? expandRecurrence(rec, start, end, start) : [start];
}
