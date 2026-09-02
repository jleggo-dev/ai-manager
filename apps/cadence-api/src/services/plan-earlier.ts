import { listActivitiesByIds } from '../repos/activities.ts';
import { listGoals } from '../repos/goals.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { getUser } from '../repos/users.ts';
import { localDayIsoPlus } from './plan-day.ts';
import { iso, WEEKDAY, type PlanViewDay } from './plan-view.ts';

/**
 * The week(s) BEFORE today, for scrolling the trail back.
 *
 * The trail opens on today and runs forward; there was no way to look at yesterday, so a
 * breakfast you forgot to log at the time could never be logged at all (owner, 2026-09-01: "it
 * should stop at today, but there should be a mechanism to see previous days… so I can enter in
 * missed data"). This hands back one earlier week per ask — `weeks = 1` is the seven days ending
 * yesterday, `weeks = 2` the seven before those — as the same day shape the week view uses, so
 * the trail draws them with the same nodes and the same sheets open on tap.
 *
 * A past day belongs to whichever plan was active when it happened, so titles come from the
 * occurrence's OWN activity row (any plan version, superseded included — `listActivitiesByIds`),
 * never from the active plan: history is what was on the card that day, not what the card says
 * now. Never materializes anything — a day that had nothing scheduled stays "A clear day".
 */
export const MAX_EARLIER_WEEKS = 8;

export async function buildEarlierDays(
  userId: string,
  weeksBack: number,
  tzHint?: string | null,
): Promise<PlanViewDay[]> {
  const weeks = Math.min(MAX_EARLIER_WEEKS, Math.max(1, Math.trunc(weeksBack) || 1));
  const user = await getUser(userId);
  const timezone = user?.timezone ?? null;
  const now = new Date();
  // Seven days, the last of which is the day before the previous window's first day.
  const fromOffset = -7 * weeks;
  const from = localDayIsoPlus(now, fromOffset, timezone, tzHint);
  const to = localDayIsoPlus(now, fromOffset + 6, timezone, tzHint);

  const days: PlanViewDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000);
    days.push({
      date: iso(d),
      weekday: WEEKDAY[d.getUTCDay()]!,
      dayNum: d.getUTCDate(),
      isToday: false,
      occurrences: [],
    });
  }
  const dayByDate = new Map(days.map((dd) => [dd.date, dd]));

  const [occ, goalsList] = await Promise.all([listOccurrences(userId, from, to), listGoals(userId).catch(() => [])]);
  const activities = await listActivitiesByIds(userId, [...new Set(occ.map((o) => o.activity_id))]);
  const actById = new Map(activities.map((a) => [a.activity_id, a]));
  const goalById = new Map(goalsList.map((g) => [g.goal_id, g]));

  for (const o of occ) {
    const day = dayByDate.get(iso(o.date));
    const a = actById.get(o.activity_id);
    if (!day || !a) continue;
    const area = a.goal_id ? goalById.get(a.goal_id)?.area : undefined;
    day.occurrences.push({
      occurrence_id: o.occurrence_id,
      activity_id: o.activity_id,
      title: a.title,
      kind: a.kind,
      status: o.status,
      time_of_day: a.schedule?.time_of_day,
      ...(area ? { area } : {}),
    });
  }
  for (const day of days) {
    day.occurrences.sort((x, y) => (x.time_of_day ?? '99').localeCompare(y.time_of_day ?? '99'));
  }
  return days;
}
