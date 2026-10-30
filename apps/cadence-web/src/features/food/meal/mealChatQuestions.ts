/**
 * The meal chat's quick questions (canvas 1c, 2026-10-29) — the PERSON's words, one tap to send,
 * changing with where the meal is: nothing in it, in the cart, logged.
 */
export type MealChatState = 'empty' | 'cart' | 'logged';

export const QUICK_QUESTIONS: Record<MealChatState, string[]> = {
  empty: ['What should I have?', 'Something quick', 'Something light'],
  cart: ['Enough protein?', 'Too much?', 'What would you swap?'],
  logged: ['How did I do?', 'What should the next one be?'],
};
