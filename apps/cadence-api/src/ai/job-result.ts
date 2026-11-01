import type { VariableCut } from '@ai-admin/core';

/**
 * The variables the engine cut to its cap on a job run, whichever way the job ran (both paths put
 * them on `metadata.truncatedVariables`). A caller that gets any back knows the model answered
 * from less than it sent, and says so to the person instead of passing the answer off as whole.
 */
export function truncatedVariablesOf(res: unknown): VariableCut[] {
  if (!res || typeof res !== 'object') return [];
  const cuts = (res as { metadata?: { truncatedVariables?: unknown } }).metadata?.truncatedVariables;
  return Array.isArray(cuts) ? (cuts as VariableCut[]) : [];
}
