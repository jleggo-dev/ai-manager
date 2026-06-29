import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';

describe('Config sync API', () => {
  it('POST /api/sync dry-run accepts empty config', async () => {
    const res = await request(app)
      .post('/api/sync')
      .set(authHeaders())
      .send({ dryRun: true, jobs: [] });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dryRun', true);
    expect(res.body).toHaveProperty('diff');
  });
});
