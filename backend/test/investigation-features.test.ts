import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';

describe('Investigation Features', () => {
  /* ── Health Status in List ─────────────────────────────── */

  describe('GET /api/health-checks/', () => {
    it('returns healthStatus field for each check', async () => {
      const res = await request(app).get('/api/health-checks/').set(authHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      for (const check of res.body.data) {
        expect(check).toHaveProperty('healthStatus');
        expect(['healthy', 'degraded', 'down', 'unknown']).toContain(check.healthStatus);
      }
    });
  });

  /* ── Filtered Runs ─────────────────────────────────────── */

  describe('GET /api/health-checks/:id/runs (filters)', () => {
    it('returns total alongside data', async () => {
      const listRes = await request(app).get('/api/health-checks/').set(authHeaders());
      if (listRes.body.data.length === 0) return;

      const checkId = listRes.body.data[0].id;
      const res = await request(app).get(`/api/health-checks/${checkId}/runs`).set(authHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
      expect(typeof res.body.total).toBe('number');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('filters by status', async () => {
      const listRes = await request(app).get('/api/health-checks/').set(authHeaders());
      if (listRes.body.data.length === 0) return;

      const checkId = listRes.body.data[0].id;
      const res = await request(app).get(`/api/health-checks/${checkId}/runs?status=pass`).set(authHeaders());

      expect(res.status).toBe(200);
      for (const run of res.body.data) {
        expect(run.status).toBe('pass');
      }
    });

    it('supports offset and limit', async () => {
      const listRes = await request(app).get('/api/health-checks/').set(authHeaders());
      if (listRes.body.data.length === 0) return;

      const checkId = listRes.body.data[0].id;
      const res = await request(app).get(`/api/health-checks/${checkId}/runs?limit=5&offset=0`).set(authHeaders());

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
    });
  });

  /* ── Failure Patterns ──────────────────────────────────── */

  describe('GET /api/health-checks/:id/failure-patterns', () => {
    it('returns error_groups and hourly_distribution', async () => {
      const listRes = await request(app).get('/api/health-checks/').set(authHeaders());
      if (listRes.body.data.length === 0) return;

      const checkId = listRes.body.data[0].id;
      const res = await request(app).get(`/api/health-checks/${checkId}/failure-patterns`).set(authHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('error_groups');
      expect(res.body).toHaveProperty('hourly_distribution');
      expect(Array.isArray(res.body.error_groups)).toBe(true);
      expect(Array.isArray(res.body.hourly_distribution)).toBe(true);
    });

    it('accepts from/to date params', async () => {
      const listRes = await request(app).get('/api/health-checks/').set(authHeaders());
      if (listRes.body.data.length === 0) return;

      const checkId = listRes.body.data[0].id;
      const res = await request(app)
        .get(`/api/health-checks/${checkId}/failure-patterns?from=2025-01-01&to=2025-12-31`)
        .set(authHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('error_groups');
    });
  });
});
