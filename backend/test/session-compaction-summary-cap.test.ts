/**
 * HARNESS-V3 C5.4, open item (2) (2026-11-01): `existingSummary` is a job variable like any other,
 * and `interpolateTemplate` cuts every variable at `MAX_VARIABLE_LENGTH`. The structured summary
 * keeps its headings in a fixed order, so a cut would drop the LAST ones (where things stand, what
 * did not work) without a word. The planner refuses to fold past the cap and says so, loudly.
 */
import { describe, it, expect } from 'vitest';
import type { ChatSessionRow } from '../src/types.ts';
import { MAX_VARIABLE_LENGTH } from '../src/ai-manager/job-execution-utils.ts';
import { planCompaction, SUMMARY_BUDGET_CHARS, type NoCompaction } from '../src/services/session-compaction-plan.ts';
import { LIVE_POLICY, block, rowFactory, said } from './helpers/compaction-sim.ts';

/** The plan as a refusal; the test asserts `transcript` is undefined first. */
const refusal = (plan: ReturnType<typeof planCompaction>): NoCompaction => {
  expect(plan.transcript).toBeUndefined();
  return plan as NoCompaction;
};

/** A small policy so a handful of rows is over the trigger; the patterns are the live ones. */
const POLICY = { ...LIVE_POLICY, triggerTokens: 1_500, ceilingTokens: 3_000, keepTailUnits: 600, minRemovedUnits: 50 };

const sessionWith = (summary: string): ChatSessionRow =>
  ({ id: 's1', config: { summarizer: POLICY }, workspace_id: 'w', session_summary: summary }) as unknown as ChatSessionRow;

/** Twelve exchanges the size production stores: well over the small trigger either way. */
function history() {
  const row = rowFactory();
  const rows = [row('system', 'persona'), row('user', block('capabilities', 100))];
  for (let i = 0; i < 12; i++) {
    rows.push(row('user', block('turn-context', 400)), row('user', said(`U${i}`, 80)), row('assistant', said(`A${i}`, 400)));
  }
  return rows;
}

describe('the summary budget is the variable cap the job applies', () => {
  it('is MAX_VARIABLE_LENGTH exactly: a summary that long is read whole, one char more is cut', () => {
    expect(SUMMARY_BUDGET_CHARS).toBe(MAX_VARIABLE_LENGTH);
  });

  it('folds when the summary sits exactly at the cap', () => {
    const plan = planCompaction(sessionWith('x'.repeat(SUMMARY_BUDGET_CHARS)), history(), POLICY, 'trigger');
    expect(plan.transcript).toBeDefined();
  });

  it('refuses, loudly, when the summary is one char over the cap', () => {
    const plan = refusal(planCompaction(sessionWith('x'.repeat(SUMMARY_BUDGET_CHARS + 1)), history(), POLICY, 'trigger'));
    expect(plan.loud).toBe(true);
    expect(plan.skipped).toContain(`${SUMMARY_BUDGET_CHARS + 1} chars, over the ${SUMMARY_BUDGET_CHARS}`);
    expect(plan.skipped).toContain('last headings');
  });

  it('refuses at the ceiling too: a cut summary is never the price of a smaller request', () => {
    const plan = refusal(planCompaction(sessionWith('x'.repeat(SUMMARY_BUDGET_CHARS + 500)), history(), POLICY, 'ceiling'));
    expect(plan.loud).toBe(true);
  });

  it('says nothing about the cap when the history is under the trigger', () => {
    const row = rowFactory();
    const few = [row('system', 'persona'), row('user', said('U0', 80)), row('assistant', said('A0', 100))];
    const plan = refusal(planCompaction(sessionWith(''), few, POLICY, 'trigger'));
    expect(plan.skipped).toBeUndefined();
    expect(plan.loud).toBeUndefined();
  });
});
