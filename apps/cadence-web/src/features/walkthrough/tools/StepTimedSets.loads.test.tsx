/**
 * Load per set on the timed-sets tool (walkthrough v3 Phase 5a): a set logged while a working load
 * is on carries it; without one the log is what it always was.
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StepTimedSets } from './StepTimedSets.tsx';

vi.mock('./chime.ts', () => ({
  playChime: vi.fn(),
  playTones: vi.fn(),
  unlockAudio: vi.fn(),
  CHIME_SWITCH: [880, 660, 880],
}));

const press = (label: string | RegExp) => fireEvent.click(screen.getByRole('button', { name: label }));

describe('StepTimedSets — loads', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const runOneSet = () => {
    press('Start');
    act(() => {
      vi.advanceTimersByTime(45_000);
    });
    press('Stop');
    press('Log');
  };

  it('no weight in play: the log has no loads key', () => {
    const onLog = vi.fn();
    render(<StepTimedSets seconds={45} sets={3} load="40 lb" chime={false} onLog={onLog} />);
    runOneSet();
    expect(onLog).toHaveBeenCalledWith({ kind: 'timed_sets', sets: [45], targetSec: 45, load: '40 lb' });
  });

  it("a working load is written to the set logged; earlier sets get the plan's; the chips show each", () => {
    const onLog = vi.fn();
    render(
      <StepTimedSets
        seconds={45}
        sets={3}
        load="40 lb"
        workingLoad="50 lb"
        chime={false}
        log={{ kind: 'timed_sets', sets: [45], targetSec: 45, load: '40 lb' }}
        onLog={onLog}
      />,
    );
    expect(screen.getAllByText(/^Set [123]$/).map((el) => el.parentElement!.textContent)).toEqual([
      '45 s40 lbSet 1',
      '·50 lbSet 2',
      '—Set 3',
    ]);
    runOneSet();
    expect(onLog).toHaveBeenCalledWith({
      kind: 'timed_sets',
      sets: [45, 45],
      targetSec: 45,
      load: '40 lb',
      loads: ['40 lb', '50 lb'],
    });
  });
});
