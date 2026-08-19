import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { allowedOrigins, corsMiddleware } from './cors.ts';

function run(origin: string | undefined, method = 'GET') {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status: vi.fn().mockReturnThis(),
    end: vi.fn(),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  corsMiddleware(allowedOrigins('https://cadence.example.com'))(
    { headers: origin ? { origin } : {}, method } as unknown as Request,
    res,
    next,
  );
  return { headers, res, next };
}

describe('corsMiddleware', () => {
  it('mirrors an allowlisted origin (the Capacitor shell)', () => {
    const { headers, next } = run('capacitor://localhost');
    expect(headers['Access-Control-Allow-Origin']).toBe('capacitor://localhost');
    expect(headers['Vary']).toBe('Origin');
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
    expect(next).toHaveBeenCalled();
  });

  /**
   * The regression that took the phone down (2026-08-19). #240 started sending
   * `X-Cadence-Timezone` on every request; it was never added to the allowlist, so the shell's
   * preflight failed and EVERY API call died before it left the device — a healthy API, a valid
   * session, and "Couldn't reach your plan just now" on screen. Sign-in kept working because
   * Supabase is a different server, which is exactly what made it look like an auth bug.
   *
   * Asserted header by header: a client that sends a header this list does not name is an app
   * that cannot talk to its own API on device, and nothing else in CI can see it.
   */
  it.each(['Content-Type', 'Authorization', 'X-Cadence-Dev-User', 'X-Cadence-Timezone'])(
    'allows the %s header the client actually sends',
    (header) => {
      const { headers } = run('capacitor://localhost');
      expect(headers['Access-Control-Allow-Headers']).toContain(header);
    },
  );

  it('answers the shell preflight the same way (the headers must survive the 204)', () => {
    const { headers, res } = run('capacitor://localhost', 'OPTIONS');
    expect(headers['Access-Control-Allow-Headers']).toContain('X-Cadence-Timezone');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('adds origins from CADENCE_CORS_ORIGINS (trailing slash trimmed)', () => {
    expect(allowedOrigins('https://a.example, https://b.example/').has('https://b.example')).toBe(true);
    const { headers } = run('https://cadence.example.com');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://cadence.example.com');
  });

  it('sets nothing for an unknown origin', () => {
    const { headers, next } = run('https://evil.example');
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('sets nothing for same-origin requests (no Origin header)', () => {
    const { headers, next } = run(undefined);
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('answers preflight with 204 and does not fall through', () => {
    const { res, next } = run('capacitor://localhost', 'OPTIONS');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
