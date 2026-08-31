import { describe, expect, it } from 'vitest';
import type { PlanActivity } from '../../lib/api.ts';
import { sparsePlan } from './planCard.ts';

const act = (over: Partial<PlanActivity>): PlanActivity => ({
  activity_id: over.activity_id ?? 'a1',
  title: over.title ?? 'Writing session',
  kind: over.kind ?? 'user',
  cadence: over.cadence ?? 'Mon, Wed, Fri',
  recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  ...over,
});

describe('sparsePlan', () => {
  it('pre-opens the reasoning at ≤2 activities — a lone collapsed bubble reads as a bug', () => {
    expect(sparsePlan([act({})])).toBe(true);
    expect(sparsePlan([act({}), act({ activity_id: 'b' })])).toBe(true);
    expect(sparsePlan([act({}), act({ activity_id: 'b' }), act({ activity_id: 'c' })])).toBe(false);
  });
});
