/**
 * The interval player used to resume PAUSED when you came back to its step (the comment near its
 * line 100, now gone). Under R6 a run you left keeps running at app level: the chimes play while
 * the player is away, and coming back opens it live, in the right phase, caught up.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { singleSetPlan, type WalkthroughStep } from '@cadence/shared';

const audio = vi.hoisted(() => ({ tones: vi.fn() }));
vi.mock('./chime.ts', async (orig) => ({
  ...(await orig<typeof import('./chime.ts')>()),
  playTones: audio.tones,
  playChime: audio.tones,
  unlockAudio: vi.fn(),
}));

const { StepInterval } = await import('./StepInterval.tsx');
const { getRunningClock, unregisterClock } = await import('../runningClock.ts');
const { CHIME_RECOVER, CHIME_WORK } = await import('./chime-tones.ts');

const STEP: WalkthroughStep = { id: 's1', title: 'Bike sprints', minutes: 1, tool: { kind: 'read' }, skippable: true };
// 10 s warm-up, then 2 × (20 s work / 10 s recover): 70 s in all.
const plan = () => singleSetPlan({ warmupSec: 10, workSec: 20, recoverSec: 10, rounds: 2 });

function tick(totalMs: number, stepMs = 250) {
  for (let t = 0; t < totalMs; t += stepMs) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}
const press = (label: string | RegExp) => fireEvent.click(screen.getAllByRole('button', { name: label }).at(-1)!);
const elapsedMetric = () => (screen.getByText('elapsed').previousElementSibling as HTMLElement).textContent;

describe('StepInterval — a run you left is still running when you come back', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    audio.tones.mockClear();
  });
  afterEach(() => {
    cleanup();
    unregisterClock();
    vi.useRealTimers();
  });

  it('left mid-warm-up, the handovers chime while it is away, and it reopens live in round 2, caught up', () => {
    const onLog = vi.fn();
    render(<StepInterval step={STEP} plan={plan()} onLog={onLog} onDone={vi.fn()} />);
    press(/^Start ·/);
    tick(5_000);
    expect(getRunningClock()).toMatchObject({ stepId: 's1', kind: 'interval', targetSec: 70 });
    audio.tones.mockClear(); // the start chime

    cleanup(); // the step is left: the player unmounts, the clock does not
    expect(getRunningClock()).not.toBeNull();
    tick(40_000); // 45 s in: warm-up → work (10 s) → recover (30 s) → work (40 s)
    expect(audio.tones.mock.calls.map((c) => c[0])).toEqual([CHIME_WORK, CHIME_RECOVER, CHIME_WORK]);
    expect(onLog).not.toHaveBeenCalled(); // leaving logged nothing; pausing would have

    render(<StepInterval step={STEP} plan={plan()} resumeClock={getRunningClock()} onLog={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Pause' }).length).toBeGreaterThan(0); // live, not "Resume"
    expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull();
    expect(screen.queryByText(/^Paused/)).toBeNull();
    expect(screen.getByText('Round 2 of 2')).toBeInTheDocument();
    expect(elapsedMetric()).toBe('0:45');
    tick(1_000);
    expect(elapsedMetric()).toBe('0:46'); // still counting
  });

  it('paused and left, it reopens paused where it was — a pause is still a pause', () => {
    render(
      <StepInterval
        step={STEP}
        plan={plan()}
        log={{ kind: 'interval', roundsDone: 0, totalRounds: 2, elapsedSec: 15, targetSec: 70, shorthand: '2 × 20/10' }}
        onLog={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^Resume/ })).toBeInTheDocument();
    expect(getRunningClock()).toBeNull();
  });
});
