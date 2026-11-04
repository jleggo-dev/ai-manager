/**
 * The running clock lives at app level (walkthrough v3 R6, owner 2026-11-03), so leaving the
 * walkthrough never silences it. The chime effect used to live in the tool's render: a timeout
 * armed inside a card that was unmounted when the person switched tabs never fired, and the
 * interval chime only sounded while the player was on screen (#477's locked-screen check).
 *
 * The first half pins the store on its own; the second is the router-level proof: a timer started
 * inside the whole walkthrough shell, the shell unmounted (what switching tab does to it), fake
 * time advanced past the target — the chime played, exactly once.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Walkthrough as WalkthroughData } from '@cadence/shared';
import { singleSetPlan } from '@cadence/shared';

const audio = vi.hoisted(() => ({ chime: vi.fn(), tones: vi.fn() }));
vi.mock('./tools/chime.ts', async (orig) => ({
  ...(await orig<typeof import('./tools/chime.ts')>()),
  playChime: audio.chime,
  playTones: audio.tones,
  unlockAudio: vi.fn(),
}));
vi.mock('../../lib/persisted-session.ts', () => ({ readPersistedSession: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../lib/api.ts', () => ({ keepJournalEntry: vi.fn(), settleTempo: vi.fn(async () => undefined) }));

const { clockLine, elapsedOf, getRunningClock, registerClock, unregisterClock, useRunningClock } =
  await import('./runningClock.ts');
const { Walkthrough } = await import('./Walkthrough.tsx');
const { CHIME_RECOVER, CHIME_SWITCH, CHIME_WORK, CHIME_DONE } = await import('./tools/chime-tones.ts');

const spec = { stepId: 's1', title: 'Farmer carry', chime: true } as const;

function tick(totalMs: number, stepMs = 250) {
  for (let t = 0; t < totalMs; t += stepMs) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
  audio.chime.mockClear();
  audio.tones.mockClear();
});
afterEach(() => {
  cleanup();
  unregisterClock();
  vi.useRealTimers();
});

describe('the store', () => {
  it('plays the plain chime at a timer target, and a turn-over halfway for a two-sided hold', () => {
    registerClock({ ...spec, kind: 'timer', startedAt: Date.now(), base: 0, targetSec: 60, switchSides: true });
    tick(29_000);
    expect(audio.tones).not.toHaveBeenCalled();
    tick(1_500);
    expect(audio.tones).toHaveBeenCalledWith(CHIME_SWITCH);
    expect(audio.chime).not.toHaveBeenCalled();
    tick(30_000);
    expect(audio.chime).toHaveBeenCalledTimes(1);
    tick(60_000);
    expect(audio.chime).toHaveBeenCalledTimes(1); // nothing past the target
  });

  it('plays an interval run through from the plan — work, recover, work, recover, the end — with nothing at the start', () => {
    const plan = singleSetPlan({ workSec: 5, recoverSec: 5, rounds: 2 });
    registerClock({ ...spec, kind: 'interval', startedAt: Date.now(), base: 0, targetSec: 20, plan });
    tick(25_000);
    expect(audio.tones.mock.calls.map((c) => c[0])).toEqual([CHIME_RECOVER, CHIME_WORK, CHIME_RECOVER, CHIME_DONE]);
  });

  it('a clock registered mid-run skips the boundaries already behind it', () => {
    registerClock({
      ...spec,
      kind: 'timer',
      startedAt: Date.now() - 40_000,
      base: 0,
      targetSec: 60,
      switchSides: true,
    });
    tick(25_000);
    expect(audio.tones).not.toHaveBeenCalled(); // the halfway point was 10 s before it registered
    expect(audio.chime).toHaveBeenCalledTimes(1);
  });

  it('unregistering silences what was armed; registering again reschedules from the new instant', () => {
    registerClock({ ...spec, kind: 'timer', startedAt: Date.now(), base: 0, targetSec: 10 });
    tick(5_000);
    unregisterClock();
    tick(10_000);
    expect(audio.chime).not.toHaveBeenCalled();
    registerClock({ ...spec, kind: 'timer', startedAt: Date.now(), base: 5, targetSec: 10 }); // resumed with 5 s banked
    tick(5_500);
    expect(audio.chime).toHaveBeenCalledTimes(1);
  });

  it('chime off: the boundary still buzzes but plays nothing', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    registerClock({ ...spec, kind: 'timer', startedAt: Date.now(), base: 0, targetSec: 5, chime: false });
    tick(6_000);
    expect(audio.chime).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledWith(60);
  });

  it("unregistering by step only lets go of that step's clock", () => {
    registerClock({ ...spec, kind: 'timer', startedAt: Date.now(), base: 0, targetSec: 60 });
    unregisterClock('s2');
    expect(getRunningClock()?.stepId).toBe('s1');
    unregisterClock('s1');
    expect(getRunningClock()).toBeNull();
  });

  it('useRunningClock follows register and unregister', () => {
    const seen: Array<string | null> = [];
    function Probe() {
      const c = useRunningClock();
      seen.push(c?.stepId ?? null);
      return null;
    }
    render(<Probe />);
    act(() => registerClock({ ...spec, kind: 'timer', startedAt: Date.now(), base: 0, targetSec: 60 }));
    act(() => unregisterClock());
    expect(seen).toEqual([null, 's1', null]);
  });

  it('elapsedOf and clockLine: what is left, the phase for an interval, the time over past a target', () => {
    const now = Date.now();
    const timer = { ...spec, kind: 'timer' as const, startedAt: now - 28_000, base: 0, targetSec: 60 };
    expect(elapsedOf(timer, now)).toBe(28);
    expect(clockLine(timer, now)).toBe('Farmer carry · 0:32');
    expect(clockLine({ ...timer, startedAt: now - 72_000 }, now)).toBe('Farmer carry · +0:12');
    const plan = singleSetPlan({ workSec: 20, recoverSec: 30, rounds: 2 });
    const interval = { ...spec, kind: 'interval' as const, startedAt: now - 32_000, base: 0, targetSec: 100, plan };
    expect(clockLine(interval, now)).toBe('Recover · 0:18');
  });
});

const wt: WalkthroughData = {
  total_min: 2,
  steps: [
    { id: 's1', title: 'Farmer carry', minutes: 1, tool: { kind: 'timer', seconds: 30 }, skippable: true },
    { id: 's2', title: 'Stretch', minutes: 1, tool: { kind: 'checkoff' }, skippable: true },
  ],
};

describe('leaving the walkthrough does not stop the clock', () => {
  it('a timer started in the shell chimes once at its target after the shell has unmounted', () => {
    const { unmount } = render(
      <Walkthrough walkthrough={wt} title="Carries" occurrenceId="o1" onClose={() => {}} onComplete={() => {}} />,
    );
    fireEvent.click(screen.getByText(/^Start/));
    tick(6_000); // through the 5 s pre-roll: the clock is running
    expect(getRunningClock()).toMatchObject({ stepId: 's1', kind: 'timer', targetSec: 30 });
    audio.chime.mockClear(); // the pre-roll's own start chime

    unmount(); // what switching tab does to the walkthrough
    expect(getRunningClock()).not.toBeNull();

    tick(40_000);
    expect(audio.chime).toHaveBeenCalledTimes(1);
  });

  it('moving to another step keeps the clock, and coming back opens the timer running and caught up', () => {
    render(<Walkthrough walkthrough={wt} title="Carries" occurrenceId="o1" onClose={() => {}} onComplete={() => {}} />);
    fireEvent.click(screen.getByText(/^Start/));
    tick(6_000);
    fireEvent.click(screen.getByLabelText('Next step'));
    tick(10_000);
    expect(getRunningClock()).toMatchObject({ stepId: 's1' });
    fireEvent.click(screen.getByLabelText('Previous step'));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    // ~11 s into the 30 s clock: the 5 s pre-roll, then 1 s here and 10 s on the other step.
    expect(screen.getByText(/^0:(19|20)$/)).toBeInTheDocument();
  });
});
