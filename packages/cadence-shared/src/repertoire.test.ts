import { describe, expect, it } from 'vitest';
import { pickDueNext, renderRepertoire, type RepertoireLike } from './repertoire.ts';

const item = (label: string, over: Partial<RepertoireLike> = {}): RepertoireLike => ({
  label,
  status: 'known',
  ...over,
});

describe('pickDueNext', () => {
  it('picks the known item resting longest', () => {
    const items = [
      item('A Short Story', { last_practiced_at: '2026-08-28T00:00:00Z' }),
      item('Écossaise', { last_practiced_at: '2026-08-10T00:00:00Z' }),
      item('Minuet in G', { last_practiced_at: '2026-08-20T00:00:00Z' }),
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
  it('groups by status, marks the due item, and dates the rest', () => {
    // Midday timestamps — a midnight-UTC instant renders as the previous calendar day in any
    // western timezone, and the assertion is about grouping, not about that.
    const text = renderRepertoire([
      item('Melody', { status: 'working', kind: 'piece', last_practiced_at: '2026-08-27T16:00:00Z' }),
      item('Écossaise', { kind: 'piece', last_practiced_at: '2026-08-10T12:00:00Z' }),
      item('A Short Story', { kind: 'piece', last_practiced_at: '2026-08-28T16:00:00Z' }),
      item('Cradle Song', { status: 'parked' }),
    ]);
    expect(text).toContain('Working on now:');
    expect(text).toContain('- Melody (piece; last worked Aug 27)');
    expect(text).toContain('rotation pool');
    expect(text).toContain('- Écossaise (piece; last worked Aug 10; DUE NEXT by rotation)');
    expect(text).not.toContain('A Short Story (piece; last worked Aug 28; DUE NEXT');
    expect(text).toContain('Set aside for now: Cradle Song');
  });

  it('renders empty for an empty list, so callers can omit the section cleanly', () => {
    expect(renderRepertoire([])).toBe('');
  });
});
