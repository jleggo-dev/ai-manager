import type { Goal } from '@cadence/shared';

/**
 * Deterministic dynamic-intake gaps (pure, no DB/engine imports — unit-testable like
 * capture-normalize.ts / plan-match.ts). "Intake is a function of the goal, not a fixed form":
 * for a TARGET goal, a coach's first question is always "where are you now?" — the measure's
 * `start`. We can detect that gap without an LLM: a target with no start is an open intake
 * question. Body-weight metrics are skipped — current weight already lives in
 * `baseline.weight_kg` and is chased by the existing body-relevant readiness checks.
 */

export interface StartingPointGap {
  title: string; // the goal, in the user's words
  metric: string; // what to ask about ("5k time", "books per year", …)
}

const WEIGHTY = /\b(kg|lbs?|weight)\b/i;

export function startingPointGaps(goals: Array<Pick<Goal, 'title' | 'type' | 'measure'>>, max = 3): StartingPointGap[] {
  const gaps: StartingPointGap[] = [];
  for (const g of goals) {
    if (g.type !== 'target') continue; // milestones ride assessment; recurring habits have no number
    const m = g.measure;
    if (!m || m.target == null || m.target === '') continue; // no number to move toward → nothing to anchor
    if (m.start != null && m.start !== '') continue; // starting point already known
    if (WEIGHTY.test(String(m.unit ?? '')) || WEIGHTY.test(String(m.metric ?? ''))) continue; // baseline owns weight
    const title = g.title.trim();
    if (!title) continue;
    gaps.push({ title, metric: String(m.metric ?? '').trim() || 'that number' });
    if (gaps.length >= max) break;
  }
  return gaps;
}
