import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SIT_MINUTES,
  MAX_SIT_MINUTES,
  MIN_SIT_MINUTES,
  RETURNS_FOOTER,
  bellMarks,
  clampIntervalMinutes,
  clampSitMinutes,
  isMeditateBells,
  returnsSentence,
  ringsAt,
  sitLogLine,
} from './meditate.ts';

describe('sit length bounds', () => {
  it('defaults when the coach says nothing', () => {
    expect(clampSitMinutes(null)).toBe(DEFAULT_SIT_MINUTES);
    expect(clampSitMinutes(undefined)).toBe(DEFAULT_SIT_MINUTES);
    expect(clampSitMinutes(Number.NaN)).toBe(DEFAULT_SIT_MINUTES);
  });

  it('keeps a sensible ask', () => {
    expect(clampSitMinutes(12)).toBe(12);
  });

  it('bounds both ends', () => {
    expect(clampSitMinutes(0)).toBe(MIN_SIT_MINUTES);
    expect(clampSitMinutes(-5)).toBe(MIN_SIT_MINUTES);
    expect(clampSitMinutes(999)).toBe(MAX_SIT_MINUTES);
  });
});

describe('interval bells', () => {
  it('defaults, and never outlasts the sit itself', () => {
    expect(clampIntervalMinutes(10, null)).toBe(5);
    expect(clampIntervalMinutes(3, 30)).toBe(3);
    expect(clampIntervalMinutes(10, 0)).toBe(1);
  });
});

describe('bellMarks', () => {
  it('rings nothing when bells are off', () => {
    expect(bellMarks(10, 'none')).toEqual([]);
  });

  it('rings only at the end for start_end (the start bell is rung as it begins)', () => {
    expect(bellMarks(10, 'start_end')).toEqual([600]);
  });

  it('spaces interval bells and always ends on one', () => {
    expect(bellMarks(10, 'interval', 5)).toEqual([300, 600]);
    expect(bellMarks(12, 'interval', 3)).toEqual([180, 360, 540, 720]);
  });

  it('never places a bell on the final second twice', () => {
    const marks = bellMarks(10, 'interval', 5);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it('answers ringsAt from the same schedule', () => {
    expect(ringsAt(300, 10, 'interval', 5)).toBe(true);
    expect(ringsAt(301, 10, 'interval', 5)).toBe(false);
    expect(ringsAt(600, 10, 'start_end')).toBe(true);
  });

  it('validates the bell setting', () => {
    expect(isMeditateBells('interval')).toBe(true);
    expect(isMeditateBells('loud')).toBe(false);
    expect(isMeditateBells(null)).toBe(false);
  });
});

describe('returnsSentence — the close', () => {
  it('says nothing at all when nobody tapped', () => {
    // Zero could be a settled sit OR a forgotten gesture; the app must not guess, and must never
    // congratulate "perfect focus".
    expect(returnsSentence(0)).toBeNull();
  });

  it('uses words, never digits', () => {
    expect(returnsSentence(1)).toBe('You noticed once.');
    expect(returnsSentence(2)).toBe('You noticed twice.');
    expect(returnsSentence(4)).toBe('You noticed four times.');
    expect(returnsSentence(12)).toBe('You noticed twelve times.');
  });

  it('stays wordy past the table rather than falling back to a number', () => {
    const s = returnsSentence(30);
    expect(s).toBe('You noticed a good few times.');
    expect(s).not.toMatch(/\d/);
  });

  it('never implies a score, a target, or a comparison', () => {
    for (const n of [1, 3, 7, 40]) {
      const s = returnsSentence(n) ?? '';
      expect(s).not.toMatch(/only|just|again|better|worse|average|streak|record|last time/i);
    }
    expect(RETURNS_FOOTER).toBe('That noticing is the practice — there is nothing to beat.');
  });
});

describe('sitLogLine', () => {
  it('reads plainly when finished', () => {
    expect(sitLogLine(600, 600)).toBe('10 min');
  });

  it('gives partial credit without shame', () => {
    expect(sitLogLine(240, 600)).toBe('4 of 10 min · that counts');
  });

  it('never reads "0 of 10 min" — sitting down at all is the thing being credited', () => {
    expect(sitLogLine(9, 600)).toBe('less than a minute · that counts');
    expect(sitLogLine(0, 600)).toBe('less than a minute · that counts');
    expect(sitLogLine(59, 600)).not.toMatch(/^0 of/);
  });

  it('never reports more than the target', () => {
    expect(sitLogLine(900, 600)).toBe('10 min');
  });
});
