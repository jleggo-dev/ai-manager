import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FREE_WRITE_MINUTES,
  FREE_WRITE_IDLE_MS,
  MAX_FREE_WRITE_MINUTES,
  MIN_FREE_WRITE_MINUTES,
  PURE_FREE_WRITE,
  clampFreeWriteMinutes,
  freeWriteDurationChip,
  freeWriteKeptLine,
  freeWritePickerHead,
  freeWriteProgress,
  freeWriteRows,
  shouldNudge,
  timeLeftLabel,
} from './freewrite.ts';
import { JOURNAL_BANKS } from './journal.ts';

describe('the clock never becomes a scoreboard', () => {
  it('reports time REMAINING, never elapsed and never a rate', () => {
    expect(timeLeftLabel(744)).toBe('12:24 left');
    expect(timeLeftLabel(65)).toBe('1:05 left');
    // An overrun clock reads 0:00, never a negative or a count-up — writing past the end is free.
    expect(timeLeftLabel(-30)).toBe('0:00 left');
  });

  it('keeps the hairline within its track however the clock drifts', () => {
    expect(freeWriteProgress(0, 1200)).toBe(0);
    expect(freeWriteProgress(600, 1200)).toBe(0.5);
    expect(freeWriteProgress(9999, 1200)).toBe(1);
    expect(freeWriteProgress(-5, 1200)).toBe(0);
    expect(freeWriteProgress(10, 0)).toBe(0);
  });

  it('clamps a duration the coach invented, and defaults when it sent none', () => {
    expect(clampFreeWriteMinutes(undefined)).toBe(DEFAULT_FREE_WRITE_MINUTES);
    expect(clampFreeWriteMinutes(Number.NaN)).toBe(DEFAULT_FREE_WRITE_MINUTES);
    expect(clampFreeWriteMinutes(9999)).toBe(MAX_FREE_WRITE_MINUTES);
    expect(clampFreeWriteMinutes(0)).toBe(MIN_FREE_WRITE_MINUTES);
  });
});

describe('the coach speaks in words, not digits', () => {
  it('says the duration at the end of a clock that actually ran out', () => {
    expect(freeWriteKeptLine(20)).toBe('Twenty minutes — kept.');
    expect(freeWriteKeptLine(5)).toBe('Five minutes — kept.');
    expect(freeWriteKeptLine(60)).toBe('An hour — kept.');
  });

  it('never says "incomplete" or grades the writing', () => {
    for (const m of [3, 5, 10, 20, 30, 60]) {
      expect(freeWriteKeptLine(m)).not.toMatch(/incomplete|only|failed|short|words?\b|wpm/i);
      expect(freeWriteKeptLine(m)).toMatch(/kept\.$/);
    }
  });

  it('heads the picker and chips the duration', () => {
    expect(freeWritePickerHead(20)).toBe('Twenty minutes — pick a place to start');
    expect(freeWriteDurationChip(20)).toBe('20 MIN');
  });
});

describe('the picker rows', () => {
  it('always offers the pure row first, with no coach input at all', () => {
    const rows = freeWriteRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBeNull();
    expect(rows[0]?.prompt).toBe(PURE_FREE_WRITE.prompt);
  });

  it('puts coach topics under it, dropping blanks and duplicates', () => {
    const rows = freeWriteRows([
      { label: 'The move', prompt: "Twenty minutes on the move — what you haven't said out loud yet." },
      { label: '  ', prompt: 'no label' },
      { label: 'Empty', prompt: '   ' },
      { label: 'Dupe', prompt: PURE_FREE_WRITE.prompt },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Pure free-write', 'The move']);
  });

  // The same question, one place: a timed free-write and the untimed free_write bank must not
  // drift into two differently-worded versions of the same prompt.
  it("shares its question with the free_write bank's primary phrasing", () => {
    const bank = JOURNAL_BANKS.find((b) => b.id === 'free_write');
    expect(bank?.phrasings[0]).toBe(PURE_FREE_WRITE.prompt);
  });
});

describe('paper is a physical journal with a timer, not a text box', () => {
  it('never nudges — there is no keyboard to nudge toward', () => {
    expect(shouldNudge('paper', FREE_WRITE_IDLE_MS * 10)).toBe(false);
  });

  it('nudges a typed session only once genuinely idle', () => {
    expect(shouldNudge('typed', FREE_WRITE_IDLE_MS - 1)).toBe(false);
    expect(shouldNudge('typed', FREE_WRITE_IDLE_MS)).toBe(true);
  });
});
