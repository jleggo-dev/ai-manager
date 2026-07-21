import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName, uniqueSlug } from './setup.ts';

describe('Config sync API', () => {
  it('POST /api/sync dry-run accepts empty config', async () => {
    const res = await request(app).post('/api/sync').set(authHeaders()).send({ dryRun: true, jobs: [] });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dryRun', true);
    expect(res.body).toHaveProperty('diff');
  });

  describe('job config replace (sync source of truth)', () => {
    let providerId: string;
    let profileId: string;
    let jobId: string;
    let jobSlug: string;
    let jobName: string;

    beforeAll(async () => {
      const provRes = await request(app)
        .post('/api/providers')
        .set(authHeaders())
        .send({
          name: uniqueName('Sync Replace Provider'),
          type: 'devs-ai',
          base_url: 'https://sync-replace-test.example.com',
          api_key: 'test-key-sync-replace',
        });
      expect(provRes.status).toBe(201);
      providerId = provRes.body.id;

      const profRes = await request(app)
        .post('/api/ai-profiles')
        .set(authHeaders())
        .send({
          name: uniqueName('Sync Replace Profile'),
          provider_id: providerId,
          external_ai_id: 'test-ai-sync-replace',
        });
      expect(profRes.status).toBe(201);
      profileId = profRes.body.id;

      jobSlug = uniqueSlug('sync-replace-job');
      jobName = uniqueName('Sync Replace Job');
      const jobRes = await request(app)
        .post('/api/processing-jobs')
        .set(authHeaders())
        .send({
          name: jobName,
          slug: jobSlug,
          ai_profile_id: profileId,
          description: 'sync replace test',
          config: {
            promptTemplate: 'Hello',
            expectedSchema: {
              type: 'object',
              properties: { keep: { type: 'string' }, dropMe: { type: 'number' } },
              required: ['keep', 'dropMe'],
            },
            staleTopLevel: true,
          },
        });
      expect(jobRes.status).toBe(201);
      jobId = jobRes.body.id;
    });

    afterAll(async () => {
      if (jobId) await request(app).delete(`/api/processing-jobs/${jobId}`).set(authHeaders());
      if (profileId) await request(app).delete(`/api/ai-profiles/${profileId}`).set(authHeaders());
      if (providerId) await request(app).delete(`/api/providers/${providerId}`).set(authHeaders());
    });

    it('replaces nested config so absent keys are deleted', async () => {
      const desiredConfig = {
        promptTemplate: 'Hello synced',
        expectedSchema: {
          type: 'object',
          properties: { keep: { type: 'string' } },
          required: ['keep'],
        },
      };

      const syncRes = await request(app)
        .post('/api/sync')
        .set(authHeaders())
        .send({
          jobs: [
            {
              name: jobName,
              slug: jobSlug,
              ai_profile_id: profileId,
              description: 'sync replace test',
              config: desiredConfig,
            },
          ],
        });
      expect(syncRes.status).toBe(200);
      expect(syncRes.body.diff).toEqual(
        expect.arrayContaining([expect.objectContaining({ entity: 'job', slug: jobSlug, action: 'update' })]),
      );

      const getRes = await request(app).get(`/api/processing-jobs/${jobId}`).set(authHeaders());
      expect(getRes.status).toBe(200);
      expect(getRes.body.config).toEqual(desiredConfig);
      expect(getRes.body.config).not.toHaveProperty('staleTopLevel');
      expect(getRes.body.config.expectedSchema.properties).not.toHaveProperty('dropMe');
    });
  });
});
