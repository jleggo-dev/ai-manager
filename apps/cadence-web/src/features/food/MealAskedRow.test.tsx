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
import { ANSWER_MAX_CHARS } from '@cadence/shared';
import { COULD_NOT_SETTLE, MealAskedRow, STILL_ASKING } from './MealAskedRow.tsx';
import { CHECKING, CHECK_FAILED, CHECK_REJECTED, SOMETHING_ELSE, THATS_IT } from './MealQuestionChoices.tsx';
import type { AnswerResult } from './reReadAnswer.ts';
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
type OnAnswer = (i: number, answer: string, chosen: boolean) => Promise<AnswerResult>;
const draw = (r: AmountRow, onAnswer?: OnAnswer, index = 0, busy = false) =>
  render(<MealAskedRow row={r} index={index} busy={busy} onQty={noop} onAnswer={onAnswer} />);
const yes: OnAnswer = async () => 'replaced';

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
    const onAnswer = vi.fn<OnAnswer>(async () => 'replaced');
    draw(asked(), onAnswer, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Whole milk' }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(2, 'Whole milk', true));
  });

  it('"Something else" opens a field; the typed line answers as not chosen, trimmed; Enter sends it too', async () => {
    const onAnswer = vi.fn<OnAnswer>(async () => 'failed');
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
    const onAnswer = vi.fn<OnAnswer>(async () => 'replaced');
    draw(asked(), onAnswer);
    fireEvent.click(screen.getByRole('button', { name: SOMETHING_ELSE }));
    const field = screen.getByLabelText('What the milk was');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('says she is checking while the re-read runs, and the buttons wait', async () => {
    let settle!: (result: AnswerResult) => void;
    const onAnswer = vi.fn<OnAnswer>(
      () =>
        new Promise<AnswerResult>((res) => {
          settle = res;
        }),
    );
    draw(asked(), onAnswer);
    fireEvent.click(screen.getByRole('button', { name: 'Skim' }));
    expect(await screen.findByText(CHECKING)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Whole milk' })).toBeDisabled();
    expect(screen.getByRole('button', { name: SOMETHING_ELSE })).toBeDisabled();
    settle('replaced');
    await waitFor(() => expect(screen.queryByText(CHECKING)).not.toBeInTheDocument());
    expect(screen.queryByText(CHECK_FAILED)).not.toBeInTheDocument();
  });

  it('a failed re-read says so in plain words and keeps the buttons for another go', async () => {
    const onAnswer = vi.fn<OnAnswer>(async () => 'failed');
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

  it('a refused answer (too long, blank) asks for different words, not "try again"', async () => {
    const onAnswer = vi.fn<OnAnswer>(async () => 'rejected');
    draw(asked(), onAnswer);
    fireEvent.click(screen.getByRole('button', { name: SOMETHING_ELSE }));
    fireEvent.change(screen.getByLabelText('What the milk was'), { target: { value: 'oat' } });
    fireEvent.click(screen.getByRole('button', { name: THATS_IT }));
    expect(await screen.findByText(CHECK_REJECTED)).toBeInTheDocument();
    expect(screen.queryByText(CHECK_FAILED)).not.toBeInTheDocument();
  });

  it("the field stops at the server's cap, and a longer answer is sent cut to it, never refused", async () => {
    const onAnswer = vi.fn<OnAnswer>(async () => 'replaced');
    draw(asked(), onAnswer);
    fireEvent.click(screen.getByRole('button', { name: SOMETHING_ELSE }));
    const field = screen.getByLabelText('What the milk was');
    expect(field).toHaveAttribute('maxLength', String(ANSWER_MAX_CHARS));
    // A paste can overrun maxLength in some browsers: the send cuts it anyway.
    fireEvent.change(field, { target: { value: 'x'.repeat(ANSWER_MAX_CHARS + 30) } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(0, 'x'.repeat(ANSWER_MAX_CHARS), false));
  });

  it('near-miss: Enter while the keyboard is still composing sends nothing', () => {
    const onAnswer = vi.fn<OnAnswer>(async () => 'replaced');
    draw(asked(), onAnswer);
    fireEvent.click(screen.getByRole('button', { name: SOMETHING_ELSE }));
    const field = screen.getByLabelText('What the milk was');
    fireEvent.change(field, { target: { value: 'ぎゅうにゅう' } });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('"Something else" opens the field focused, and a second tap closes it again', () => {
    draw(asked(), yes);
    fireEvent.click(screen.getByRole('button', { name: SOMETHING_ELSE }));
    expect(screen.getByLabelText('What the milk was')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: SOMETHING_ELSE }));
    expect(screen.queryByLabelText('What the milk was')).not.toBeInTheDocument();
  });

  it('busy (the card writing, or another answer in flight) disables every button and the open field', () => {
    const { rerender } = draw(asked(), yes);
    fireEvent.click(screen.getByRole('button', { name: SOMETHING_ELSE }));
    expect(screen.getByLabelText('What the milk was')).toBeEnabled();
    // The card goes busy with the field open: the field and its send wait too.
    rerender(<MealAskedRow row={asked()} index={0} busy onQty={noop} onAnswer={yes} />);
    for (const name of ['Whole milk', '2%', 'Skim', SOMETHING_ELSE, THATS_IT]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByLabelText('What the milk was')).toBeDisabled();
  });

  it.each([CHECKING, CHECK_FAILED, CHECK_REJECTED, SOMETHING_ELSE, THATS_IT, STILL_ASKING, COULD_NOT_SETTLE])(
    'the copy names no product and no banned word: %s',
    (copy) => {
      expect(copy).not.toMatch(/\bCadence\b/);
      expect(copy).not.toMatch(/\b(captured|unlock|empower|journey|beats|tempo|instruments)\b/i);
    },
  );
});

/**
 * A question that came back (review of #460): the person sees that something happened — "I still
 * couldn't settle that:" above the NEW question and choices — and after REASKS_MAX the row stops
 * offering buttons and asks the amount, saying why.
 */
describe('MealAskedRow — a question that came back', () => {
  it.each<[string, number, string[], string[], string[]]>([
    [
      'first ask → her question and her buttons, nothing more',
      0,
      ['Whole milk', SOMETHING_ELSE],
      [STILL_ASKING],
      ['1 glass'],
    ],
    [
      'asked again once → the line, the NEW question, the buttons',
      1,
      [STILL_ASKING, 'Whole milk'],
      [COULD_NOT_SETTLE],
      ['1 glass'],
    ],
    [
      'asked again twice → she could not settle it, the amount chips',
      2,
      [COULD_NOT_SETTLE, '1 glass'],
      [STILL_ASKING],
      ['Whole milk', SOMETHING_ELSE],
    ],
    ['near-miss: past the cap → the same as at it', 3, [COULD_NOT_SETTLE, '1 glass'], [STILL_ASKING], ['Whole milk']],
  ])('%s', (_label, reasks, shownText, hiddenText, hiddenButtons) => {
    draw(asked({ reasks }), yes);
    for (const t of shownText) {
      expect(screen.queryByText(t) ?? screen.queryByRole('button', { name: t })).toBeInTheDocument();
    }
    for (const t of hiddenText) expect(screen.queryByText(t)).not.toBeInTheDocument();
    for (const name of hiddenButtons) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('the re-asked question is the new one, with the new choices', () => {
    draw(asked({ reasks: 1, question: 'Full-fat or light?', choices: ['Full-fat', 'Light'] }), yes);
    expect(screen.getByText('Full-fat or light?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Whole milk' })).not.toBeInTheDocument();
  });
});
