/**
 * An amount nobody stated, on the screen where the recipe gets saved.
 *
 * The job used to invent a number for "some onion" and the draft showed it as if the person had
 * said it. Now the amount arrives empty. What these pin:
 *   • the empty amount is a box to fill in, not a silent 1;
 *   • Save is held until every one of them has a real amount;
 *   • the per-serving line says it is incomplete while any is open — a total missing an
 *     ingredient must not read as a small dish;
 *   • filling the last box releases Save, and what gets posted carries the typed amount.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { RecipeDraft } from '../../lib/api.ts';

const api = vi.hoisted(() => ({
  saveRecipe: vi.fn(async (_draft: unknown) => ({ status: 'ok' as const, recipe: { recipe_id: 'r1' } })),
  recipeMacroHint: (m: { kcal?: number }) => (m.kcal != null ? `~${m.kcal} kcal` : ''),
}));
vi.mock('../../lib/api.ts', () => api);

const { RecipeSaveConfirm } = await import('./RecipeSaveConfirm.tsx');
const { readAmount, withAmount } = await import('./recipeAmount.ts');

/** Beef chili with the onion amount never stated — the parcel's own example. */
function draft(): RecipeDraft {
  return {
    name: 'Beef chili',
    source: 'ai_from_chat',
    servings: 6,
    ingredients: [
      { name: 'ground beef', qty: 500, unit: 'g', food_id: 'f-beef' },
      { name: 'onion', qty: null, unit: 'item', food_id: 'f-onion', amount_unstated: true },
    ],
    steps: [],
    macros_per_serving: { kcal: 210, has_unstated_amounts: true },
    tags: [],
  };
}

const saveButton = () => screen.getByRole('button', { name: /save recipe/i });
const amountBox = () => screen.getByLabelText('Amount of onion');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('readAmount / withAmount', () => {
  const table: Array<[typed: string, expected: number | null]> = [
    ['500', 500],
    ['0.5', 0.5],
    [' 2 ', 2],
    ['', null],
    ['   ', null],
    ['some', null],
    ['0', null],
    ['-3', null],
  ];

  for (const [typed, expected] of table) {
    it(`reads ${JSON.stringify(typed)} as ${expected === null ? 'still unstated' : String(expected)}`, () => {
      expect(readAmount(typed)).toBe(expected);
    });
  }

  it('drops the unstated flag once a real amount is typed, and puts it back if it is cleared', () => {
    const row = { name: 'onion', qty: null, amount_unstated: true as const };
    const filled = withAmount(row, '2');
    expect(filled).toEqual({ name: 'onion', qty: 2 });
    expect(withAmount(filled, '')).toEqual({ name: 'onion', qty: null, amount_unstated: true });
  });
});

describe('RecipeSaveConfirm — an amount nobody stated', () => {
  const props = { dietary: null, onCancel: vi.fn(), onSaved: vi.fn() };

  it('shows an empty amount box asking for the amount, not a number', () => {
    render(<RecipeSaveConfirm draft={draft()} {...props} />);
    const box = amountBox() as HTMLInputElement;
    expect(box.value).toBe('');
    expect(box.placeholder).toBe('amount?');
    // The ingredient itself is still there — only the amount is missing.
    expect(screen.getByText(/onion/)).toBeTruthy();
  });

  it('holds Save until the amount is filled, and says the total is incomplete meanwhile', () => {
    render(<RecipeSaveConfirm draft={draft()} {...props} />);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('incomplete until every amount is filled')).toBeTruthy();
  });

  it('releases Save once a real amount is typed and posts that amount', async () => {
    render(<RecipeSaveConfirm draft={draft()} {...props} />);
    fireEvent.change(amountBox(), { target: { value: '2' } });

    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('incomplete until every amount is filled')).toBeNull();

    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveRecipe).toHaveBeenCalledTimes(1));
    const posted = api.saveRecipe.mock.calls[0]![0] as RecipeDraft;
    expect(posted.ingredients[1]).toEqual({ name: 'onion', qty: 2, unit: 'item', food_id: 'f-onion' });
  });

  it('holds Save again if the amount is cleared back out', () => {
    render(<RecipeSaveConfirm draft={draft()} {...props} />);
    fireEvent.change(amountBox(), { target: { value: '2' } });
    fireEvent.change(amountBox(), { target: { value: '' } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('a draft with every amount stated saves as before — no box, no note, no hold', () => {
    const d = draft();
    d.ingredients = [{ name: 'ground beef', qty: 500, unit: 'g', food_id: 'f-beef' }];
    d.macros_per_serving = { kcal: 210 };
    render(<RecipeSaveConfirm draft={d} {...props} />);

    expect(screen.queryByLabelText(/^Amount of /)).toBeNull();
    expect(screen.queryByText('incomplete until every amount is filled')).toBeNull();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });
});
