/**
 * Token-budget tiers (spec §4.3) — pure deterministic app code, no LLM.
 * Drives summarize-and-roll and JIT-injection decisions on the Coach hot path.
 */
export type BudgetTier = 'green' | 'amber' | 'red';

export function budgetTier(usedTokens: number, maxTokens: number): BudgetTier {
  const ratio = maxTokens > 0 ? usedTokens / maxTokens : 0;
  if (ratio < 0.6) return 'green'; // full dossier + summary + last K turns
  if (ratio <= 0.8) return 'amber'; // trigger summarize-and-roll; trim K
  return 'red'; // dossier + summary + last ~2 turns; defer JIT to essentials
}
