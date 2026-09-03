import { describe, it, expect } from 'vitest';
import type { RepertoireItem, RepertoireStatus } from '@cadence/shared';
import { resolveRepertoire } from './progress-nontemporal-repertoire.ts';

const NOW = new Date('2026-08-31T12:00:00Z');

function item(label: string, status: RepertoireStatus, over: Partial<RepertoireItem> = {}): RepertoireItem {
  return {
    item_id: `zzq-${label}`,
    user_id: 'zzq-user',
    goal_id: 'g-piano',
    label,
    status,
    kind: 'piece',
    meta: null,
    started_at: '2026-07-20T09:00:00Z',
    learned_at: null,
    last_practiced_at: null,
    ...over,
  };
}

describe('resolveRepertoire', () => {
  it('omits with evidence when nothing is on file (and says so per-goal when scoped)', () => {
    expect(resolveRepertoire([], null, NOW)).toEqual({
      id: 'repertoire',
      kind: 'repertoire',
      reason: 'no repertoire on file',
    });
    expect(resolveRepertoire([item('Clair de lune', 'working')], 'g-other', NOW)).toEqual({
      id: 'repertoire',
      kind: 'repertoire',
      reason: 'no repertoire items for this goal',
    });
  });

  it('maps standing: known → learned (month from learned_at), practiced working → in progress, untouched working → not started', () => {
    const result = resolveRepertoire(
      [
        item('River Flows in You', 'working'), // coach's pick, never practiced
        // Started 2026-07-20, practiced — 6 whole weeks before Aug 31.
        item('Clair de lune', 'working', { last_practiced_at: '2026-08-29T18:00:00Z' }),
        item('Gymnopédie №1', 'known', { learned_at: '2026-03-14T10:00:00Z' }),
        item('Comptine d’un autre été', 'known', { learned_at: '2026-06-02T10:00:00Z' }),
      ],
      'g-piano',
      NOW,
    );
    expect(result).toEqual({
      items: [
        { label: 'Gymnopédie №1', state: 'learned', learned_month: '2026-03' },
        { label: 'Comptine d’un autre été', state: 'learned', learned_month: '2026-06' },
        { label: 'Clair de lune', state: 'in_progress', weeks_in: 6 },
        { label: 'River Flows in You', state: 'not_started' },
      ],
      learned: 2,
      in_progress: 1,
      noun: 'pieces',
    });
  });

  it('shows a backfilled known item (learned_at null) as learned with NO month — never an invented date', () => {
    const result = resolveRepertoire([item('Für Elise', 'known')], 'g-piano', NOW);
    expect('items' in result && result.items[0]).toEqual({
      label: 'Für Elise',
      state: 'learned',
      learned_month: null,
    });
  });

  /**
   * The four standings (owner design 2026-09-02). Nothing is excluded from the card any more —
   * `parked`, the one standing that was, is gone. `retired` is finished material and counts as
   * learned (retiring must never shrink "learned this year"); `queued` is material they have yet
   * to start, which is the state 'not started' already means.
   */
  it('counts retired as learned and queued as not started, and week counts floor at 1', () => {
    const result = resolveRepertoire(
      [
        item('Moonlight Sonata', 'retired', { learned_at: '2026-05-11T10:00:00Z' }),
        item('Frankie and Johnnie', 'queued'),
        item('Arabesque', 'working', { started_at: '2026-08-30T09:00:00Z', last_practiced_at: '2026-08-30T10:00:00Z' }),
      ],
      'g-piano',
      NOW,
    );
    expect(result).toEqual({
      items: [
        { label: 'Moonlight Sonata', state: 'learned', learned_month: '2026-05' },
        { label: 'Arabesque', state: 'in_progress', weeks_in: 1 },
        { label: 'Frankie and Johnnie', state: 'not_started' },
      ],
      learned: 1,
      in_progress: 1,
      noun: 'pieces',
    });
  });

  it('a retired item they already knew keeps showing as learned with no month — never an invented one', () => {
    const result = resolveRepertoire([item('Für Elise', 'retired')], 'g-piano', NOW);
    expect('items' in result && result.items[0]).toEqual({
      label: 'Für Elise',
      state: 'learned',
      learned_month: null,
    });
  });

  it('caps the visible list from the oldest-learned end; counts stay whole; noun falls back to items', () => {
    const learned = Array.from({ length: 12 }, (_, i) =>
      item(`piece ${String(i).padStart(2, '0')}`, 'known', {
        kind: null,
        learned_at: `2026-${String(i + 1).padStart(2, '0')}-05T10:00:00Z`,
      }),
    );
    const working = item('the new one', 'working', { kind: null, last_practiced_at: '2026-08-30T10:00:00Z' });
    const result = resolveRepertoire([...learned, working], null, NOW);
    if (!('items' in result)) throw new Error('expected a payload');
    expect(result.items).toHaveLength(10);
    // The in-progress row survives the cap; the trimmed rows are the oldest learned months.
    expect(result.items.at(-1)).toMatchObject({ label: 'the new one', state: 'in_progress' });
    expect(result.items[0]).toMatchObject({ learned_month: '2026-04' });
    expect(result.learned).toBe(12);
    expect(result.in_progress).toBe(1);
    expect(result.noun).toBe('items');
  });
});
