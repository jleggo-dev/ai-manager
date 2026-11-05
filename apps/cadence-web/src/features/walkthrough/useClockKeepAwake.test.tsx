/**
 * The screen stays on while a clock you watch runs (walkthrough v3 R6, owner 2026-11-03) — held
 * from the app root, following the store, not by the tool. The failure this guards: start a timer,
 * switch to the Coach tab, the tool unmounts, a tool-held lock is released, the phone auto-locks,
 * the webview suspends, and the chime the store armed never fires. So: a timer started in the
 * whole walkthrough shell stays held after the shell unmounts; letting the clock go releases; the
 * metronome starting and stopping during a running timer leaves the timer's hold in place (the
 * capability counts); a sit holds nothing on the default and does on "stays on".
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Walkthrough as WalkthroughData } from '@cadence/shared';
import { SIT_SCREEN_KEY } from '../../lib/sit-screen.ts';

// The real counted capability over a spy, so the metronome row proves the count and not a mock.
const lock = vi.hoisted(() => ({ set: vi.fn(async (_on: boolean) => undefined) }));
vi.mock('../../lib/capability/index.ts', async () => {
  const { countedKeepAwake } = await import('../../lib/capability/keep-awake.ts');
  return {
    capabilities: {
      keepAwake: countedKeepAwake({ set: lock.set }),
      localNotifications: { isAvailable: () => false },
      liveActivity: { isAvailable: () => false, start: async () => false, pause: async () => {}, end: async () => {} },
    },
  };
});
vi.mock('./tools/chime.ts', async (orig) => ({
  ...(await orig<typeof import('./tools/chime.ts')>()),
  playChime: vi.fn(),
  playTones: vi.fn(),
  unlockAudio: vi.fn(),
}));
vi.mock('../../lib/persisted-session.ts', () => ({ readPersistedSession: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../lib/api.ts', () => ({ keepJournalEntry: vi.fn(), settleTempo: vi.fn(async () => undefined) }));

const { clockHoldsScreen, useClockKeepAwake } = await import('./useClockKeepAwake.ts');
const { registerClock, unregisterClock } = await import('./runningClock.ts');
const { useMetronome } = await import('./tools/useMetronome.ts');
const { Walkthrough } = await import('./Walkthrough.tsx');
type Spec = Parameters<typeof registerClock>[0];
type Kind = Spec['kind'];

/** The app root's hold, on its own. */
function Root() {
  useClockKeepAwake();
  return null;
}
const spec = (kind: Kind): Spec => ({
  stepId: 's1',
  title: 'Step',
  kind,
  startedAt: Date.now(),
  base: 0,
  targetSec: 60,
  chime: true,
  ...(kind === 'sit' ? { bells: { bells: 'none' as const, intervalMin: 0 } } : {}),
});
const held = () => lock.set.mock.calls.filter(([on]) => on).length;
const released = () => lock.set.mock.calls.filter(([on]) => !on).length;

beforeEach(() => {
  vi.useFakeTimers();
  lock.set.mockClear();
});
afterEach(() => {
  cleanup();
  unregisterClock();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('clockHoldsScreen', () => {
  it.each<[Kind, boolean, boolean]>([
    ['timer', true, true],
    ['timed_set', true, true],
    ['interval', true, true],
    ['circuit_move', true, true],
    ['sit', false, true],
    ['breath', false, true],
  ])('%s: on the default %s, with "stays on" %s', (kind, onDark, onOn) => {
    expect(clockHoldsScreen(spec(kind), 'dark')).toBe(onDark);
    expect(clockHoldsScreen(spec(kind), 'on')).toBe(onOn);
  });
  it('nothing registered holds nothing, whatever the setting', () => {
    expect(clockHoldsScreen(null, 'on')).toBe(false);
  });
});

describe('useClockKeepAwake follows the store', () => {
  it.each<Kind>(['timer', 'timed_set', 'interval', 'circuit_move'])(
    '%s: held on register, released on unregister',
    (kind) => {
      render(<Root />);
      expect(held()).toBe(0);
      act(() => registerClock(spec(kind)));
      expect(lock.set).toHaveBeenLastCalledWith(true);
      act(() => registerClock({ ...spec(kind), chime: false })); // a re-registration is not a second hold
      expect(held()).toBe(1);
      act(() => unregisterClock());
      expect(lock.set).toHaveBeenLastCalledWith(false);
      expect(released()).toBe(1);
    },
  );

  it.each<Kind>(['sit', 'breath'])('%s: never held on the default (goes dark)', (kind) => {
    render(<Root />);
    act(() => registerClock(spec(kind)));
    act(() => unregisterClock());
    expect(lock.set).not.toHaveBeenCalled();
  });

  it.each<Kind>(['sit', 'breath'])('%s: held on "stays on", released on unregister', (kind) => {
    window.localStorage.setItem(SIT_SCREEN_KEY, 'on');
    render(<Root />);
    act(() => registerClock(spec(kind)));
    expect(lock.set).toHaveBeenLastCalledWith(true);
    act(() => unregisterClock());
    expect(lock.set).toHaveBeenLastCalledWith(false);
  });

  it('released when the root itself unmounts (the shell closing)', () => {
    const { unmount } = render(<Root />);
    act(() => registerClock(spec('timer')));
    unmount();
    expect(lock.set).toHaveBeenLastCalledWith(false);
  });
});

const wt: WalkthroughData = {
  total_min: 1,
  steps: [{ id: 's1', title: 'Farmer carry', minutes: 1, tool: { kind: 'timer', seconds: 30 }, skippable: true }],
};

describe('a timer started in the shell', () => {
  function tick(totalMs: number, stepMs = 250) {
    for (let t = 0; t < totalMs; t += stepMs) {
      act(() => {
        vi.advanceTimersByTime(stepMs);
      });
    }
  }

  it('stays held after routing away (the walkthrough unmounting); letting the clock go releases', () => {
    render(<Root />);
    const shell = render(<Walkthrough walkthrough={wt} title="Carries" onClose={() => {}} onComplete={() => {}} />);
    fireEvent.click(screen.getByText(/^Start/));
    expect(held()).toBe(0); // the pre-roll is not a running clock
    tick(6_000);
    expect(held()).toBe(1);

    shell.unmount(); // what switching tab does to the walkthrough
    expect(released()).toBe(0);

    act(() => unregisterClock());
    expect(released()).toBe(1);
  });

  it('the metronome starting and stopping during a running timer leaves the timer held', () => {
    function Dock() {
      const m = useMetronome({ bpm: 72, meter: 4 }, 'Scales');
      return <button onClick={m.toggle}>{m.running ? 'stop' : 'start'}</button>;
    }
    render(
      <>
        <Root />
        <Dock />
      </>,
    );
    act(() => registerClock(spec('timer')));
    expect(held()).toBe(1);
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getByText('stop'));
    expect(held()).toBe(1); // the second holder was silent
    expect(released()).toBe(0); // and letting it go dropped nothing
    act(() => unregisterClock());
    expect(released()).toBe(1);
  });
});
