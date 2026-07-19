/**
 * Compatibility re-export ΓÇö formatting rules live in `./formatting-rules/`.
 * Existing imports of `../services/formatting-rules.ts` keep working.
 */
export { RULE_REGISTRY, listAvailableRules, applyFormattingRules, type RuleEntry } from './formatting-rules/index.ts';
