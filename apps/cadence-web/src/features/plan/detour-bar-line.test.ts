import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ActiveEpisode } from '../../lib/api.ts';
import { barLine } from './detour-bar-line.ts';

/**
 * The bar's whole job is one honest sentence, so the arithmetic in it is worth pinning: an
 * off-by-one here tells someone they are on day 0 of their own detour, or day 9 of 7.
 */
const ep = (over: Partial<ActiveEpisode> = {}): ActiveEpisode => ({
  type: 'travel',
  start: '2026-08-17',
  end: '2026-08-23',
  gearKnown: true,
  ...over,
});

const on = (iso: string) => vi.setSystemTime(new Date(`${iso}T12:00:00Z`));
afterEach(() => vi.useRealTimers());

describe('barLine', () => {
  it('counts the day inclusively, so the first day is day 1', () => {
    vi.useFakeTimers();
    on('2026-08-17');
    expect(barLine(ep())).toBe("You're on an alternate plan — traveling, day 1 of 7");
  });

  it('reads the way the design drew it mid-detour', () => {
    vi.useFakeTimers();
    on('2026-08-18');
    expect(barLine(ep())).toBe("You're on an alternate plan — traveling, day 2 of 7");
  });

  /** A detour you have overrun should not say "day 9 of 7" — it holds at the last day. */
  it('clamps past the end rather than counting into nonsense', () => {
    vi.useFakeTimers();
    on('2026-08-25');
    expect(barLine(ep())).toContain('day 7 of 7');
  });

  /** Nor should one that has not begun read as day 0. */
  it('clamps before the start', () => {
    vi.useFakeTimers();
    on('2026-08-15');
    expect(barLine(ep())).toContain('day 1 of 7');
  });

  it('a one-day detour is day 1 of 1, never 0', () => {
    vi.useFakeTimers();
    on('2026-08-17');
    expect(barLine(ep({ start: '2026-08-17', end: '2026-08-17' }))).toContain('day 1 of 1');
  });

  /** Plain words for hard things — never a euphemism, and never a clinical enum leaking out. */
  it('names each kind in the words a person would use', () => {
    vi.useFakeTimers();
    on('2026-08-17');
    expect(barLine(ep({ type: 'illness' }))).toContain('unwell');
    expect(barLine(ep({ type: 'injury' }))).toContain('injured');
    expect(barLine(ep({ type: 'recovery' }))).toContain('recovering');
    expect(barLine(ep({ type: 'custom' }))).toContain('off the usual shape');
  });

  it('survives a malformed date rather than rendering NaN at someone', () => {
    vi.useFakeTimers();
    on('2026-08-17');
    expect(barLine(ep({ end: 'not-a-date' }))).not.toMatch(/NaN/);
  });
});
