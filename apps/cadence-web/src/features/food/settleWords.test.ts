/**
 * What the card calls its open rows is a router between two words (owner 2026-09-01: every
 * such decision gets a table of positives and near-misses): "amount" when every open row waits on
 * an amount, "question" as soon as one waits on her question with answers to tap.
 */
import { describe, expect, it } from 'vitest';
import { settleButton, settleChip } from './settleWords.ts';

describe('settleChip / settleButton', () => {
  it.each([
    [1, false, '1 AMOUNT TO SETTLE', 'One amount to settle first'],
    [2, false, '2 AMOUNTS TO SETTLE', '2 amounts to settle first'],
    [1, true, '1 QUESTION TO SETTLE', 'One question to settle first'],
    [3, true, '3 QUESTIONS TO SETTLE', '3 questions to settle first'],
    // Near-miss: nothing open says nothing, whichever word would have applied.
    [0, false, '', ''],
    [0, true, '', ''],
  ])('%i open, choices %s → %j / %j', (asked, anyChoices, chip, button) => {
    expect(settleChip(asked, anyChoices)).toBe(chip);
    expect(settleButton(asked, anyChoices)).toBe(button);
  });
});
