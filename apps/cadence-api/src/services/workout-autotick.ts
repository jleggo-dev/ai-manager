import { getUser } from '../repos/users.ts';
import { listPendingForDate, setOccurrenceStatus } from '../repos/occurrences.ts';
import { matchWorkoutToActivity, workoutValue, type RecordedWorkout } from './workout-match.ts';

/**
 * A workout the watch recorded ticks the session that was planned for it.
 *
 * The missing half of `completion_source: 'healthkit'` — a field the plan has always written and
 * nothing ever read. Someone ran for 77 minutes, their phone told us, the coach could see it, and
 * the plan still showed the run as pending and waited to be told (owner, 2026-08-15).
 *
 * Runs when new rows arrive, and only forward: it ticks PENDING occurrences and never un-ticks,
 * re-writes or overrides anything a person did themselves. A session someone already logged in
 * their own words keeps those words — the device's numbers are the weaker record of the two.
 */
export async function autoTickFromWorkouts(userId: string, workouts: RecordedWorkout[]): Promise<number> {
  if (!workouts.length) return 0;
  const timezone = (await getUser(userId))?.timezone ?? 'UTC';

  // Group by the LOCAL day the workout started — a 22:30 run belongs to that evening's plan, not
  // to tomorrow because UTC rolled over.
  const byDate = new Map<string, RecordedWorkout[]>();
  for (const w of workouts) {
    const startedAt = (w as RecordedWorkout & { started_at?: string }).started_at;
    if (!startedAt) continue;
    const date = localDate(startedAt, timezone);
    if (!date) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), w]);
  }

  let ticked = 0;
  for (const [date, dayWorkouts] of byDate) {
    const pending = await listPendingForDate(userId, date);
    if (!pending.length) continue;
    // One workout claims at most one session, and each session at most one workout — a cooldown
    // walk logged right after a run must not also tick tomorrow's walk.
    const claimed = new Set<string>();
    for (const w of dayWorkouts) {
      const free = pending.filter((p) => !claimed.has(p.occurrence_id));
      const hit = matchWorkoutToActivity(w, free);
      if (!hit) continue;
      const target = free.find((p) => p.activity_id === hit.activity_id);
      if (!target) continue;
      claimed.add(target.occurrence_id);
      const value = workoutValue(w);
      await setOccurrenceStatus(userId, target.occurrence_id, 'done', Object.keys(value).length ? value : undefined);
      ticked += 1;
    }
  }
  return ticked;
}

/** The YYYY-MM-DD this instant falls on where the user lives. Null on an unusable zone/date. */
function localDate(iso: string, timezone: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
