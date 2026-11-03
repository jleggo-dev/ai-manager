/**
 * The interval player never chimed on the phone (owner's gym session, 2026-11-02). Its first chime
 * plays at the end of a five-second pre-roll, with no finger on the screen, and iOS only lets audio
 * sound if it was opened INSIDE a tap. StepTimer calls `unlockAudio()` in its Start tap; this player
 * did not, so the audio stayed suspended for the whole run — the 2026-09-06 calf-stretch bug again,
 * in a second tool. The existing tests mocked the chime module and so could not see it.
 *
 * One row per tap that leads to a running clock. Each asserts the unlock happened synchronously in
 * the tap itself, not later in an effect — an effect runs outside the gesture and does not count.
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { singleSetPlan, type IntervalPlan, type WalkthroughStep } from '@cadence/shared';
import { StepInterval } from './StepInterval.tsx';

const audio = vi.hoisted(() => ({ unlock: vi.fn(), tones: vi.fn() }));
vi.mock('./chime.ts', async (orig) => {
  const real = await orig<typeof import('./chime.ts')>();
  return { ...real, unlockAudio: audio.unlock, playTones: audio.tones, playChime: audio.tones };
});

const STEP: WalkthroughStep = { id: 's1', title: 'Bike sprints', minutes: 1, tool: { kind: 'read' }, skippable: true };
const noWarmup = () => singleSetPlan({ workSec: 5, recoverSec: 5, rounds: 2 });
const withWarmup = () => singleSetPlan({ warmupSec: 10, workSec: 5, recoverSec: 5, rounds: 2 });

/** The whole ring is a tap target named Start / Pause too; the primary button comes last in the DOM. */
const press = (label: string | RegExp) => fireEvent.click(screen.getAllByRole('button', { name: label }).at(-1)!);
/** Advances in 250 ms slices, each flushed on its own: the pre-roll re-arms one timeout per render. */
function tick(totalMs: number) {
  for (let t = 0; t < totalMs; t += 250) {
    act(() => {
      vi.advanceTimersByTime(250);
    });
  }
}

/** Press Start and run 2 s into the clock, past any pre-roll, so Pause / Restart have a run to act on. */
function runABit(plan: IntervalPlan) {
  press(/^Start ·/);
  tick(plan.warmupSec > 0 ? 2_000 : 7_000);
}

type Row = [name: string, plan: () => IntervalPlan, setup: (plan: IntervalPlan) => void, tap: string | RegExp];

const ROWS: Row[] = [
  ['pre-roll Start (no warm-up)', noWarmup, () => undefined, /^Start ·/],
  ['warm-up Start', withWarmup, () => undefined, /^Start ·/],
  [
    'Resume after a pause',
    noWarmup,
    (plan) => {
      runABit(plan);
      press('Pause');
    },
    /^Resume/,
  ],
  ['Restart mid-run', noWarmup, runABit, 'Restart'],
  ['Skip the count · start now, during the pre-roll', noWarmup, () => press(/^Start ·/), /^Skip the count/],
];

describe('StepInterval — every tap that leads to a running clock opens the audio inside the tap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    audio.unlock.mockReset();
    audio.tones.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each(ROWS)('%s', (_name, makePlan, setup, tap) => {
    const plan = makePlan();
    render(<StepInterval step={STEP} plan={plan} onLog={vi.fn()} onDone={vi.fn()} />);
    setup(plan);
    audio.unlock.mockClear();

    press(tap);

    // Synchronously, in the same tick as the click — nothing has been advanced yet.
    expect(audio.unlock).toHaveBeenCalled();
  });

  it('the pre-roll chime still plays after the unlock — the unlock did not replace it', () => {
    render(<StepInterval step={STEP} plan={noWarmup()} onLog={vi.fn()} onDone={vi.fn()} />);
    press(/^Start ·/);
    expect(audio.unlock).toHaveBeenCalledTimes(1);
    expect(audio.tones).not.toHaveBeenCalled();
    tick(6_000);
    expect(audio.tones).toHaveBeenCalled();
  });
});
