/**
 * Load per set (walkthrough v3 Phase 5). The log-line tails are the shapes on the design's Redlines
 * board, so the coach reads what was lifted and what the plan said; the parse and format pair is
 * what the weight sheet's dial runs on.
 */
import { describe, expect, it } from 'vitest';
import { formatLoad, loadTail, loadsDiffer, parseLoad, swappedTail } from './set-loads.ts';
import { timedSetsLogLine } from './timed-sets.ts';

describe('loadTail — what the log line says about the load', () => {
  it.each<[string, string | undefined, ReadonlyArray<string | null> | undefined, string]>([
    ['no load anywhere', undefined, undefined, ''],
    ['plan load, no per-set record', '40 lb', undefined, ' @ 40 lb'],
    ['plan load, every set as planned', '40 lb', ['40 lb', '40 lb'], ' @ 40 lb'],
    [
      'plan said bodyweight, sets lifted at one load',
      'bodyweight',
      ['15 lb', '15 lb', '15 lb'],
      ' @ 15 lb (plan said bodyweight)',
    ],
    ['plan had no load at all, sets lifted', undefined, ['15 lb', '15 lb'], ' @ 15 lb (plan said bodyweight)'],
    [
      'one set heavier than the plan',
      '15 lb',
      ['15 lb', '15 lb', '20 lb'],
      ' @ [15 lb, 15 lb, 20 lb] (plan said 15 lb)',
    ],
    [
      'a set lifted with nothing where the plan had a load',
      '15 lb',
      ['15 lb', null],
      ' @ [15 lb, bodyweight] (plan said 15 lb)',
    ],
    ['an empty record reads as planned', '40 lb', [], ' @ 40 lb'],
  ])('%s', (_name, plan, loads, expected) => {
    expect(loadTail(plan, loads)).toBe(expected);
  });

  it('loadsDiffer is the gate: null and undefined are the same "no load"', () => {
    expect(loadsDiffer(undefined, [null, null])).toBe(false);
    expect(loadsDiffer('40 lb', ['40 lb'])).toBe(false);
    expect(loadsDiffer('40 lb', ['45 lb'])).toBe(true);
    expect(loadsDiffer(undefined, ['15 lb'])).toBe(true);
  });
});

describe('swappedTail — a swap is never a skip', () => {
  it('names the prescribed move, or says nothing', () => {
    expect(swappedTail('glute bridge')).toBe(' · swapped from glute bridge');
    expect(swappedTail(undefined)).toBe('');
  });
});

describe('timedSetsLogLine with per-set loads', () => {
  it('reads like the reps line: the seconds, then the load tail', () => {
    expect(timedSetsLogLine([45, 45, 45, 45], '40 lb', ['50 lb', '50 lb', '50 lb', '50 lb'])).toBe(
      '4×45 s @ 50 lb (plan said 40 lb)',
    );
    expect(timedSetsLogLine([45, 53], '2×40 lb')).toBe('45 · 53 s @ 2×40 lb');
  });
});

describe('parseLoad — what the dial can hold', () => {
  it.each<[string, { value: number; unit: 'lb' | 'kg' } | null]>([
    ['15 lb', { value: 15, unit: 'lb' }],
    ['7.5 lb', { value: 7.5, unit: 'lb' }],
    ['40lbs', { value: 40, unit: 'lb' }],
    ['25 pounds', { value: 25, unit: 'lb' }],
    ['20 kg', { value: 20, unit: 'kg' }],
    ['12,5 kg', { value: 12.5, unit: 'kg' }],
    ['10 kilos', { value: 10, unit: 'kg' }],
    // Near-misses: no unit, two implements, a band, an effort zone, nothing.
    ['15', null],
    ['2×40 lb', null],
    ['light band', null],
    ['zone 2', null],
    ['bodyweight', null],
    ['', null],
  ])('%s', (load, expected) => {
    expect(parseLoad(load)).toEqual(expected);
  });
});

describe('formatLoad — the unit spelled, nothing is bodyweight', () => {
  it.each<[number, 'lb' | 'kg', string]>([
    [7.5, 'lb', '7.5 lb'],
    [15, 'lb', '15 lb'],
    [20, 'kg', '20 kg'],
    [12.345, 'kg', '12.35 kg'],
    [0, 'lb', 'bodyweight'],
    [-5, 'kg', 'bodyweight'],
  ])('%s %s', (value, unit, expected) => {
    expect(formatLoad(value, unit)).toBe(expected);
  });

  it('round-trips through parseLoad', () => {
    expect(parseLoad(formatLoad(7.5, 'lb'))).toEqual({ value: 7.5, unit: 'lb' });
  });
});
