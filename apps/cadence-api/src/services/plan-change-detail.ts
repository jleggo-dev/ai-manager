import { getUser } from '../repos/users.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { describeRecurrence } from './scheduling.ts';
import { ANYTIME } from './plan-edit.ts';

/**
 * The Changes sheet's one read: the FULL per-item view of whatever `propose_plan_change` last put
 * up, so the sheet never has to re-derive it from the free-text `changes` lines ChangeCard already
 * renders. Same reasoning as `week-review-facts.ts`: the tool computed and stored the proposal:
 * this reads it back, rather than trusting the turn that announced it.
 */

/** One swap candidate — a row from the stored `pending_plan.activities`, its position in that
 *  array (stable; nothing here or in propose_plan_change ever reorders it), and its NOW → NEXT
 *  WEEK schedule. */
export interface PendingChangeDetailItem {
  index: number;
  title: string;
  /** The coach's one-line why, when `propose_plan_change` was given one. Absent for an ordinary
   *  edit that carried no `reason` — most of them. */
  change_reason?: string;
  /** Resolved default: absent on the stored row reads as true (broker-contracts.ts), same as the
   *  commit funnel already treats it (plan-partial-apply.ts). */
  enabled: boolean;
  /** The still-active plan's CURRENT schedule for this commitment, summarized ("Thu · 6:30 pm").
   *  Null for a pure add — there is no "now" for a commitment that doesn't exist yet. */
  now: string | null;
  /** The proposal's own schedule for this row, same summary shape as `now`. */
  next: string;
}

export interface PendingChangeDetail {
  /** The still-active plan's version, so the sheet can label the row "WEEK {version + 1}". Null
   *  when there is nothing pending, or the rare race where the active plan itself is gone. */
  plan_version: number | null;
  items: PendingChangeDetailItem[];
}

/** "6:30 pm", "7 am" — the user's own 12-hour clock, minutes dropped on the hour. Anything that
 *  isn't a bare HH:MM passes through unchanged, except the literal `anytime` plan-edit.ts stores
 *  for "no particular time" — spelled out the same way its own card lines already say it. */
function clockLabel12(raw: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return raw === ANYTIME ? 'any time' : raw;
  const minute = Number(m[2]);
  let hour = Number(m[1]) % 12;
  if (hour === 0) hour = 12;
  const suffix = Number(m[1]) >= 12 ? 'pm' : 'am';
  return minute === 0 ? `${hour} ${suffix}` : `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** "Thu · 6:30 pm" — the days it happens plus when, one line for a NOW/NEXT column. Reuses
 *  `describeRecurrence` (the same cadence words the plan, the build card and propose_plan_change's
 *  own change-lines already use) rather than inventing a second vocabulary for the same fact. No
 *  time set omits the time half instead of printing a placeholder. */
export function scheduleLine(recurrence: string, timeOfDay?: string): string {
  const days = describeRecurrence(recurrence);
  return timeOfDay ? `${days} · ${clockLabel12(timeOfDay)}` : days;
}

/**
 * The pending change, in full — nothing pending is an EMPTY list, not a 404: the sheet only opens
 * after ChangeCard (or its own "Show me" branch) has already confirmed something is there, so this
 * is a detail fetch, never the existence check.
 */
export async function buildPendingChangeDetail(userId: string): Promise<PendingChangeDetail> {
  const pending = (await getUser(userId))?.pending_plan;
  if (!pending?.activities?.length) return { plan_version: null, items: [] };

  const plan = await getActivePlan(userId);
  const current = plan ? await listActivities(plan.plan_id) : [];
  const byCommitmentId = new Map(current.map((a) => [a.commitment_id, a] as const));

  const items = pending.activities.map((a, index) => {
    const now = a.commitment_id ? byCommitmentId.get(a.commitment_id) : undefined;
    return {
      index,
      title: a.title,
      ...(a.change_reason ? { change_reason: a.change_reason } : {}),
      enabled: a.enabled !== false,
      now: now ? scheduleLine(now.schedule.recurrence, now.schedule.time_of_day) : null,
      next: scheduleLine(a.recurrence, a.time_of_day),
    };
  });

  return { plan_version: plan?.version ?? null, items };
}
