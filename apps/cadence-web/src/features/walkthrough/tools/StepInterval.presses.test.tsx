/**
 * autoAdvance.test.tsx presses Start-to-completion, Restart-inside-the-hand-off-window, and
 * Skip-phase, but never presses the primary button's OTHER role — "Pause" mid-run, which logs the
 * PARTIAL run (rounds actually finished, seconds actually spent) rather than the prescription. Same
 * gap StepTimer had, same reason it matters: the honesty rule this tool advertises in its own file
 * header ("pausing out early logs the rounds actually finished") was never pressed and checked.
 *
 * Ticks advance to the "elapsed" metric's OWN text, found via its sibling label rather than a
 * plain `getByText` search — the ring's phase-remaining countdown is formatted the same way
 * ("M:SS") and reaches the same string one second earlier (a 5 s work phase minus 2 s elapsed also
 * reads "0:03"), so a plain text search finds the wrong node and the click lands a second early.
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { singleSetPlan, type WalkthroughStep } from '@cadence/shared';
import { StepInterval } from './StepInterval.tsx';

/** The "elapsed" metric's value span sits immediately before its own label in the DOM. */
function elapsedMetricText(): string | null {
  const label = screen.queryByText('elapsed');
  return (label?.previousElementSibling as HTMLElement | null)?.textContent ?? null;
}

function tickUntilElapsed(text: string, maxMs = 20_000, stepMs = 100) {
  for (let t = 0; t < maxMs; t += stepMs) {
    if (elapsedMetricText() === text) return;
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}

const INTERVAL_STEP: WalkthroughStep = {
  id: 's1',
  title: 'Bike sprints',
  minutes: 1,
  tool: { kind: 'read' },
  skippable: true,
};
// 2 rounds of 5 s work / 5 s recover — 20 s total, matching autoAdvance.test.tsx's own fixture.
const quickPlan = () => singleSetPlan({ workSec: 5, recoverSec: 5, rounds: 2 });

describe('StepInterval — Pause logs the run actually done, not the prescription', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('pausing 3 s into the first work phase logs 0 rounds done and 3 s spent — and does not hand off', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepInterval step={INTERVAL_STEP} plan={quickPlan()} onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Start/));
    tickUntilElapsed('0:03'); // 3 s of the first 5 s work phase — well short of a completed round

    fireEvent.click(screen.getByText('Pause'));

    expect(onLog).toHaveBeenCalledWith({
      kind: 'interval',
      roundsDone: 0,
      totalRounds: 2,
      elapsedSec: 3,
      targetSec: 20,
      shorthand: '2 × 5/5',
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('after a pause, the primary button reads Resume and picks the clock back up without the pre-roll', () => {
    render(<StepInterval step={INTERVAL_STEP} plan={quickPlan()} onLog={() => {}} onDone={() => {}} />);

    fireEvent.click(screen.getByText(/^Start/));
    tickUntilElapsed('0:03');
    fireEvent.click(screen.getByText('Pause'));

    expect(screen.getByText(/^Resume/)).toBeInTheDocument();
    expect(screen.queryByText('Get in position')).toBeNull();
  });
});
