/**
 * Owner ruling 2026-11-03: a walkthrough button that WRITES wears the design system's commit green;
 * amber is kept for what is in progress. Pins the split so a later "one amber for every tool" tidy-up
 * can't quietly undo it: the log button is green, the timer's Start/Pause face is still amber, and
 * both faces come from the single definitions in tone.ts.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StepReps } from './StepReps.tsx';
import { COMMIT, TONE } from './tone.ts';
import { logBtn as timerFace } from './timerStyles.ts';
import { greenBtn } from '../wt-styles.ts';

describe('commit green vs in-progress amber', () => {
  it('the reps log button is the commit green, not the amber do-tone', () => {
    render(<StepReps sets={2} reps={10} onLog={vi.fn()} />);
    const btn = screen.getByText('Log set 1 · 10 reps');
    // jsdom rewrites oklch(60% …) as oklch(0.6 …), so match on the hue, not the exact string:
    // every stop of the commit gradient sits on hue 152 (green); the amber do-tone is hue 68–70.
    const hues = [...btn.style.background.matchAll(/oklch\([^)]*?\s(\d+)\)/g)].map((m) => Number(m[1]));
    expect(hues).toEqual([152, 152]);
    expect(btn.style.boxShadow).toContain(' 152)');
    expect(btn.style.background).not.toContain(' 70)');
    expect(TONE.fillA).toContain(' 70)'); // the amber this test is guarding against
  });

  it('the timer Start/Pause face stays amber; only the over-target Stop · log swaps to green at render', () => {
    expect(timerFace.background).toContain(TONE.fillA);
    expect(timerFace.boxShadow).toBe(`0 5px 0 ${TONE.deep}`);
  });

  it('the shell greenBtn (Finish, Done) and COMMIT are one definition', () => {
    expect(greenBtn.background).toBe(COMMIT.background);
    expect(greenBtn.boxShadow).toBe(COMMIT.boxShadow);
  });
});
