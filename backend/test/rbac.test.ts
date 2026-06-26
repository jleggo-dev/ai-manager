import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName } from './setup.ts';

describe('Authorization & Access Control', () => {
  let providerId: string | null = null;

  afterAll(async () => {
    if (providerId) {
      await request(app).delete(`/api/providers/${providerId}`).set(authHeaders());
    }
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/providers')
      .send({ name: 'Unauth', type: 'devs-ai', base_url: 'https://example.com' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('any workspace member can create a provider', async () => {
    const name = uniqueName('rbac-create');
    const res = await request(app).post('/api/providers').set(authHeaders()).send({
      name,
      type: 'devs-ai',
      base_url: 'https://rbac-test.example.com',
      api_key: 'rbac-test-key-12345',
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe(name);
    providerId = res.body.id;
  });

  it('any workspace member can update a provider', async () => {
    expect(providerId).toBeTruthy();
    const updatedName = uniqueName('rbac-updated');
    const res = await request(app).put(`/api/providers/${providerId}`).set(authHeaders()).send({ name: updatedName });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(updatedName);
  });

  it('any workspace member can delete a provider', async () => {
    expect(providerId).toBeTruthy();
    const res = await request(app).delete(`/api/providers/${providerId}`).set(authHeaders());
    expect(res.status).toBe(204);
    providerId = null;
  });

  it('authenticated request reaches Zod validation (no role gate)', async () => {
    const res = await request(app).post('/api/ai-profiles').set(authHeaders()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('unauthenticated DELETE returns 401', async () => {
    const res = await request(app).delete('/api/providers/00000000-0000-0000-0000-000000000001');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('unauthenticated access to API keys returns 401', async () => {
    const res = await request(app).get('/api/api-keys');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('unauthenticated access to settings returns 401', async () => {
    const res = await request(app).put('/api/settings/test-key').send({ value: 'test' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('unauthenticated access to calling-applications returns 401', async () => {
    const res = await request(app).post('/api/calling-applications').send({ name: 'test' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

describe('Chat Session Write Restrictions', () => {
  it('unauthenticated POST to session messages returns 401', async () => {
    const fakeSessionId = '00000000-0000-0000-0000-000000000001';
    const res = await request(app).post(`/api/chat-sessions/${fakeSessionId}/messages`).send({ message: 'hello' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('unauthenticated PUT to session reset returns 401', async () => {
    const fakeSessionId = '00000000-0000-0000-0000-000000000001';
    const res = await request(app).put(`/api/chat-sessions/${fakeSessionId}/reset`);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('unauthenticated PUT to session close returns 401', async () => {
    const fakeSessionId = '00000000-0000-0000-0000-000000000001';
    const res = await request(app).put(`/api/chat-sessions/${fakeSessionId}/close`);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('unauthenticated POST to tool-outputs returns 401', async () => {
    const fakeSessionId = '00000000-0000-0000-0000-000000000001';
    const res = await request(app)
      .post(`/api/chat-sessions/${fakeSessionId}/tool-outputs`)
      .send({ outputs: [{ toolCallId: 'tc1', output: 'ok' }] });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('authenticated GET to session still returns (read allowed for all)', async () => {
    const fakeSessionId = '00000000-0000-0000-0000-000000000001';
    const res = await request(app).get(`/api/chat-sessions/${fakeSessionId}`).set(authHeaders());
    expect([200, 404]).toContain(res.status);
  });

  it('authenticated DELETE to session still returns (delete allowed for all)', async () => {
    const fakeSessionId = '00000000-0000-0000-0000-000000000001';
    const res = await request(app).delete(`/api/chat-sessions/${fakeSessionId}`).set(authHeaders());
    expect([204, 404]).toContain(res.status);
  });
});
