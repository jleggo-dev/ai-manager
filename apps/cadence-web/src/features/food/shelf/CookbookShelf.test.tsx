/**
 * One shelf, no tab triple (canvas S2): the only on-screen distinction is yield. Green — tap and
 * it's logged. Butter — pick a portion first, and the stepper's count rides out through onPick.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Recipe } from '@cadence/shared';
import { CookbookShelf } from './CookbookShelf.tsx';

const listRecipes = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api.ts', () => ({ listRecipes }));

const chia: Recipe = {
  recipe_id: 'r1',
  name: 'Chia bowl',
  source: 'user',
  servings: 1,
  ingredients: [
    { name: 'yogurt', qty: 150, unit: 'g' },
    { name: 'chia', qty: 2, unit: 'tbsp' },
    { name: 'whey', qty: 1, unit: 'scoop' },
    { name: 'strawberries', qty: 1, unit: 'cup' },
  ],
  steps: [],
  macros_per_serving: { kcal: 348 },
  tags: [],
  saved: true,
};

const stew: Recipe = {
  ...chia,
  recipe_id: 'r2',
  name: 'Chickpea & spinach stew',
  servings: 4,
  ingredients: [{ name: 'chickpeas', qty: 400, unit: 'g' }],
  macros_per_serving: { kcal: 125 },
};

beforeEach(() => {
  listRecipes.mockReset();
  listRecipes.mockResolvedValue({ status: 'ok', recipes: [chia, stew] });
});

describe('CookbookShelf', () => {
  it('splits the shelf on yield — the whole taxonomy, no tabs', async () => {
    render(<CookbookShelf onPick={() => {}} onClose={() => {}} />);
    expect(await screen.findByText("ONE PORTION · TAP AND IT'S LOGGED")).toBeInTheDocument();
    expect(screen.getByText('MAKES SEVERAL · PICK A PORTION')).toBeInTheDocument();
    expect(listRecipes).toHaveBeenCalledWith({ savedOnly: true });

    // Bracketed rows: member names as the sub-line; the batch says what it makes.
    expect(screen.getByText('yogurt · chia · whey · strawberries')).toBeInTheDocument();
    expect(screen.getByText('makes 4')).toBeInTheDocument();
    expect(
      screen.getByText(
        "A green bracket is one portion. A butter bracket makes several. That's the whole taxonomy — no tabs.",
      ),
    ).toBeInTheDocument();
  });

  it('logs a one-portion row on the tap — no stepper in the way', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<CookbookShelf onPick={onPick} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Chia bowl — log one portion' }));
    expect(onPick).toHaveBeenCalledWith(chia, 1);
  });

  it('asks a makes-several row for a portion count, and onPick carries it', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<CookbookShelf onPick={onPick} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Chickpea & spinach stew — makes 4/ }));

    expect(screen.getByText('1 of 4 servings')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More servings' }));
    expect(screen.getByText('250 kcal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log 2 servings' }));
    expect(onPick).toHaveBeenCalledWith(stew, 2);
  });

  it('filters the shelf client-side, sections included', async () => {
    const user = userEvent.setup();
    render(<CookbookShelf onPick={() => {}} onClose={() => {}} />);
    await screen.findByText("ONE PORTION · TAP AND IT'S LOGGED");
    await user.type(screen.getByRole('searchbox', { name: 'Search your meals and recipes' }), 'stew');
    expect(screen.queryByText("ONE PORTION · TAP AND IT'S LOGGED")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Chickpea & spinach stew/ })).toBeInTheDocument();
  });
});
