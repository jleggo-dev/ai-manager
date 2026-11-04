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

/** Alternatives per item (walkthrough v3 R3): the coach writes two or three; the app keeps at most this. */
export const ALTERNATIVES_MAX = 3;
/** Equipment names on an alternative: each this long at most, and at most this many of them. */
export const EQUIPMENT_NAME_MAX = 40;
export const ALTERNATIVE_EQUIPMENT_MAX = 6;

/** A commitment's standing instruction (`activity.how_to`), in characters. There was no stored
 *  bound before walkthrough v3 Phase 6; 600 is the same backstop the coach's `why` has
 *  (plan-synthesis.ts). The Every time write refuses rather than runs past it. */
export const HOW_TO_MAX = 600;
