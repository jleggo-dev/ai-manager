/**
 * The add-food sheet's two lives (meal-logging rework): the legacy `log` mode keeps writing a
 * meal exactly as before — every existing caller rides on default props — while `draft` mode
 * reprices the same sheet for the open meal: "Add to breakfast", no slot question, the strip
 * underneath, and the portion handed back through `onAdd`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Food } from '@cadence/shared';
import { AddFoodSheet } from './AddFoodSheet.tsx';

const strawberries: Food = {
  food_id: 'f-straw',
  owner_user_id: null,
  visibility: 'private',
  name: 'Strawberries, raw',
  brand: null,
  source: 'cnf',
  off_id: null,
  fdc_id: null,
  base_unit: 'g',
  macros_per_base: { kcal: 0.32, protein_g: 0.007, carbs_g: 0.08, fat_g: 0.003 },
  servings: [
    { label: '1 cup, halves', unit: 'cup', amount_g: 152 },
    { label: '100 g', unit: 'g', amount_g: 100 },
  ],
  default_serving: 0,
  confidence: null,
  photo_ref: null,
};

beforeEach(cleanup);

describe('log mode (the legacy callers)', () => {
  it('keeps the Log button, the meal question, and the onLog shape', () => {
    const onLog = vi.fn();
    render(<AddFoodSheet food={strawberries} meal="lunch" onLog={onLog} onBack={() => {}} />);
    expect(screen.getByLabelText('Meal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More servings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    expect(onLog).toHaveBeenCalledWith({ servingIndex: 0, quantity: 1.25, meal: 'lunch' });
  });
});

describe('draft mode (the sheet · add and stay)', () => {
  it('says "Add to breakfast", drops the slot question, and hands the portion to onAdd', () => {
    const onAdd = vi.fn();
    const onLog = vi.fn();
    render(
      <AddFoodSheet
        food={strawberries}
        meal="breakfast"
        mode="draft"
        mealLabel="breakfast"
        onAdd={onAdd}
        onLog={onLog}
        onBack={() => {}}
        strip={<div>Breakfast · 3 things · not counted yet</div>}
      />,
    );
    // The draft owns the slot — no meal question here.
    expect(screen.queryByLabelText('Meal')).toBeNull();
    // No "you'll come straight back" line — the button says what happens (owner, 2026-10-31).
    expect(screen.queryByText(/come straight back/)).toBeNull();
    expect(screen.getByText('Breakfast · 3 things · not counted yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fewer servings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to breakfast' }));
    expect(onAdd).toHaveBeenCalledWith({ servingIndex: 0, quantity: 0.75 });
    expect(onLog).not.toHaveBeenCalled();
  });
});

describe('what the sheet shows', () => {
  it('names a branded food with its brand in front — "Gatorade Lemon-lime", not "Lemon-lime"', () => {
    const gatorade: Food = {
      ...strawberries,
      food_id: 'f-gat',
      name: 'Lemon-lime',
      brand: 'Gatorade',
      source: 'fatsecret',
    };
    render(
      <AddFoodSheet
        food={gatorade}
        meal="breakfast"
        mode="draft"
        mealLabel="breakfast"
        onAdd={() => {}}
        onLog={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText('Gatorade Lemon-lime')).toBeInTheDocument();
  });

  it('puts the add button in the footer, not the header', () => {
    const { container } = render(
      <AddFoodSheet
        food={strawberries}
        meal="breakfast"
        mode="draft"
        mealLabel="breakfast"
        onAdd={() => {}}
        onLog={() => {}}
        onBack={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Add to breakfast' });
    expect(btn.closest('.fd-foot')).not.toBeNull();
    expect(container.querySelector('.fd-head')?.contains(btn)).toBe(false);
  });
});
