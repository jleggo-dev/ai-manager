/**
 * The timer as an EFFORT rather than a hold, and the clock that survives being left — everything
 * one ruck on 2026-09-06 found missing:
 *
 *  • the 50-min timer auto-advanced at 50:00 and could not be told the ruck ran to 110 → an
 *    open-ended timer chimes at its target, keeps counting, and Stop logs the real time;
 *  • leaving the app to start a podcast froze the clock → time is read off the wall clock, so
 *    a suspended page catches up the moment it is back;
 *  • a ruck done with the watch had no way to be logged → "Did it already" logs the minutes named;
 *  • "switch sides" in a stretch's cue had no bell → a halfway chime and a visible cue.
 *
 * Ticks advance in slices, each in its own `act`, for the reason autoAdvance.test.tsx gives.
 * Fake timers also fake `Date.now()`, which is what the wall clock reads.
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StepTimer } from './StepTimer.tsx';

const chimes = vi.hoisted(() => ({ tones: [] as number[][] }));
vi.mock('./chime.ts', async (orig) => {
  const real = await orig<typeof import('./chime.ts')>();
  return {
    ...real,
    playChime: () => chimes.tones.push([660, 880]),
    playTones: (n: readonly number[]) => chimes.tones.push([...n]),
    unlockAudio: () => undefined,
  };
});

/** Exactly the 5 s grey pre-roll: the run starts on its last tick, so elapsed counts from here. */
const PREROLL_MS = 5_000;

function tick(totalMs: number, stepMs = 250) {
  for (let t = 0; t < totalMs; t += stepMs) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}

describe('StepTimer — an open-ended effort', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chimes.tones.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('chimes and logs at the target, then keeps counting instead of moving on', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepTimer seconds={60} chime openEnded onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Start/));
    tick(PREROLL_MS);
    tick(61_000);

    // The target is logged the moment it is reached — leaving via › still counts the step...
    expect(onLog).toHaveBeenCalledWith({ kind: 'timer', elapsedSec: 60, targetSec: 60, done: true });
    expect(chimes.tones.filter((t) => t[0] === 660 && t[1] === 880).length).toBeGreaterThanOrEqual(2); // pre-roll + target
    // ...but the clock is still running and nothing has moved on.
    tick(2_000);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText(/^past 1:00/)).toBeInTheDocument();
    expect(screen.getByText(/Time.s up/)).toBeInTheDocument();
  });

  it('Stop logs the time actually spent — 110 minutes on a 50-minute ruck — and hands off', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepTimer seconds={50 * 60} chime={false} openEnded onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Start/));
    tick(PREROLL_MS);
    tick(110 * 60_000, 30_000);

    fireEvent.click(screen.getByText(/^Stop · log 110 min/));
    expect(onLog).toHaveBeenLastCalledWith({ kind: 'timer', elapsedSec: 6600, targetSec: 3000, done: true });
    tick(2_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('StepTimer — the clock survives the app being left', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('catches up from the wall clock when the page wakes, and completes if the target passed', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepTimer seconds={60} chime={false} onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Start/));
    tick(PREROLL_MS);
    tick(10_000);
    expect(screen.getByText('0:50')).toBeInTheDocument();

    // The page sleeps: no timers fire, but the world moves on twenty minutes.
    act(() => {
      vi.setSystemTime(Date.now() + 20 * 60_000);
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    tick(1_000);

    expect(onLog).toHaveBeenCalledWith({ kind: 'timer', elapsedSec: 60, targetSec: 60, done: true });
    tick(2_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('StepTimer — done off the phone', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('"Did it already" logs the minutes named as done, then hands off', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepTimer seconds={50 * 60} chime={false} openEnded onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Did it already/));
    const minutes = screen.getByLabelText('Minutes done') as HTMLInputElement;
    expect(minutes.value).toBe('50'); // opens at the prescription
    fireEvent.change(minutes, { target: { value: '110' } });
    fireEvent.click(screen.getByText('Log it done'));

    expect(onLog).toHaveBeenCalledWith({ kind: 'timer', elapsedSec: 6600, targetSec: 3000, done: true });
    tick(2_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('StepTimer — a two-sided hold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chimes.tones.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('chimes the turn-over and shows "Switch sides" at the halfway point, once', () => {
    render(<StepTimer seconds={60} chime switchSides onLog={() => {}} onDone={() => {}} />);

    fireEvent.click(screen.getByText(/^Start/));
    tick(PREROLL_MS);
    tick(29_000);
    expect(screen.queryByText('Switch sides')).toBeNull();

    tick(2_000);
    expect(screen.getByText('Switch sides')).toBeInTheDocument();
    expect(chimes.tones.filter((t) => t.join() === '880,660,880')).toHaveLength(1);

    tick(10_000);
    expect(chimes.tones.filter((t) => t.join() === '880,660,880')).toHaveLength(1);
  });
});
