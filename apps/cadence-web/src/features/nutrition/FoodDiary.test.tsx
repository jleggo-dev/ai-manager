/**
 * The diary reads the bracket (rework P6, canvas A4): a parts meal collapses to one row and
 * expands in place to correction-addressable rows; the legacy recipe_id shape reads the same way
 * without a data change; grouping the past goes through editMealParts and never moves a number.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoodDiary } from './FoodDiary.tsx';
import type { Meal, NutritionDayData } from '../../lib/api.ts';

const editMealParts = vi.hoisted(() => vi.fn());
const correctMealItem = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api.ts', () => ({ editMealParts, correctMealItem }));

const wideMeal = (over: object): Meal =>
  ({ log_id: 'm1', date: '2026-09-02', meal: 'breakfast', items: [], ...over }) as Meal;

const dayOf = (meals: Meal[]): NutritionDayData => ({
  date: '2026-09-02',
  meals,
  totals: {},
  provisional_totals: {},
  confirmed_count: meals.length,
  provisional_count: 0,
  targets: null,
  left: null,
  burn_kcal: 0,
  eatback_kcal: 0,
  eatback_pct: 50,
});

const chiaBowlMeal = wideMeal({
  items: [
    { name: 'yogurt', qty: 150, unit: 'g', est: { kcal: 100 }, part: 'p1' },
    { name: 'chia', est: { kcal: 120 }, part: 'p1' },
    { name: 'whey', est: { kcal: 80 }, part: 'p1' },
    { name: 'strawberries', est: { kcal: 48 }, part: 'p1' },
    { name: 'chocolate chip muffin', qty: 1, unit: 'muffin', est: { kcal: 430 } },
  ],
  parts: [{ key: 'p1', name: 'Chia bowl', source: 'user' }],
  macros: { kcal: 778 },
});

function renderDiary(day: NutritionDayData, onCorrected?: () => void) {
  return render(
    <FoodDiary
      day={day}
      confirming={null}
      onConfirm={() => {}}
      onLog={() => {}}
      {...(onCorrected ? { onCorrected } : {})}
    />,
  );
}

beforeEach(() => {
  editMealParts.mockReset();
  editMealParts.mockResolvedValue({ log_id: 'm1' });
  correctMealItem.mockReset();
});

describe('FoodDiary parts rendering', () => {
  it('collapses a bracket to one row and expands it to correction-addressable rows', async () => {
    const user = userEvent.setup();
    renderDiary(dayOf([chiaBowlMeal]));
    await user.click(screen.getByRole('button', { name: /Breakfast —/ }));

    // Collapsed: the name, the count, the part kcal — and no member rows yet. The loose muffin
    // is untouched.
    expect(screen.getByText('Chia bowl')).toBeInTheDocument();
    expect(screen.getByText('4 things')).toBeInTheDocument();
    expect(screen.getByText('348')).toBeInTheDocument();
    expect(screen.queryByText('yogurt')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /chocolate chip muffin — open/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Chia bowl — 4 things/ }));
    for (const name of ['yogurt', 'chia', 'whey', 'strawberries']) {
      expect(screen.getByRole('button', { name: `${name} — open to see what it contributed` })).toBeInTheDocument();
    }

    // A member row still opens MealItemSheet — the logId+index address survived the bracket.
    await user.click(screen.getByRole('button', { name: /yogurt — open/ }));
    expect(screen.getByRole('dialog', { name: 'yogurt' })).toBeInTheDocument();
  });

  it('reads a logged portion of a batch as "1 of 4 servings" on the same mark', async () => {
    const user = userEvent.setup();
    const stew = wideMeal({
      meal: 'lunch',
      items: [
        { name: 'chickpeas', est: { kcal: 80 }, part: 'p1' },
        { name: 'spinach', est: { kcal: 45 }, part: 'p1' },
      ],
      parts: [{ key: 'p1', name: 'Chickpea & spinach stew', yield_servings: 4, servings_logged: 1, source: 'user' }],
      macros: { kcal: 125 },
    });
    renderDiary(dayOf([stew]));
    await user.click(screen.getByRole('button', { name: /Lunch —/ }));
    expect(screen.getByText('1 of 4 servings')).toBeInTheDocument();
  });

  it('adapts a legacy recipe_id log to one bracket row, reader-side only', async () => {
    const user = userEvent.setup();
    const legacy = wideMeal({
      recipe_id: 'r9',
      items: [
        { name: 'Chia bowl', qty: 1, unit: 'serving', est: { kcal: 348 } },
        { name: 'yogurt', food_id: 'f1' },
        { name: 'chia', food_id: 'f2' },
      ],
      macros: { kcal: 348 },
    });
    renderDiary(dayOf([legacy]));
    await user.click(screen.getByRole('button', { name: /Breakfast —/ }));

    expect(screen.getByText('3 things')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Chia bowl — 3 things/ }));
    // The flat rows come back with their original indexes — corrections still land.
    await user.click(screen.getByRole('button', { name: /Chia bowl — open to see/ }));
    expect(screen.getByRole('dialog', { name: 'Chia bowl' })).toBeInTheDocument();
  });

  it('says OPEN on a slot whose meal is still open', () => {
    renderDiary(
      dayOf([wideMeal({ state: 'open', items: [{ name: 'latte', est: { kcal: 120 } }], macros: { kcal: 120 } })]),
    );
    expect(screen.getByText('OPEN')).toBeInTheDocument();
  });
});

describe('grouping the past', () => {
  const flat = wideMeal({
    items: [
      { name: 'yogurt', qty: 150, unit: 'g', est: { kcal: 100 } },
      { name: 'chia', est: { kcal: 120 } },
      { name: 'chocolate chip muffin', est: { kcal: 430 } },
    ],
    macros: { kcal: 650 },
  });
  const grouped = wideMeal({
    items: [
      { name: 'yogurt', qty: 150, unit: 'g', est: { kcal: 100 }, part: 'p1' },
      { name: 'chia', est: { kcal: 120 }, part: 'p1' },
      { name: 'chocolate chip muffin', est: { kcal: 430 } },
    ],
    parts: [{ key: 'p1', name: null, source: 'user' }],
    macros: { kcal: 650 },
  });

  it('calls editMealParts with the picked indexes, and the slot reads the same numbers after', async () => {
    const user = userEvent.setup();
    const onCorrected = vi.fn();
    const { rerender } = renderDiary(dayOf([flat]), onCorrected);
    await user.click(screen.getByRole('button', { name: /Breakfast —/ }));
    const before = screen.getByRole('button', { name: /Breakfast —/ }).getAttribute('aria-label');

    await user.click(screen.getByRole('button', { name: 'Group things' }));
    const sheet = screen.getByRole('dialog', { name: 'Group things' });
    await user.click(within(sheet).getByRole('button', { name: /yogurt/ }));
    await user.click(within(sheet).getByRole('button', { name: /chia/ }));
    await user.click(within(sheet).getByRole('button', { name: /Group these two/ }));

    expect(editMealParts).toHaveBeenCalledWith('m1', { op: 'group', item_indexes: [0, 1] });
    await waitFor(() => expect(onCorrected).toHaveBeenCalled());

    // The parent re-reads and hands back the same meal, now bracketed. Same kcal, same count —
    // grouping changes no numbers, ever.
    rerender(
      <FoodDiary
        day={dayOf([grouped])}
        confirming={null}
        onConfirm={() => {}}
        onLog={() => {}}
        onCorrected={onCorrected}
      />,
    );
    expect(screen.getByRole('button', { name: /Breakfast —/ }).getAttribute('aria-label')).toBe(before);
    // The unnamed bracket reads as a plain count — label and sub both say so.
    expect(screen.getAllByText('2 things').length).toBeGreaterThan(0);
  });

  it('takes things out through the part menu, one remove per pick', async () => {
    const user = userEvent.setup();
    renderDiary(dayOf([chiaBowlMeal]), vi.fn());
    await user.click(screen.getByRole('button', { name: /Breakfast —/ }));
    await user.click(screen.getByRole('button', { name: /Chia bowl — 4 things/ }));
    await user.click(screen.getByRole('button', { name: 'More for Chia bowl' }));
    await user.click(screen.getByRole('button', { name: /Take something out/ }));

    const sheet = screen.getByRole('dialog', { name: 'Take something out' });
    await user.click(within(sheet).getByRole('button', { name: /strawberries/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Take it out' }));

    await waitFor(() => expect(editMealParts).toHaveBeenCalledWith('m1', { op: 'remove', part: 'p1', index: 3 }));
  });
});
