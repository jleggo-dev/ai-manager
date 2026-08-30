import { describe, it, expect } from 'vitest';
import { resolveWindowRange, omit, EPOCH_DATE } from './progress-window.ts';

const NOW = new Date('2026-08-29T12:00:00Z');

describe('resolveWindowRange', () => {
  it('week: trailing 7 days ending today, labeled plainly', () => {
    expect(resolveWindowRange('week', NOW)).toEqual({ from: '2026-08-23', to: '2026-08-29', label: 'this week', days: 7 });
  });

  it('month: trailing 30 days ending today', () => {
    expect(resolveWindowRange('month', NOW)).toEqual({
      from: '2026-07-31',
      to: '2026-08-29',
      label: 'this month',
      days: 30,
    });
  });

  it('all: floors at the epoch rather than an open-ended null the caller has to branch on', () => {
    const r = resolveWindowRange('all', NOW);
    expect(r.from).toBe(EPOCH_DATE);
    expect(r.to).toBe('2026-08-29');
    expect(r.label).toBe('all time');
  });
});

describe('omit', () => {
  it('shapes a WidgetOmission — the evidence guards report instead of throwing or going silent', () => {
    expect(omit('shelf', 'shelf', 'no goal events in this window')).toEqual({
      id: 'shelf',
      kind: 'shelf',
      reason: 'no goal events in this window',
    });
  });
});
