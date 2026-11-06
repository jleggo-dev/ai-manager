import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patternById } from '@cadence/shared';
import { StepBreathing } from './StepBreathing.tsx';
import { BREATH_PACE_KEY } from './useBreathPace.ts';
import type { RunningClockSpec } from '../runningClock.ts';

const api = vi.hoisted(() => ({
  get: vi.fn(async (): Promise<number | null> => null),
  save: vi.fn(async (_pace: number) => true),
}));
vi.mock('../../../lib/api/breath-pace.ts', () => ({
  getBreathPace: () => api.get(),
  saveBreathPace: (pace: number) => api.save(pace),
}));

const registered = vi.hoisted(() => ({ spec: null as RunningClockSpec | null }));
vi.mock('../useRegisteredClock.ts', () => ({
  useRegisteredClock: (spec: RunningClockSpec | null) => {
    registered.spec = spec;
  },
}));

/** Longer than the 5 s grey pre-roll, so the run has actually started. */
const PREROLL_MS = 6_000;

function tick(ms: number) {
  for (let left = ms; left > 0; left -= 1_000) {
    act(() => {
      vi.advanceTimersByTime(Math.min(1_000, left));
    });
  }
}

/** Let the account's answer land. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

const slider = () => screen.queryByRole('slider', { name: 'Pace' }) as HTMLInputElement | null;

function setSlider(value: number) {
  const input = slider();
  if (!input) throw new Error('no pace slider on the card');
  fireEvent.change(input, { target: { value: String(value) } });
}

function card(id: string, cycles: number, onLog = vi.fn(), onDone = vi.fn()) {
  return render(<StepBreathing pattern={patternById(id)} cycles={cycles} onLog={onLog} onDone={onDone} />);
}

describe('StepBreathing pace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    registered.spec = null;
    api.get.mockReset();
    api.get.mockResolvedValue(null);
    api.save.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each([
    ['box', true],
    ['wind_down', true],
    ['coherent', true],
    ['extended_exhale', true],
    ['physiological_sigh', true],
    ['triangle', true],
    ['equal', true],
    ['alternate_nostril', true],
    ['up_shift', false], // quick on purpose and capped hardest
  ])('%s offers the slider: %s', (id, offered) => {
    card(id, 3);
    expect(slider() !== null).toBe(offered);
  });

  it('is smooth: the track moves in hundredths, not in stops', () => {
    card('box', 3);
    expect(slider()?.step).toBe('0.01');
    setSlider(1.37);
    expect(slider()?.value).toBe('1.37');
  });

  it('carries no words: the animals are the whole label on screen', () => {
    const { container } = card('box', 3);
    const row = slider()?.parentElement;
    expect(row?.textContent).toBe('');
    expect(row?.querySelectorAll('svg')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/quicker|slower|tempo/i);
  });

  it('a slower pace stretches the run: the same two rounds take twice as long', () => {
    const onLog = vi.fn();
    card('box', 2, onLog);
    setSlider(2);
    fireEvent.click(screen.getByText('Begin'));
    tick(PREROLL_MS);

    tick(33_000); // would have finished at a second a count
    expect(onLog).not.toHaveBeenCalled();

    tick(33_000); // 2 rounds × 16 counts × 2 s = 64 s
    expect(onLog).toHaveBeenCalledWith({ kind: 'breathing', roundsDone: 2, totalRounds: 2, pattern: 'box' });
  });

  it('tells the app-level clock the real length, so the end chime lands when the run ends', () => {
    card('box', 2);
    setSlider(1.5);
    fireEvent.click(screen.getByText('Begin'));
    tick(PREROLL_MS);
    expect(registered.spec?.targetSec).toBeCloseTo(2 * 16 * 1.5, 5);
  });

  it("the count on screen stays the pattern's own 4, each number just lasts longer", () => {
    card('box', 2);
    setSlider(2);
    fireEvent.click(screen.getByText('Begin'));
    tick(PREROLL_MS - 1_000); // the pre-roll's own last tick starts the run
    tick(200);
    expect(screen.getByText('In')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    tick(1_600); // 1.8 s in: still inside the first 2 s count
    expect(screen.getByText('4')).toBeTruthy();
    tick(600); // 2.4 s in: the second count
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('a run resumed after a relaunch picks up at the right place for its pace', () => {
    window.localStorage.setItem(BREATH_PACE_KEY, '2');
    render(
      <StepBreathing
        pattern={patternById('box')}
        cycles={2}
        resumeClock={{ startedAt: Date.now() - 10_000, base: 0 }}
        onLog={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    tick(100);
    // 10 s at 2 s a count is 5 counts: one into the first hold, not two whole phases on.
    expect(screen.getByText('Hold')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('touching the slider breathes the pattern to judge it by, and never logs or finishes', () => {
    const onLog = vi.fn();
    const onDone = vi.fn();
    card('box', 1, onLog, onDone);
    expect(screen.queryByText('In')).toBeNull();

    setSlider(0.75);
    tick(200);
    expect(screen.getByText('In')).toBeTruthy();

    tick(60_000); // far past a whole one-round step
    expect(onLog).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(registered.spec).toBeNull();
    expect(screen.getByText('Begin')).toBeTruthy();
  });

  it('tuning shows the per-phase cue a real run would, not the resting summary', () => {
    const sides = patternById('alternate_nostril');
    card('alternate_nostril', 2);
    expect(screen.getByText(sides.summary)).toBeTruthy();

    setSlider(1.1);
    tick(200);
    expect(screen.getByText('left side — right thumb closes the right')).toBeTruthy();
    expect(screen.queryByText(sides.summary)).toBeNull();
  });

  it('leaves the card when you begin, and tuning does not leak into the pre-roll', () => {
    card('box', 2);
    setSlider(1.5);
    fireEvent.click(screen.getByText('Begin'));
    expect(slider()).toBeNull();
    expect(screen.getByText('Get settled')).toBeTruthy();
  });

  it('the footnote minutes follow the pace', () => {
    card('box', 6);
    expect(screen.getByText(/about 2 min/)).toBeTruthy();
    setSlider(2);
    expect(screen.getByText(/about 3 min/)).toBeTruthy();
  });

  it('a tighter pattern plays narrower without overwriting what was set on box', () => {
    window.localStorage.setItem(BREATH_PACE_KEY, '1.8');
    card('wind_down', 2);
    expect(Number(slider()?.max)).toBeCloseTo(10 / 7, 5);
    expect(Number(slider()?.value)).toBeLessThanOrEqual(10 / 7);
    expect(window.localStorage.getItem(BREATH_PACE_KEY)).toBe('1.8');
  });

  it('a cached value that is not a number falls back to the default pace', () => {
    window.localStorage.setItem(BREATH_PACE_KEY, 'not a pace');
    card('box', 2);
    expect(slider()?.value).toBe('1');
  });
});

describe('StepBreathing pace on the account', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    registered.spec = null;
    api.get.mockReset();
    api.get.mockResolvedValue(null);
    api.save.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a new phone picks up the pace from the account, and keeps a copy', async () => {
    api.get.mockResolvedValue(1.62);
    card('box', 2);
    expect(slider()?.value).toBe('1'); // paints at once, before any network answer
    await settle();
    expect(slider()?.value).toBe('1.62');
    expect(window.localStorage.getItem(BREATH_PACE_KEY)).toBe('1.62');
  });

  it('an account with no pace leaves the copy on this phone alone', async () => {
    window.localStorage.setItem(BREATH_PACE_KEY, '1.4');
    card('box', 2);
    await settle();
    expect(slider()?.value).toBe('1.4');
  });

  it('a whole drag is one save, of where it settled', () => {
    card('box', 2);
    for (const value of [1.1, 1.2, 1.3, 1.45]) {
      setSlider(value);
      tick(100);
    }
    expect(api.save).not.toHaveBeenCalled();
    tick(1_000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save).toHaveBeenCalledWith(1.45);
  });

  it('leaving the card inside the save delay still saves', () => {
    const view = card('box', 2);
    setSlider(1.3);
    view.unmount();
    expect(api.save).toHaveBeenCalledWith(1.3);
  });

  it('opening the card and not touching the slider saves nothing', async () => {
    api.get.mockResolvedValue(1.5);
    const view = card('box', 2);
    await settle();
    tick(2_000);
    view.unmount();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('the account answering late never overrides a slider already being moved', async () => {
    let answer: (pace: number | null) => void = () => undefined;
    api.get.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    card('box', 2);
    setSlider(1.8);
    answer(1.2);
    await settle();
    expect(slider()?.value).toBe('1.8');
  });

  it('the account answering mid-run never changes the speed of the run', async () => {
    let answer: (pace: number | null) => void = () => undefined;
    api.get.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const onLog = vi.fn();
    card('box', 1, onLog);
    fireEvent.click(screen.getByText('Begin'));
    tick(PREROLL_MS);
    answer(2);
    await settle();
    expect(registered.spec?.targetSec).toBe(16); // still the pace the run began at
    tick(17_000);
    expect(onLog).toHaveBeenCalledWith({ kind: 'breathing', roundsDone: 1, totalRounds: 1, pattern: 'box' });
  });

  it('a failed sync never reaches the practice', async () => {
    api.get.mockResolvedValue(null);
    api.save.mockResolvedValue(false);
    const onLog = vi.fn();
    card('box', 1, onLog);
    await settle();
    setSlider(1.25);
    tick(1_000);
    fireEvent.click(screen.getByText('Begin'));
    tick(PREROLL_MS);
    tick(21_000); // 16 counts × 1.25 s
    expect(onLog).toHaveBeenCalledWith({ kind: 'breathing', roundsDone: 1, totalRounds: 1, pattern: 'box' });
  });
});
