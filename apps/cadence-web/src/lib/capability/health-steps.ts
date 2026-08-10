/**
 * Reading daily steps out of HealthKit — and the one-time re-ask that existing users need.
 *
 * **Why this isn't just a `queryAggregated` call.** Steps were added to the permission set AFTER
 * people had already granted the original one (workouts, distance, calories, heart rate). iOS
 * never re-opens the Health sheet on its own for a type an app has newly started asking for, so
 * for every existing install the step permission is in a third state: not granted, not denied,
 * never asked. HealthKit answers an unauthorized read the same way it answers a genuinely empty
 * one — an empty result, no error — which means "nothing came back" carries no information about
 * WHY. The only way to tell the two apart is to ask once and look again.
 *
 * That is the same trap `health-permissions.ts` was written for: a permission surface that
 * reports success while reading nothing. The rules that fall out of it:
 *
 * - An empty read triggers at most ONE re-request, ever, guarded by a caller-supplied flag. An
 *   unguarded retry would open a modal Health sheet on every cold start for anyone who really
 *   does have no step data.
 * - Nothing here throws. Steps ride along with a workout read that must still succeed without
 *   them; a step failure that took the workouts down with it would be a worse bug than the one
 *   this fixes.
 * - `[]` means "we could not read it", never "they took no steps". Callers must not store a zero.
 */
import type { DailySteps } from './index.ts';

/** One aggregated bucket as capacitor-health returns it (QueryAggregatedResponse.aggregatedData). */
export interface AggregatedBucket {
  startDate: string;
  endDate: string;
  value: number;
}

export interface StepsReaderDeps {
  /** `Health.queryAggregated({ dataType: 'steps', bucket: 'day', ... })`, already bound. */
  queryDailySteps(range: { startDate: string; endDate: string }): Promise<AggregatedBucket[]>;
  /** Re-open the permission request for the step type. May legitimately do nothing on iOS. */
  requestSteps(): Promise<unknown>;
  /** Has the one-time re-ask already happened for this person on this device? */
  hasAskedForSteps(): boolean;
  markAskedForSteps(): void;
  now?: () => number;
}

/** The device's wall-clock day for a bucket — a step day is a calendar day where the person is. */
function localDay(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Buckets → one row per calendar day, oldest first. HealthKit can return more than one bucket for
 * a day (multiple sources, a day split across a DST boundary), so days are summed rather than
 * replaced — otherwise a phone-plus-watch user silently loses whichever bucket arrived first.
 */
export function bucketsToDailySteps(buckets: AggregatedBucket[]): DailySteps[] {
  const byDay = new Map<string, number>();
  for (const b of buckets) {
    const date = localDay(b?.startDate ?? '');
    if (!date) continue;
    const v = Number(b.value);
    if (!Number.isFinite(v) || v < 0) continue;
    byDay.set(date, (byDay.get(date) ?? 0) + v);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, steps]) => ({ date, steps: Math.round(steps) }));
}

/** True when a read told us nothing — no buckets, or buckets that are all zero. */
function readNothing(rows: DailySteps[]): boolean {
  return rows.every((r) => r.steps <= 0);
}

export async function readDailySteps(sinceISO: string, deps: StepsReaderDeps): Promise<DailySteps[]> {
  const now = deps.now ?? Date.now;
  const range = { startDate: sinceISO, endDate: new Date(now()).toISOString() };

  const attempt = async (): Promise<DailySteps[]> => {
    try {
      return bucketsToDailySteps(await deps.queryDailySteps(range));
    } catch {
      return [];
    }
  };

  const first = await attempt();
  if (!readNothing(first)) return first;
  if (deps.hasAskedForSteps()) return first;

  // Nothing came back and we have never asked for this type — the existing-user case. Ask once,
  // record that we did whether or not the ask succeeds, and look again.
  deps.markAskedForSteps();
  try {
    await deps.requestSteps();
  } catch {
    /* a refused or unavailable prompt still leaves the second read worth trying */
  }
  const second = await attempt();
  return readNothing(second) ? first : second;
}
