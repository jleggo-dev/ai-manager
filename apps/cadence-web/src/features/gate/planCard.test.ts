import { describe, expect, it } from 'vitest';
import type { PlanActivity } from '../../lib/api.ts';
import { groupPlanRows, rowMeta, sparsePlan } from './planCard.ts';

const act = (over: Partial<PlanActivity>): PlanActivity => ({
  activity_id: over.activity_id ?? 'a1',
  title: over.title ?? 'Writing session',
  kind: over.kind ?? 'user',
  cadence: over.cadence ?? 'Mon, Wed, Fri',
  recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  ...over,
});

describe('groupPlanRows', () => {
  it('drops headers on a single-goal plan — the headline already names it', () => {
    const rows = [
      act({ activity_id: 'a', goal_id: 'g1', goal_title: 'Write a novel', area: 'practice' }),
      act({ activity_id: 'b', goal_id: 'g1', goal_title: 'Write a novel', area: 'practice' }),
      act({ activity_id: 'c', title: 'Weekly check-in', kind: 'system' }),
    ];
    const groups = groupPlanRows(rows);
    expect(groups.map((g) => g.header)).toEqual([null, null]);
    expect(groups[0]!.items).toHaveLength(2);
  });

  it('shows "Toward <goal>" headers at ≥2 goals, foundations sinking last', () => {
    const rows = [
      act({ activity_id: 'chk', title: 'Weekly check-in', kind: 'system' }),
      act({ activity_id: 'a', goal_id: 'g1', goal_title: 'Run a 10k', area: 'movement' }),
      act({ activity_id: 'b', goal_id: 'g2', goal_title: 'Daily pages', area: 'practice' }),
    ];
    const groups = groupPlanRows(rows);
    expect(groups.map((g) => g.header)).toEqual(['Toward Run a 10k', 'Toward Daily pages', 'Foundations']);
    expect(groups[0]!.headerArea).toBe('movement');
  });
});

describe('sparsePlan', () => {
  it('pre-opens the reasoning at ≤2 activities — a lone collapsed row reads as a bug', () => {
    expect(sparsePlan([act({})])).toBe(true);
    expect(sparsePlan([act({}), act({ activity_id: 'b' })])).toBe(true);
    expect(sparsePlan([act({}), act({ activity_id: 'b' }), act({ activity_id: 'c' })])).toBe(false);
  });
});

describe('rowMeta', () => {
  it('joins cadence and duration, omitting what is absent', () => {
    expect(rowMeta(act({ duration_min: 45 }))).toBe('Mon, Wed, Fri · 45 min');
    expect(rowMeta(act({}))).toBe('Mon, Wed, Fri');
  });

  /**
   * The consent row carries both numbers (owner ruling 2026-08-17): the effort he named, and what
   * to keep free for it. Deciding whether you can afford a rhythm needs the second one.
   */
  it('shows the effort AND the time to set aside, when there is warm-up to allow for', () => {
    expect(rowMeta(act({ duration_min: 45, area: 'movement' }))).toBe('Mon, Wed, Fri · 45 min (allow 55)');
  });

  it('keeps a meditation at its full length and budgets the settling time separately', () => {
    expect(rowMeta(act({ duration_min: 20, area: 'mind' }))).toBe('Mon, Wed, Fri · 20 min (allow 25)');
  });

  it('stays a single number when the effort is the whole session', () => {
    expect(rowMeta(act({ duration_min: 15, area: 'nourishment' }))).toBe('Mon, Wed, Fri · 15 min');
  });
});
