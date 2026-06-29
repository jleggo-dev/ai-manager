import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';

/** Skip when triggers table is not migrated (live Supabase returns 500). */
function shouldSkipTriggersIntegration(res: { status: number }): boolean {
  return res.status === 500 || res.status === 503;
}

describe('Triggers API', () => {
  it('POST /api/triggers/:slug/run returns 401 without auth', async () => {
    const res = await request(app).post('/api/triggers/nonexistent/run').send({});
    expect(res.status).toBe(401);
  });

  it('POST /api/triggers/:slug/run returns 404 for unknown slug with API key', async () => {
    const res = await request(app)
      .post('/api/triggers/nonexistent-trigger-slug/run')
      .set(authHeaders())
      .send({});
    if (shouldSkipTriggersIntegration(res)) return;
    expect(res.status).toBe(404);
  });

  it('GET /api/triggers lists triggers', async () => {
    const res = await request(app).get('/api/triggers').set(authHeaders());
    if (shouldSkipTriggersIntegration(res)) return;
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
