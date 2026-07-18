/**
 * Response Sanitization
 * ---------------------
 * Strips sensitive fields (e.g. provider api_key) from objects
 * before they are sent to API clients. Internal server code still
 * receives full data from models; this layer sits between models
 * and HTTP responses.
 */

const SENSITIVE_KEYS = new Set([
  'api_key',
  'key_hash',
  'password',
  'secret',
  'token',
  'credentials',
  'service_role_key',
  'encryption_key',
  'access_token',
  'refresh_token',
  'screenshot_path',
]);

/**
 * Recursively strip sensitive keys from an object or array.
 * Returns a new object — the original is not mutated.
 */
export function stripSecrets(obj: unknown): unknown {
  if (obj == null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) return obj.map(stripSecrets);

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    clean[key] = value && typeof value === 'object' ? stripSecrets(value) : value;
  }
  return clean;
}

/** Provider responses: strip api_key but expose whether one is configured. */
export function sanitizeProvider<T extends { api_key?: string | null }>(row: T): Record<string, unknown> {
  const hasApiKey = Boolean(String(row.api_key ?? '').trim());
  return { ...(stripSecrets(row) as Record<string, unknown>), has_api_key: hasApiKey };
}
