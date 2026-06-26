import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';

describe('Authentication', () => {
  it('rejects requests without Authorization header', async () => {
    const res = await request(app).get('/api/providers');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects invalid API key', async () => {
    const res = await request(app)
      .get('/api/providers')
      .set('Authorization', 'Bearer aim_sk_completely_invalid_key');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('does not echo the invalid key in error response', async () => {
    const badKey = 'aim_sk_should_not_be_echoed_back';
    const res = await request(app)
      .get('/api/providers')
      .set('Authorization', `Bearer ${badKey}`);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(badKey);
  });

  it('accepts valid API key and returns data', async () => {
    const res = await request(app)
      .get('/api/providers')
      .set(authHeaders());
    expect(res.status).toBe(200);
  });

  it('rejects malformed JSON body with 400', async () => {
    const res = await request(app)
      .post('/api/providers')
      .set('Content-Type', 'application/json')
      .set(authHeaders())
      .send('{"broken json');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid json/i);
  });

  it('rejects invalid UUID in X-Forwarded-User-Id', async () => {
    const res = await request(app)
      .get('/api/providers')
      .set(authHeaders())
      .set('X-Forwarded-User-Id', 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uuid/i);
  });

  it('accepts valid UUID in X-Forwarded-User-Id', async () => {
    const res = await request(app)
      .get('/api/providers')
      .set(authHeaders())
      .set('X-Forwarded-User-Id', '00000000-0000-0000-0000-000000000001');
    expect(res.status).toBe(200);
  });

  it('rejects non-matching X-Workspace-Id with 403', async () => {
    const res = await request(app)
      .get('/api/providers')
      .set(authHeaders())
      .set('X-Workspace-Id', '00000000-0000-0000-0000-000000000099');
    expect(res.status).toBe(403);
  });
});
