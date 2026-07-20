/**
 * Content comparison helpers for config-as-code dry-run (INFRA-P2).
 * Placeholder tokens like `<UUID>` are ignored so dry-run can still detect
 * prompt/schema drift without false positives on unresolved cross-refs.
 */

const PLACEHOLDER_RE = /^<[^>]+>$/;

export function looksLikePlaceholder(value: unknown): boolean {
  return typeof value === 'string' && PLACEHOLDER_RE.test(value.trim());
}

/** Deterministic JSON for equality checks (sorted object keys). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
  return out;
}

/**
 * True when every non-placeholder field listed in `fields` that appears on
 * `desired` matches the corresponding value on `live`.
 */
export function contentMatches(
  live: Record<string, unknown>,
  desired: Record<string, unknown>,
  fields: string[],
): boolean {
  for (const field of fields) {
    if (!(field in desired)) continue;
    const want = desired[field];
    if (looksLikePlaceholder(want)) continue;
    if (stableStringify(live[field] ?? null) !== stableStringify(want ?? null)) return false;
  }
  return true;
}

export const PROFILE_COMPARE_FIELDS = [
  'name',
  'description',
  'external_ai_id',
  'profile_type',
  'mode',
  'runtime_options',
  'failover_external_ai_id',
  'provider_id',
  'failover_provider_id',
] as const;

export const JOB_COMPARE_FIELDS = ['name', 'description', 'config', 'ai_profile_id'] as const;

export const WORKFLOW_COMPARE_FIELDS = ['name', 'description', 'config', 'ai_profile_id'] as const;
