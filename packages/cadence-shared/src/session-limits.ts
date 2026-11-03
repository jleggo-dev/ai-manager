/**
 * Text limits for a stored session, in characters. One home for the numbers, read from both
 * sides: the API's normalizer (session-normalize.ts) cuts text to them, and the session checker
 * (session-check.ts) reports text that ran past them. The prescribe-session prompt in
 * config/ai-admin/ai-admin.config.json tells the coach the same numbers as facts, and
 * prescribe-session-set-flow-facts.test.ts pins the two together — change both at once.
 */
export const ITEM_NAME_MAX = 120;
export const ITEM_LOAD_MAX = 80;
export const ITEM_DETAIL_MAX = 600;
export const BLOCK_LABEL_MAX = 40;
