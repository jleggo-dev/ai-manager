import type { PlanViewData } from '../../lib/api.ts';
import { RationaleBubble } from './RationaleBubble.tsx';
import { ProposedWeek } from '../plan/ProposedWeek.tsx';
import { sparsePlan } from './planCard.ts';

/**
 * The plan card itself — her rationale bubble, then the week day by day — extracted from the
 * gate so it is ONE surface with several hosts (owner, 2026-08-12: "a default high-level
 * overview of the week that could be viewed anywhere in the app"). The gate wraps it in the
 * sign-up offer; the coach tab opens it as a sheet over the conversation; anything else that
 * needs "the plan, and why" composes this rather than growing its own.
 *
 * The week itself is the shared ProposedWeek module (owner, 2026-08-31: the rebalance sheet's
 * day-grouped look "shouldn't be isolated to re-balancing") — same grammar as a proposal, with
 * each commitment's why as tap-to-open marginalia on its first appearance. The old dot-strip
 * and the flat reasons list this replaces said the same things with the week's shape left out.
 */
export function PlanCardView({ plan }: { plan: PlanViewData }) {
  return (
    <>
      {plan.rationale && <RationaleBubble rationale={plan.rationale} startOpen={sparsePlan(plan.activities)} />}
      <ProposedWeek activities={plan.activities} />
    </>
  );
}
