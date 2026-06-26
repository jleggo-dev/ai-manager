/**
 * URL Validator — SSRF Protection
 * --------------------------------
 * Shared utility for validating URLs against SSRF attacks.
 * Enforces HTTPS-only, blocks private/reserved IP ranges,
 * resolves DNS and validates resolved IPs, supports optional
 * domain allowlists.
 *
 * Extracted from attachment-resolver.ts for reuse across
 * widget health checks and other URL-consuming features.
 */

import { resolve4, resolve6 } from 'node:dns/promises';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '[::1]',
  '::1',
  'metadata.google.internal',
  'metadata.google',
]);

export function isBlockedIp(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^0\./.test(h)) return true;
  if (h === '::' || h.startsWith('fe80:') || h.startsWith('fc00:') || h.startsWith('fd')) return true;
  return false;
}

export interface ValidateUrlOptions {
  allowedDomains?: string[];
  allowHttp?: boolean;
}

/**
 * Validate a URL for safe server-side fetching.
 *
 * Checks scheme, embedded credentials, hostname blocklist,
 * optional domain allowlist, and DNS-resolved IP addresses.
 * Returns the parsed URL on success; throws a descriptive
 * Error on any violation.
 */
export async function validateSafeUrl(url: string, options: ValidateUrlOptions = {}): Promise<URL> {
  const { allowedDomains = [], allowHttp = false } = options;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!allowHttp && parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }
  if (allowHttp && parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP or HTTPS URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }

  if (isBlockedIp(parsed.hostname)) {
    throw new Error('URL points to a blocked address');
  }

  if (allowedDomains.length > 0) {
    const allowed = allowedDomains.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
    );
    if (!allowed) {
      throw new Error(`Domain "${parsed.hostname}" is not in the allowed list`);
    }
  }

  const resolvedIps = await resolve4(parsed.hostname).catch(() =>
    resolve6(parsed.hostname).catch(() => {
      throw new Error(`Cannot resolve hostname: ${parsed.hostname}`);
    }),
  );

  for (const ip of resolvedIps) {
    if (isBlockedIp(ip)) {
      throw new Error('URL resolves to a blocked IP address');
    }
  }

  return parsed;
}
