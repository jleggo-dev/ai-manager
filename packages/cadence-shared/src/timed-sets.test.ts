/**
 * Sets of a timed effort (walkthrough v3 R1, owner 2026-11-03). The owner's 2026-11-02 gym session
 * showed the missing shape: a farmer carry of four 45-second sets was stored as `reps`, sets 4,
 * reps 1, with the time only in the cue. An audit of 1,319 stored items found ~9 like it — every
 * one a carry, hang or plank done in sets — because `inferTool` let `sets` beat `duration_min` and
 * dropped the duration.
 *
 * A router that decides which tool plays fails silently, so this is a table: the real stored
 * shapes as positives, and the rows that LOOK like them (a rep count with a tempo note, a single
 * hold, an explicit reps pick) as near-misses.
 */
import { describe, expect, it } from 'vitest';
import type { SessionItem } from './types/occurrence.ts';
import { deriveWalkthrough, inferTool, stepCaptureMode, type StepTool } from './walkthrough.ts';
import { renderCoachToolCatalog, COACH_TOOLS } from './tool-catalog.ts';
import { MAX_REST_SEC, clampRestSec, secondsText, timedSetsLogLine } from './timed-sets.ts';

const carry: SessionItem = { name: 'Farmer carry', sets: 4, duration_min: 0.75, load: '2 × 40 lb kettlebells' };

describe('inferTool — sets of a timed effort', () => {
  const ROWS: Array<[string, SessionItem, StepTool]> = [
    // Positives: the stored shapes from the audit.
    [
      'a carry: sets 4, 45 s, a load',
      carry,
      { kind: 'timer', seconds: 45, chime: true, sets: 4, load: '2 × 40 lb kettlebells' },
    ],
    [
      'a dead hang: sets 3, 30 s',
      { name: 'Dead hang', sets: 3, duration_min: 0.5 },
      { kind: 'timer', seconds: 30, chime: true, sets: 3 },
    ],
    [
      'a plank: sets 3, 30 s',
      { name: 'Plank', sets: 3, duration_min: 0.5 },
      { kind: 'timer', seconds: 30, chime: true, sets: 3 },
    ],
    [
      'the Oct 5 dead hang: tool timer set explicitly, with sets',
      { name: 'Dead hang', tool: 'timer', sets: 3, duration_min: 0.5 },
      { kind: 'timer', seconds: 30, chime: true, sets: 3 },
    ],
    [
      'rest between sets rides along, bounded',
      { name: 'Dead hang', sets: 3, duration_min: 0.5, rest_sec: 90 },
      { kind: 'timer', seconds: 30, chime: true, sets: 3, rest_sec: 90 },
    ],
    [
      'a two-sided carry keeps its halfway chime, per set',
      { name: 'Suitcase carry', sets: 3, duration_min: 1, per_side: true, load: '24 kg' },
      { kind: 'timer', seconds: 60, chime: true, switch_sides: true, sets: 3, load: '24 kg' },
    ],
    // Near-misses: reps with a tempo note in the cue are reps.
    [
      'glute bridge, reps with "pause 2 seconds at the top" → reps',
      { name: 'Glute bridge', sets: 2, reps: 12, detail: 'pause 2 seconds at the top' },
      { kind: 'reps', sets: 2, reps: 12 },
    ],
    [
      'step-down, reps with "lower over 3 seconds" → reps',
      { name: 'Step-down', sets: 3, reps: 10, detail: 'lower over 3 seconds' },
      { kind: 'reps', sets: 3, reps: 10 },
    ],
    [
      'sets with reps AND a duration → reps, as today',
      { name: 'Tempo squat', sets: 3, reps: 8, duration_min: 1, load: '60 kg' },
      { kind: 'reps', sets: 3, reps: 8, load: '60 kg' },
    ],
    ['sets with no length → reps, as today', { name: 'AMRAP push-ups', sets: 2 }, { kind: 'reps', sets: 2 }],
    // A single hold is the plain timer it always was — no sets key, no rest key.
    [
      'a single hold, no sets → plain timer, unchanged',
      { name: 'Plank', duration_min: 0.5 },
      { kind: 'timer', seconds: 30, chime: true },
    ],
    [
      'a single hold, sets 1 → plain timer',
      { name: 'Plank', sets: 1, duration_min: 0.5 },
      { kind: 'timer', seconds: 30, chime: true },
    ],
    [
      'a plain timer keeps its load, no sets',
      { name: 'Weighted plank', duration_min: 1, load: '10 kg' },
      { kind: 'timer', seconds: 60, chime: true, load: '10 kg' },
    ],
    // The coach's explicit pick still wins — the owner's own stored carry row is this shape today.
    [
      'tool reps set explicitly, sets 4 with a duration → reps (the explicit pick wins)',
      { name: 'Farmer carry', tool: 'reps', sets: 4, reps: 1, duration_min: 0.75 },
      { kind: 'reps', sets: 4, reps: 1 },
    ],
    [
      'rest_sec without sets is not stored on the step',
      { name: 'Plank', duration_min: 0.5, rest_sec: 60 },
      { kind: 'timer', seconds: 30, chime: true },
    ],
  ];

  it.each(ROWS)('%s', (_name, item, expected) => {
    expect(inferTool(item)).toEqual(expected);
  });

  it('a timed effort in sets captures each set (structured); a single hold stays done', () => {
    expect(stepCaptureMode({ kind: 'timer', seconds: 45, sets: 4 })).toBe('structured');
    expect(stepCaptureMode({ kind: 'timer', seconds: 45 })).toBe('done');
  });

  it('the step is sets × one set, plus the rests — not the length of one set rounded to a minute', () => {
    const session = (items: SessionItem[]) => ({
      blocks: [{ label: 'Main', items }],
      note: '',
      generated_at: '2026-11-03T00:00:00.000Z',
      version: 1,
    });
    expect(deriveWalkthrough(session([carry])).steps[0]?.minutes).toBe(3); // 4 × 45 s
    expect(deriveWalkthrough(session([{ ...carry, rest_sec: 60 }])).steps[0]?.minutes).toBe(6); // + 3 rests
    expect(deriveWalkthrough(session([{ name: 'Plank', duration_min: 0.5 }])).steps[0]?.minutes).toBe(1); // unchanged
  });
});

describe('rest between sets is bounded on the way in', () => {
  it.each<[number | undefined, number | undefined]>([
    [90, 90],
    [90.4, 90],
    [5000, MAX_REST_SEC],
    [0, undefined],
    [-5, undefined],
    [Number.NaN, undefined],
    [undefined, undefined],
  ])('%s → %s', (input, expected) => {
    expect(clampRestSec(input)).toBe(expected);
  });
});

describe('the catalog states the fact, and only the fact', () => {
  const rendered = renderCoachToolCatalog();

  it('timer with sets is described as one effort repeated, with rest_sec between and duration_min per set', () => {
    expect(rendered).toContain('With sets (2 or more) it is one timed effort repeated that many times');
    expect(rendered).toContain('rest_sec seconds of rest between');
    expect(rendered).toContain('duration_min is then the length of ONE set');
    expect(COACH_TOOLS.timer.reads).toEqual(expect.arrayContaining(['sets', 'rest_sec', 'load']));
  });

  it('never tells the coach that carries or hangs are timed (facts, not picks)', () => {
    const timer = `${COACH_TOOLS.timer.summary} ${COACH_TOOLS.timer.notWhen ?? ''}`;
    expect(timer).not.toMatch(/carr(y|ies)/i);
    expect(timer).not.toMatch(/hang/i);
  });
});

describe('the receipt line', () => {
  it.each<[number[], string | undefined, string]>([
    [[40, 40, 40, 40], '2×40 lb', '4×40 s @ 2×40 lb'],
    [[45, 53, 32, 45], '2×40 lb', '45 · 53 · 32 · 45 s @ 2×40 lb'],
    [[30, 30, 30], undefined, '3×30 s'],
    [[90], undefined, '1×90 s'],
    [[], '2×40 lb', ''],
  ])('%j @ %s → %s', (sets, load, expected) => {
    expect(timedSetsLogLine(sets, load)).toBe(expected);
    expect(timedSetsLogLine(sets, load)).not.toContain('undefined');
  });

  it.each<[number, string]>([
    [45, '45 s'],
    [60, '1 min'],
    [120, '2 min'],
    [90, '1:30'],
    [0, '0 s'],
  ])('secondsText %d → %s', (sec, expected) => {
    expect(secondsText(sec)).toBe(expected);
  });
});
