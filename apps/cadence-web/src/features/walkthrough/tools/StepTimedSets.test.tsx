/**
 * Sets of a timed effort (walkthrough v3 R1, design B). The rulings these pin, in the order a
 * carry happens: the clock counts down to the target and chimes there but logs NOTHING and keeps
 * counting up; Stop opens a review that says over or under in the same colour; Log writes the set
 * and the next one waits for Start; Keep going carries the time back onto the clock; switch sides
 * chimes once per set; a remembered running clock reopens on the same set, caught up.
 *
 * Ticks advance in slices, each in its own `act` (see autoAdvance.test.tsx); fake timers also
 * fake `Date.now()`, which is what the wall clock reads.
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TONE } from './tone.ts';
import { StepTimedSets } from './StepTimedSets.tsx';
import { getRunningClock } from '../runningClock.ts';

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

function tick(totalMs: number, stepMs = 250) {
  for (let t = 0; t < totalMs; t += stepMs) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}
const button = (label: string | RegExp) => screen.getByRole('button', { name: label });
const press = (label: string | RegExp) => fireEvent.click(button(label));
const endChimes = () => chimes.tones.filter((t) => t[0] === 660 && t[1] === 880).length;
const switchChimes = () => chimes.tones.filter((t) => t.join() === '880,660,880').length;
/** jsdom rewrites oklch(52% …) as oklch(0.52 …), so compare the chroma and hue of TONE.off. */
const offColour = (el: HTMLElement) => el.style.color.endsWith(TONE.off.slice(TONE.off.indexOf(' ')));

describe('StepTimedSets — a carry in four sets of 45 seconds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
    chimes.tones.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const mount = (props: Partial<Parameters<typeof StepTimedSets>[0]> = {}) => {
    const onLog = vi.fn();
    const onDone = vi.fn();
    render(<StepTimedSets seconds={45} sets={4} load="2×40 lb" chime onLog={onLog} onDone={onDone} {...props} />);
    return { onLog, onDone };
  };

  it('opens on set 1 with the target on the clock and a Start that reads Start, nothing more', () => {
    mount();
    expect(screen.getByText('Set 1 of 4')).toBeInTheDocument();
    expect(screen.getByText('0:45')).toBeInTheDocument();
    expect(button('Start')).toBeInTheDocument();
  });

  it('counts down, chimes at the target, then keeps counting UP with the ring hashed — and logs nothing', () => {
    const { onLog, onDone } = mount();
    press('Start');
    expect(getRunningClock()).not.toBeNull(); // registered at app level: the chimes and the pocket bells are its
    tick(10_000);
    expect(screen.getByText('0:35')).toBeInTheDocument();
    expect(screen.getByText('of 0:45')).toBeInTheDocument();
    expect(document.querySelector('[data-hashed]')).toBeNull();

    tick(43_000); // 53 s in
    expect(endChimes()).toBe(1);
    expect(screen.getAllByText('0:53')).toHaveLength(2); // the clock, and set 2's chip showing it live
    expect(screen.getByText('8 s over')).toBeInTheDocument();
    expect(document.querySelector('[data-hashed]')).not.toBeNull();
    // The whole point: unlike a single hold, nothing was logged and nothing moved on.
    expect(onLog).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(button('Stop')).toBeInTheDocument();
  });

  it('Stop opens the review over the target, in the off-target colour, and Log writes the set', () => {
    const { onLog } = mount();
    press('Start');
    tick(53_000);
    press('Stop');
    expect(onLog).not.toHaveBeenCalled(); // Stop does not write
    expect(screen.getByText('53')).toBeInTheDocument();
    expect(screen.getByText('seconds')).toBeInTheDocument();
    expect(offColour(screen.getByText('8 over target'))).toBe(true);
    expect(button('Reset to 45')).toBeInTheDocument();

    press('Log');
    expect(onLog).toHaveBeenCalledWith({ kind: 'timed_sets', sets: [53], targetSec: 45, load: '2×40 lb' });
  });

  it('a set stopped early reads "under target" in the SAME colour — never a warning', () => {
    const { onLog } = mount();
    press('Start');
    tick(32_000);
    press('Stop');
    expect(endChimes()).toBe(0);
    expect(offColour(screen.getByText('13 under target'))).toBe(true);
    expect(screen.queryByText(/warning|short|missed/i)).toBeNull();
    press('Log');
    expect(onLog).toHaveBeenCalledWith({ kind: 'timed_sets', sets: [32], targetSec: 45, load: '2×40 lb' });
  });

  it('− / + move the seconds by one; Reset to 45 lands on the target and the line says so', () => {
    const { onLog } = mount();
    press('Start');
    tick(53_000);
    press('Stop');
    press('one second less');
    press('one second less');
    press('one second less');
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('5 over target')).toBeInTheDocument();
    press('Reset to 45');
    expect(screen.getByText('On target')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reset to/ })).toBeNull();
    press('one second more');
    expect(screen.getByText('1 over target')).toBeInTheDocument();
    press('Log');
    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ sets: [46] }));
  });

  it('Keep going puts the time back on the clock and it runs on from there', () => {
    const { onLog } = mount();
    press('Start');
    tick(30_000);
    press('Stop');
    press('Keep going');
    expect(button('Stop')).toBeInTheDocument();
    tick(20_000); // 50 s in all
    expect(screen.getByText('5 s over')).toBeInTheDocument();
    expect(onLog).not.toHaveBeenCalled();
  });

  it('after Log the next set waits for Start — no rest clock, no auto-start — and the chip shows the set', () => {
    const { onLog, onDone } = mount();
    press('Start');
    tick(45_000);
    press('Stop');
    press('Log');
    cleanup();
    // The shell re-renders the tool with its log; the second set is idle.
    render(
      <StepTimedSets
        seconds={45}
        sets={4}
        load="2×40 lb"
        chime
        log={{ kind: 'timed_sets', sets: [45], targetSec: 45, load: '2×40 lb' }}
        onLog={onLog}
        onDone={onDone}
      />,
    );
    expect(screen.getByText('Set 2 of 4')).toBeInTheDocument();
    expect(button('Start')).toBeInTheDocument();
    expect(screen.getByText('45 s')).toBeInTheDocument(); // set 1's chip
    tick(5_000);
    expect(screen.getByText('0:45')).toBeInTheDocument(); // still idle
    expect(onDone).not.toHaveBeenCalled();
  });

  it('logging the last set hands off after a beat; every chip then reads its own seconds', () => {
    const { onLog, onDone } = mount({
      log: { kind: 'timed_sets', sets: [45, 53, 32], targetSec: 45, load: '2×40 lb' },
    });
    expect(screen.getByText('Set 4 of 4')).toBeInTheDocument();
    press('Start');
    tick(45_000);
    press('Stop');
    press('Log');
    expect(onLog).toHaveBeenLastCalledWith({
      kind: 'timed_sets',
      sets: [45, 53, 32, 45],
      targetSec: 45,
      load: '2×40 lb',
    });
    tick(1_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('with every set logged the button is spent and a logged chip re-opens that set for editing', () => {
    const { onLog } = mount({ log: { kind: 'timed_sets', sets: [45, 53, 32, 45], targetSec: 45, load: '2×40 lb' } });
    expect(button(/Sets logged · 4 of 4/)).toBeDisabled();
    fireEvent.click(screen.getByText('Set 2'));
    expect(screen.getByText('53')).toBeInTheDocument();
    expect(screen.getByText('8 over target')).toBeInTheDocument();
    press('Reset to 45');
    press('Log');
    expect(onLog).toHaveBeenCalledWith({ kind: 'timed_sets', sets: [45, 45, 32, 45], targetSec: 45, load: '2×40 lb' });
  });

  it('switch sides chimes at the halfway point of the set and shows the cue until the target', () => {
    mount({ switchSides: true });
    press('Start');
    tick(22_000);
    expect(switchChimes()).toBe(0);
    tick(2_000);
    expect(switchChimes()).toBe(1);
    expect(screen.getByText('Switch sides')).toBeInTheDocument();
    tick(22_000);
    expect(screen.queryByText('Switch sides')).toBeNull();
    expect(switchChimes()).toBe(1);
  });

  it('a remembered running clock reopens on the same set, caught up, still counting, and registered', () => {
    const startedAt = Date.now() - 50_000;
    mount({
      log: { kind: 'timed_sets', sets: [45], targetSec: 45, load: '2×40 lb' },
      resumeClock: { startedAt, base: 0 },
      stepId: 's7',
    });
    expect(screen.getByText('Set 2 of 4')).toBeInTheDocument();
    expect(screen.getByText('5 s over')).toBeInTheDocument();
    expect(button('Stop')).toBeInTheDocument();
    expect(getRunningClock()).toMatchObject({ stepId: 's7', kind: 'timed_set', startedAt, base: 0, targetSec: 45 });
    tick(1_000);
    expect(screen.getByText('6 s over')).toBeInTheDocument();
    press('Stop');
    expect(getRunningClock()).toBeNull();
  });

  it('registers the clock at app level when it starts, lets it go on Stop, registers again on Keep going', () => {
    mount({ stepId: 's7' });
    press('Start');
    expect(getRunningClock()).toMatchObject({ stepId: 's7', kind: 'timed_set', startedAt: Date.now(), base: 0 });
    tick(10_000);
    press('Stop');
    expect(getRunningClock()).toBeNull();
    press('Keep going');
    expect(getRunningClock()).toMatchObject({ startedAt: Date.now(), base: 10 });
  });

  it('nothing on the card explains the UI', () => {
    mount();
    for (const re of [/tap /i, /keeps counting/i, /moves on/i, /rest/i]) expect(screen.queryByText(re)).toBeNull();
    press('Start');
    tick(50_000);
    press('Stop');
    for (const re of [/tap /i, /keeps counting/i, /moves on/i, /rest/i]) expect(screen.queryByText(re)).toBeNull();
  });
});
