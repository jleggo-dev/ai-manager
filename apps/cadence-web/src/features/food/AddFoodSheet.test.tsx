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
    expect(screen.queryByText("You'll come straight back here for the next one.")).toBeNull();
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
    expect(screen.getByText("You'll come straight back here for the next one.")).toBeInTheDocument();
    expect(screen.getByText('Breakfast · 3 things · not counted yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fewer servings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to breakfast' }));
    expect(onAdd).toHaveBeenCalledWith({ servingIndex: 0, quantity: 0.75 });
    expect(onLog).not.toHaveBeenCalled();
  });
});
