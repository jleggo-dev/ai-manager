/**
 * Goal realism assessment (spec §6.2) — the coach's honest read on ONE goal, plus stepping-stones.
 * The point of the whole "coach, not an app" promise: don't just record "run a Spartan Beast in
 * October," pressure-test it against where the person actually is and propose a realistic ramp.
 *
 * SUGGEST-ONLY: this never writes to the goal. It returns the assessment; the user accepts (or
 * edits) the stepping-stones + any right-sized target/date in Review, which PATCHes the goal.
 */
import type { GoalAssessment } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { getGoal } from '../repos/goals.ts';
import { getUser } from '../repos/users.ts';
import { logAi } from './ai-log.ts';

const VERDICTS = new Set<GoalAssessment['verdict']>(['on_track', 'stretch', 'unrealistic']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function assessGoal(userId: string, goalId: string): Promise<GoalAssessment | null> {
  const goal = await getGoal(userId, goalId);
  if (!goal) return null;
  const user = await getUser(userId);

  const res = await runJobBySlug(userId, 'assess-goal', {
    goal: JSON.stringify({
      title: goal.title,
      area: goal.area,
      type: goal.type,
      measure: goal.measure,
      timeframe: goal.timeframe,
    }),
    baseline: JSON.stringify(user?.baseline ?? {}),
  });
  const p = parseJson(res.formatted ?? res.raw ?? '');
  if (!p) return null;

  const st = p.suggested_target as { value?: unknown; unit?: unknown } | null | undefined;
  const assessment: GoalAssessment = {
    verdict: VERDICTS.has(p.verdict as GoalAssessment['verdict'])
      ? (p.verdict as GoalAssessment['verdict'])
      : 'stretch',
    assessment: typeof p.assessment === 'string' ? p.assessment.trim() : '',
    suggested_target:
      st && typeof st === 'object' && typeof st.value === 'number'
        ? { value: st.value, unit: String(st.unit ?? '') }
        : null,
    suggested_end: typeof p.suggested_end === 'string' && ISO_DATE.test(p.suggested_end) ? p.suggested_end : null,
    milestones: Array.isArray(p.milestones)
      ? (p.milestones as unknown[])
          .filter(
            (m): m is { label: string; target_date?: unknown } =>
              !!m && typeof (m as { label?: unknown }).label === 'string',
          )
          .map((m) => ({
            label: String(m.label).trim(),
            target_date: typeof m.target_date === 'string' && ISO_DATE.test(m.target_date) ? m.target_date : undefined,
          }))
          .filter((m) => m.label.length > 0)
          .slice(0, 6)
      : [],
  };

  void logAi(userId, {
    kind: 'assess_goal',
    input: { goalId, title: goal.title },
    output: assessment,
    meta: { verdict: assessment.verdict },
  });
  return assessment;
}
