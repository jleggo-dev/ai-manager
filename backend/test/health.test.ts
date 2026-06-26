import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './setup.ts';

describe('Health Check', () => {
  it('GET /api/health returns 200 with status field', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(['ok', 'degraded']).toContain(res.body.status);
  });

  it('reports status as ok when all tables are reachable', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBe('ok');
  });

  it('health endpoint is publicly accessible (no auth required)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});
