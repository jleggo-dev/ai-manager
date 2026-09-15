/**
 * The shelf (owner, 2026-09-14): "When I go to the plan, I immediately see the disrupted ask,
 * which should only display if I deliberately pull down."
 *
 * Two of the coach's proposals are not hers at all — they are the app noticing an absence
 * (situation.ts's return detection): "Life happened?" after four dark days, "Welcome back" after
 * seven. Both used to greet the plan the moment it opened, pushing today's first node off the
 * screen to ask a question the person had not raised. They now wait on a shelf above the trail:
 * a pull down from the top of the plan (or a tap on the grip) brings the banner out, and once out
 * for a given proposal it stays out for the session — the question was accepted, not the answer.
 *
 * A proposal the coach actually made ('replan' — a re-plan she recommended, or the monthly rebuild
 * checkpoint) is hers to raise and shows as it always has. Pure and table-tested
 * (`proposalShelf.test.ts`): a router deciding what is on screen fails silently (CLAUDE.md).
 */
export type ProposalAction = 'replan' | 'enter_disrupted' | 'rebaseline';

/** The pull that brings the shelf out, from a trail scrolled to its top. Past a scroll's own
 *  slop, short of a flick that means "show me last week". */
export const PULL_REVEAL_PX = 64;

export function isShelvedProposal(action: string | null | undefined): boolean {
  return action === 'enter_disrupted' || action === 'rebaseline';
}

/* ── Revealed this session — per proposal, in memory only (a tab switch unmounts the plan) ──── */

const revealed = new Set<string>();

export function wasRevealed(key: string): boolean {
  return revealed.has(key);
}

export function rememberRevealed(key: string): void {
  revealed.add(key);
}

/** Test seam. */
export function __clearRevealedForTests(): void {
  revealed.clear();
}
