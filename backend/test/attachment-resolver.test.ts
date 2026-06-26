import { describe, it, expect } from 'vitest';

/**
 * Copied from src/services/attachment-resolver.ts for isolated unit testing
 * (the originals are module-private).
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost', '0.0.0.0', '[::1]', '::1',
  'metadata.google.internal', 'metadata.google',
]);

function isBlockedIp(hostname: string): boolean {
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

function validateUrl(url: string, allowedDomains: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid attachment URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Attachment URLs must use HTTPS');
  }

  if (isBlockedIp(parsed.hostname)) {
    throw new Error('Attachment URLs must not target internal or metadata addresses');
  }

  if (allowedDomains.length > 0) {
    const allowed = allowedDomains.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
    );
    if (!allowed) {
      throw new Error(`Attachment domain "${parsed.hostname}" is not in the allowed list`);
    }
  }
}

/* ── isBlockedIp ───────────────────────────────────────────── */

describe('isBlockedIp', () => {
  it('blocks localhost', () => {
    expect(isBlockedIp('localhost')).toBe(true);
  });

  it('blocks 127.x.x.x (loopback)', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('127.255.255.255')).toBe(true);
  });

  it('blocks 10.x.x.x (private class A)', () => {
    expect(isBlockedIp('10.0.0.1')).toBe(true);
    expect(isBlockedIp('10.255.255.255')).toBe(true);
  });

  it('blocks 192.168.x.x (private class C)', () => {
    expect(isBlockedIp('192.168.0.1')).toBe(true);
    expect(isBlockedIp('192.168.100.200')).toBe(true);
  });

  it('blocks 169.254.x.x (link-local)', () => {
    expect(isBlockedIp('169.254.0.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
  });

  it('blocks metadata.google.internal', () => {
    expect(isBlockedIp('metadata.google.internal')).toBe(true);
    expect(isBlockedIp('metadata.google')).toBe(true);
  });

  it('allows public IPs (e.g. 8.8.8.8)', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('1.1.1.1')).toBe(false);
    expect(isBlockedIp('203.0.113.50')).toBe(false);
  });

  it('allows public hostnames', () => {
    expect(isBlockedIp('example.com')).toBe(false);
    expect(isBlockedIp('storage.googleapis.com')).toBe(false);
    expect(isBlockedIp('cdn.example.org')).toBe(false);
  });
});

/* ── validateUrl ───────────────────────────────────────────── */

describe('validateUrl', () => {
  it('rejects HTTP URLs (non-HTTPS)', () => {
    expect(() => validateUrl('http://example.com/file.pdf', [])).toThrow(
      'Attachment URLs must use HTTPS',
    );
  });

  it('rejects invalid URLs', () => {
    expect(() => validateUrl('not-a-url', [])).toThrow('Invalid attachment URL');
    expect(() => validateUrl('', [])).toThrow('Invalid attachment URL');
  });

  it('rejects internal IPs via URL (localhost)', () => {
    expect(() => validateUrl('https://localhost/secret', [])).toThrow(
      'must not target internal or metadata addresses',
    );
    expect(() => validateUrl('https://127.0.0.1/secret', [])).toThrow(
      'must not target internal or metadata addresses',
    );
  });

  it('accepts valid HTTPS URLs with no allowlist', () => {
    expect(() => validateUrl('https://example.com/file.pdf', [])).not.toThrow();
    expect(() => validateUrl('https://cdn.example.com/img.png', [])).not.toThrow();
  });

  it('rejects non-allowed domains when allowlist is set', () => {
    expect(() => validateUrl('https://evil.com/file.pdf', ['example.com'])).toThrow(
      'is not in the allowed list',
    );
  });

  it('accepts allowed domains (exact match and subdomain)', () => {
    expect(() => validateUrl('https://example.com/file.pdf', ['example.com'])).not.toThrow();
    expect(() => validateUrl('https://cdn.example.com/file.pdf', ['example.com'])).not.toThrow();
  });

  it('allows all domains when allowlist is empty', () => {
    expect(() => validateUrl('https://any-domain.io/file.pdf', [])).not.toThrow();
    expect(() => validateUrl('https://another.org/data.csv', [])).not.toThrow();
  });
});
