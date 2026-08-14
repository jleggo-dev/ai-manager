/**
 * The retrieval layer's shared contract. Its own module so the function groups
 * (registry.ts, food-health-functions.ts) can each import it without a cycle.
 */

export interface RetrievalFunction {
  name: string;
  description: string; // LLM-facing (catalog / P2 selection)
  domains: string[];
  run(userId: string, params?: Record<string, unknown>): Promise<unknown>;
  render(result: unknown): string; // compact section, or '' to omit
  rows(result: unknown): number; // for provenance
}

export function isoRange(days: number): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now - days * 86_400_000).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  };
}
