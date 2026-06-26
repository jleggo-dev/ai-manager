import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName } from './setup.ts';

describe('Security', () => {
  const TEST_RAW_KEY = 'security-test-key-should-not-leak-abcdef';
  let providerId: string | null = null;
  let aiProfileId: string | null = null;

  beforeAll(async () => {
    const provRes = await request(app)
      .post('/api/providers')
      .set(authHeaders())
      .send({
        name: uniqueName('sec-provider'),
        type: 'devs-ai',
        base_url: 'https://security-test.example.com',
        api_key: TEST_RAW_KEY,
      });
    if (provRes.status === 201) {
      providerId = provRes.body.id;
    }

    if (providerId) {
      const profRes = await request(app)
        .post('/api/ai-profiles')
        .set(authHeaders())
        .send({
          name: uniqueName('sec-profile'),
          provider_id: providerId,
          external_ai_id: 'test-model-sec-123',
          profile_type: 'model',
          mode: 'chat',
        });
      if (profRes.status === 201) {
        aiProfileId = profRes.body.id;
      }
    }
  });

  afterAll(async () => {
    if (aiProfileId) {
      await request(app).delete(`/api/ai-profiles/${aiProfileId}`).set(authHeaders());
    }
    if (providerId) {
      await request(app).delete(`/api/providers/${providerId}`).set(authHeaders());
    }
  });

  it('GET /api/providers list masks api_key (no raw key exposed)', async () => {
    expect(providerId).toBeTruthy();
    const res = await request(app).get('/api/providers').set(authHeaders());
    expect(res.status).toBe(200);

    const provider = res.body.data.find((p: { id: string }) => p.id === providerId);
    expect(provider).toBeDefined();
    expect(provider).not.toHaveProperty('api_key');
    expect(JSON.stringify(res.body)).not.toContain(TEST_RAW_KEY);
  });

  it('GET /api/providers/:id masks api_key (no raw key exposed)', async () => {
    expect(providerId).toBeTruthy();
    const res = await request(app).get(`/api/providers/${providerId}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('api_key');
  });

  it('GET /api/ai-profiles/:id strips api_key from provider join', async () => {
    expect(aiProfileId).toBeTruthy();
    const res = await request(app).get(`/api/ai-profiles/${aiProfileId}`).set(authHeaders());
    expect(res.status).toBe(200);
    if (res.body.provider) {
      expect(res.body.provider).not.toHaveProperty('api_key');
    }
    expect(JSON.stringify(res.body)).not.toContain(TEST_RAW_KEY);
  });

  it('GET /api/chat-sessions list does not include api_key in nested objects', async () => {
    const res = await request(app).get('/api/chat-sessions').set(authHeaders());
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(TEST_RAW_KEY);
    if (res.body.data?.length > 0) {
      for (const session of res.body.data) {
        if (session.ai_profile?.provider) {
          expect(session.ai_profile.provider).not.toHaveProperty('api_key');
        }
      }
    }
  });

  it('API key listing endpoint does not expose full keys or hashes', async () => {
    const res = await request(app).get('/api/api-keys').set(authHeaders());
    // Route explicitly rejects API-key auth (requires JWT session)
    expect(res.status).toBe(403);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('aim_sk_');
  });

  it('error responses for invalid auth do not echo key material', async () => {
    const badKey = 'aim_sk_secret_that_must_not_leak';
    const res = await request(app).get('/api/providers').set('Authorization', `Bearer ${badKey}`);
    expect(res.status).toBe(401);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(badKey);
    expect(body).not.toContain('aim_sk_');
  });

  it('rate limit headers are present on responses', async () => {
    const res = await request(app).get('/api/providers').set(authHeaders());
    expect(res.status).toBe(200);
    const h = res.headers;
    // express-rate-limit standardHeaders: 'draft-7' emits RateLimit-Policy and RateLimit
    const hasRateLimitHeaders =
      h['ratelimit-policy'] !== undefined || h['ratelimit'] !== undefined || h['x-ratelimit-limit'] !== undefined;
    expect(hasRateLimitHeaders).toBe(true);
  });

  it('malformed authorization header returns 401 without exposing internals', async () => {
    const res = await request(app).get('/api/providers').set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/node_modules/);
    expect(body).not.toMatch(/at\s+\w+\s+\(/);
    expect(body).not.toContain('dXNlcjpwYXNz');
  });
});
