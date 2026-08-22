/**
 * A23 §1b — "from somewhere?", asked once and never in the way. What these pin:
 *   • it asks only about items we could neither match nor already name a vendor for;
 *   • it NEVER blocks the log — an unanswered vendor is a fine outcome;
 *   • an answer reaches the log, because a brand dropped on the way back is a food pinned
 *     without its vendor, which is the whole bug this exists to prevent;
 *   • it stays a light line, not a form.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { AmountRow } from './useMealAmounts.ts';

const invalidate = vi.fn();
vi.mock('../../lib/query/index.ts', () => ({
  useInvalidateNutritionDay: () => invalidate,
  localTodayIso: () => '2026-08-22',
}));

interface LoggedPreview {
  items: Array<{ name: string; brand?: string; qty?: number }>;
}
const api = vi.hoisted(() => ({
  logPreviewedMeal: vi.fn(async (_preview: unknown, _meal?: unknown) => ({ log_id: 'l1' })),
}));
vi.mock('../../lib/api.ts', () => api);

const { MealParseCard } = await import('./MealParseCard.tsx');
const { vendorAskRows } = await import('./vendorAsk.ts');

/** Everything carries an amount, so the amounts rule is not what gates these tests. */
const preview = {
  meal: 'breakfast' as const,
  raw_text: 'a yogurt parfait and a coffee',
  items: [
    { name: 'yogurt parfait', qty: 1, unit: 'parfait', est: { kcal: 380, protein_g: 14 } },
    { name: 'coffee', qty: 1, unit: 'cup', est: { kcal: 5 }, food_id: 'usda-coffee' },
  ],
  macros: { kcal: 385 },
  confidence: 0.8,
  flags: {},
};

/** What actually went to the log endpoint — the only thing that proves the brand survived. */
const logged = (): LoggedPreview => api.logPreviewedMeal.mock.calls[0]?.[0] as LoggedPreview;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('vendorAskRows', () => {
  const row = (over: Partial<AmountRow> = {}): AmountRow => ({
    name: 'yogurt parfait',
    qty: 1,
    source: 'given',
    baseQty: 1,
    matched: false,
    ...over,
  });

  it('asks about an item that matched nothing and named nobody', () => {
    expect(vendorAskRows([row()])).toHaveLength(1);
  });

  it('stays quiet about an item already matched to a food on file', () => {
    expect(vendorAskRows([row({ matched: true })])).toHaveLength(0);
  });

  it('stays quiet when the vendor is already known — never asks twice', () => {
    expect(vendorAskRows([row({ brand: 'Materia Prima' })])).toHaveLength(0);
  });

  it('stays a light question rather than a form', () => {
    const many = [row({ name: 'a' }), row({ name: 'b' }), row({ name: 'c' }), row({ name: 'd' })];
    expect(vendorAskRows(many).length).toBeLessThanOrEqual(2);
  });
});

describe('MealParseCard — the vendor question', () => {
  it('asks about the unmatched item only, and says it is optional', () => {
    render(<MealParseCard preview={preview} onLogged={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/OPTIONAL, ASKED ONCE/)).toBeInTheDocument();
    expect(screen.getByLabelText('Where did the yogurt parfait come from?')).toBeInTheDocument();
    // The coffee already resolved to a saved food — nothing to ask.
    expect(screen.queryByLabelText('Where did the coffee come from?')).not.toBeInTheDocument();
  });

  it('never gates the log on it', async () => {
    render(<MealParseCard preview={preview} onLogged={() => {}} onCancel={() => {}} />);
    const log = screen.getByRole('button', { name: /Log to breakfast/ });
    expect(log).not.toBeDisabled();
    fireEvent.click(log);
    await waitFor(() => expect(api.logPreviewedMeal).toHaveBeenCalled());
    expect(logged().items[0]).not.toHaveProperty('brand');
  });

  it('carries an answered vendor all the way into the log', async () => {
    render(<MealParseCard preview={preview} onLogged={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Where did the yogurt parfait come from?'), {
      target: { value: 'Materia Prima' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Log to breakfast/ }));

    await waitFor(() => expect(api.logPreviewedMeal).toHaveBeenCalled());
    expect(logged().items[0]).toMatchObject({ name: 'yogurt parfait', brand: 'Materia Prima' });
  });

  it('drops the question once it has been answered', () => {
    render(<MealParseCard preview={preview} onLogged={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Where did the yogurt parfait come from?'), {
      target: { value: 'Materia Prima' },
    });
    // Answered rows leave the ask list — the line is asked once, not once per keystroke of doubt.
    expect(
      vendorAskRows([
        { name: 'yogurt parfait', qty: 1, source: 'given', baseQty: 1, matched: false, brand: 'Materia Prima' },
      ]),
    ).toHaveLength(0);
  });

  it('keeps a vendor the parse already heard, without asking again', () => {
    const heard = {
      ...preview,
      items: [{ ...preview.items[0]!, brand: 'Starbucks' }],
    };
    render(<MealParseCard preview={heard} onLogged={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText(/OPTIONAL, ASKED ONCE/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Log to breakfast/ }));
    return waitFor(() => expect(logged().items[0]).toMatchObject({ brand: 'Starbucks' }));
  });
});
