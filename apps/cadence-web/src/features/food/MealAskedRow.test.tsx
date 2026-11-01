/**
 * Which answers an asked row offers is a router (owner 2026-09-01: every button gets a table test,
 * positives and near-misses): her question WITH choices → one button per choice in her words plus
 * "Something else", and NO amount chips (an amount cannot answer "whole or skim?"); a question
 * without choices, or a plain missing amount → the amount chips, as always; choices with no host
 * to re-read → the amount chips, never a dead end. Then the buttons themselves: a tap answers with
 * the choice as chosen, a typed line answers as not chosen, the wait is said in her voice, and a
 * failed re-read keeps the buttons.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MealAskedRow } from './MealAskedRow.tsx';
import { CHECKING, CHECK_FAILED, SOMETHING_ELSE, THATS_IT } from './MealQuestionChoices.tsx';
import type { AmountRow } from './useMealAmounts.ts';

const row = (over: Partial<AmountRow> = {}): AmountRow => ({
  name: 'milk',
  matched: false,
  qty: null,
  source: 'asked',
  baseQty: 1,
  ...over,
});
const CHOICES = ['Whole milk', '2%', 'Skim'];
const asked = (over: Partial<AmountRow> = {}): AmountRow =>
  row({ question: 'Whole milk, 2% or skim?', choices: CHOICES, asked_about: 'milk', ...over });
const noop = () => {};
type OnAnswer = (i: number, answer: string, chosen: boolean) => Promise<boolean>;
const draw = (r: AmountRow, onAnswer?: OnAnswer, index = 0) =>
  render(<MealAskedRow row={r} index={index} onQty={noop} onAnswer={onAnswer} />);
const yes: OnAnswer = async () => true;

afterEach(cleanup);

describe('MealAskedRow — which answers it offers', () => {
  it.each<[string, AmountRow, boolean, string[], string[]]>([
    [
      'her question with choices → buttons in her words, no amount chips',
      asked(),
      true,
      ['Whole milk', '2%', 'Skim', SOMETHING_ELSE],
      ['1 glass', '240 g', 'Another amount'],
    ],
    [
      'her question without choices → the amount chips',
      row({ question: 'How much?', asked_about: 'milk' }),
      true,
      ['1 glass', '240 g', 'Another amount'],
      [SOMETHING_ELSE],
    ],
    ['no question at all → the amount chips', row(), true, ['1 glass', 'Another amount'], [SOMETHING_ELSE]],
    [
      'near-miss: choices but no host to re-read → the amount chips, never a dead end',
      asked(),
      false,
      ['1 glass', 'Another amount'],
      ['Whole milk', SOMETHING_ELSE],
    ],
    [
      'near-miss: an empty choices list → the amount chips',
      asked({ choices: [] }),
      true,
      ['1 glass'],
      [SOMETHING_ELSE],
    ],
  ])('%s', (_label, r, withHost, shown, hidden) => {
    draw(r, withHost ? yes : undefined);
    for (const name of shown) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    for (const name of hidden) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('shows her question above the buttons, in her words', () => {
    draw(asked(), yes);
    expect(screen.getByText('Whole milk, 2% or skim?')).toBeInTheDocument();
    expect(screen.queryByText('how much?')).not.toBeInTheDocument();
  });
});

describe('MealAskedRow — the buttons', () => {
  it('a tap answers with the choice, as chosen, for this row', async () => {
    const onAnswer = vi.fn<OnAnswer>(async () => true);
    draw(asked(), onAnswer, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Whole milk' }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(2, 'Whole milk', true));
  });

  it('"Something else" opens a field; the typed line answers as not chosen, trimmed; Enter sends it too', async () => {
    const onAnswer = vi.fn<OnAnswer>(async () => true);
    draw(asked(), onAnswer);
    expect(screen.queryByLabelText('What the milk was')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: SOMETHING_ELSE }));
    const field = screen.getByLabelText('What the milk was');
    expect(screen.getByRole('button', { name: THATS_IT })).toBeDisabled();

    fireEvent.change(field, { target: { value: '  lactose-free  ' } });
    fireEvent.click(screen.getByRole('button', { name: THATS_IT }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(0, 'lactose-free', false));

    fireEvent.change(field, { target: { value: 'oat' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(0, 'oat', false));
  });

  it('near-miss: a blank typed line sends nothing', () => {
    const onAnswer = vi.fn<OnAnswer>(async () => true);
    draw(asked(), onAnswer);
    fireEvent.click(screen.getByRole('button', { name: SOMETHING_ELSE }));
    const field = screen.getByLabelText('What the milk was');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('says she is checking while the re-read runs, and the buttons wait', async () => {
    let settle!: (ok: boolean) => void;
    const onAnswer = vi.fn<OnAnswer>(
      () =>
        new Promise<boolean>((res) => {
          settle = res;
        }),
    );
    draw(asked(), onAnswer);
    fireEvent.click(screen.getByRole('button', { name: 'Skim' }));
    expect(await screen.findByText(CHECKING)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Whole milk' })).toBeDisabled();
    expect(screen.getByRole('button', { name: SOMETHING_ELSE })).toBeDisabled();
    settle(true);
    await waitFor(() => expect(screen.queryByText(CHECKING)).not.toBeInTheDocument());
    expect(screen.queryByText(CHECK_FAILED)).not.toBeInTheDocument();
  });

  it('a failed re-read says so in plain words and keeps the buttons for another go', async () => {
    const onAnswer = vi.fn<OnAnswer>(async () => false);
    draw(asked(), onAnswer);
    fireEvent.click(screen.getByRole('button', { name: '2%' }));
    expect(await screen.findByText(CHECK_FAILED)).toBeInTheDocument();
    expect(screen.queryByText(CHECKING)).not.toBeInTheDocument();
    for (const name of ['Whole milk', '2%', 'Skim', SOMETHING_ELSE]) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
    // The question is still there to answer.
    expect(screen.getByText('Whole milk, 2% or skim?')).toBeInTheDocument();
  });

  it.each([CHECKING, CHECK_FAILED, SOMETHING_ELSE, THATS_IT])(
    'the copy names no product and no banned word: %s',
    (copy) => {
      expect(copy).not.toMatch(/\bCadence\b/);
      expect(copy).not.toMatch(/\b(captured|unlock|empower|journey|beats|tempo|instruments)\b/i);
    },
  );
});
