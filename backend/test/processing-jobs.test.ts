import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName, uniqueSlug } from './setup.ts';

const NON_EXISTENT_UUID = '00000000-0000-4000-a000-000000000000';

let providerId: string;
let profileId: string;
let jobId: string;

beforeAll(async () => {
  const provRes = await request(app)
    .post('/api/providers')
    .set(authHeaders())
    .send({
      name: uniqueName('PJ Test Provider'),
      type: 'devs-ai',
      base_url: 'https://pj-test.example.com',
      api_key: 'test-key-pj',
    });
  expect(provRes.status).toBe(201);
  providerId = provRes.body.id;

  const profRes = await request(app)
    .post('/api/ai-profiles')
    .set(authHeaders())
    .send({
      name: uniqueName('PJ Test Profile'),
      provider_id: providerId,
      external_ai_id: 'test-ai-pj',
    });
  expect(profRes.status).toBe(201);
  profileId = profRes.body.id;
});

afterAll(async () => {
  if (jobId) {
    await request(app).delete(`/api/processing-jobs/${jobId}`).set(authHeaders());
  }
  if (profileId) {
    await request(app).delete(`/api/ai-profiles/${profileId}`).set(authHeaders());
  }
  if (providerId) {
    await request(app).delete(`/api/providers/${providerId}`).set(authHeaders());
  }
});

describe('Processing Jobs CRUD', () => {
  it('lists processing jobs', async () => {
    const res = await request(app).get('/api/processing-jobs').set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('pagination');
  });

  it('creates a processing job', async () => {
    const name = uniqueName('Test Job');
    const slug = uniqueSlug('test-job');
    const res = await request(app)
      .post('/api/processing-jobs')
      .set(authHeaders())
      .send({
        name,
        slug,
        ai_profile_id: profileId,
        description: 'Integration test job',
        config: { promptTemplate: 'Hello {{name}}' },
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe(name);
    expect(res.body.slug).toBe(slug);
    expect(res.body.ai_profile_id).toBe(profileId);
    expect(res.body.is_active).toBe(true);
    jobId = res.body.id;
  });

  it('gets a processing job by ID', async () => {
    const res = await request(app).get(`/api/processing-jobs/${jobId}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
    expect(res.body).toHaveProperty('ai_profile');
  });

  it('updates a processing job', async () => {
    const res = await request(app)
      .put(`/api/processing-jobs/${jobId}`)
      .set(authHeaders())
      .send({ description: 'Updated description' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Updated description');
  });

  it('deep-merges config on update', async () => {
    await request(app)
      .put(`/api/processing-jobs/${jobId}`)
      .set(authHeaders())
      .send({ config: { promptTemplate: 'Prompt A', settingX: true } });

    const mergeRes = await request(app)
      .put(`/api/processing-jobs/${jobId}`)
      .set(authHeaders())
      .send({ config: { settingY: 42 } });

    expect(mergeRes.status).toBe(200);
    expect(mergeRes.body.config).toMatchObject({
      promptTemplate: 'Prompt A',
      settingX: true,
      settingY: 42,
    });
  });

  it('lists with pagination', async () => {
    const res = await request(app).get('/api/processing-jobs?limit=1').set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(1);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
  });

  it('returns 400 when creating with missing required fields', async () => {
    const res = await request(app)
      .post('/api/processing-jobs')
      .set(authHeaders())
      .send({ description: 'Missing name and slug' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation failed');
    expect(res.body).toHaveProperty('details');
  });

  it('returns 404 for non-existent UUID', async () => {
    const res = await request(app).get(`/api/processing-jobs/${NON_EXISTENT_UUID}`).set(authHeaders());
    expect(res.status).toBe(404);
  });

  it('tests job execution endpoint shape', async () => {
    const res = await request(app)
      .post(`/api/processing-jobs/${jobId}/test`)
      .set(authHeaders())
      .send({ message: 'Hello integration test', callingApplication: 'integration-test' });

    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('raw');
      expect(res.body).toHaveProperty('formatted');
      expect(res.body).toHaveProperty('durationMs');
    }
  });

  it('rejects job execution without message', async () => {
    const res = await request(app).post(`/api/processing-jobs/${jobId}/test`).set(authHeaders()).send({});
    expect(res.status).toBe(400);
  });

  it('rejects job execution when callingApplication is missing (API key auth)', async () => {
    const res = await request(app)
      .post(`/api/processing-jobs/${jobId}/test`)
      .set(authHeaders())
      .send({ message: 'Should be rejected' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/callingApplication is required/i);
  });

  it('accepts job execution when callingApplication is provided', async () => {
    const res = await request(app)
      .post(`/api/processing-jobs/${jobId}/test`)
      .set(authHeaders())
      .send({ message: 'Should be accepted', callingApplication: 'test:enforcement' });
    // Should NOT be 400 for missing callingApplication
    // (may 200 or 500 depending on LLM provider connectivity)
    if (res.status === 400) {
      expect(res.body.error).not.toMatch(/callingApplication is required/i);
    }
  });

  it('batch updates multiple jobs', async () => {
    const res = await request(app)
      .patch('/api/processing-jobs/batch')
      .set(authHeaders())
      .send({
        updates: [{ id: jobId, description: 'Batch updated' }],
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results[0]).toMatchObject({ id: jobId, status: 'ok' });
  });

  it('rejects batch update with empty array', async () => {
    const res = await request(app).patch('/api/processing-jobs/batch').set(authHeaders()).send({ updates: [] });
    expect(res.status).toBe(400);
  });

  it('creates a job with requires_user_credentials flag', async () => {
    const slug = uniqueSlug('creds-job');
    const res = await request(app)
      .post('/api/processing-jobs')
      .set(authHeaders())
      .send({
        name: uniqueName('Creds Job'),
        slug,
        ai_profile_id: profileId,
        requires_user_credentials: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.requires_user_credentials).toBe(true);

    const getRes = await request(app).get(`/api/processing-jobs/${res.body.id}`).set(authHeaders());
    expect(getRes.status).toBe(200);
    expect(getRes.body.requires_user_credentials).toBe(true);

    await request(app).delete(`/api/processing-jobs/${res.body.id}`).set(authHeaders());
  });

  it('defaults requires_user_credentials to false when omitted', async () => {
    expect(jobId).toBeTruthy();
    const res = await request(app).get(`/api/processing-jobs/${jobId}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.requires_user_credentials).toBe(false);
  });

  it('updates requires_user_credentials on an existing job', async () => {
    const enableRes = await request(app)
      .put(`/api/processing-jobs/${jobId}`)
      .set(authHeaders())
      .send({ requires_user_credentials: true });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.requires_user_credentials).toBe(true);

    const disableRes = await request(app)
      .put(`/api/processing-jobs/${jobId}`)
      .set(authHeaders())
      .send({ requires_user_credentials: false });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.requires_user_credentials).toBe(false);
  });

  it('deletes a processing job', async () => {
    const res = await request(app).delete(`/api/processing-jobs/${jobId}`).set(authHeaders());
    expect(res.status).toBe(204);
  });

  it('returns 404 after deletion', async () => {
    const res = await request(app).get(`/api/processing-jobs/${jobId}`).set(authHeaders());
    expect(res.status).toBe(404);
    jobId = '';
  });
});
