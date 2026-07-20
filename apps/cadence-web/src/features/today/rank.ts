import type { ProgressCard } from '@cadence/shared';

/**
 * Dashboard sort: movement rings first, then counts, practice dots, measured, milestones —
 * the S6 registry order. Nourishment consistency is dropped in the dashboard renderer
 * (the Nutrition card owns that area); this rank still places it with other consistency cards.
 */
export function rankProgressCard(c: ProgressCard): number {
  if (c.kind === 'consistency') return c.area === 'movement' ? 0 : 2;
  if (c.kind === 'count') return 1;
  if (c.kind === 'latest_vs_target') return 3;
  return 4; // countdown
}
