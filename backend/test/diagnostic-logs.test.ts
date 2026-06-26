import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';

describe('Diagnostic Logs', () => {
  let firstLogId: string | null = null;

  it('GET /api/diagnostic-logs returns paginated list', async () => {
    const res = await request(app)
      .get('/api/diagnostic-logs')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination).toHaveProperty('has_more');
    expect(res.body.pagination).toHaveProperty('limit');

    if (res.body.data.length > 0) {
      firstLogId = res.body.data[0].id;
    }
  });

  it('GET /api/diagnostic-logs/:id returns a single log', async () => {
    if (!firstLogId) {
      console.log('  ↳ no diagnostic logs in database — skipping detail fetch');
      return;
    }
    const res = await request(app)
      .get(`/api/diagnostic-logs/${firstLogId}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', firstLogId);
    expect(res.body).toHaveProperty('created_at');
  });

  it('GET /api/diagnostic-logs respects limit parameter', async () => {
    const res = await request(app)
      .get('/api/diagnostic-logs?limit=5')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(5);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
  });

  it('GET /api/diagnostic-logs filters by processingJobId', async () => {
    const fakeJobId = '00000000-0000-0000-0000-000000000099';
    const res = await request(app)
      .get(`/api/diagnostic-logs?processingJobId=${fakeJobId}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const log of res.body.data) {
      expect(log.processing_job_id).toBe(fakeJobId);
    }
  });

  it('GET /api/diagnostic-logs/token-stats returns aggregation', async () => {
    const res = await request(app)
      .get('/api/diagnostic-logs/token-stats')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sampleSize');
    expect(typeof res.body.sampleSize).toBe('number');
    expect(res.body).toHaveProperty('totals');
    expect(res.body.totals).toHaveProperty('promptTokens');
    expect(res.body.totals).toHaveProperty('completionTokens');
    expect(res.body.totals).toHaveProperty('totalTokens');
    expect(res.body).toHaveProperty('byJob');
    expect(res.body).toHaveProperty('byModel');
  });
});
