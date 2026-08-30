import { describe, expect, it } from 'vitest';
import { pickDueNext, renderRepertoire, type RepertoireLike } from './repertoire.ts';

const item = (label: string, over: Partial<RepertoireLike> = {}): RepertoireLike => ({
  label,
  status: 'known',
  ...over,
});

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

describe('pickDueNext', () => {
  it('picks the known item resting longest', () => {
    const items = [
      item('A Short Story', { last_practiced_at: daysAgo(1) }),
      item('Écossaise', { last_practiced_at: daysAgo(19) }),
      item('Minuet in G', { last_practiced_at: daysAgo(9) }),
    ];
    expect(pickDueNext(items)?.label).toBe('Écossaise');
  });

  it('a never-practiced item rests longer than any practiced one', () => {
    const items = [
      item('Écossaise', { last_practiced_at: '2020-01-01T00:00:00Z' }),
      item('Arietta', { last_practiced_at: null }),
    ];
    expect(pickDueNext(items)?.label).toBe('Arietta');
  });

  it('only known items rotate — working and parked are never due', () => {
    const items = [item('Melody', { status: 'working' }), item('Cradle Song', { status: 'parked' })];
    expect(pickDueNext(items)).toBeNull();
  });

  it('ties break stably (started_at, then label), not by row order', () => {
    const items = [
      item('B piece', { last_practiced_at: null, started_at: '2026-08-02T00:00:00Z' }),
      item('A piece', { last_practiced_at: null, started_at: '2026-08-02T00:00:00Z' }),
      item('C piece', { last_practiced_at: null, started_at: '2026-08-01T00:00:00Z' }),
    ];
    expect(pickDueNext(items)?.label).toBe('C piece');
    expect(pickDueNext([...items].reverse())?.label).toBe('C piece');
  });
});

describe('renderRepertoire', () => {
  it('groups by status, marks the due item, and dates by relative day-count', () => {
    const now = Date.now();
    const text = renderRepertoire(
      [
        item('Melody', { status: 'working', kind: 'piece', last_practiced_at: daysAgo(1) }),
        item('Écossaise', { kind: 'piece', last_practiced_at: daysAgo(20) }),
        item('A Short Story', { kind: 'piece', last_practiced_at: daysAgo(0.2) }),
        item('Cradle Song', { status: 'parked' }),
      ],
      now,
    );
    expect(text).toContain('Working on now:');
    expect(text).toContain('- Melody (piece; worked yesterday)');
    expect(text).toContain('rotation pool');
    expect(text).toContain('- Écossaise (piece; worked 20 days ago; DUE NEXT by rotation)');
    expect(text).toContain('- A Short Story (piece; worked today)');
    expect(text).toContain('Set aside for now: Cradle Song');
  });

  it('orders the known pool longest-rest first and a cut never drops the due item', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      item(`Piece ${String(i).padStart(2, '0')}`, { last_practiced_at: daysAgo(i) }),
    );
    const text = renderRepertoire(many);
    // Piece 19 rests longest → due, and must lead the list despite 20 > cap.
    const lines = text.split('\n');
    expect(lines[1]).toContain('Piece 19');
    expect(lines[1]).toContain('DUE NEXT by rotation');
    expect(text).toContain('…and 5 more on file'); // 20 known, cap 15 — the cut says so
  });

  it('renders empty for an empty list, so callers can omit the section cleanly', () => {
    expect(renderRepertoire([])).toBe('');
  });
});
