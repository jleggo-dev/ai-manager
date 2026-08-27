import { describe, it, expect } from 'vitest';
import type { WeekReviewFacts } from '../../../lib/api.ts';
import { applyMealToggle, applyMindStepToggle, applySessionToggle, applyWeighInToggle } from './week-review-mutate.ts';

const FACTS: WeekReviewFacts = {
  period: { from: '2026-08-17', to: '2026-08-23' },
  weigh_in: { occurrence_id: 'w1', date: '2026-08-23', status: 'pending' },
  days: [
    {
      date: '2026-08-17',
      sessions: [{ occurrence_id: 's1', title: 'Easy run', status: 'pending', planned_min: 30 }],
      meals: [
        { meal: 'breakfast', occurrence_id: 'b1', logged: false },
        { meal: 'lunch', occurrence_id: 'l1', logged: false },
        { meal: 'dinner', occurrence_id: 'd1', logged: false },
      ],
      mind: [
        {
          occurrence_id: 'g1',
          title: 'Evening pages',
          status: 'pending',
          steps: [
            { name: 'Settle', done: false },
            { name: 'Write', done: true },
          ],
        },
      ],
    },
  ],
};

describe('applySessionToggle', () => {
  it('confirms done and records minutes, leaving every other row untouched', () => {
    const next = applySessionToggle(FACTS, 's1', true, 32);
    expect(next.days[0]!.sessions[0]).toMatchObject({ status: 'done', logged_min: 32 });
    expect(next.days[0]!.meals).toEqual(FACTS.days[0]!.meals);
  });

  it('un-checking marks skipped, never back to pending', () => {
    const next = applySessionToggle(FACTS, 's1', false);
    expect(next.days[0]!.sessions[0]!.status).toBe('skipped');
  });

  it('leaves logged_min alone when no minutes are given', () => {
    const next = applySessionToggle(FACTS, 's1', true);
    expect(next.days[0]!.sessions[0]!.logged_min).toBeUndefined();
  });

  it('is a no-op for an occurrence id the week does not have', () => {
    const next = applySessionToggle(FACTS, 'nope', true);
    expect(next).toEqual(FACTS);
  });
});

describe('applyMealToggle', () => {
  it('flips only the named day + slot', () => {
    const next = applyMealToggle(FACTS, '2026-08-17', 'lunch', true);
    const meals = next.days[0]!.meals;
    expect(meals.find((m) => m.meal === 'lunch')!.logged).toBe(true);
    expect(meals.find((m) => m.meal === 'breakfast')!.logged).toBe(false);
    expect(meals.find((m) => m.meal === 'dinner')!.logged).toBe(false);
  });

  it('touches nothing on a day that does not match', () => {
    const next = applyMealToggle(FACTS, '2026-09-01', 'lunch', true);
    expect(next).toEqual(FACTS);
  });
});

describe('applyMindStepToggle', () => {
  it('flips the named step and leaves the sibling step alone', () => {
    const next = applyMindStepToggle(FACTS, 'g1', 'Settle', true);
    const steps = next.days[0]!.mind[0]!.steps!;
    expect(steps.find((s) => s.name === 'Settle')!.done).toBe(true);
    expect(steps.find((s) => s.name === 'Write')!.done).toBe(true);
  });

  it('sets the row done once every step is done', () => {
    const next = applyMindStepToggle(FACTS, 'g1', 'Settle', true);
    expect(next.days[0]!.mind[0]!.status).toBe('done');
  });

  it('reverts an all-done row to pending when a step is un-checked', () => {
    const allDone = applyMindStepToggle(FACTS, 'g1', 'Settle', true);
    const reverted = applyMindStepToggle(allDone, 'g1', 'Write', false);
    expect(reverted.days[0]!.mind[0]!.status).toBe('pending');
  });

  it('is a no-op for a mind row with no named steps (a plain done/not-done row)', () => {
    const plainDone: WeekReviewFacts = {
      ...FACTS,
      days: [{ ...FACTS.days[0]!, mind: [{ occurrence_id: 'g2', title: 'Sit', status: 'done', done: true }] }],
    };
    const next = applyMindStepToggle(plainDone, 'g2', 'Settle', false);
    expect(next).toEqual(plainDone);
  });
});

describe('applyWeighInToggle', () => {
  it('flips the week-level weigh-in status', () => {
    const next = applyWeighInToggle(FACTS, true);
    expect(next.weigh_in).toEqual({ ...FACTS.weigh_in, status: 'done' });
  });

  it('un-checking marks skipped', () => {
    const done = applyWeighInToggle(FACTS, true);
    const next = applyWeighInToggle(done, false);
    expect(next.weigh_in!.status).toBe('skipped');
  });

  it('is a no-op when the week has no weigh-in scheduled', () => {
    const noWeighIn: WeekReviewFacts = { ...FACTS, weigh_in: null };
    expect(applyWeighInToggle(noWeighIn, true)).toEqual(noWeighIn);
  });
});
