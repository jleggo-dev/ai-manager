import { describe, it, expect } from 'vitest';
import { normalizeTempActivity, computeTempOccurrenceDates } from './episode-overlay.ts';

describe('normalizeTempActivity', () => {
  it('coerces a temp activity to our shape, tagged category "episode"', () => {
    const a = normalizeTempActivity({
      title: '  Hotel circuit  ',
      kind: 'user',
      schedule: { recurrence: 'FREQ=DAILY' },
    });
    expect(a).toMatchObject({
      title: 'Hotel circuit',
      kind: 'user',
      category: 'episode',
      completion_source: 'self_report',
    });
    expect(a?.schedule?.recurrence).toBe('FREQ=DAILY');
  });
  it('defaults an unknown kind to "user"', () => {
    expect(normalizeTempActivity({ title: 'Walk', kind: 'weird' })?.kind).toBe('user');
    expect(normalizeTempActivity({ title: 'Log food', kind: 'system' })?.kind).toBe('system');
  });
  it('drops entries with no usable title / non-objects', () => {
    expect(normalizeTempActivity({ kind: 'user' })).toBeNull();
    expect(normalizeTempActivity({ title: '   ' })).toBeNull();
    expect(normalizeTempActivity(null)).toBeNull();
    expect(normalizeTempActivity('nope')).toBeNull();
  });
});

describe('computeTempOccurrenceDates', () => {
  it('expands a recurrence across the episode window', () => {
    expect(computeTempOccurrenceDates('FREQ=DAILY', '2026-07-15', '2026-07-17')).toEqual([
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
    ]);
  });
  it('a one-off (empty recurrence) is a single option on the start day', () => {
    expect(computeTempOccurrenceDates('', '2026-07-15', '2026-07-20')).toEqual(['2026-07-15']);
    expect(computeTempOccurrenceDates(undefined, '2026-07-15', '2026-07-20')).toEqual(['2026-07-15']);
  });
});
