/**
 * Repairing an item on the confirm card — brief 03, the last free moment.
 *
 * After the log, a food nothing matched is PINNED as a permanent private row, so a wrong name
 * stops being one bad meal and becomes one that resolves again tomorrow. These are the same two
 * moves the logged-meal sheet offers, arriving one step earlier and costing nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MealItemEdit } from './MealItemEdit.tsx';
import type { AmountRow } from './useMealAmounts.ts';

const peanuts: AmountRow = {
  name: 'seasoned peanuts',
  brand: 'couchetard or K.',
  matched: false,
  qty: 35.5,
  unit: 'g',
  est: { kcal: 210, protein_g: 9, fat_g: 18, sodium_mg: 225 },
  source: 'given',
  baseQty: 35.5,
};
const pickles: AmountRow = { ...peanuts, name: 'dill pickles', est: { kcal: 5, sodium_mg: 450 } };

describe('MealItemEdit', () => {
  it('renames and carries the vendor, saying plainly that the numbers stay', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <MealItemEdit row={peanuts} index={0} siblings={[]} onRename={onRename} onMerge={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/numbers stay as they are/)).toBeInTheDocument();

    const field = screen.getByLabelText('What seasoned peanuts really was');
    await user.clear(field);
    await user.type(field, 'Dill Pickle Peanuts');
    await user.click(screen.getByRole('button', { name: 'That’s it' }));

    expect(onRename).toHaveBeenCalledWith(0, 'Dill Pickle Peanuts', 'couchetard or K.');
  });

  it('offers a merge only when there is another row to merge into', async () => {
    const user = userEvent.setup();
    const onMerge = vi.fn();
    const { rerender } = render(
      <MealItemEdit row={pickles} index={1} siblings={[]} onRename={vi.fn()} onMerge={onMerge} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Same as another' })).toBeNull();

    rerender(
      <MealItemEdit
        row={pickles}
        index={1}
        siblings={[{ row: peanuts, index: 0 }]}
        onRename={vi.fn()}
        onMerge={onMerge}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Same as another' }));
    await user.click(screen.getByRole('button', { name: 'seasoned peanuts' }));
    expect(onMerge).toHaveBeenCalledWith(1, 0);
  });

  it('will not save a blank name', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <MealItemEdit row={peanuts} index={0} siblings={[]} onRename={onRename} onMerge={vi.fn()} onClose={vi.fn()} />,
    );
    await user.clear(screen.getByLabelText('What seasoned peanuts really was'));
    expect(screen.getByRole('button', { name: 'That’s it' })).toBeDisabled();
  });
});
