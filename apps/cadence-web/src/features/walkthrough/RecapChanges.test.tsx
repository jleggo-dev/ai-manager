/**
 * "You changed N things" at the Recap (walkthrough v3 Phase 6c, R5): one row per change with its
 * own Every time / Just today. Every time writes ONCE through the one route and then shows the
 * sentence as a fact; Just today writes nothing; a row the server refused says so and offers
 * again; with no plan task behind the run there is nothing to write to, so only Just today shows.
 * Nothing is written without a tap.
 */
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { StructureChange } from '@cadence/shared';

const keepHowTo = vi.fn();
vi.mock('../../lib/api.ts', () => ({ keepHowTo: (...a: unknown[]) => keepHowTo(...a) }));

const { RecapChanges } = await import('./RecapChanges.tsx');

const CHANGES: StructureChange[] = [
  {
    kind: 'alternate',
    key: 'alternate:s3+s4',
    words: 'Bench press + dumbbell row, alternating',
    sentence: 'alternate bench press and dumbbell row',
    pills: ['Bench', 'Row', 'Bench', 'Row'],
    rounds: 3,
  },
  { kind: 'spread', key: 'spread:s5', words: 'Dead hang, one set at a time', sentence: 'dead hang one set at a time' },
  { kind: 'swap', key: 'swap:s7', words: 'Glute bridge → hip thrust', sentence: 'hip thrust instead of glute bridge' },
];

beforeEach(() => {
  keepHowTo.mockReset();
  keepHowTo.mockResolvedValue({
    ok: true,
    kept: true,
    how_to: 'alternate bench press and dumbbell row',
    activity: 'Obstacle strength',
  });
});
afterEach(cleanup);

describe('RecapChanges', () => {
  it('lists each change as a fact with its pills, and a pair of buttons each', () => {
    render(<RecapChanges changes={CHANGES} occurrenceId="o1" />);
    expect(screen.getByText('You changed 3 things')).toBeInTheDocument();
    expect(screen.getByText('Bench press + dumbbell row, alternating')).toBeInTheDocument();
    expect(screen.getAllByText(/^(Bench|Row)$/)).toHaveLength(4);
    expect(screen.getByText('· 3 rounds')).toBeInTheDocument();
    expect(screen.getByText('Glute bridge → hip thrust')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Every time' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Just today' })).toHaveLength(3);
    expect(keepHowTo).not.toHaveBeenCalled();
  });

  it('one change reads "thing"; none draws nothing', () => {
    render(<RecapChanges changes={[CHANGES[1]!]} occurrenceId="o1" />);
    expect(screen.getByText('You changed 1 thing')).toBeInTheDocument();
    cleanup();
    render(<RecapChanges changes={[]} occurrenceId="o1" />);
    expect(screen.queryByText(/You changed/)).toBeNull();
  });

  it('Every time writes that change’s sentence once and shows it as a fact; the other rows keep their buttons', async () => {
    render(<RecapChanges changes={CHANGES} occurrenceId="o1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Every time' })[0]!);
    await waitFor(() =>
      expect(screen.getByText('Every time · alternate bench press and dumbbell row')).toBeInTheDocument(),
    );
    expect(keepHowTo).toHaveBeenCalledTimes(1);
    expect(keepHowTo).toHaveBeenCalledWith('o1', 'alternate bench press and dumbbell row');
    expect(screen.getAllByRole('button', { name: 'Every time' })).toHaveLength(2);
  });

  it('Just today writes nothing and says so', () => {
    render(<RecapChanges changes={CHANGES} occurrenceId="o1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Just today' })[1]!);
    expect(screen.getByText('Just today', { selector: 'div' })).toBeInTheDocument();
    expect(keepHowTo).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Every time' })).toHaveLength(2);
  });

  it('a write the server refused says so and offers the buttons again', async () => {
    keepHowTo.mockResolvedValue({ ok: false, reason: 'full' });
    render(<RecapChanges changes={[CHANGES[1]!]} occurrenceId="o1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Every time' }));
    await waitFor(() => expect(screen.getByText(/Didn.t take/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Every time' })).toBeInTheDocument();
  });

  it('with no plan task behind the run, only Just today is offered', () => {
    render(<RecapChanges changes={CHANGES} />);
    expect(screen.queryByRole('button', { name: 'Every time' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Just today' })).toHaveLength(3);
  });
});
