/**
 * Diff-aware commit invalidation (PLAN-CHANGES.md, Phase 1) — pure logic, no DB, no LLM.
 *
 * Every commit used to wipe EVERY future pending occurrence of the outgoing plan and let the
 * warm-up re-author every session (~34s each): a one-activity edit re-authored the whole week,
 * and build_next_week's byte-identical roll-forward re-authored it to change nothing (the exact
 * failure coach-actions.ts's no-op gate names: "regenerating ten prescribed sessions to change
 * nothing"). This module decides which of the outgoing plan's activities the new version leaves
 * UNCHANGED in every way a prescribed session depends on, so commitActivities can re-point their
 * future pending occurrences — cached sessions included — at the new plan's rows instead of
 * wiping them.
 *
 * Two gates, BOTH required for an old→new pair to survive:
 *  1. the session fingerprint below is equal — everything generateSession reads off the activity;
 *  2. the recurrence lands on the SAME dates under the new plan's anchor. expandRecurrence
 *     measures INTERVAL parity and the BYDAY/BYMONTHDAY defaults from plan.generated_at, and a
 *     new version gets a new generated_at — so "every other day" can flip parity across commits.
 *     A surviving row on a date the new plan would not schedule is a ghost occurrence, so when
 *     the date sets differ the pair is treated as changed and takes the ordinary wipe.
 */
import type { Activity } from '@cadence/shared';
import { expandRecurrence } from './scheduling.ts';

/** One old→new activity pairing whose future pending occurrences may survive, re-pointed. */
export interface SurvivorPair {
  oldActivityId: string;
  newActivityId: string;
  title: string;
}

export interface CommitDiff {
  survivors: SurvivorPair[];
  /** Old activities NOT surviving (changed, removed, or ambiguously titled) — their future
   *  pending occurrences take the wipe-and-rematerialize treatment, as every commit used to. */
  invalidated: number;
}

/** The date window and recurrence anchors the same-dates gate needs (gate 2 above). */
export interface CommitDiffWindow {
  /** First date the re-point/wipe touches — today, matching deleteFuturePendingOccurrences. */
  from: string;
  /** Last date of the new plan's materialization horizon (today + occurrenceDays). */
  to: string;
  /** The OLD plan's recurrence anchor: its generated_at date (ensureHorizon's convention). */
  oldAnchor: string;
  /** The NEW plan's recurrence anchor: its generated_at date. */
  newAnchor: string;
}

/**
 * Deterministic JSON with sorted object keys and undefined-valued keys dropped, so two values
 * that round-tripped through jsonb at different commits compare structurally, not by key order.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
  return `{${entries.join(',')}}`;
}

/** The fields the fingerprint covers — a stored Activity row from either plan version. */
export type FingerprintInput = Pick<Activity, 'category' | 'schedule' | 'target' | 'how_to' | 'goal_id'>;

/**
 * Everything a prescribed session depends on, and nothing else. The evidence is generateSession
 * (session-generate.ts): the ONLY activity fields it reads are title, kind, category, schedule,
 * target, how_to, and goal_id —
 *  - title/kind are the MATCH key, not fingerprinted here (title also keys progression history
 *    and the deterministic anchor; kind gates generation entirely);
 *  - category → the prescribe prompt's `activity.category` and the outdoor/weather check;
 *  - schedule.recurrence / time_of_day / duration_min → the prompt's `activity.schedule`
 *    (recurrence additionally decides WHICH dates exist — gate 2 handles the anchor half);
 *  - target, deep and scheme included → the prompt's `activity.target`, and `target.scheme`
 *    drives the deterministic engine's computeSession;
 *  - how_to → the prompt ("dead hangs, not farmers carries");
 *  - goal_id → the deterministic-mode plan_mode lookup and the repertoire scoping.
 *
 * Deliberately NOT fingerprinted: why, suggested, completion_source, commitment_id. Prescriptions
 * never see them, and survivors are re-pointed at the NEW activity row, so a reworded `why`
 * reaches the session sheet without costing a single re-authored session.
 */
export function sessionFingerprint(a: FingerprintInput): string {
  return canonical({
    category: a.category ?? null,
    recurrence: a.schedule?.recurrence ?? '',
    // ''/null/undefined all mean "no clock time" (minutesOfDay treats them identically).
    time_of_day: (a.schedule?.time_of_day ?? '').trim() || null,
    duration_min: a.schedule?.duration_min ?? null,
    target: a.target ?? null,
    how_to: a.how_to ?? null,
    goal_id: a.goal_id ?? null,
  });
}

/** Same normalization inheritCommitmentIds uses for "the same thing across versions", plus kind
 *  (a title that flips user↔system is a different thing — and a different generation gate). */
function matchKey(a: Pick<Activity, 'title' | 'kind'>): string {
  return `${a.kind}\n${(a.title ?? '').trim().toLowerCase()}`;
}

/** Gate 2: does this recurrence fire on the same dates in-window under both plans' anchors? */
function sameScheduledDates(recurrence: string, w: CommitDiffWindow): boolean {
  const oldDates = expandRecurrence(recurrence, w.from, w.to, w.oldAnchor).join(' ');
  const newDates = expandRecurrence(recurrence, w.from, w.to, w.newAnchor).join(' ');
  return oldDates === newDates;
}

function groupByKey(activities: Activity[]): Map<string, Activity[]> {
  const map = new Map<string, Activity[]>();
  for (const a of activities) {
    const key = matchKey(a);
    const group = map.get(key);
    if (group) group.push(a);
    else map.set(key, [a]);
  }
  return map;
}

/**
 * Pair the outgoing plan's activities against the incoming version's and return the pairs whose
 * occurrences may survive the commit. Both inputs are stored Activity rows (the old plan's
 * listActivities and the new version's insertActivities RETURNING set), so the comparison is
 * symmetric — both sides have been through the same normalization and jsonb round-trip.
 *
 * A title+kind collision (two same-titled rows on either side) has no safe pairing — the queue
 * trick inheritCommitmentIds uses decides lineage, not sameness — so all of them are treated as
 * changed. Correctness over cleverness: the cost of a wrong wipe is one cold session; the cost
 * of a wrong survival is a session prescribed for a commitment that no longer says that.
 */
export function diffCommittedActivities(
  oldActivities: Activity[],
  newActivities: Activity[],
  window: CommitDiffWindow,
): CommitDiff {
  const oldByKey = groupByKey(oldActivities);
  const newByKey = groupByKey(newActivities);

  const survivors: SurvivorPair[] = [];
  for (const [key, olds] of oldByKey) {
    const news = newByKey.get(key) ?? [];
    if (olds.length !== 1 || news.length !== 1) continue; // removed, or ambiguous — wipe
    const oldA = olds[0]!;
    const newA = news[0]!;
    if (sessionFingerprint(oldA) !== sessionFingerprint(newA)) continue;
    if (!sameScheduledDates(newA.schedule?.recurrence ?? '', window)) continue;
    survivors.push({ oldActivityId: oldA.activity_id, newActivityId: newA.activity_id, title: oldA.title });
  }
  return { survivors, invalidated: oldActivities.length - survivors.length };
}
