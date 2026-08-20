/**
 * Where should it sit? (design 06). What these pin:
 *   • the thing is COUNTED before the question is asked — the choice only changes how the day
 *     reads back, and the copy says so;
 *   • folding it in writes the meal kind; leaving it alone leaves it a snack;
 *   • with nothing on the day to join, there is no question and nothing renders.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Meal } from '../../lib/api.ts';

const invalidate = vi.fn();
vi.mock('../../lib/query/index.ts', () => ({
  useInvalidateNutritionDay: () => invalidate,
  localTodayIso: () => '2026-08-20',
}));

const api = vi.hoisted(() => ({ patchMeal: vi.fn(async () => ({})) }));
vi.mock('../../lib/api.ts', () => api);

const { MealSlotChoice } = await import('./MealSlotChoice.tsx');

const latte: Meal = {
  log_id: 'c',
  date: '2026-08-20',
  meal: 'drink',
  items: [{ name: 'Oat latte, medium' }],
  macros: { kcal: 190 },
};
const breakfast: Meal = {
  log_id: 'b',
  date: '2026-08-20',
  meal: 'breakfast',
  items: [{ name: 'Greek yogurt' }, { name: 'Blueberries' }, { name: 'Granola' }],
  macros: { kcal: 510 },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MealSlotChoice', () => {
  it('says it is already counted, and offers the day’s open meal', () => {
    render(<MealSlotChoice logged={latte} meals={[latte, breakfast]} onDone={() => {}} />);
    expect(screen.getByText('COUNTED')).toBeInTheDocument();
    expect(screen.getByText('With breakfast')).toBeInTheDocument();
    expect(screen.getByText('3 things so far · 510 kcal')).toBeInTheDocument();
    expect(screen.getByText(/already counted either way/)).toBeInTheDocument();
  });

  it('folds it into that meal', async () => {
    const onDone = vi.fn();
    render(<MealSlotChoice logged={latte} meals={[latte, breakfast]} onDone={onDone} />);
    fireEvent.click(screen.getByText('Done'));
    await waitFor(() => expect(api.patchMeal).toHaveBeenCalledWith('c', { meal: 'breakfast' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('leaves it on its own as a snack', async () => {
    render(<MealSlotChoice logged={latte} meals={[latte, breakfast]} onDone={() => {}} />);
    fireEvent.click(screen.getByText('On its own'));
    fireEvent.click(screen.getByText('Done'));
    await waitFor(() => expect(api.patchMeal).toHaveBeenCalledWith('c', { meal: 'snack' }));
  });

  it('asks nothing when there is nothing to join', () => {
    const { container } = render(<MealSlotChoice logged={latte} meals={[latte]} onDone={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
