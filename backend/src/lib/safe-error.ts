/**
 * Safe Error Responses
 * --------------------
 * Strips internal implementation details from error messages before
 * sending them to API clients. Prevents information disclosure of
 * constraint names, table names, stack traces, and Supabase internals.
 */

const INTERNAL_PATTERNS = [
  /duplicate key.*constraint/i,
  /violates.*constraint/i,
  /relation ".*" does not exist/i,
  /column ".*" of relation/i,
  /ERROR:\s+/i,
  /stack trace/i,
  /at\s+\w+\s+\(/,
  /node_modules/,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /supabase/i,
];

const SAFE_DOMAIN_PATTERNS: [RegExp, string][] = [
  [
    /requires personal credentials/i,
    'This AI profile requires personal credentials. Please configure your provider credentials.',
  ],
  [/failover_provider_id/i, 'Failover provider configuration is invalid.'],
  [/failover_external_ai_id/i, 'Failover model configuration is invalid.'],
  [/callingApplication is required/i, 'A calling application identifier is required.'],
  [/already exists/i, 'A resource with this identifier already exists.'],
  [/not found/i, 'The requested resource was not found.'],
  [/workspace context/i, 'Workspace context is required for this operation.'],
  [/rate limit/i, 'Rate limit exceeded. Please try again later.'],
];

export function safeClientError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);

  for (const pattern of INTERNAL_PATTERNS) {
    if (pattern.test(raw)) return fallback;
  }

  for (const [pattern, safeMessage] of SAFE_DOMAIN_PATTERNS) {
    if (pattern.test(raw)) return safeMessage;
  }

  return fallback;
}

/**
 * For routes that distinguish 4xx (client) from 5xx (server) errors,
 * use this to ensure even 4xx responses don't leak internals.
 */
export function safeStatusError(err: unknown, status: number, fallback: string): string {
  if (status >= 500) return fallback;
  return safeClientError(err, fallback);
}
