import { describe, expect, it } from 'vitest';
import { ACTION_TOOLS, CASES } from './eval-tool-selection-cases.ts';
import { alwaysOnToolNames } from '../src/services/coach-tool-tiers.ts';
import {
  FLOOR_MARGIN,
  SMOKE_IDS,
  floorVerdict,
  parseFloor,
  readBaseline,
  smokeFloor,
  tokenEstimate,
  type EvalBaseline,
} from './eval-tool-selection-smoke.ts';

const smoke = CASES.filter((c) => (SMOKE_IDS as readonly string[]).includes(c.id));

/**
 * The subset is only a smoke test if it still spans what it was chosen to span. A renamed case, a
 * case moved to another kind, or a pruned forbid list would quietly narrow it, and nothing else
 * would notice: the runner only checks that the ids exist.
 */
describe('the smoke subset', () => {
  it('names only cases that exist, each once', () => {
    expect(smoke.map((c) => c.id).sort()).toEqual([...SMOKE_IDS].sort());
    expect(new Set(SMOKE_IDS).size).toBe(SMOKE_IDS.length);
  });

  it('is about a fifth of the full set', () => {
    const share = smoke.length / CASES.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.25);
  });

  it('covers every kind, both instrument checks, and both directions of firing', () => {
    expect(new Set(smoke.map((c) => c.kind))).toEqual(new Set(['canary', 'action', 'read', 'silence']));
    expect(SMOKE_IDS).toContain('CAN-POS');
    expect(SMOKE_IDS).toContain('CAN-NEG');
    expect(smoke.filter((c) => c.expect.length === 0).length).toBeGreaterThanOrEqual(3);
    expect(smoke.filter((c) => c.expect.length > 0).length).toBeGreaterThanOrEqual(8);
  });

  it('reaches always-on actions, on-demand actions and on-demand reads', () => {
    const always = new Set(alwaysOnToolNames());
    const expected = smoke.flatMap((c) => c.expect);
    expect(expected.filter((t) => ACTION_TOOLS.has(t) && always.has(t)).length).toBeGreaterThanOrEqual(3);
    expect(expected.filter((t) => ACTION_TOOLS.has(t) && !always.has(t)).length).toBeGreaterThanOrEqual(2);
    expect(expected.filter((t) => !ACTION_TOOLS.has(t) && !always.has(t)).length).toBeGreaterThanOrEqual(3);
  });

  it('carries forbids and argument checks, not only selections', () => {
    expect(smoke.filter((c) => c.forbid?.length).length).toBeGreaterThanOrEqual(6);
    expect(smoke.filter((c) => c.args).length).toBeGreaterThanOrEqual(4);
  });
});

describe('the committed baseline', () => {
  it('parses, and holds a full-run F1 in percentage points or null', () => {
    const b = readBaseline();
    if (b.fullRunF1 !== null) {
      expect(b.fullRunF1).toBeGreaterThan(1);
      expect(b.fullRunF1).toBeLessThanOrEqual(100);
      expect(b.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.cases).toBeGreaterThan(0);
    }
  });
});

const base: EvalBaseline = { fullRunF1: null, measuredAt: null, commit: null, cases: null };

describe('smokeFloor', () => {
  it.each([
    ['no numbers on file → no default', base, null],
    ['a full run → that minus the margin', { ...base, fullRunF1: 82.9, measuredAt: '2026-09-15' }, 77.9],
    ['a smoke run wins over a full run', { ...base, fullRunF1: 82.9, smokeF1: 91.3 }, 86.3],
    ['a null smoke run falls back to the full run', { ...base, fullRunF1: 80, smokeF1: null }, 75],
  ] as const)('%s', (_label, b, want) => {
    expect(smokeFloor(b)?.floor ?? null).toBe(want);
  });

  it('says where the floor came from', () => {
    expect(smokeFloor({ ...base, fullRunF1: 82.9, measuredAt: '2026-09-15' })?.from).toContain('2026-09-15');
    expect(FLOOR_MARGIN).toBe(5);
  });
});

describe('parseFloor', () => {
  it.each([
    ['77.9', { floor: 77.9 }],
    ['80', { floor: 80 }],
    ['100', { floor: 100 }],
  ])('accepts %s', (raw, want) => {
    expect(parseFloor(raw)).toEqual(want);
  });

  it.each([
    // A fraction would pass every run if read as percentage points.
    ['0.8', /percentage points/],
    ['1', /percentage points/],
    ['101', /percentage/],
    ['', /needs a number/],
    ['eighty', /needs a number/],
  ])('refuses %j', (raw, why) => {
    const parsed = parseFloor(raw);
    expect('error' in parsed && parsed.error).toMatch(why);
  });
});

describe('floorVerdict', () => {
  it.each([
    [82.0, 77.9, true, 0],
    [77.9, 77.9, true, 0],
    [77.8, 77.9, false, 0.1],
    [70.4, 77.9, false, 7.5],
  ])('F1 %d against floor %d → pass %s, gap %d', (f1, floor, pass, gap) => {
    expect(floorVerdict(f1, floor)).toEqual({ pass, gap });
  });
});

describe('tokenEstimate', () => {
  it('scales with the number of turns', () => {
    expect(tokenEstimate(13).prompt * 5).toBeLessThan(tokenEstimate(68).prompt * 1.1);
    expect(tokenEstimate(0)).toEqual({ prompt: 0, completion: 0 });
  });
});
