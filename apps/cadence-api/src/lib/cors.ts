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

/**
 * Every custom header the client sends, and the list a preflight is answered with.
 *
 * **This list is not decoration — a header missing from it takes the whole app down on device.**
 * The browser fails the preflight for an unlisted header, so the request is never sent: on the
 * native shell that reads as "Couldn't reach your plan just now" on a perfectly healthy API, with
 * sign-in still working (Supabase is a different server with its own CORS). `X-Cadence-Timezone`
 * shipped to every request in #240 and was not added here, which broke every API call the phone
 * made while the web app — same-origin through the rewrite — stayed fine, so nothing in CI or in
 * a browser could see it.
 *
 * Adding a header in `lib/api/http.ts` means adding it HERE, in the same change.
 */
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Cadence-Dev-User', 'X-Cadence-Timezone'] as const;

/** Express middleware. Mirrors the Origin back only when allowlisted; answers preflights with 204. */
export function corsMiddleware(origins: Set<string> = allowedOrigins()) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}
