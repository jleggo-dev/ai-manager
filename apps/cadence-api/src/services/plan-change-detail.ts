import { getUser } from '../repos/users.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { describeRecurrence } from './scheduling.ts';
import { clockLabel12 } from './plan-change-detail-labels.ts';
import { inheritCommitmentIds } from './plan-synthesis.ts';
import { sessionFingerprint } from './plan-commit-diff.ts';
import { buildProposedWeek, type ProposedRow, type WeekDay } from './plan-change-week.ts';
import { localDayIso, localDayIsoPlus } from './plan-day.ts';
import type { Activity, PendingPlanActivity } from '@cadence/shared';

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
  /** What the session will CONTAIN from now on, when the proposal changes it (or an add says).
   *  A rework keeps its days and time, so without this NOW and NEXT read identically and the card
   *  shows no change at all. */
  how_to?: string;
}

export interface PendingChangeDetail {
  /** The still-active plan's version, so the sheet can label the row "WEEK {version + 1}". Null
   *  when there is nothing pending, or the rare race where the active plan itself is gone. */
  plan_version: number | null;
  items: PendingChangeDetailItem[];
  /** Titles of the commitments the proposal drops. Not toggleable: the toggles address rows of the
   *  stored proposal, and a removed commitment has no row there. */
  removed: string[];
  /** The next seven days with the change applied, grouped by day — the sheet's full-height view.
   *  See plan-change-week.ts. */
  week: WeekDay[];
}

/** "Thu · 6:30 pm · 40 min" — the days it happens, when, and for how long, one line for a NOW/NEXT
 *  column. Reuses `describeRecurrence` (the same cadence words the plan, the build card and
 *  propose_plan_change's own change-lines already use) rather than inventing a second vocabulary
 *  for the same fact. An unset time or length omits that part instead of printing a placeholder;
 *  the length is there because a resize changes nothing else, and NOW → NEXT would read the same. */
export function scheduleLine(recurrence: string, timeOfDay?: string, durationMin?: number): string {
  const parts = [describeRecurrence(recurrence)];
  if (timeOfDay) parts.push(clockLabel12(timeOfDay));
  if (durationMin) parts.push(`${durationMin} min`);
  return parts.join(' · ');
}

/** A proposal row in the stored-Activity shape the commit's own fingerprint reads. */
function asCommitted(a: PendingPlanActivity): Pick<Activity, 'category' | 'schedule' | 'target' | 'how_to' | 'goal_id'> {
  return {
    category: a.category,
    schedule: { recurrence: a.recurrence, time_of_day: a.time_of_day, duration_min: a.duration_min },
    target: a.target,
    how_to: a.how_to,
    goal_id: a.goal_id,
  };
}

/**
 * Does this proposal row leave its commitment exactly as it is? Same test the commit uses to keep
 * a commitment's sessions (sessionFingerprint, plan-commit-diff.ts), plus the name. A proposal
 * stores the WHOLE next plan, so without this the sheet listed every commitment the person has:
 * swapping one warm-up (2026-11-01) read "Apply 18 changes" over 17 rows that changed nothing.
 */
function unchanged(a: PendingPlanActivity, now: Activity | undefined): boolean {
  if (!now) return false;
  return a.title.trim() === now.title.trim() && sessionFingerprint(asCommitted(a)) === sessionFingerprint(now);
}

/**
 * What the pending change actually changes — only the rows that differ from the active plan, plus
 * the names of what it drops. Nothing pending is an EMPTY list, not a 404: the sheet only opens
 * after ChangeCard (or its own "Show me" branch) has already confirmed something is there, so this
 * is a detail fetch, never the existence check.
 */
export async function buildPendingChangeDetail(userId: string, now = new Date()): Promise<PendingChangeDetail> {
  const user = await getUser(userId);
  const pending = user?.pending_plan;
  if (!pending?.activities?.length) return { plan_version: null, items: [], removed: [], week: [] };

  const plan = await getActivePlan(userId);
  const current = plan ? await listActivities(plan.plan_id) : [];
  const byCommitmentId = new Map(current.map((a) => [a.commitment_id, a] as const));

  // A rebuild's rows carry no commitment_id until the commit hands them their predecessors' by
  // title (inheritCommitmentIds). Match the same way here, on copies, or every row a rebuild kept
  // reads as new and every current one as removed.
  const proposed = pending.activities.map((a) => ({ ...a }));
  inheritCommitmentIds(proposed, current);

  const items: PendingChangeDetailItem[] = [];
  const rows: ProposedRow[] = [];
  proposed.forEach((a, index) => {
    const before = a.commitment_id ? byCommitmentId.get(a.commitment_id) : undefined;
    const same = unchanged(a, before);
    rows.push({ row: a, index, changed: !same });
    if (same) return;
    const how = a.how_to?.trim();
    items.push({
      index,
      title: a.title,
      ...(a.change_reason ? { change_reason: a.change_reason } : {}),
      enabled: a.enabled !== false,
      now: before
        ? scheduleLine(before.schedule.recurrence, before.schedule.time_of_day, before.schedule.duration_min)
        : null,
      next: scheduleLine(a.recurrence, a.time_of_day, a.duration_min),
      ...(how && how !== (before?.how_to ?? '').trim() ? { how_to: how } : {}),
    });
  });

  const kept = new Set(proposed.map((a) => a.commitment_id).filter(Boolean));
  const removed = current.filter((a) => !kept.has(a.commitment_id)).map((a) => a.title);

  const week = buildProposedWeek({
    proposed: rows,
    current,
    from: localDayIso(now, user?.timezone),
    to: localDayIsoPlus(now, 6, user?.timezone),
    // The same anchors a commit uses (plan-synthesis.ts): the active plan's generated_at date, and
    // the date the new version would be generated on.
    currentAnchor: plan ? new Date(plan.generated_at).toISOString().slice(0, 10) : now.toISOString().slice(0, 10),
    proposedAnchor: now.toISOString().slice(0, 10),
  });

  return { plan_version: plan?.version ?? null, items, removed, week };
}
