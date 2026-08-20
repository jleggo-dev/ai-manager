/**
 * The amounts rule, on the card (design 05c). What these pin:
 *   • an amount they SAID is kept — no chips, no question, just a stepper to correct it;
 *   • an amount they DIDN'T give is asked for, as chips, and the card will not log until it is
 *     answered — confirm-first means the open question is a real gate, not a hint;
 *   • what logs is exactly what the card shows, including an amount answered by a chip;
 *   • an amount Cadence supplied is LABELLED as hers rather than passed off as theirs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const invalidate = vi.fn();
vi.mock('../../lib/query/index.ts', () => ({
  useInvalidateNutritionDay: () => invalidate,
  localTodayIso: () => '2026-08-20',
}));

const api = vi.hoisted(() => ({
  logPreviewedMeal: vi.fn(async () => ({ log_id: 'l1' })),
}));
vi.mock('../../lib/api.ts', () => api);

const { MealParseCard } = await import('./MealParseCard.tsx');

/** "toast and eggs" — the design's own case: the eggs are countable, the bread is not. */
const preview = {
  meal: 'breakfast' as const,
  raw_text: 'toast and eggs',
  items: [
    { name: 'eggs, fried', qty: 2, unit: 'large', est: { kcal: 180, protein_g: 13 } },
    { name: 'sourdough toast', est: { kcal: 120, carbs_g: 22 } },
  ],
  macros: { kcal: 300 },
  confidence: 0.8,
  flags: {},
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MealParseCard — one thing assumed, one thing asked', () => {
  it('labels the amount Cadence supplied and asks for the one nobody gave', () => {
    render(<MealParseCard preview={preview} onLogged={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('ASSUMED')).toBeInTheDocument();
    expect(screen.getByText('how much?')).toBeInTheDocument();
    expect(screen.getByText('1 AMOUNT TO SETTLE')).toBeInTheDocument();
    // Chips, never a keypad.
    expect(screen.getByRole('button', { name: '1 slice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 slices' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '40 g' })).toBeInTheDocument();
  });

  it('will not log while an amount is open', () => {
    render(<MealParseCard preview={preview} onLogged={() => {}} onCancel={() => {}} />);
    const log = screen.getByRole('button', { name: /amount to settle first/i });
    expect(log).toBeDisabled();
    fireEvent.click(log);
    expect(api.logPreviewedMeal).not.toHaveBeenCalled();
  });

  it('logs exactly what the card shows once the amount is answered', async () => {
    const onLogged = vi.fn();
    render(<MealParseCard preview={preview} initialMeal="breakfast" onLogged={onLogged} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '2 slices' }));

    const log = screen.getByRole('button', { name: 'Log to breakfast' });
    expect(log).toBeEnabled();
    fireEvent.click(log);

    await waitFor(() => expect(api.logPreviewedMeal).toHaveBeenCalled());
    const [sent, meal] = api.logPreviewedMeal.mock.calls[0] as unknown as [typeof preview, string];
    expect(meal).toBe('breakfast');
    expect(sent.items[0]).toMatchObject({ name: 'eggs, fried', qty: 2, unit: 'large' });
    // Two slices of a one-slice read is twice the read.
    expect(sent.items[1]).toMatchObject({ name: 'sourdough toast', qty: 2, unit: 'slice' });
    expect(sent.items[1]?.est?.kcal).toBe(240);
    expect(onLogged).toHaveBeenCalled();
  });

  it('keeps an amount they said, with no question attached to it', () => {
    const theirs = {
      ...preview,
      raw_text: '2 slices of sourdough toast',
      items: [{ name: 'sourdough toast', qty: 2, unit: 'slice', est: { kcal: 240 } }],
    };
    render(<MealParseCard preview={theirs} onLogged={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText('how much?')).not.toBeInTheDocument();
    expect(screen.queryByText('ASSUMED')).not.toBeInTheDocument();
    expect(screen.queryByText(/AMOUNTS? TO SETTLE/)).not.toBeInTheDocument();
    expect(screen.getByText('One thing')).toBeInTheDocument();
  });
});
