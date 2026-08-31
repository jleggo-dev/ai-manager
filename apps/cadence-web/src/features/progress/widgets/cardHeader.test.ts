import { describe, expect, it } from 'vitest';
import type { WidgetSpec } from '@cadence/shared';
import { deadlineTag, headerTag } from './cardHeader.ts';

const spec = (over: Partial<WidgetSpec>): WidgetSpec => ({ id: 'w', kind: 'stage_path', ...over });
const NOW = new Date('2026-08-31T10:00:00');

describe('deadlineTag', () => {
  it('counts down to a goal-scoped deadline, in the card tag', () => {
    expect(deadlineTag(spec({ deadline: '2026-10-04' }), 'stage_path', NOW)).toBe(' · Oct 4 · 34 days out');
    expect(deadlineTag(spec({ deadline: '2026-09-01' }), 'count_toward', NOW)).toBe(' · Sep 1 · 1 day out');
    expect(deadlineTag(spec({ deadline: '2026-08-31' }), 'stage_path', NOW)).toBe(' · Aug 31 · today');
  });

  it('says nothing for passed deadlines, other kinds, or specs without one', () => {
    // Counting what happened, never a scoreboard: an overdue tag would be shame in mono-caps.
    expect(deadlineTag(spec({ deadline: '2026-08-30' }), 'stage_path', NOW)).toBe('');
    expect(deadlineTag(spec({ deadline: '2026-10-04' }), 'trend_vs_target', NOW)).toBe('');
    expect(deadlineTag(spec({}), 'stage_path', NOW)).toBe('');
  });
});

describe('headerTag', () => {
  it('names the repertoire counts from the payload, never a stored sentence', () => {
    expect(
      headerTag({
        kind: 'repertoire',
        data: { items: [], learned: 2, in_progress: 1, noun: 'pieces' },
      }),
    ).toBe('repertoire · 2 learned · 1 in progress');
  });

  it('names the felt measure and its source', () => {
    expect(headerTag({ kind: 'felt_week', data: { weeks: [] } })).toBe('felt · from your daily notes');
  });
});
