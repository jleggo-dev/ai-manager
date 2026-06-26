import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName } from './setup.ts';

describe('Providers CRUD', () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of [...createdIds].reverse()) {
      try {
        await request(app).delete(`/api/providers/${id}`).set(authHeaders());
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  /* ── Lifecycle ────────────────────────────────────────────── */

  let lifecycleId: string;

  it('GET /api/providers — lists providers', async () => {
    const res = await request(app).get('/api/providers').set(authHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('pagination');
  });

  it('POST /api/providers — creates a provider', async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(authHeaders())
      .send({
        name: uniqueName('Test Provider'),
        type: 'devs-ai',
        api_key: 'sk-test-key-12345',
        base_url: 'https://devs.ai',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toContain('Test Provider');
    lifecycleId = res.body.id;
    createdIds.push(lifecycleId);
  });

  it('GET /api/providers/:id — gets the created provider', async () => {
    const res = await request(app).get(`/api/providers/${lifecycleId}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(lifecycleId);
  });

  it('api_key is masked in response (not raw)', async () => {
    const res = await request(app).get(`/api/providers/${lifecycleId}`).set(authHeaders());
    expect(res.status).toBe(200);
    if (res.body.api_key) {
      expect(res.body.api_key).toMatch(/\.\.\.$/);
      expect(res.body.api_key).not.toBe('sk-test-key-12345');
    }
  });

  it('PUT /api/providers/:id — updates the provider name', async () => {
    const newName = uniqueName('Updated Provider');
    const res = await request(app).put(`/api/providers/${lifecycleId}`).set(authHeaders()).send({ name: newName });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(newName);
  });

  it('DELETE /api/providers/:id — deletes the provider', async () => {
    const res = await request(app).delete(`/api/providers/${lifecycleId}`).set(authHeaders());
    expect(res.status).toBe(204);
    const idx = createdIds.indexOf(lifecycleId);
    if (idx !== -1) createdIds.splice(idx, 1);
  });

  it('GET after delete returns 404', async () => {
    const res = await request(app).get(`/api/providers/${lifecycleId}`).set(authHeaders());
    expect(res.status).toBe(404);
  });

  /* ── Validation ───────────────────────────────────────────── */

  it('rejects creation with missing required fields (400)', async () => {
    const res = await request(app).post('/api/providers').set(authHeaders()).send({ type: 'devs-ai' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('rejects creation with invalid URL (400)', async () => {
    const res = await request(app).post('/api/providers').set(authHeaders()).send({
      name: 'Bad URL Provider',
      type: 'devs-ai',
      base_url: 'not-a-valid-url',
    });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: { path: string }) => d.path === 'base_url')).toBe(true);
  });

  /* ── Pagination & queries ─────────────────────────────────── */

  it('GET /api/providers?limit=2 — respects limit', async () => {
    const res = await request(app).get('/api/providers?limit=2').set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });

  it('GET /api/providers/:id — 404 for non-existent UUID', async () => {
    const fakeId = '00000000-0000-4000-a000-000000000000';
    const res = await request(app).get(`/api/providers/${fakeId}`).set(authHeaders());
    expect(res.status).toBe(404);
  });

  it('pagination response includes all metadata fields', async () => {
    const res = await request(app).get('/api/providers?limit=1').set(authHeaders());
    expect(res.status).toBe(200);
    const { pagination } = res.body;
    expect(pagination).toHaveProperty('next_cursor');
    expect(pagination).toHaveProperty('prev_cursor');
    expect(pagination).toHaveProperty('has_more');
    expect(pagination).toHaveProperty('limit', 1);
  });
});
