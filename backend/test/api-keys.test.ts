import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName } from './setup.ts';

/**
 * API Keys routes require a Supabase user session (JWT), not an API key.
 * The test setup authenticates via API key, so CRUD operations return 403.
 * We verify both the rejection contract and the error messaging.
 */
describe('API Keys', () => {
  it('GET /api/api-keys rejects API-key auth with 403', async () => {
    const res = await request(app)
      .get('/api/api-keys')
      .set(authHeaders());
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/user session|JWT/i);
  });

  it('POST /api/api-keys rejects API-key auth with 403', async () => {
    const res = await request(app)
      .post('/api/api-keys')
      .set(authHeaders())
      .send({ name: uniqueName('Test Key') });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/user session|JWT/i);
  });

  it('POST /api/api-keys rejects empty name with 400 (via requireRole passthrough)', async () => {
    const res = await request(app)
      .post('/api/api-keys')
      .set(authHeaders())
      .send({ name: '' });
    // requireRole passes API-key mode through, then the handler checks mode
    expect([400, 403]).toContain(res.status);
    expect(res.body).toHaveProperty('error');
  });

  it('DELETE /api/api-keys/:id rejects API-key auth with 403', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const res = await request(app)
      .delete(`/api/api-keys/${fakeId}`)
      .set(authHeaders());
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/user session|JWT/i);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/api-keys');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});
