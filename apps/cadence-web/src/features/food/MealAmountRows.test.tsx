/**
 * The rows of the confirm card, table-tested (owner 2026-09-01: every button gets a table test).
 * Which row a parsed item becomes is a router — an asked amount gets chips, a kept amount gets a
 * stepper — and the coach's question has to survive either way: on an asked row it IS the
 * question; on a kept row (one that arrived with an amount anyway) it rides the sub line rather
 * than being silently hidden behind the amount.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MealAmountRows } from './MealAmountRows.tsx';
import type { AmountRow } from './useMealAmounts.ts';

const row = (over: Partial<AmountRow> = {}): AmountRow => ({
  name: 'milk',
  matched: false,
  qty: null,
  source: 'asked',
  baseQty: 1,
  ...over,
});
const noop = () => {};
const draw = (rows: AmountRow[]) => render(<MealAmountRows rows={rows} onQty={noop} onRemove={noop} onEdit={noop} />);

afterEach(cleanup);

describe('MealAmountRows — the question is shown wherever the row lands', () => {
  it.each([
    [
      'an asked row with her question asks it in her words',
      row({ question: 'Whole milk or 2%?' }),
      'Whole milk or 2%?',
    ],
    ['an asked row with no question asks the plain amount question', row(), 'how much?'],
  ])('%s', (_, r, text) => {
    draw([r]);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 glass' })).toBeInTheDocument();
  });

  it('a row with her choices and a host to re-read offers the buttons and no amount chips', () => {
    render(
      <MealAmountRows
        rows={[row({ question: 'Whole milk or 2%?', choices: ['Whole milk', '2%'], asked_about: 'milk' })]}
        onQty={noop}
        onRemove={noop}
        onEdit={noop}
        onAnswer={async () => 'replaced' as const}
      />,
    );
    expect(screen.getByRole('button', { name: 'Whole milk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Something else' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1 glass' })).not.toBeInTheDocument();
  });

  it('near-miss: a row carrying a question WITH an amount is kept — no chips — and still shows the question', () => {
    draw([row({ qty: 1, unit: 'cup', source: 'given', est: { kcal: 122 }, question: 'Whole milk or 2%?' })]);
    expect(screen.queryByText('how much?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1 glass' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More milk' })).toBeInTheDocument();
    expect(screen.getByText('1 cup · Whole milk or 2%?')).toBeInTheDocument();
  });

  it('a kept row shows the amount and what the coach assumed, on one line', () => {
    draw([
      row({
        name: 'eggs',
        qty: 2,
        unit: 'large',
        source: 'given',
        est: { kcal: 144 },
        assumption: 'Took these as large',
      }),
    ]);
    expect(screen.getByText('2 large · Took these as large')).toBeInTheDocument();
    expect(screen.queryByText('ASSUMED')).not.toBeInTheDocument();
  });

  it('labels an amount the app supplied as assumed', () => {
    draw([row({ name: 'toast', qty: 1, unit: 'slice', source: 'assumed', est: { kcal: 80 } })]);
    expect(screen.getByText('ASSUMED')).toBeInTheDocument();
  });
});
