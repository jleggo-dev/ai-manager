/**
 * The circuit card never drew a move's `detail` — the coach's words about how to do the move went
 * nowhere while the step header showed its own (owner's gym session, 2026-11-02). Now the current
 * move's cue is drawn with the same folding `Cue` the header uses: three lines, then "more". And the
 * move's target is plain text ("12 reps", "30 s"), not a TARGET pill — the design ruling of
 * 2026-11-03, the same one that took the box off the step header.
 */
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { WalkthroughStep } from '@cadence/shared';
import { StepCircuit } from './StepCircuit.tsx';
import { LONG_CUE_CHARS } from '../wt-cue.tsx';

const STEP: WalkthroughStep = { id: 's1', title: 'Core circuit', minutes: 5, tool: { kind: 'read' }, skippable: true };
const LONG = 'Brace before every rep and breathe out as you lift. '.repeat(6).trim(); // > LONG_CUE_CHARS
const SHORT = 'Slow on the way down.';

function circuit(first: { name: string; reps?: number; seconds?: number; detail?: string }) {
  return render(
    <StepCircuit
      step={STEP}
      rounds={2}
      exercises={[first, { name: 'Dead bug', reps: 8 }]}
      onLog={vi.fn()}
      onAdvance={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe('StepCircuit — the current move shows its cue, folded', () => {
  it('the guard: the long cue is long enough to fold where the browser cannot measure', () => {
    expect(LONG.length).toBeGreaterThan(LONG_CUE_CHARS);
    expect(SHORT.length).toBeLessThan(LONG_CUE_CHARS);
  });

  it.each([
    ['a reps move with a long cue folds it behind "more"', { name: 'Plank', reps: 12, detail: LONG }, LONG, true],
    ['a timed move with a long cue folds it too', { name: 'Plank', seconds: 30, detail: LONG }, LONG, true],
    ['a short cue is shown whole, with no "more"', { name: 'Plank', reps: 12, detail: SHORT }, SHORT, false],
  ] as const)('%s', (_name, move, text, folds) => {
    circuit(move);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'more' }) != null).toBe(folds);
  });

  it('a move with no cue draws nothing for it', () => {
    circuit({ name: 'Plank', reps: 12 });
    expect(screen.queryByRole('button', { name: 'more' })).toBeNull();
  });
});

describe('StepCircuit — the target is plain text, no TARGET pill', () => {
  it.each([
    ['reps', { name: 'Plank', reps: 12 }, '12 reps'],
    ['seconds', { name: 'Plank', seconds: 30 }, '30 s'],
  ])('%s', (_name, move, text) => {
    circuit(move);
    // The rotation list below repeats the number, so there can be more than one match.
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Target/)).toBeNull();
  });
});
