/**
 * Opening a logged food and repairing it — the surface the dill-pickle incident asked for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MealItemSheet } from './MealItemSheet.tsx';
import type { DiaryRow } from './foodDiaryRows.ts';

const correctMealItem = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api.ts', () => ({ correctMealItem }));

const peanuts: DiaryRow = {
  key: 'm1-0',
  logId: 'm1',
  index: 0,
  name: 'seasoned peanuts',
  brand: 'couchetard or K.',
  amount: '35.5 g',
  macros: { kcal: 210, protein_g: 9, fat_g: 18, sodium_mg: 225 },
};
const pickles: DiaryRow = { ...peanuts, key: 'm1-1', index: 1, name: 'dill pickles', brand: null, amount: null };

beforeEach(() => {
  correctMealItem.mockReset();
  correctMealItem.mockResolvedValue({ log_id: 'm1' });
});

describe('MealItemSheet', () => {
  it('shows what the food contributed, sodium named as the one to stay under', () => {
    render(<MealItemSheet row={peanuts} siblings={[]} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.getByText('225 mg')).toBeInTheDocument();
    expect(screen.getByText('one to stay under')).toBeInTheDocument();
  });

  it('shows the vendor, which no other screen ever has', () => {
    render(<MealItemSheet row={peanuts} siblings={[]} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(/couchetard or K\./)).toBeInTheDocument();
  });

  it('renames without touching the numbers', async () => {
    const user = userEvent.setup();
    render(<MealItemSheet row={peanuts} siblings={[]} onClose={() => {}} onChanged={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Fix the name' }));

    const field = screen.getByLabelText('What this food was');
    await user.clear(field);
    await user.type(field, 'Dill Pickle Peanuts');
    await user.click(screen.getByRole('button', { name: 'Save the name' }));

    await waitFor(() =>
      expect(correctMealItem).toHaveBeenCalledWith('m1', {
        op: 'rename',
        index: 0,
        name: 'Dill Pickle Peanuts',
        brand: 'couchetard or K.',
      }),
    );
  });

  it('offers a merge only when there is something to merge into', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MealItemSheet row={peanuts} siblings={[]} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Same as another item' })).toBeNull();

    rerender(<MealItemSheet row={pickles} siblings={[peanuts, pickles]} onClose={() => {}} onChanged={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Same as another item' }));
    await user.click(screen.getByRole('button', { name: 'seasoned peanuts' }));

    await waitFor(() => expect(correctMealItem).toHaveBeenCalledWith('m1', { op: 'merge', index: 1, into: 0 }));
  });

  it('takes an item off when it was never eaten', async () => {
    const user = userEvent.setup();
    render(<MealItemSheet row={pickles} siblings={[]} onClose={() => {}} onChanged={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'I didn’t eat this' }));
    await user.click(screen.getByRole('button', { name: /Take .* off/ }));

    await waitFor(() => expect(correctMealItem).toHaveBeenCalledWith('m1', { op: 'drop', index: 1 }));
  });

  it('says the blank is ours, not the food’s, and points at the fix', () => {
    render(<MealItemSheet row={{ ...peanuts, macros: null }} siblings={[]} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(/don’t hold nutrition for this one yet/)).toBeInTheDocument();
  });

  it('offers no repairs for a meal with no addressable item', () => {
    // index null: read it, but there is nothing to rename or drop.
    render(<MealItemSheet row={{ ...peanuts, index: null }} siblings={[]} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Fix the name' })).toBeNull();
  });

  it('signals a change without a payload, so an emptied meal cannot be held onto', async () => {
    // Dropping the LAST item removes the whole meal server-side. A caller that patched its own
    // state from a returned row would be holding a meal that no longer exists — so the signal
    // carries nothing and the owner of the day re-reads.
    const user = userEvent.setup();
    correctMealItem.mockResolvedValue({ meal_removed: true });
    const onChanged = vi.fn();
    render(<MealItemSheet row={pickles} siblings={[]} onClose={() => {}} onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: 'I didn’t eat this' }));
    await user.click(screen.getByRole('button', { name: /Take .* off/ }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith());
  });

  it('leaves the meal unchanged and says so when the save fails', async () => {
    const user = userEvent.setup();
    correctMealItem.mockResolvedValue(null);
    const onChanged = vi.fn();
    render(<MealItemSheet row={pickles} siblings={[]} onClose={() => {}} onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: 'I didn’t eat this' }));
    await user.click(screen.getByRole('button', { name: /Take .* off/ }));

    expect(await screen.findByText(/Your meal is unchanged/)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
