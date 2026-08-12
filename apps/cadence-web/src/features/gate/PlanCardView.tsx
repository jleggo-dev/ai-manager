import type { PlanViewData } from '../../lib/api.ts';
import { WeekStrip } from './WeekStrip.tsx';
import { RationaleBubble } from './RationaleBubble.tsx';
import { PlanReasonRows } from './PlanReasonRows.tsx';
import { sparsePlan } from './planCard.ts';

/**
 * The plan card itself — week strip, her rationale bubble, the commitments with their whys —
 * extracted from the gate so it is ONE surface with several hosts (owner, 2026-08-12: "a default
 * high-level overview of the week that could be viewed anywhere in the app"). The gate wraps it
 * in the sign-up offer; the coach tab opens it as a sheet over the conversation; anything else
 * that needs "the plan, and why" composes this rather than growing its own.
 */
export function PlanCardView({ plan }: { plan: PlanViewData }) {
  const sparse = sparsePlan(plan.activities);
  return (
    <>
      <WeekStrip week={plan.week} activities={plan.activities} />
      {plan.rationale && <RationaleBubble rationale={plan.rationale} startOpen={sparse} />}
      <PlanReasonRows activities={plan.activities} startOpen={sparse} />
    </>
  );
}
