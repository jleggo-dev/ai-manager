/**
 * A rearranged group playing one turn at a time (walkthrough v3 Phase 6, design board "Playing an
 * alternated pair"): the eyebrow and the chips per turn, the reps dial logging THIS turn by its
 * key, the timed set for a held move, Change on the turn's own step, and the hand-off after the
 * last turn. A set on its own plays the same screen without the eyebrow or the chips.
 */
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  type PlayedStep,
  type TurnLogs,
  type WalkthroughStep,
  applyShape,
  combine,
  defaultShape,
  moveTurnOut,
} from '@cadence/shared';
import { StepGroup } from './StepGroup.tsx';

vi.mock('./chime.ts', () => ({ playChime: vi.fn(), playTones: vi.fn(), unlockAudio: vi.fn(), CHIME_SWITCH: [] }));

const steps: WalkthroughStep[] = [
  {
    id: 's1',
    title: 'Bench press',
    body: 'Feet flat.',
    video_query: 'bench press form',
    minutes: 9,
    tool: { kind: 'reps', sets: 3, reps: 8, load: '95 lb' },
    skippable: true,
  },
  {
    id: 's2',
    title: 'Dumbbell row',
    minutes: 9,
    tool: { kind: 'reps', sets: 3, reps: 10, load: '40 lb' },
    skippable: true,
  },
  { id: 's3', title: 'Dead hang', minutes: 3, tool: { kind: 'timer', seconds: 45, sets: 3 }, skippable: true },
];
const stepOf = (id: string) => steps.find((s) => s.id === id);
const pair = (): PlayedStep => applyShape(steps, combine(defaultShape(steps), 'g1', 'g2', 'alternate'))[0]!;
const hang = (): PlayedStep => applyShape(steps, moveTurnOut(defaultShape(steps), 'g3', 0, 0))[0]!;

function mount(step: PlayedStep, turnLogs: TurnLogs = {}, extra: Partial<Parameters<typeof StepGroup>[0]> = {}) {
  const onLogTurn = vi.fn();
  const onAdvance = vi.fn();
  const onChange = vi.fn();
  render(
    <StepGroup
      step={step}
      stepOf={stepOf}
      workingLoads={{}}
      turnLogs={turnLogs}
      onLogTurn={onLogTurn}
      onAdvance={onAdvance}
      onChange={onChange}
      {...extra}
    />,
  );
  return { onLogTurn, onAdvance, onChange };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the eyebrow and the chips per turn', () => {
  it.each([
    ['nothing logged: bench R1', {}, 'Circuit · Round 1 of 3 · bench + row', 'Bench press', '8 × 95 lb', 'Bench R1'],
    [
      'one turn logged: row R1',
      { 's1:0': { value: 8 } },
      'Circuit · Round 1 of 3 · bench + row',
      'Dumbbell row',
      '10 × 40 lb',
      'Row R1',
    ],
    [
      'a round logged: bench R2',
      { 's1:0': { value: 8 }, 's2:0': { value: 10 } },
      'Circuit · Round 2 of 3 · bench + row',
      'Bench press',
      '8 × 95 lb',
      'Bench R2',
    ],
    [
      'everything logged stays on the last turn',
      Object.fromEntries(['s1:0', 's2:0', 's1:1', 's2:1', 's1:2', 's2:2'].map((k) => [k, { value: 1 }])),
      'Circuit · Round 3 of 3 · bench + row',
      'Dumbbell row',
      '10 × 40 lb',
      'Row R3',
    ],
  ] as const)('%s', (_n, logs, eyebrow, title, target, current) => {
    mount(pair(), logs as TurnLogs);
    expect(screen.getByText(eyebrow)).toBeInTheDocument();
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(target)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: current })).toHaveAttribute('aria-current', 'step');
    expect(screen.getAllByRole('button', { name: /^(Bench|Row) R\d$/ })).toHaveLength(6);
  });

  it('a set on its own has no eyebrow and no chips, and plays the timed set', () => {
    mount(hang());
    expect(screen.queryByText(/Circuit ·/)).toBeNull();
    expect(screen.queryByRole('button', { name: /R1$/ })).toBeNull();
    expect(screen.getByText('Dead hang')).toBeInTheDocument();
    expect(screen.getByText('45 s')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
});

describe('logging a turn', () => {
  it('Log writes THIS turn by its key with the reps on the dial, then moves to the next chip', () => {
    const { onLogTurn, onAdvance } = mount(pair());
    fireEvent.click(screen.getByLabelText('one fewer rep'));
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    expect(onLogTurn).toHaveBeenCalledWith({ stepId: 's1', set: 0 }, { value: 7, load: '95 lb' });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('the working load rides into the turn log', () => {
    const { onLogTurn } = mount(pair(), {}, { workingLoads: { s1: '100 lb' } });
    expect(screen.getByText('8 × 100 lb')).toBeInTheDocument();
    expect(screen.getByText('reps · 100 lb')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    expect(onLogTurn).toHaveBeenCalledWith({ stepId: 's1', set: 0 }, { value: 8, load: '100 lb' });
  });

  it('logging the last turn hands off after a beat', () => {
    const all = Object.fromEntries(['s1:0', 's2:0', 's1:1', 's2:1', 's1:2'].map((k) => [k, { value: 1 }]));
    const { onAdvance } = mount(pair(), all);
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('a chip tap reopens a logged turn; Save rewrites it', () => {
    const { onLogTurn } = mount(pair(), { 's1:0': { value: 8 } });
    fireEvent.click(screen.getByRole('button', { name: 'Bench R1' }));
    expect(screen.getByText('Bench press')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('one more rep'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onLogTurn).toHaveBeenCalledWith({ stepId: 's1', set: 0 }, { value: 9, load: '95 lb' });
  });

  it('a timed turn logs its seconds through Stop then Log', () => {
    const { onLogTurn } = mount(hang());
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    expect(onLogTurn).toHaveBeenCalledWith({ stepId: 's3', set: 0 }, { value: 10 });
  });

  it('Change opens for the turn’s own step, and Form links its video', () => {
    const { onChange } = mount(pair());
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onChange).toHaveBeenCalledWith('s1');
    expect(screen.getByText('Form')).toBeInTheDocument();
    expect(screen.getByText('Feet flat.')).toBeInTheDocument();
  });
});
