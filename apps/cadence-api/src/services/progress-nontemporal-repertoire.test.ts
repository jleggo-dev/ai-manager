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
        // Started 2026-01-10, learned 2026-03-14 — 9 whole weeks.
        item('Gymnopédie №1', 'known', { started_at: '2026-01-10T10:00:00Z', learned_at: '2026-03-14T10:00:00Z' }),
        // Started 2026-04-20, learned 2026-06-02 — 6 whole weeks.
        item('Comptine d’un autre été', 'known', {
          started_at: '2026-04-20T10:00:00Z',
          learned_at: '2026-06-02T10:00:00Z',
        }),
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
      learned_in_year: 2,
      learned_by_month: [
        { month: '2026-03', label: 'Gymnopédie №1', weeks: 9 },
        { month: '2026-06', label: 'Comptine d’un autre été', weeks: 6 },
      ],
      years: [
        { year: 2024, count: 0 },
        { year: 2025, count: 0 },
        { year: 2026, count: 2 },
      ],
      learning: 2,
      keeping_up: 2,
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
        // Started 2026-02-01, learned 2026-05-11 — 14 whole weeks. Retiring afterward changes
        // nothing about when it was learned or how long it took.
        item('Moonlight Sonata', 'retired', {
          started_at: '2026-02-01T10:00:00Z',
          learned_at: '2026-05-11T10:00:00Z',
        }),
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
      // A retired item counts toward learned_in_year exactly like a known one would.
      learned_in_year: 1,
      learned_by_month: [{ month: '2026-05', label: 'Moonlight Sonata', weeks: 14 }],
      years: [
        { year: 2024, count: 0 },
        { year: 2025, count: 0 },
        { year: 2026, count: 1 },
      ],
      // Arabesque is 'working'; nothing here is 'known' — Moonlight Sonata is retired, not kept.
      learning: 1,
      keeping_up: 0,
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

/**
 * "Progress counts what was learned this year" (design frame 2c, owner 2026-09-02): the card's
 * measure line is learned_in_year, not the all-time learned count above — because it must read
 * the same whether a piece is still Keeping up or has been moved to Learned, and never invent a
 * date for something they already knew.
 */
describe('resolveRepertoire — learned_in_year / learned_by_month / years', () => {
  it('counts known and retired items with a real learned_at in the current year, and skips a backfilled one', () => {
    const result = resolveRepertoire(
      [
        item('Prelude in C', 'known', { learned_at: '2026-02-10T10:00:00Z' }),
        item('Turkish March', 'retired', { learned_at: '2026-07-04T10:00:00Z' }),
        item('Für Elise', 'known'), // backfilled — no learned_at, never counted into a year
        item('Arabesque', 'working'),
      ],
      'g-piano',
      NOW,
    );
    if (!('items' in result)) throw new Error('expected a payload');
    expect(result.learned_in_year).toBe(2);
    expect(result.years.at(-1)).toEqual({ year: 2026, count: 2 });
  });

  it('retiring never shrinks learned_in_year — a retired piece counts exactly like a known one with the same date', () => {
    const known = resolveRepertoire([item('Piece', 'known', { learned_at: '2026-04-01T10:00:00Z' })], 'g-piano', NOW);
    const retired = resolveRepertoire(
      [item('Piece', 'retired', { learned_at: '2026-04-01T10:00:00Z' })],
      'g-piano',
      NOW,
    );
    if (!('items' in known) || !('items' in retired)) throw new Error('expected payloads');
    expect(retired.learned_in_year).toBe(known.learned_in_year);
    expect(retired.learned_in_year).toBe(1);
  });

  it('lists learned_by_month in month order, regardless of the order items were given', () => {
    const result = resolveRepertoire(
      [
        item('June piece', 'known', { started_at: '2026-04-01T10:00:00Z', learned_at: '2026-06-15T10:00:00Z' }),
        item('February piece', 'known', { started_at: '2026-01-01T10:00:00Z', learned_at: '2026-02-20T10:00:00Z' }),
        item('April piece', 'retired', { started_at: '2026-02-15T10:00:00Z', learned_at: '2026-04-10T10:00:00Z' }),
      ],
      'g-piano',
      NOW,
    );
    if (!('items' in result)) throw new Error('expected a payload');
    expect(result.learned_by_month.map((m) => m.month)).toEqual(['2026-02', '2026-04', '2026-06']);
    expect(result.learned_by_month.map((m) => m.label)).toEqual(['February piece', 'April piece', 'June piece']);
  });

  it('never lets a learned_by_month week count read 0 — same-day start-to-learned rounds up to 1', () => {
    const result = resolveRepertoire(
      [item('Fast study', 'known', { started_at: '2026-05-01T10:00:00Z', learned_at: '2026-05-01T14:00:00Z' })],
      'g-piano',
      NOW,
    );
    if (!('items' in result)) throw new Error('expected a payload');
    expect(result.learned_by_month).toEqual([{ month: '2026-05', label: 'Fast study', weeks: 1 }]);
  });

  it('gives the trailing three calendar years relative to now, oldest first, zero-filled when nothing was learned', () => {
    const result = resolveRepertoire(
      [item('Old piece', 'known', { learned_at: '2024-03-01T10:00:00Z' })],
      'g-piano',
      NOW,
    );
    if (!('items' in result)) throw new Error('expected a payload');
    expect(result.years).toEqual([
      { year: 2024, count: 1 },
      { year: 2025, count: 0 },
      { year: 2026, count: 0 },
    ]);
  });

  it('reckons the year from `now`, never a hardcoded year', () => {
    const laterNow = new Date('2028-01-15T12:00:00Z');
    const result = resolveRepertoire(
      [item('Piece', 'known', { learned_at: '2028-01-05T10:00:00Z' })],
      'g-piano',
      laterNow,
    );
    if (!('items' in result)) throw new Error('expected a payload');
    expect(result.learned_in_year).toBe(1);
    expect(result.years.map((y) => y.year)).toEqual([2026, 2027, 2028]);
  });

  it('counts learning (working) and keeping_up (known), scoped the same as everything else on the card', () => {
    const result = resolveRepertoire(
      [
        item('Working A', 'working'),
        item('Working B', 'working'),
        item('Known A', 'known'),
        item('Retired A', 'retired'),
        item('Queued A', 'queued'),
      ],
      'g-piano',
      NOW,
    );
    if (!('items' in result)) throw new Error('expected a payload');
    expect(result.learning).toBe(2);
    expect(result.keeping_up).toBe(1);
  });
});
