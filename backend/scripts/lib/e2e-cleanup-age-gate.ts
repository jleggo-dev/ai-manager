/**
 * Soft-cleanup age-gate for AI Admin e2e leftovers (PR #86).
 *
 * Soft mode only deletes rows older than a min age so a finishing CI job
 * does not wipe in-flight `e2e%` rows from a parallel Actions run that
 * shares the same Supabase project. Full cleanup (soft=false) has no gate.
 */

/** Default: leave rows younger than 20 minutes for concurrent CI. */
export const DEFAULT_SOFT_MIN_AGE_MS = 20 * 60 * 1000;

/**
 * ISO cutoff for soft age-gate (`created_at < cutoff`).
 * Returns null when soft is false — delete matching rows of any age.
 */
export function resolveOlderThanIso(
  soft: boolean,
  options: { nowMs?: number; minAgeMs?: number | null; envMinAgeMs?: string | null } = {},
): string | null {
  if (!soft) return null;

  const nowMs = options.nowMs ?? Date.now();
  const fromEnv = options.envMinAgeMs?.trim();
  const parsedEnv = fromEnv ? Number.parseInt(fromEnv, 10) : NaN;
  const explicit = options.minAgeMs;
  const candidate =
    explicit != null && Number.isFinite(explicit) && explicit >= 0
      ? explicit
      : Number.isFinite(parsedEnv) && parsedEnv >= 0
        ? parsedEnv
        : DEFAULT_SOFT_MIN_AGE_MS;

  return new Date(nowMs - candidate).toISOString();
}
