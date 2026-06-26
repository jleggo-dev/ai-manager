import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName, onCleanup, runCleanup } from './setup.ts';

const PAGINATION_FIELDS = ['next_cursor', 'prev_cursor', 'has_more', 'limit'];

let seedProviderIds: string[] = [];

beforeAll(async () => {
  for (let i = 0; i < 4; i++) {
    const res = await request(app)
      .post('/api/providers')
      .set(authHeaders())
      .send({
        name: uniqueName(`pagtest-${i}`),
        type: 'devs-ai',
        base_url: `https://pagtest-${i}.example.com`,
      });
    if (res.status === 201) seedProviderIds.push(res.body.id);
  }
  onCleanup(async () => {
    for (const id of seedProviderIds.reverse()) {
      await request(app).delete(`/api/providers/${id}`).set(authHeaders());
    }
  });
});

afterAll(async () => {
  await runCleanup();
});

describe('Cursor-based Pagination', () => {
  it('returns the standard pagination envelope { data, pagination }', async () => {
    const res = await request(app)
      .get('/api/providers')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('pagination');

    for (const field of PAGINATION_FIELDS) {
      expect(res.body.pagination).toHaveProperty(field);
    }
  });

  it('respects a custom limit parameter', async () => {
    const res = await request(app)
      .get('/api/providers?limit=2')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });

  it('caps limit at the MAX_LIMIT (200)', async () => {
    const res = await request(app)
      .get('/api/providers?limit=9999')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(200);
  });

  it('falls back to default limit for zero or negative values', async () => {
    const resZero = await request(app)
      .get('/api/providers?limit=0')
      .set(authHeaders());
    expect(resZero.status).toBe(200);
    expect(resZero.body.pagination.limit).toBe(50);

    const resNeg = await request(app)
      .get('/api/providers?limit=-5')
      .set(authHeaders());
    expect(resNeg.status).toBe(200);
    expect(resNeg.body.pagination.limit).toBe(50);
  });

  it('supports cursor-based forward navigation', async () => {
    const page1 = await request(app)
      .get('/api/providers?limit=2')
      .set(authHeaders());

    expect(page1.status).toBe(200);

    if (!page1.body.pagination.has_more || !page1.body.pagination.next_cursor) {
      return;
    }

    const cursor = encodeURIComponent(page1.body.pagination.next_cursor);
    const page2 = await request(app)
      .get(`/api/providers?limit=2&cursor=${cursor}`)
      .set(authHeaders());

    expect(page2.status).toBe(200);
    expect(page2.body.data.length).toBeGreaterThan(0);

    const page1Ids = page1.body.data.map((r: { id: string }) => r.id);
    const page2Ids = page2.body.data.map((r: { id: string }) => r.id);
    const overlap = page2Ids.filter((id: string) => page1Ids.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('returns results from the beginning when cursor is empty', async () => {
    const withCursor = await request(app)
      .get('/api/providers?cursor=')
      .set(authHeaders());

    const withoutCursor = await request(app)
      .get('/api/providers')
      .set(authHeaders());

    expect(withCursor.status).toBe(200);
    expect(withoutCursor.status).toBe(200);

    if (withCursor.body.data.length > 0 && withoutCursor.body.data.length > 0) {
      expect(withCursor.body.data[0].id).toBe(withoutCursor.body.data[0].id);
    }
  });

  it('returns 400 for an invalid cursor format', async () => {
    const res = await request(app)
      .get('/api/providers?cursor=not-a-valid-cursor-!!!!')
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/invalid cursor/i);
  });

  it('returns a consistent pagination shape across different endpoints', async () => {
    const endpoints = [
      '/api/providers',
      '/api/ai-profiles',
      '/api/processing-jobs',
    ];

    for (const endpoint of endpoints) {
      const res = await request(app)
        .get(endpoint)
        .set(authHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty('pagination');

      for (const field of PAGINATION_FIELDS) {
        expect(res.body.pagination).toHaveProperty(field);
      }
      expect(typeof res.body.pagination.has_more).toBe('boolean');
      expect(typeof res.body.pagination.limit).toBe('number');
    }
  });
});
