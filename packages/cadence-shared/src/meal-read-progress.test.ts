/**
 * The progress line is pure, so it is testable — which is the point of keeping the clock outside it.
 * A progress indicator whose correctness depends on real timers is one nobody tests, and this
 * codebase has already shipped one status line that was right in the unit and invisible in the
 * product (PLAN.md, 2026-08-17).
 */
import { describe, it, expect } from 'vitest';
import { readProgressLine, READ_PHOTO_STEPS, NUTRITION_STEPS } from './meal-read-progress.ts';

describe('readProgressLine', () => {
  it('shows the first line immediately, never an empty one', () => {
    expect(readProgressLine(READ_PHOTO_STEPS, 0)).toBe('Sending your photo…');
    expect(readProgressLine(NUTRITION_STEPS, 0)).toBe('Working out the nutrition…');
  });

  it('advances as the stage runs', () => {
    expect(readProgressLine(READ_PHOTO_STEPS, 3000)).toBe('Looking at what’s on the plate…');
    expect(readProgressLine(READ_PHOTO_STEPS, 14000)).toBe('Sizing the portions against the cup and plate…');
  });

  /**
   * Stage 1 was measured at 11–35s and stage 2 at 23–38s, but a slow model is not a bug and the
   * screen must not go blank waiting for one. The last line HOLDS, however long it takes.
   */
  it('holds the last line past the longest measured run', () => {
    const tail = READ_PHOTO_STEPS.at(-1)?.text;
    expect(tail).toBeDefined();
    expect(readProgressLine(READ_PHOTO_STEPS, 60_000)).toBe(tail);
    expect(readProgressLine(READ_PHOTO_STEPS, 600_000)).toBe(tail);
  });

  it('never goes backwards as time moves forward', () => {
    const seen: string[] = [];
    for (let t = 0; t <= 40_000; t += 500) {
      const line = readProgressLine(READ_PHOTO_STEPS, t);
      if (seen[seen.length - 1] !== line) seen.push(line);
    }
    expect(seen).toEqual(READ_PHOTO_STEPS.map((s) => s.text));
  });

  it('is defensive about an empty step list rather than rendering "undefined"', () => {
    expect(readProgressLine([], 5000)).toBe('');
  });

  /** BRAND: behaviour, never the entity. No line may name the machinery. */
  it('never names the machinery', () => {
    const banned = /\b(model|llm|ai|api|token|prompt|gpt|gemini|vision)\b/i;
    for (const s of [...READ_PHOTO_STEPS, ...NUTRITION_STEPS]) {
      expect(s.text, s.text).not.toMatch(banned);
    }
  });
});
