/**
 * The screen stays on while a clock you watch runs, and only then (walkthrough v3 R6, owner
 * 2026-11-03, extending the metronome's 2026-11-01 ruling). One row per watched tool: the hold is
 * taken on Start and let go on every way out — pause, stop, finish, and the card unmounting — so a
 * phone never auto-locks on a running clock and never stays lit on a stopped one.
 *
 * A sit and the breath pacer are the exceptions (owner addendum): keep-awake means a lit screen,
 * and a sit is eyes-closed. They hold nothing on the default and do on "stays on".
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { singleSetPlan, type WalkthroughStep } from '@cadence/shared';
import { SIT_SCREEN_KEY } from '../../../lib/sit-screen.ts';

const set = vi.fn(async (_on: boolean) => undefined);
vi.mock('../../../lib/capability/index.ts', () => ({
  capabilities: {
    keepAwake: { set },
    localNotifications: { isAvailable: () => false },
    liveActivity: { isAvailable: () => false, start: async () => false, pause: async () => {}, end: async () => {} },
  },
}));
vi.mock('./chime.ts', async (orig) => ({
  ...(await orig<typeof import('./chime.ts')>()),
  playChime: vi.fn(),
  playTones: vi.fn(),
  unlockAudio: vi.fn(),
}));

const { StepTimer } = await import('./StepTimer.tsx');
const { StepTimedSets } = await import('./StepTimedSets.tsx');
const { StepInterval } = await import('./StepInterval.tsx');
const { CircuitMoveClock } = await import('./CircuitMoveClock.tsx');
const { StepMeditate } = await import('./StepMeditate.tsx');
const { StepBreathing } = await import('./StepBreathing.tsx');
const { BREATH_PATTERNS } = await import('@cadence/shared');

const STEP: WalkthroughStep = { id: 's1', title: 'Bike sprints', minutes: 1, tool: { kind: 'read' }, skippable: true };
const PATTERN = BREATH_PATTERNS.find((p) => p.id === 'box') ?? BREATH_PATTERNS[0]!;

function tick(totalMs: number, stepMs = 250) {
  for (let t = 0; t < totalMs; t += stepMs) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}
/** The interval's ring is a Start / Pause target too; the primary button comes last. */
const press = (label: string | RegExp) => fireEvent.click(screen.getAllByRole('button', { name: label }).at(-1)!);
const held = () => set.mock.calls.filter(([on]) => on).length;
const released = () => set.mock.calls.filter(([on]) => !on).length;

interface Row {
  tool: string;
  mount: () => void;
  start: () => void;
  /** Each way out of a running clock, by name; `finish` lets the clock run to its target. */
  outs: Record<string, () => void>;
}

const ROWS: Row[] = [
  {
    tool: 'timer',
    mount: () => void render(<StepTimer seconds={10} chime={false} onLog={vi.fn()} onDone={vi.fn()} />),
    start: () => {
      press(/^Start/);
      tick(6_000); // through the pre-roll
    },
    outs: {
      pause: () => press('Pause'),
      finish: () => tick(11_000), // a hold stops itself at the target
    },
  },
  {
    tool: 'timer (an effort, which runs past its target)',
    mount: () => void render(<StepTimer seconds={10} chime={false} openEnded onLog={vi.fn()} onDone={vi.fn()} />),
    start: () => {
      press(/^Start/);
      tick(6_000);
    },
    outs: {
      pause: () => press('Pause'),
      'stop past the target': () => {
        tick(11_000);
        press(/^Stop ·/);
      },
    },
  },
  {
    tool: 'timed sets',
    mount: () => void render(<StepTimedSets seconds={10} sets={2} chime={false} onLog={vi.fn()} />),
    start: () => press('Start'),
    outs: {
      stop: () => press('Stop'),
      'stop past the target': () => {
        tick(11_000);
        press('Stop');
      },
    },
  },
  {
    tool: 'interval',
    mount: () =>
      void render(
        <StepInterval
          step={STEP}
          plan={singleSetPlan({ warmupSec: 10, workSec: 5, recoverSec: 5, rounds: 1 })}
          onLog={vi.fn()}
          onDone={vi.fn()}
        />,
      ),
    start: () => press(/^Start ·/),
    outs: {
      pause: () => press('Pause'),
      restart: () => press('Restart'),
      finish: () => tick(21_000),
    },
  },
  {
    tool: 'circuit move',
    mount: () => void render(<CircuitMoveClock seconds={10} onElapsed={vi.fn()} />),
    start: () => press(/^Start ·/),
    outs: {
      pause: () => press('Pause'),
      finish: () => tick(11_000),
    },
  },
];

describe('the screen stays on while a watched clock runs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    set.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe.each(ROWS)('$tool', ({ mount, start, outs }) => {
    it('holds nothing while merely open, holds on Start', () => {
      mount();
      expect(held()).toBe(0);
      start();
      expect(held()).toBe(1);
    });

    it.each(Object.entries(outs))('lets go on %s', (_name, out) => {
      mount();
      start();
      expect(set).toHaveBeenLastCalledWith(true);
      out();
      expect(set).toHaveBeenLastCalledWith(false);
    });

    it('lets go when the card unmounts mid-run', () => {
      mount();
      start();
      cleanup();
      expect(set).toHaveBeenLastCalledWith(false);
      expect(released()).toBe(1);
    });
  });

  it('timer: Reset mid-run lets go', () => {
    render(<StepTimer seconds={10} chime={false} onLog={vi.fn()} onDone={vi.fn()} />);
    press(/^Start/);
    tick(6_000);
    press('Reset');
    expect(set).toHaveBeenLastCalledWith(false);
  });
});

describe('a sit and the breath pacer hold the screen only when this phone says so', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    set.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  const SIT_ROWS: Array<[string, () => void, string | RegExp]> = [
    [
      'sit',
      () => void render(<StepMeditate seconds={60} bells="none" intervalMin={0} onLog={vi.fn()} onDone={vi.fn()} />),
      /^Begin/,
    ],
    [
      'breath pacer',
      () => void render(<StepBreathing pattern={PATTERN} cycles={2} onLog={vi.fn()} onDone={vi.fn()} />),
      'Begin',
    ],
  ];

  it.each(SIT_ROWS)('%s: never holds on the default (goes dark), through the pre-roll and the run', (_t, mount, go) => {
    mount();
    press(go);
    tick(7_000);
    expect(held()).toBe(0);
  });

  it.each(SIT_ROWS)('%s: holds from Begin on "stays on", and lets go on unmount', (_t, mount, go) => {
    window.localStorage.setItem(SIT_SCREEN_KEY, 'on');
    mount();
    expect(held()).toBe(0);
    press(go);
    expect(set).toHaveBeenLastCalledWith(true);
    tick(7_000);
    expect(held()).toBe(1);
    cleanup();
    expect(set).toHaveBeenLastCalledWith(false);
  });
});
