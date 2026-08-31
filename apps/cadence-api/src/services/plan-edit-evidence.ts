import type { Constraint, PendingPlanActivity } from '@cadence/shared';
import { firesOn, readDensity } from './plan-density.ts';
import { ANYTIME } from './plan-edit.ts';

/**
 * Evidence about the week a proposal WOULD produce, rendered into `propose_plan_change`'s return.
 *
 * The gap this closes (2026-08-31, the Wednesday case): the owner's proposed week had hill
 * intervals, an early run, AND mobility stacked on a Wednesday whose own constraint said ONE
 * workout and no afternoons — and no tool said a word, because the tool's return was only the
 * diff lines. She could describe each edit correctly and still never see the week the edits
 * added up to. Same ruling as the coach-authored-weeks inversion (owner 2026-08-31: the coach IS
 * the planner): she emits the slate, code executes it, and the guards here hand back EVIDENCE
 * with the result — the card still goes up, nothing blocks, SHE adjudicates.
 *
 * Everything in this file is pure: the resulting activity set in, lines out. The caller
 * (coach-actions.ts) appends them to the tool's return after the proposal is stored.
 */

/** RRULE day codes in week order — the axis `readDensity.perDay` is indexed by. */
const RRULE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/** Grid labels, exactly as the get_active_plan render prints them (retrieval/registry.ts). */
const GRID_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

/** Day words for the collision lines — the same three-letter form the card's own diff lines use
 *  (describeRecurrence: "Mon, Wed, Fri"), so one message never spells a day two ways. */
const DAY_WORDS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * The proposed week's day grid, one line, in the exact style `get_active_plan` renders the
 * committed week — so the coach can compare what she just proposed against what she read.
 * `readDensity` walks `schedule.recurrence` on Activity rows; a pending row carries the same
 * RRULE flat, so it is re-nested here rather than the arithmetic re-implemented.
 */
export function proposedWeekShape(activities: PendingPlanActivity[]): string {
  const d = readDensity(activities.map((a) => ({ kind: a.kind, schedule: { recurrence: a.recurrence } })));
  const shape = d.perDay.map((n, i) => `${GRID_NAMES[i]} ${n || '—'}`).join(' · ');
  return `Proposed week shape (their own items per day): ${shape}`;
}

/**
 * Two (or more) of THEIR commitments landing on the same day at the same stated time.
 *
 * Only concrete, matching times collide: an untimed commitment and an `anytime` one float, and a
 * warning about a clash that exists only if you squint would teach her to ignore the real ones.
 * One line per occupied slot, naming every title in it — evidence, never a veto: back-to-back
 * can be exactly what the user asked for, and she is the one who knows.
 */
export function timeCollisions(activities: PendingPlanActivity[]): string[] {
  const timed = activities.filter(
    (a) => a.kind !== 'system' && !!a.time_of_day?.trim() && a.time_of_day.trim() !== ANYTIME,
  );
  const lines: string[] = [];
  RRULE_DAYS.forEach((code, i) => {
    const bySlot = new Map<string, string[]>();
    for (const a of timed) {
      if (!firesOn(a.recurrence, code)) continue;
      const t = a.time_of_day!.trim();
      bySlot.set(t, [...(bySlot.get(t) ?? []), a.title]);
    }
    for (const [t, titles] of bySlot) {
      if (titles.length < 2) continue;
      const named = titles.map((x) => `"${x}"`).join(' and ');
      lines.push(`Time collision: ${named} ${titles.length > 2 ? 'all' : 'both'} land on ${DAY_WORDS[i]} at ${t}.`);
    }
  });
  return lines;
}

/**
 * The user's plan-around constraints, said back as a check-list — deliberately NOT matched against
 * the week by string rules. "Wednesday - limit to one workout" carries its meaning in words no
 * containment rule reads (the same lesson as the constraint twins, 2026-08-31), so code handing
 * over the labels and HER checking the week against them is the honest division of labour.
 * Empty when nothing on file is planned around.
 */
export function constraintChecklist(
  constraints: ReadonlyArray<Partial<Pick<Constraint, 'label' | 'plan_around'>>> | undefined,
): string[] {
  const labels = (constraints ?? []).filter((c) => c.plan_around && c.label?.trim()).map((c) => c.label!.trim());
  if (!labels.length) return [];
  return [`Their file says they work around: ${labels.join('; ')} — check the proposed week against these.`];
}

/** The whole report, in the order the coach should read it: shape, clashes, then the check-list. */
export function planEditEvidence(
  proposed: PendingPlanActivity[],
  constraints: ReadonlyArray<Partial<Pick<Constraint, 'label' | 'plan_around'>>> | undefined,
): string[] {
  return [proposedWeekShape(proposed), ...timeCollisions(proposed), ...constraintChecklist(constraints)];
}
