/**
 * What the confirm card calls its open rows. A row waits on an AMOUNT (the chips) or on her
 * QUESTION with answers to tap (MealQuestionChoices); the card said "AMOUNT" for both until
 * 2026-11-01, which read wrong over "whole or skim?". The word is "question" as soon as any open
 * row carries choices, "amount" when every one waits on an amount. Table-tested.
 */
const noun = (asked: number, anyChoices: boolean, upper: boolean): string => {
  const word = anyChoices ? 'question' : 'amount';
  const plural = asked === 1 ? word : `${word}s`;
  return upper ? plural.toUpperCase() : plural;
};

/** The header chip: "1 AMOUNT TO SETTLE", "2 QUESTIONS TO SETTLE". Empty when nothing is open. */
export function settleChip(asked: number, anyChoices: boolean): string {
  return asked > 0 ? `${asked} ${noun(asked, anyChoices, true)} TO SETTLE` : '';
}

/** The disabled log button: "One amount to settle first", "2 questions to settle first". */
export function settleButton(asked: number, anyChoices: boolean): string {
  if (asked <= 0) return '';
  return `${asked === 1 ? 'One' : asked} ${noun(asked, anyChoices, false)} to settle first`;
}
