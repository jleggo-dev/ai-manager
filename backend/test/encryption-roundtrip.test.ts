import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName } from './setup.ts';

let providerId: string;

afterAll(async () => {
  if (providerId) {
    await request(app).delete(`/api/providers/${providerId}`).set(authHeaders());
  }
});

describe('Provider API Key Encryption Roundtrip', () => {
  it('creates a provider with api_key and strips it from response', async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(authHeaders())
      .send({
        name: uniqueName('Enc Test'),
        type: 'devs-ai',
        base_url: 'https://enc.example.com',
        api_key: 'sk-test-roundtrip-key-12345',
      });
    expect(res.status).toBe(201);
    providerId = res.body.id;
    expect(res.body).not.toHaveProperty('api_key');
    expect(JSON.stringify(res.body)).not.toContain('sk-test-roundtrip-key-12345');
  });

  it('GET strips api_key from response', async () => {
    const res = await request(app)
      .get(`/api/providers/${providerId}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('api_key');
    expect(JSON.stringify(res.body)).not.toContain('sk-test-roundtrip-key-12345');
  });

  it('updating api_key strips it from response', async () => {
    const res = await request(app)
      .put(`/api/providers/${providerId}`)
      .set(authHeaders())
      .send({ api_key: 'sk-new-key-67890' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('api_key');
    expect(JSON.stringify(res.body)).not.toContain('sk-new-key-67890');
  });
});
