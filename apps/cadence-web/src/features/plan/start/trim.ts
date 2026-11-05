import type { Walkthrough as WalkthroughData, WalkthroughStep } from '@cadence/shared';

/**
 * "I have less time" — Cadence proposes what to cut; the user confirms.
 *
 * The design is explicit that this step **never asks for a number**, and that is not a styling
 * preference. Asking "how many minutes?" makes the person do the planning: they have to guess a
 * budget, and then find out afterwards what their guess cost them. Proposing a concrete cut
 * inverts it — they see exactly which steps go and what's left before anything starts, which is
 * the same suggest-then-confirm contract every other plan change in Cadence honours.
 *
 * Core steps are the floor of what she PROPOSES: she never suggests cutting one. The proposal is
 * where the choosing starts, though, not the end of it: the person can put back anything she cut
 * and drop anything she kept, the core included (`pickSteps`), because it is their session and
 * their time (owner, 2026-11-05).
 */

export interface TrimProposal {
  /** What would run, in the original order. */
  kept: WalkthroughStep[];
  /** What Cadence proposes dropping — shown by name, never as a silent diff. */
  cut: WalkthroughStep[];
  minutes: number;
  /** Whether a tighter proposal exists below this one. */
  canTrimMore: boolean;
}

const minutesOf = (steps: WalkthroughStep[]): number => steps.reduce((n, s) => n + s.minutes, 0);

/**
 * The trim ladder, tightest-last. Two rungs at most:
 *   1. drop the steps already marked optional
 *   2. drop everything that isn't core
 * Rungs that don't actually differ collapse, so "Trim more" never appears when it would do
 * nothing — an offer that changes nothing is worse than no offer.
 */
function ladder(wt: WalkthroughData): WalkthroughStep[][] {
  const rungs = [wt.steps.filter((s) => s.core || !s.skippable), wt.steps.filter((s) => s.core)];
  const seen = new Set<string>();
  const out: WalkthroughStep[][] = [];
  for (const rung of rungs) {
    if (rung.length === 0 || rung.length === wt.steps.length) continue; // nothing cut → not a rung
    const key = rung.map((s) => s.id).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rung);
  }
  return out;
}

/** Is there anything worth trimming at all? Drives whether the button is offered. */
export function canTrim(wt: WalkthroughData | null): boolean {
  return !!wt && ladder(wt).length > 0;
}

/** The proposal at `level` (0 = gentlest), or null when the session can't be trimmed. */
export function proposeTrim(wt: WalkthroughData, level: number): TrimProposal | null {
  const rungs = ladder(wt);
  if (rungs.length === 0) return null;
  const i = Math.min(Math.max(0, level), rungs.length - 1);
  const kept = rungs[i]!;
  const keptIds = new Set(kept.map((s) => s.id));
  return {
    kept,
    cut: wt.steps.filter((s) => !keptIds.has(s.id)),
    minutes: minutesOf(kept),
    canTrimMore: i < rungs.length - 1,
  };
}

/** What the person chose, row by row, in the session's own order. Empty when they dropped it all. */
export function pickSteps(steps: readonly WalkthroughStep[], keep: ReadonlySet<string>): TrimProposal {
  const kept = steps.filter((s) => keep.has(s.id));
  return { kept, cut: steps.filter((s) => !keep.has(s.id)), minutes: minutesOf(kept), canTrimMore: false };
}

/** Whether a pick is still exactly what she proposed, so her words and "trim more" still apply. */
export function isHerProposal(proposal: TrimProposal, keep: ReadonlySet<string>): boolean {
  return proposal.kept.length === keep.size && proposal.kept.every((s) => keep.has(s.id));
}

/** Her line over the list. "What I'd drop" is only true until the person changes something. */
export function trimLine(pick: TrimProposal, hers: boolean): string {
  if (pick.kept.length === 0) return 'That drops everything — keep at least one step.';
  if (hers) return `Here's what I'd drop — that brings it to ${pick.minutes} min. Sound right?`;
  if (pick.cut.length === 0) return `That keeps all of it — ${pick.minutes} min.`;
  return `Your call — that brings it to ${pick.minutes} min.`;
}

/** Turn an accepted proposal back into a runnable walkthrough. */
export function applyTrim(wt: WalkthroughData, proposal: TrimProposal): WalkthroughData {
  return { ...wt, total_min: proposal.minutes, steps: proposal.kept };
}
