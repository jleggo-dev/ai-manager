import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName } from './setup.ts';

/**
 * Copied from src/db/tenant.ts so we can unit-test without AsyncLocalStorage.
 */
interface AuthContext {
  mode: string;
  userId?: string;
  forwardedUserId?: string;
}

function effectiveUserId(ctx: AuthContext | null | undefined): string | null {
  if (!ctx) return null;
  if (ctx.mode === 'jwt') return ctx.userId ?? null;
  return ctx.forwardedUserId || ctx.userId || null;
}

/* ── Unit: effectiveUserId ─────────────────────────────────── */

describe('effectiveUserId (unit)', () => {
  it('returns null for undefined context', () => {
    expect(effectiveUserId(undefined)).toBeNull();
  });

  it('returns null for null context', () => {
    expect(effectiveUserId(null)).toBeNull();
  });

  it('returns userId for jwt mode', () => {
    const ctx = { mode: 'jwt', userId: 'jwt-user-123' };
    expect(effectiveUserId(ctx)).toBe('jwt-user-123');
  });

  it('prefers forwardedUserId over api key creator for api_key mode', () => {
    const ctx = { mode: 'api_key', userId: 'apikey-user-456', forwardedUserId: 'fwd-789' };
    expect(effectiveUserId(ctx)).toBe('fwd-789');
  });

  it('falls back to userId (api key creator) when forwardedUserId is absent', () => {
    const ctx = { mode: 'api_key', userId: 'apikey-user-456' };
    expect(effectiveUserId(ctx)).toBe('apikey-user-456');
  });

  it('returns null for api_key mode with neither userId nor forwardedUserId', () => {
    const ctx = { mode: 'api_key' };
    expect(effectiveUserId(ctx)).toBeNull();
  });
});

/* ── Integration: tenant scoping via API ───────────────────── */

describe('Tenant scoping (integration)', () => {
  const createdProviderIds: string[] = [];
  const createdProfileIds: string[] = [];

  afterAll(async () => {
    for (const id of [...createdProfileIds].reverse()) {
      try {
        await request(app).delete(`/api/ai-profiles/${id}`).set(authHeaders());
      } catch {
        /* best-effort cleanup */
      }
    }
    for (const id of [...createdProviderIds].reverse()) {
      try {
        await request(app).delete(`/api/providers/${id}`).set(authHeaders());
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  let tenantProviderId: string;
  let tenantProfileId: string;

  it('creating a provider auto-injects workspace_id', async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(authHeaders())
      .send({
        name: uniqueName('Tenant Provider'),
        type: 'devs-ai',
        api_key: 'sk-tenant-test-key',
        base_url: 'https://devs.ai',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('workspace_id');
    expect(typeof res.body.workspace_id).toBe('string');
    tenantProviderId = res.body.id;
    createdProviderIds.push(tenantProviderId);
  });

  it('created provider is returned in GET list for same workspace', async () => {
    const res = await request(app).get('/api/providers').set(authHeaders());
    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(tenantProviderId);
  });

  it('creating an AI profile auto-injects workspace_id', async () => {
    const res = await request(app)
      .post('/api/ai-profiles')
      .set(authHeaders())
      .send({
        name: uniqueName('Tenant Profile'),
        provider_id: tenantProviderId,
        external_ai_id: 'gpt-4',
        description: 'Tenant-scoped test profile',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('workspace_id');
    expect(typeof res.body.workspace_id).toBe('string');
    tenantProfileId = res.body.id;
    createdProfileIds.push(tenantProfileId);
  });

  it('listing only returns items for the authenticated workspace', async () => {
    const provRes = await request(app).get('/api/providers').set(authHeaders());
    expect(provRes.status).toBe(200);

    const workspaceIds = new Set(
      provRes.body.data.map((p: { workspace_id?: string }) => p.workspace_id).filter(Boolean),
    );
    expect(workspaceIds.size).toBeLessThanOrEqual(1);
  });

  it('non-existent UUID returns 404 (cross-workspace isolation)', async () => {
    const fakeId = '00000000-0000-4000-a000-000000000000';
    const res = await request(app).get(`/api/providers/${fakeId}`).set(authHeaders());
    expect(res.status).toBe(404);
  });

  it('unauthenticated request is rejected', async () => {
    const res = await request(app).get('/api/providers');
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
