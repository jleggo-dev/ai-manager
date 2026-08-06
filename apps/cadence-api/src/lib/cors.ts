import type { Request, Response, NextFunction } from 'express';

/**
 * CORS for the native (Capacitor iOS) shell — the ONLY cross-origin consumer. Web never needs
 * this: dev goes through the Vite proxy and prod through the cadence-web Vercel rewrite, both
 * same-origin. The shell's WKWebView serves the bundle from capacitor://localhost (or
 * https://localhost depending on the configured iosScheme), so its API calls carry that Origin.
 *
 * Auth rides the Authorization header (no cookies), so no Allow-Credentials — keeps this a plain
 * allowlist with zero CSRF surface.
 */
const DEFAULT_ALLOWED = ['capacitor://localhost', 'https://localhost', 'http://localhost:3100'];

/** Allowlist = defaults + comma-separated CADENCE_CORS_ORIGINS (extra origins, e.g. previews). */
export function allowedOrigins(extra: string | undefined = process.env.CADENCE_CORS_ORIGINS): Set<string> {
  const fromEnv = (extra ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED, ...fromEnv]);
}

/** Express middleware. Mirrors the Origin back only when allowlisted; answers preflights with 204. */
export function corsMiddleware(origins: Set<string> = allowedOrigins()) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cadence-Dev-User');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}
