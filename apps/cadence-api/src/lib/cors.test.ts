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
