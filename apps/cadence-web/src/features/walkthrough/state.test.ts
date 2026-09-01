import { describe, expect, it } from 'vitest';
import type { WalkthroughStep } from '@cadence/shared';
import { logLine, stepFraction, type StepLog } from './state.ts';

/**
 * Partial credit + log-line coverage for the four "tool palette" step types this parcel adds
 * player support for (Reps & sets, Check off, Measure, Feeling check-in) — the pure helpers
 * `state.ts` already exposed for every other tool, but never had colocated tests of their own.
 */

const step = (tool: WalkthroughStep['tool']): WalkthroughStep => ({
  id: 's1',
  title: 'Step',
  minutes: 3,
  tool,
  skippable: true,
});

describe('reps & sets — counted, logged', () => {
  const repsStep = step({ kind: 'reps', sets: 3, reps: 10, load: '35 lb' });

  it('partial credit: some sets logged reads as a fraction of the target', () => {
    const log: StepLog = { kind: 'reps', sets: [10, 8] };
    expect(stepFraction(repsStep, log)).toBeCloseTo(2 / 3);
  });

  it('reaching the target sets reads as fully logged', () => {
    const log: StepLog = { kind: 'reps', sets: [10, 10, 10] };
    expect(stepFraction(repsStep, log)).toBe(1);
  });

  it('log line: uniform sets collapse to sets×reps, non-uniform sets list each one', () => {
    expect(logLine(repsStep, { kind: 'reps', sets: [10, 10, 10], load: '35 lb' })).toBe('3×10 @ 35 lb');
    expect(logLine(repsStep, { kind: 'reps', sets: [10, 8, 6], load: '35 lb' })).toBe('3×[10,8,6] @ 35 lb');
  });

  it('degrades honestly: no load on the log never prints " @ undefined"', () => {
    const noLoadStep = step({ kind: 'reps', sets: 2 });
    expect(logLine(noLoadStep, { kind: 'reps', sets: [12] })).toBe('1×12');
    expect(logLine(noLoadStep, { kind: 'reps', sets: [12] })).not.toContain('undefined');
  });
});

describe('check off — did it, with an optional note', () => {
  const checkoffStep = step({ kind: 'checkoff', label: '5 km' });

  it('logging with no note is fully credited and reads back as "done"', () => {
    const log: StepLog = { kind: 'done' };
    expect(stepFraction(checkoffStep, log)).toBe(1);
    expect(logLine(checkoffStep, log)).toBe('done');
  });

  it('an optional note rides the same log write and becomes the receipt', () => {
    const log: StepLog = { kind: 'done', note: 'took the long way round' };
    expect(stepFraction(checkoffStep, log)).toBe(1);
    expect(logLine(checkoffStep, log)).toBe('took the long way round');
  });

  it('degrades honestly: an unlogged step has no fraction', () => {
    expect(stepFraction(checkoffStep, undefined)).toBe(0);
  });
});

describe('measure — a number, kept verbatim', () => {
  const measureStep = step({ kind: 'measure', metric: 'Weight', unit: 'kg' });

  it('one entry is the whole capture — binary, never partial', () => {
    const log: StepLog = { kind: 'measure', value: '82.4', unit: 'kg', metric: 'Weight' };
    expect(stepFraction(measureStep, log)).toBe(1);
  });

  it('log line lands the typed number verbatim, with its unit', () => {
    // Trailing/odd formatting the person actually typed survives — it is never reparsed or rounded.
    expect(logLine(measureStep, { kind: 'measure', value: '82.40', unit: 'kg', metric: 'Weight' })).toBe('82.40 kg');
  });

  it('degrades honestly: an absent unit drops the trailing space rather than printing a blank one', () => {
    const noUnitStep = step({ kind: 'measure', metric: 'Wingspan', unit: '' });
    expect(logLine(noUnitStep, { kind: 'measure', value: '178', unit: '', metric: 'Wingspan' })).toBe('178');
  });

  it('an empty typed value is never counted as logged', () => {
    const log: StepLog = { kind: 'measure', value: '  ', unit: 'kg', metric: 'Weight' };
    expect(stepFraction(measureStep, log)).toBe(0);
  });
});

describe('feeling check-in — one word, always fully credited', () => {
  const feelingStep = step({ kind: 'feeling_log' });

  it('a saved word is always full credit — there is no partial feeling note', () => {
    const log: StepLog = { kind: 'feeling_log', word: 'steady', family: 'settled', room: 1 };
    expect(stepFraction(feelingStep, log)).toBe(1);
  });

  it('log line reads the word and how much room it is taking, never a number', () => {
    const line = logLine(feelingStep, { kind: 'feeling_log', word: 'wired', family: 'wired', room: 3 });
    expect(line).toContain('wired');
    expect(line).not.toMatch(/\b[123]\b/); // the 1–3 room scale never renders as a raw digit
  });
});
