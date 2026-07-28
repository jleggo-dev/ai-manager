/**
 * Today-screen day recap (REQ8 redesign) — ONE warm 5–10 word line shown after "It's {date} —".
 * A Broker (gemini) job over today's weather + activity titles, CACHED per user + local date so it
 * generates at most once a day (instant + cheap on every open). Fire-safe: any failure returns null
 * and the header simply shows the date with no line. No new schema — the cache is process-local.
 */
import { sql } from '../db/sql.ts';
import { runJobBySlug } from '../ai/aim.ts';
import { getUser } from '../repos/users.ts';
import { getWeatherForUser, formatWeatherLine, localDateIso } from './weather/weather.ts';

const cache = new Map<string, { recap: string | null; date: string }>();

/** Test seam — clear the process cache. */
export function __clearDayRecapCacheForTests(): void {
  cache.clear();
}

/** Coerce the job's `{ recap }` into a bounded line, or null when there's nothing usable. */
export function parseRecap(text: string): string | null {
  try {
    const o = JSON.parse(text) as { recap?: unknown };
    const r = typeof o.recap === 'string' ? o.recap.trim() : '';
    return r ? r.slice(0, 120) : null;
  } catch {
    return null;
  }
}

/** Today's activity titles (pending or done), earliest first — the recap's activity context. */
async function titlesForDay(userId: string, date: string): Promise<string[]> {
  const rows = await sql<{ title: string }[]>`
    select a.title
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.date = ${date} and o.status in ('pending', 'done')
    order by a.schedule->>'time_of_day' nulls last`;
  return rows.map((r) => r.title).filter(Boolean);
}

/** The day recap for the user's local today — cached, soft-failing to null. */
export async function getDayRecap(userId: string): Promise<string | null> {
  const user = await getUser(userId);
  const today = localDateIso(new Date(), user?.timezone);
  const key = `${userId}:${today}`;
  const hit = cache.get(key);
  if (hit && hit.date === today) return hit.recap;

  try {
    const [weather, titles] = await Promise.all([
      getWeatherForUser(userId)
        .then((w) => (w ? formatWeatherLine(w) : ''))
        .catch(() => ''),
      titlesForDay(userId, today).catch(() => [] as string[]),
    ]);
    const activities = titles.join(', ') || 'nothing scheduled';
    const res = await runJobBySlug(userId, 'day-recap', { weather, activities });
    const recap = parseRecap(res.formatted ?? res.raw ?? '');
    cache.set(key, { recap, date: today });
    return recap;
  } catch (err) {
    console.warn('[day-recap]', err instanceof Error ? err.message : err);
    cache.set(key, { recap: null, date: today });
    return null;
  }
}
