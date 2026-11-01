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
  logPreviewedMeal: vi.fn(async (_preview: unknown, _meal?: unknown) => ({ log_id: 'l1' })),
  previewMealAnswer: vi.fn(async (_input: unknown): Promise<unknown> => ({ items: [] })),
}));
vi.mock('../../lib/api.ts', () => api);

const { MealParseCard } = await import('./MealParseCard.tsx');
const { CHECK_FAILED } = await import('./MealQuestionChoices.tsx');

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

/**
 * REGRESSION (2026-08-22, owner-reported "nada back in terms of micronutrients"). The card summed
 * four keys into the total it posts, so every micronutrient the parse produced was dropped at the
 * confirm — and the day sums that total. The card still DRAWS four; what it hands back is complete.
 */
describe('MealParseCard — the total it posts carries every nutrient', () => {
  const withMicros = {
    meal: 'breakfast' as const,
    raw_text: '2 eggs and arugula',
    items: [
      { name: 'eggs', qty: 2, unit: 'large', est: { kcal: 140, protein_g: 12, iron_mg: 1.8, vitamin_b12_ug: 1.1 } },
      { name: 'arugula', qty: 1, unit: 'handful', est: { kcal: 5, calcium_mg: 32 } },
    ],
    macros: { kcal: 145 },
    confidence: 0.8,
    flags: {},
  };

  it('sums micronutrients into the posted total', async () => {
    render(<MealParseCard preview={withMicros} onLogged={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Log to breakfast/ }));

    await waitFor(() => expect(api.logPreviewedMeal).toHaveBeenCalled());
    const posted = api.logPreviewedMeal.mock.calls[0]![0] as { macros: Record<string, number> };
    expect(posted.macros.iron_mg).toBeCloseTo(1.8, 1);
    expect(posted.macros.vitamin_b12_ug).toBeCloseTo(1.1, 1);
    expect(posted.macros.calcium_mg).toBeCloseTo(32, 0);
    expect(posted.macros.kcal).toBeCloseTo(145, 0);
  });
});

/**
 * A coach-led question row (FOOD-LOGGING-COACH-LED.md): no number, no food link, no words — the
 * question is what it waits for. A chip gives it an amount; the question stays on the row, and
 * what is posted carries neither a link nor words for the memory to learn from.
 */
describe('MealParseCard — a question row counts nothing until it is answered', () => {
  const eggs = { name: 'eggs', qty: 2, unit: 'large', est: { kcal: 144 }, food_id: 'f-eggs', said: '2 eggs' };
  const base = { meal: 'breakfast' as const, raw_text: 'milk and 2 eggs', confidence: null, flags: {} };

  it('near-miss: a question row WITH a number is out of the total until a chip answers it, then in — the total says what is posted', async () => {
    const preview = {
      ...base,
      items: [{ name: 'milk', question: 'Whole milk or 2%?', est: { kcal: 122 } }, eggs],
      macros: { kcal: 266 },
      coach: { reached: true, calls: 1, checked: [] },
    };
    render(<MealParseCard preview={preview} initialMeal="breakfast" onLogged={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('~144 kcal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1 glass' }));
    expect(screen.getByText('~266 kcal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log to breakfast' }));
    await waitFor(() => expect(api.logPreviewedMeal).toHaveBeenCalled());
    const [sent] = api.logPreviewedMeal.mock.calls[0] as unknown as [
      { items: Array<{ est?: { kcal?: number } }>; macros: { kcal: number } },
    ];
    expect(sent.items[0]?.est?.kcal).toBe(122);
    expect(sent.macros.kcal).toBeCloseTo(266, 0);
  });

  it('near-miss: a question row that ARRIVES with a qty is left out until touched, as on the quick-log sheet', () => {
    const preview = {
      ...base,
      items: [{ name: 'milk', question: 'Whole milk or 2%?', qty: 1, unit: 'glass', est: { kcal: 122 } }, eggs],
      macros: { kcal: 266 },
      coach: { reached: true, calls: 1, checked: [] },
    };
    render(<MealParseCard preview={preview} initialMeal="breakfast" onLogged={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('~144 kcal')).toBeInTheDocument();
    expect(screen.queryByText('~266 kcal')).not.toBeInTheDocument();
    // The stepper is the card's answer for a row that already carries an amount.
    fireEvent.click(screen.getByRole('button', { name: 'More milk' }));
    expect(screen.getByText(/~29\d kcal/)).toBeInTheDocument();
  });
});

describe('MealParseCard — a coach-led question row', () => {
  const coachLed = {
    meal: 'breakfast' as const,
    raw_text: 'milk and 2 eggs',
    items: [
      { name: 'milk', question: 'Whole milk or 2%?', basis: 'none' as const },
      {
        name: 'eggs',
        qty: 2,
        unit: 'large',
        est: { kcal: 144 },
        food_id: 'f-eggs',
        said: '2 eggs',
        basis: 'record' as const,
      },
    ],
    macros: { kcal: 144 },
    confidence: null,
    flags: {},
    coach: { reached: true, calls: 1, checked: [] },
  };

  it('asks her question, keeps it on the row once a chip answers the amount, and posts no link or words for it', async () => {
    render(<MealParseCard preview={coachLed} initialMeal="breakfast" onLogged={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Whole milk or 2%?')).toBeInTheDocument();
    expect(screen.getByText('1 AMOUNT TO SETTLE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '1 glass' }));
    // Kept now — a stepper, not chips — and her question still on the sub line.
    expect(screen.getByText('1 glass · Whole milk or 2%?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More milk' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Log to breakfast' }));
    await waitFor(() => expect(api.logPreviewedMeal).toHaveBeenCalled());
    const [sent] = api.logPreviewedMeal.mock.calls[0] as unknown as [typeof coachLed];
    expect(sent.items[0]).toMatchObject({ name: 'milk', qty: 1, unit: 'glass' });
    expect(sent.items[0]).not.toHaveProperty('food_id');
    expect(sent.items[0]).not.toHaveProperty('said');
    // The picked row keeps both, so the confirm prices from its food and the memory learns.
    expect(sent.items[1]).toMatchObject({ food_id: 'f-eggs', said: '2 eggs' });
  });
});

/**
 * Her question answered with a button (FOOD-LOGGING-COACH-LED.md, "chips in her voice"; owner
 * 2026-11-01): the choices are buttons, the row counts nothing and gates the log until answered,
 * a tap re-reads that part for the card's slot and the priced row takes its place — total,
 * link and words included — and a failed re-read keeps the question, the buttons and the gate.
 */
describe('MealParseCard — her question answered with a button', () => {
  const asked = {
    meal: 'breakfast' as const,
    raw_text: 'milk and 2 eggs',
    items: [
      {
        name: 'milk',
        question: 'Whole milk, 2% or skim?',
        choices: ['Whole milk', '2%', 'Skim'],
        asked_about: 'milk',
        basis: 'none' as const,
      },
      {
        name: 'eggs',
        qty: 2,
        unit: 'large',
        est: { kcal: 144 },
        food_id: 'f-eggs',
        said: '2 eggs',
        basis: 'record' as const,
      },
    ],
    macros: { kcal: 144 },
    confidence: null,
    flags: {},
    coach: { reached: true, calls: 1, checked: [] },
  };
  const answered = {
    meal: 'breakfast' as const,
    raw_text: 'whole milk',
    items: [
      {
        name: 'Milk, whole',
        qty: 1,
        unit: 'cup',
        est: { kcal: 149, protein_g: 8 },
        food_id: 'f-whole',
        said: 'milk',
        basis: 'record' as const,
        source_label: 'USDA',
      },
    ],
    macros: { kcal: 149 },
    confidence: null,
    flags: {},
    coach: { reached: true, calls: 1, checked: [] },
  };

  it('offers her answers as buttons, counts the row as a question, and will not log until it is answered', () => {
    render(<MealParseCard preview={asked} initialMeal="breakfast" onLogged={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Whole milk, 2% or skim?')).toBeInTheDocument();
    expect(screen.getByText('1 QUESTION TO SETTLE')).toBeInTheDocument();
    for (const name of ['Whole milk', '2%', 'Skim', 'Something else']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // Never the amount chips for a question an amount cannot answer.
    expect(screen.queryByRole('button', { name: '1 glass' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'One question to settle first' })).toBeDisabled();
    // Nothing counted for it: the total is the eggs alone.
    expect(screen.getByText('~144 kcal')).toBeInTheDocument();
  });

  it('a tap re-reads the part for this slot, the priced row takes its place, the total moves, and the confirm carries its food and words', async () => {
    api.previewMealAnswer.mockResolvedValueOnce(answered);
    const onLogged = vi.fn();
    render(<MealParseCard preview={asked} initialMeal="breakfast" onLogged={onLogged} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Whole milk' }));

    await waitFor(() =>
      expect(api.previewMealAnswer).toHaveBeenCalledWith({
        asked_about: 'milk',
        answer: 'Whole milk',
        chosen: true,
        meal: 'breakfast',
      }),
    );
    expect(await screen.findByText('Milk, whole')).toBeInTheDocument();
    expect(screen.queryByText('Whole milk, 2% or skim?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skim' })).not.toBeInTheDocument();
    expect(screen.getByText('1 cup')).toBeInTheDocument();
    expect(screen.getByText('~293 kcal')).toBeInTheDocument();
    expect(screen.queryByText(/TO SETTLE/)).not.toBeInTheDocument();

    const log = screen.getByRole('button', { name: 'Log to breakfast' });
    expect(log).toBeEnabled();
    fireEvent.click(log);
    await waitFor(() => expect(api.logPreviewedMeal).toHaveBeenCalled());
    const [sent] = api.logPreviewedMeal.mock.calls[0] as unknown as [typeof answered];
    expect(sent.items).toHaveLength(2);
    // The answered row is a picked row now: its food and the words the question was about ride
    // back, so the confirm prices from the food and the memory learns "milk".
    expect(sent.items[0]).toMatchObject({ name: 'Milk, whole', qty: 1, unit: 'cup', food_id: 'f-whole', said: 'milk' });
    expect(sent.items[1]).toMatchObject({ food_id: 'f-eggs', said: '2 eggs' });
    expect(sent.macros?.kcal).toBe(293);
    expect(onLogged).toHaveBeenCalled();
  });

  it('a typed answer goes the same way, marked as not chosen', async () => {
    api.previewMealAnswer.mockResolvedValueOnce(answered);
    render(<MealParseCard preview={asked} initialMeal="breakfast" onLogged={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Something else' }));
    fireEvent.change(screen.getByLabelText('What the milk was'), { target: { value: 'lactose-free' } });
    fireEvent.click(screen.getByRole('button', { name: "That's it" }));
    await waitFor(() =>
      expect(api.previewMealAnswer).toHaveBeenCalledWith({
        asked_about: 'milk',
        answer: 'lactose-free',
        chosen: false,
        meal: 'breakfast',
      }),
    );
    expect(await screen.findByText('Milk, whole')).toBeInTheDocument();
  });

  it('a failed re-read keeps the question, the buttons and the gate', async () => {
    api.previewMealAnswer.mockRejectedValueOnce(new Error('500'));
    render(<MealParseCard preview={asked} initialMeal="breakfast" onLogged={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skim' }));
    expect(await screen.findByText(CHECK_FAILED)).toBeInTheDocument();
    expect(screen.getByText('Whole milk, 2% or skim?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skim' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'One question to settle first' })).toBeDisabled();
    expect(screen.getByText('~144 kcal')).toBeInTheDocument();
    expect(api.logPreviewedMeal).not.toHaveBeenCalled();
  });

  it('near-miss: a re-read that comes back with nothing is a failure too, never an emptied card', async () => {
    api.previewMealAnswer.mockResolvedValueOnce({ ...answered, items: [] });
    render(<MealParseCard preview={asked} initialMeal="breakfast" onLogged={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '2%' }));
    expect(await screen.findByText(CHECK_FAILED)).toBeInTheDocument();
    expect(screen.getByText('Two things')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2%' })).toBeEnabled();
  });
});
