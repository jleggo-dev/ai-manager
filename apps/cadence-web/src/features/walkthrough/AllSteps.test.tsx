/**
 * The All-steps sheet draws groups of sets (walkthrough v3 Phase 6, design board "All steps"):
 * one row per group, one pill per set, the row you are on amber and "here now", a done row's
 * pills green with what was logged, a combined group with Split, and Rearrange in the header.
 * Tapping a row still only jumps.
 */
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  type PlayedShape,
  type WalkthroughStep,
  applyShape,
  combine,
  defaultShape,
  moveTurnOut,
  normalizeShape,
} from '@cadence/shared';
import { AllSteps } from './AllSteps.tsx';
import type { StepLogs } from './state.ts';

const steps: WalkthroughStep[] = [
  { id: 's1', title: 'Warm-up', minutes: 6, tool: { kind: 'read' }, skippable: true },
  { id: 's2', title: 'Pull-ups', minutes: 6, tool: { kind: 'reps', sets: 3, reps: 5 }, skippable: true },
  { id: 's3', title: 'Bench press', minutes: 9, tool: { kind: 'reps', sets: 3, reps: 8 }, skippable: true },
  { id: 's4', title: 'Dumbbell row', minutes: 9, tool: { kind: 'reps', sets: 3, reps: 10 }, skippable: true },
  { id: 's5', title: 'Dead hang', minutes: 3, tool: { kind: 'timer', seconds: 45, sets: 3 }, skippable: true },
];
const stepOf = (id: string) => steps.find((s) => s.id === id);

function mount(shape: PlayedShape, logs: StepLogs = {}, idx = 1, extra: Partial<Parameters<typeof AllSteps>[0]> = {}) {
  const groups = normalizeShape(shape, steps);
  const played = applyShape(steps, groups);
  const onJump = vi.fn();
  const onRearrange = vi.fn();
  const onSplit = vi.fn();
  render(
    <AllSteps
      steps={played}
      shape={groups}
      stepOf={stepOf}
      logs={logs}
      idx={idx}
      visited={new Set([0, idx])}
      onClose={() => {}}
      onJump={onJump}
      onReview={() => {}}
      onRearrange={onRearrange}
      onSplit={onSplit}
      {...extra}
    />,
  );
  return { onJump, onRearrange, onSplit, played };
}
const row = (title: string) => within(screen.getByText(title).closest('[data-row]') as HTMLElement);

afterEach(cleanup);

describe('All steps — rows per shape', () => {
  it.each<[string, () => PlayedShape, string[]]>([
    ['as prescribed', () => defaultShape(steps), ['Warm-up', 'Pull-ups', 'Bench press', 'Dumbbell row', 'Dead hang']],
    [
      'presses and rows alternating',
      () => combine(defaultShape(steps), 'g3', 'g4', 'alternate'),
      ['Warm-up', 'Pull-ups', 'Bench press + dumbbell row', 'Dead hang'],
    ],
    [
      'the hangs spread',
      () => moveTurnOut(moveTurnOut(defaultShape(steps), 'g5', 0, 1), 'g5', 0, 4),
      ['Warm-up', 'Dead hang', 'Pull-ups', 'Bench press', 'Dead hang', 'Dumbbell row', 'Dead hang'],
    ],
  ])('%s', (_n, shape, titles) => {
    mount(shape());
    const sheet = within(screen.getByRole('dialog', { name: 'All steps' }));
    expect(
      sheet
        .getAllByText(/^(Warm-up|Pull-ups|Bench press|Dumbbell row|Dead hang|Bench press \+ dumbbell row)$/)
        .map((el) => el.textContent),
    ).toEqual(titles);
    expect(
      sheet.getByText(
        `${titles.length} STEPS · 29 MIN LEFT`.replace('29', String(expectedLeft(shape(), titles.length))),
      ),
    ).toBeInTheDocument();
  });

  it('pills: a set each; a combined group’s pills by short name; meta counts sets', () => {
    mount(combine(defaultShape(steps), 'g3', 'g4', 'alternate'), {}, 0);
    expect(row('Pull-ups').getAllByText('Pull-up 5')).toHaveLength(3);
    expect(row('Pull-ups').getByText('3 sets')).toBeInTheDocument();
    const pair = row('Bench press + dumbbell row');
    expect(pair.getAllByText(/^(Bench|Row)$/).map((el) => el.textContent)).toEqual([
      'Bench',
      'Row',
      'Bench',
      'Row',
      'Bench',
      'Row',
    ]);
    expect(pair.getByText('6 sets')).toBeInTheDocument();
    expect(pair.getByRole('button', { name: 'Split' })).toBeInTheDocument();
    expect(row('Dead hang').getAllByText('Hang 45 s')).toHaveLength(3);
  });

  it('the row you are on reads "here now"; a done row reads "done" with green pills; a logged set shows its number', () => {
    mount(defaultShape(steps), { s1: { kind: 'done' }, s2: { kind: 'reps', sets: [5, 4], target: 5 } }, 2);
    expect(row('Warm-up').getByText('done')).toBeInTheDocument();
    expect(row('Warm-up').getByText('✓ 6 min')).toBeInTheDocument();
    expect(row('Bench press').getByText('here now')).toBeInTheDocument();
    expect(row('Pull-ups').getByText('✓ 5')).toBeInTheDocument();
    expect(row('Pull-ups').getByText('✓ 4')).toBeInTheDocument();
    expect(row('Pull-ups').getByText('Pull-up 5')).toBeInTheDocument(); // the third, not yet
  });

  it('a combined group’s logged turns show in its pills', () => {
    const shape = combine(defaultShape(steps), 'g3', 'g4', 'alternate');
    const logs: StepLogs = {
      g6: {
        kind: 'group',
        mode: 'alternate',
        turns: { 's3:0': { value: 8 }, 's4:0': { value: 10 } },
        done: { turns: 2, rounds: 1 },
        total: { turns: 6, rounds: 3 },
      },
    };
    mount(shape, logs);
    const pair = row('Bench press + dumbbell row');
    expect(pair.getByText('✓ 8')).toBeInTheDocument();
    expect(pair.getByText('✓ 10')).toBeInTheDocument();
    expect(pair.getAllByText('Bench')).toHaveLength(2);
  });

  it('Rearrange opens the sheet; Split splits that group; tapping a row jumps and nothing else', () => {
    const { onJump, onRearrange, onSplit } = mount(combine(defaultShape(steps), 'g3', 'g4', 'alternate'));
    fireEvent.click(screen.getByRole('button', { name: 'Rearrange' }));
    expect(onRearrange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    expect(onSplit).toHaveBeenCalledWith('g6');
    expect(onJump).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Dead hang'));
    expect(onJump).toHaveBeenCalledWith(3);
  });

  it('draws no line explaining the UI and marks nothing "moved"', () => {
    mount(moveTurnOut(defaultShape(steps), 'g5', 0, 1));
    expect(screen.queryByText(/moved/i)).toBeNull();
    expect(screen.queryByText(/tap|looking around/i)).toBeNull();
  });
});

function expectedLeft(shape: PlayedShape, n: number): number {
  const played = applyShape(steps, normalizeShape(shape, steps));
  return played.reduce((m, s, i) => (i !== 1 && i !== 0 ? m + s.minutes : m), 0) + (n ? 0 : 0);
}
