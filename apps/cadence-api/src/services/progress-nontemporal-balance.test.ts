import { describe, it, expect } from 'vitest';
import type { SessionFeedbackRow } from '../repos/coach-moments.ts';
import { resolveBalance } from './progress-nontemporal-balance.ts';

function row(kind: 'movement' | 'mind', patch: Partial<SessionFeedbackRow> = {}): SessionFeedbackRow {
  return {
    feedback_id: 'zzq-feedback',
    occurrence_id: null,
    kind,
    rpe: null,
    felt_state: null,
    reason_code: null,
    created_at: '2026-08-20T00:00:00Z',
    ...patch,
  };
}

describe('resolveBalance', () => {
  it('omits with evidence when there are no answered sessions of that kind', () => {
    expect(resolveBalance([], 'mind')).toEqual({
      id: 'balance:mind',
      kind: 'balance',
      reason: 'no answered mind sessions in this window',
    });
  });

  it('mind: counts calmer as positive, out of every answered mind row', () => {
    const rows = [
      row('mind', { felt_state: 'calmer' }),
      row('mind', { felt_state: 'calmer' }),
      row('mind', { felt_state: 'same' }),
      row('mind', { felt_state: 'more_wound_up' }),
    ];
    expect(resolveBalance(rows, 'mind')).toEqual({ positive_label: 'Calmer', positive: 2, total: 4, noun: 'sits' });
  });

  it('movement: counts just_right as positive', () => {
    const rows = [row('movement', { rpe: 'just_right' }), row('movement', { rpe: 'too_hard' })];
    expect(resolveBalance(rows, 'movement')).toEqual({
      positive_label: 'Felt right',
      positive: 1,
      total: 2,
      noun: 'sessions',
    });
  });

  it('never exposes a complement/negative-series field — count what happened only', () => {
    const rows = [row('mind', { felt_state: 'more_wound_up' })];
    const result = resolveBalance(rows, 'mind');
    expect(Object.keys(result)).toEqual(['positive_label', 'positive', 'total', 'noun']);
  });

  it('filters rows by kind — a movement row never leaks into a mind balance', () => {
    const rows = [row('movement', { rpe: 'just_right' }), row('mind', { felt_state: 'calmer' })];
    expect(resolveBalance(rows, 'mind')).toEqual({ positive_label: 'Calmer', positive: 1, total: 1, noun: 'sits' });
  });
});
