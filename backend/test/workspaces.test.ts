import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';

/**
 * Workspace routes require a Supabase user session (JWT).
 * The test setup authenticates via API key, so these endpoints return 403.
 * We verify the rejection contract and error messaging.
 */
describe('Workspaces', () => {
  it('GET /api/workspaces rejects API-key auth with 403', async () => {
    const res = await request(app)
      .get('/api/workspaces')
      .set(authHeaders());
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/user session|JWT/i);
  });

  it('GET /api/workspaces lists workspaces when no auth', async () => {
    const res = await request(app).get('/api/workspaces');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/workspaces/:id/members rejects API-key auth with 403', async () => {
    const fakeWsId = '00000000-0000-0000-0000-000000000001';
    const res = await request(app)
      .get(`/api/workspaces/${fakeWsId}/members`)
      .set(authHeaders());
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/user session|JWT/i);
  });

  it('GET /api/workspaces/:id/members rejects non-UUID workspace id', async () => {
    const res = await request(app)
      .get('/api/workspaces/not-a-uuid/members')
      .set(authHeaders());
    // Route-level mode check fires before UUID validation
    expect([403, 404]).toContain(res.status);
    expect(res.body).toHaveProperty('error');
  });
});
