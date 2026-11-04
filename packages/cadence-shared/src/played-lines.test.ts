/**
 * The words of a played session (walkthrough v3 Phase 6) — the pills, the group names and the
 * log-line shapes on the Redlines board. A short name that reads wrong is a pill that reads
 * wrong on every row, so the table carries the gym's own titles and the near-misses.
 */
import { describe, expect, it } from 'vitest';
import {
  SPREAD_TAIL,
  groupEyebrow,
  groupLogLine,
  groupMeta,
  groupNick,
  groupRecapTitle,
  groupSummary,
  groupTitle,
  pillLabel,
  shortName,
  shortNames,
  turnChip,
} from './played-lines.ts';
import { byTitle } from './played-fixture.test-helper.ts';

describe('shortName — the word a pill goes by', () => {
  it.each([
    ['Bench press', 'Bench'],
    ['Dumbbell row', 'Row'],
    ['Farmer carry', 'Carry'],
    ['Hip thrust', 'Thrust'],
    ['Dead hang', 'Hang'],
    ['Pull-ups', 'Pull-up'],
    ['Squats', 'Squat'],
    ['Overhead press', 'Overhead'],
    ['Lateral raise', 'Lateral'],
    ['Press', 'Press'], // one word is itself, and "ss" is not a plural
    ['Hollow hold', 'Hollow'],
    ['Goblet squat (light)', 'Squat'],
    ['run', 'Run'],
    ['  ', ''],
  ])('%s → %s', (title, expected) => {
    expect(shortName(title)).toBe(expected);
  });

  it('shortNames falls back to the full titles when two would read the same', () => {
    expect(shortNames(['Dumbbell row', 'Barbell row'])).toEqual(['Dumbbell row', 'Barbell row']);
    expect(shortNames(['Bench press', 'Dumbbell row'])).toEqual(['Bench', 'Row']);
  });
});

describe('a combined group’s names', () => {
  it('row title, eyebrow nick and recap title', () => {
    const names = ['Bench press', 'Dumbbell row'];
    expect(groupTitle(names)).toBe('Bench press + dumbbell row');
    expect(groupNick(names)).toBe('bench + row');
    expect(groupRecapTitle(names)).toBe('Bench + row');
    expect(groupTitle(['Farmer carry', 'Hip thrust'])).toBe('Farmer carry + hip thrust');
  });
});

describe('pillLabel and groupMeta — what a row draws', () => {
  it.each([
    ['reps', byTitle('Pull-ups'), 'Pull-up 5'],
    ['timed set', byTitle('Dead hang'), 'Hang 45 s'],
    ['a prescribed circuit', byTitle('Abs circuit'), '4 moves × 3 rounds'],
    ['a read', byTitle('Warm-up'), '6 min'],
    ['reps with no count', { title: 'Rows', minutes: 3, tool: { kind: 'reps' as const, sets: 2 } }, 'Row'],
  ])('%s', (_n, step, expected) => {
    expect(pillLabel(step)).toBe(expected);
  });

  it('meta counts sets, or rounds for a circuit', () => {
    expect(groupMeta(3, byTitle('Pull-ups').tool)).toBe('3 sets');
    expect(groupMeta(1, byTitle('Dead hang').tool)).toBe('1 set');
    expect(groupMeta(6, undefined)).toBe('6 sets');
    expect(groupMeta(1, byTitle('Abs circuit').tool)).toBe('3 rounds');
  });
});

describe('the log-line shapes the coach reads', () => {
  it.each([
    ['alternate, every round done', 'alternate', { turns: 6, rounds: 3 }, { turns: 6, rounds: 3 }, 'circuit · 3 rounds'],
    ['alternate, stopped after two', 'alternate', { turns: 4, rounds: 2 }, { turns: 6, rounds: 3 }, 'circuit · 2 of 3 rounds'],
    ['alternate, mid-round counts the full rounds only', 'alternate', { turns: 5, rounds: 2 }, { turns: 6, rounds: 3 }, 'circuit · 2 of 3 rounds'],
    ['sequence, all sets', 'sequence', { turns: 6, rounds: 3 }, { turns: 6, rounds: 3 }, 'in sequence'],
    ['sequence, stopped early', 'sequence', { turns: 4, rounds: 2 }, { turns: 6, rounds: 3 }, '4 of 6 sets · in sequence'],
  ] as const)('%s', (_n, mode, done, total, expected) => {
    expect(groupLogLine(mode, done, total)).toBe(expected);
  });

  it('a group’s summary names the group, its line, and each member’s own numbers behind it', () => {
    expect(
      groupSummary('bench + row', 'circuit · 3 rounds', [
        { title: 'Bench press', line: '3×8 @ 95 lb' },
        { title: 'Dumbbell row', line: '3×10 @ 40 lb' },
      ]),
    ).toBe('bench + row circuit · 3 rounds (bench press 3×8 @ 95 lb, dumbbell row 3×10 @ 40 lb)');
    expect(groupSummary('bench + row', 'circuit · 0 of 3 rounds', [])).toBe('bench + row circuit · 0 of 3 rounds');
  });

  it('a spread step wears the one-at-a-time tail', () => {
    expect(`3×45 s${SPREAD_TAIL}`).toBe('3×45 s · one at a time');
  });
});

describe('the eyebrow and the turn chips over a played group', () => {
  it('circuit for alternating turns, sequence for one step then the other', () => {
    expect(groupEyebrow('alternate', 1, 3, 'bench + row')).toBe('Circuit · Round 1 of 3 · bench + row');
    expect(groupEyebrow(undefined, 2, 3, 'bench + row')).toBe('Circuit · Round 2 of 3 · bench + row');
    expect(groupEyebrow('sequence', 2, 3, 'carry + thrust')).toBe('Sequence · Set 2 of 3 · carry + thrust');
  });

  it('a chip is the short name over the round', () => {
    expect(turnChip('Bench press', 0)).toEqual({ name: 'Bench', round: 'R1' });
    expect(turnChip('Dumbbell row', 2)).toEqual({ name: 'Row', round: 'R3' });
  });
});
