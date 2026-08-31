import type { PlanActivity } from '../../lib/api.ts';

/**
 * Pure view logic for the plan card (design: "Cadence Plan Card Gate"). The week rows themselves
 * moved into the shared week module (plan/weekGroups.ts + ProposedWeek) when the rebalance
 * sheet's day-grouped look became THE week look (owner, 2026-08-31); what's left here is the
 * card-level rule the rationale bubble still needs.
 */

/**
 * The sparse rule (design frame 4): at ≤2 activities the rationale arrives already open — when
 * the plan is one row, the reasoning IS the content, and a collapsed bubble reads as a bug
 * rather than restraint.
 */
export function sparsePlan(activities: PlanActivity[]): boolean {
  return activities.length <= 2;
}
