/**
 * The prefs route is where a user's answer to "how much should this thing talk to me?" becomes a
 * stored fact. The cases worth pinning are the ones where a bad request would quietly widen that
 * answer: an out-of-range quiet minute, an unknown tier, or a partial save that resets the fields
 * it did not mention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const getPrefs = vi.fn();
const upsert = vi.fn(async (..._a: unknown[]) => {});
const buildPlan = vi.fn();

vi.mock('../repos/notifications.ts', () => ({
  getNotificationPrefs: (...a: unknown[]) => getPrefs(...a),
  upsertNotificationPrefs: (...a: unknown[]) => upsert(...a),
}));
// Mocked so the test never reaches db/sql.ts (and its "set CADENCE_DB_PASSWORD"): the local-nudge
// builder is exercised by its own unit tests, not through the route.
vi.mock('../services/notify/local-plan.ts', () => ({ buildLocalNudgePlan: (...a: unknown[]) => buildPlan(...a) }));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: prefsRoutes } = await import('./notification-prefs.ts');

const STORED = {
  enabled: true,
  tier: 'moderate' as const,
  quietStartMin: 21 * 60,
  quietEndMin: 7 * 60,
  kinds: {},
  maxPerDay: 3,
};

/** The route's JSON shape, as the client sees it. */
interface PrefsResponse {
  enabled?: boolean;
  tier?: string;
  quietStartMin?: number;
  quietEndMin?: number;
  includes?: string[];
  excludes?: string[];
  maxPerDay?: number;
  kinds?: unknown;
  error?: string;
}

async function call(
  method: 'GET' | 'PUT',
  body?: unknown,
  path = '/me/notification-prefs',
): Promise<{ status: number; body: PrefsResponse }> {
  const app = express();
  app.use(express.json());
  app.use('/me', prefsRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as PrefsResponse };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getPrefs.mockResolvedValue({ ...STORED });
  buildPlan.mockResolvedValue({ today: '2026-08-10', activities: [], waypoints: [] });
});

describe('GET /me/notification-prefs', () => {
  it('returns the dial plus what it resolves to', async () => {
    const r = await call('GET');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: true, tier: 'moderate', quietStartMin: 1260, quietEndMin: 420 });
    // The server says what the tier MEANS, so the Settings card and the gate that withholds a
    // notification cannot disagree about it.
    expect(r.body.includes).toContain('almost_time');
    expect(r.body.excludes).toContain('weather_move');
    expect(r.body.maxPerDay).toBe(1);
  });

  it('never leaks the operational fields as if they were preferences', async () => {
    const r = await call('GET');
    expect(r.body.kinds).toBeUndefined();
  });
});

describe('PUT /me/notification-prefs', () => {
  it('applies only the fields that were sent', async () => {
    await call('PUT', { tier: 'lots' });
    expect(upsert).toHaveBeenCalledWith('u1', { tier: 'lots' });
  });

  it('accepts the whole dial at once', async () => {
    await call('PUT', { enabled: false, tier: 'few', quietStartMin: 0, quietEndMin: 1439 });
    expect(upsert).toHaveBeenCalledWith('u1', {
      enabled: false,
      tier: 'few',
      quietStartMin: 0,
      quietEndMin: 1439,
    });
  });

  it('returns what the SERVER stored, not what the client hoped', async () => {
    getPrefs.mockResolvedValue({ ...STORED, tier: 'lots' });
    const r = await call('PUT', { tier: 'lots' });
    expect(r.body.tier).toBe('lots');
    expect(r.body.maxPerDay).toBe(2);
  });

  it('rejects a quiet minute outside 0..1439', async () => {
    for (const body of [
      { quietStartMin: -1 },
      { quietStartMin: 1440 },
      { quietEndMin: 1440 },
      { quietEndMin: 99999 },
    ]) {
      const r = await call('PUT', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects a non-integer quiet minute', async () => {
    expect((await call('PUT', { quietStartMin: 12.5 })).status).toBe(400);
  });

  it('rejects a tier that is not one of the three', async () => {
    const r = await call('PUT', { tier: 'loud' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/few\|moderate\|lots/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects unknown fields rather than silently ignoring them', async () => {
    // A client sending `maxPerDay` or `kinds` is asking for something this route does not offer;
    // accepting-and-dropping it would look like it worked.
    expect((await call('PUT', { maxPerDay: 20 })).status).toBe(400);
  });

  it('accepts an empty body as a no-op', async () => {
    const r = await call('PUT', {});
    expect(r.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith('u1', {});
  });

  it('reports a storage failure instead of pretending it saved', async () => {
    upsert.mockRejectedValueOnce(new Error('db down'));
    expect((await call('PUT', { tier: 'few' })).status).toBe(500);
  });
});

describe('GET /me/local-nudges', () => {
  it('hands the device what it needs to schedule the local set', async () => {
    const r = await call('GET', undefined, '/me/local-nudges');
    expect(r.status).toBe(200);
    expect(buildPlan).toHaveBeenCalledWith('u1', expect.any(Date));
  });

  it('reports a failure rather than serving a half-built plan', async () => {
    buildPlan.mockRejectedValueOnce(new Error('db down'));
    expect((await call('GET', undefined, '/me/local-nudges')).status).toBe(500);
  });
});
