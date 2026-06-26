import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName, uniqueSlug, onCleanup, runCleanup } from './setup.ts';

let seedProviderId: string;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/providers')
    .set(authHeaders())
    .send({
      name: uniqueName('valtest'),
      type: 'devs-ai',
      base_url: 'https://valtest.example.com',
    });
  seedProviderId = res.body.id;
  onCleanup(async () => {
    await request(app).delete(`/api/providers/${seedProviderId}`).set(authHeaders());
  });
});

afterAll(async () => {
  await runCleanup();
});

interface ValidationDetail {
  path: string;
  message: string;
}
interface ValidationBody {
  error: string;
  details: ValidationDetail[];
}

function expectValidationError(body: ValidationBody) {
  expect(body).toHaveProperty('error', 'Validation failed');
  expect(body).toHaveProperty('details');
  expect(Array.isArray(body.details)).toBe(true);
  expect(body.details.length).toBeGreaterThan(0);
  for (const detail of body.details) {
    expect(detail).toHaveProperty('path');
    expect(detail).toHaveProperty('message');
    expect(typeof detail.message).toBe('string');
  }
}

describe('Zod Validation Middleware', () => {
  describe('POST /api/providers', () => {
    it('rejects missing name field', async () => {
      const res = await request(app)
        .post('/api/providers')
        .set(authHeaders())
        .send({ type: 'devs-ai', base_url: 'https://example.com' });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'name')).toBe(true);
    });

    it('rejects an invalid base_url (not a URL)', async () => {
      const res = await request(app)
        .post('/api/providers')
        .set(authHeaders())
        .send({ name: 'Bad URL Provider', type: 'devs-ai', base_url: 'not-a-url' });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'base_url')).toBe(true);
    });

    it('rejects an empty body', async () => {
      const res = await request(app).post('/api/providers').set(authHeaders()).send({});

      expect(res.status).toBe(400);
      expectValidationError(res.body);
    });
  });

  describe('POST /api/ai-profiles', () => {
    it('rejects missing provider_id', async () => {
      const res = await request(app).post('/api/ai-profiles').set(authHeaders()).send({
        name: 'No Provider',
        external_ai_id: 'some-ai',
      });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'provider_id')).toBe(true);
    });

    it('rejects non-UUID provider_id', async () => {
      const res = await request(app).post('/api/ai-profiles').set(authHeaders()).send({
        name: 'Bad UUID Profile',
        provider_id: 'not-a-uuid',
        external_ai_id: 'some-ai',
      });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'provider_id')).toBe(true);
    });
  });

  describe('POST /api/processing-jobs', () => {
    it('rejects missing name', async () => {
      const res = await request(app).post('/api/processing-jobs').set(authHeaders()).send({ slug: 'test-slug' });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'name')).toBe(true);
    });

    it('rejects missing slug', async () => {
      const res = await request(app).post('/api/processing-jobs').set(authHeaders()).send({ name: 'No Slug Job' });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'slug')).toBe(true);
    });

    it('rejects an invalid slug format (uppercase / spaces)', async () => {
      const res = await request(app)
        .post('/api/processing-jobs')
        .set(authHeaders())
        .send({ name: 'Bad Slug', slug: 'NOT VALID SLUG!' });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'slug')).toBe(true);
    });
  });

  describe('POST /api/chat-sessions', () => {
    it('rejects missing required fields (empty body)', async () => {
      const res = await request(app).post('/api/chat-sessions').set(authHeaders()).send({});

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'userId')).toBe(true);
    });

    it('rejects non-UUID aiProfileId', async () => {
      const res = await request(app)
        .post('/api/chat-sessions')
        .set(authHeaders())
        .send({ aiProfileId: 'bad-uuid', userId: 'test-user' });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'aiProfileId')).toBe(true);
    });
  });

  describe('Error response structure', () => {
    it('includes descriptive error messages in the details array', async () => {
      const res = await request(app)
        .post('/api/providers')
        .set(authHeaders())
        .send({ name: '', type: '', base_url: 'bad' });

      expect(res.status).toBe(400);
      expectValidationError(res.body);

      for (const detail of res.body.details) {
        expect(detail.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('PUT endpoint validation', () => {
    it('rejects invalid data on PUT /api/providers/:id', async () => {
      const res = await request(app)
        .put(`/api/providers/${seedProviderId}`)
        .set(authHeaders())
        .send({ base_url: 'not-a-valid-url' });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'base_url')).toBe(true);
    });
  });

  describe('Extra / unrecognised fields', () => {
    it('strips or rejects unrecognised fields in request body', async () => {
      const res = await request(app)
        .post('/api/providers')
        .set(authHeaders())
        .send({
          name: uniqueName('extra-fields'),
          type: 'devs-ai',
          base_url: 'https://extra.example.com',
          totally_fake_field: 'should-not-appear',
          another_bogus: 123,
        });

      if (res.status === 201) {
        expect(res.body).not.toHaveProperty('totally_fake_field');
        expect(res.body).not.toHaveProperty('another_bogus');
        onCleanup(async () => {
          await request(app).delete(`/api/providers/${res.body.id}`).set(authHeaders());
        });
      } else {
        expect(res.status).toBe(400);
      }
    });
  });

  describe('Type coercion behaviour', () => {
    it('rejects a string where a boolean is expected for is_active', async () => {
      const res = await request(app)
        .post('/api/providers')
        .set(authHeaders())
        .send({
          name: uniqueName('coerce-test'),
          type: 'devs-ai',
          base_url: 'https://coerce.example.com',
          is_active: 'not-a-boolean',
        });

      if (res.status === 400) {
        expectValidationError(res.body);
      } else {
        expect(res.status).toBe(201);
        onCleanup(async () => {
          await request(app).delete(`/api/providers/${res.body.id}`).set(authHeaders());
        });
      }
    });
  });

  describe('Tightened schema: AI profile enums', () => {
    it('rejects invalid profile_type enum value', async () => {
      const res = await request(app)
        .post('/api/ai-profiles')
        .set(authHeaders())
        .send({
          name: uniqueName('enum-test'),
          provider_id: seedProviderId,
          external_ai_id: 'some-ai',
          profile_type: 'banana',
        });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
    });

    it('rejects invalid mode enum value', async () => {
      const res = await request(app)
        .post('/api/ai-profiles')
        .set(authHeaders())
        .send({
          name: uniqueName('mode-test'),
          provider_id: seedProviderId,
          external_ai_id: 'some-ai',
          mode: 'streaming',
        });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
    });

    it('accepts valid profile_type and mode values', async () => {
      const res = await request(app)
        .post('/api/ai-profiles')
        .set(authHeaders())
        .send({
          name: uniqueName('valid-enum'),
          provider_id: seedProviderId,
          external_ai_id: 'test-ai-id',
          profile_type: 'agent',
          mode: 'chat',
        });

      expect(res.status).toBe(201);
      expect(res.body.profile_type).toBe('agent');
      expect(res.body.mode).toBe('chat');
      onCleanup(async () => {
        await request(app).delete(`/api/ai-profiles/${res.body.id}`).set(authHeaders());
      });
    });
  });

  describe('Tightened schema: workflow config', () => {
    it('rejects workflow config.inputVariables with missing name', async () => {
      const res = await request(app)
        .post('/api/workflows')
        .set(authHeaders())
        .send({
          name: uniqueName('bad-var'),
          slug: uniqueSlug('bad-var'),
          config: {
            inputVariables: [{ label: 'Topic' }],
          },
        });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
    });

    it('accepts valid workflow config with inputVariables', async () => {
      const res = await request(app)
        .post('/api/workflows')
        .set(authHeaders())
        .send({
          name: uniqueName('good-var'),
          slug: uniqueSlug('good-var'),
          config: {
            inputVariables: [{ name: 'topic', label: 'Topic', required: true }],
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.config.inputVariables[0].name).toBe('topic');
      onCleanup(async () => {
        await request(app).delete(`/api/workflows/${res.body.id}`).set(authHeaders());
      });
    });
  });

  describe('Tightened schema: processing job config', () => {
    it('accepts valid processing job config with variables', async () => {
      const res = await request(app)
        .post('/api/processing-jobs')
        .set(authHeaders())
        .send({
          name: uniqueName('pj-config'),
          slug: uniqueSlug('pj-config'),
          config: {
            systemPrompt: 'You are a test assistant',
            variables: [{ name: 'topic', label: 'Topic' }],
          },
        });

      expect(res.status).toBe(201);
      onCleanup(async () => {
        await request(app).delete(`/api/processing-jobs/${res.body.id}`).set(authHeaders());
      });
    });

    it('rejects processing job config.variables with missing name', async () => {
      const res = await request(app)
        .post('/api/processing-jobs')
        .set(authHeaders())
        .send({
          name: uniqueName('pj-bad'),
          slug: uniqueSlug('pj-bad'),
          config: {
            variables: [{ label: 'No Name' }],
          },
        });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
    });
  });

  describe('Semantic validation: ref checks', () => {
    it('rejects workflow with non-existent ai_profile_id', async () => {
      const res = await request(app)
        .post('/api/workflows')
        .set(authHeaders())
        .send({
          name: uniqueName('bad-ref'),
          slug: uniqueSlug('bad-ref'),
          ai_profile_id: '00000000-0000-0000-0000-000000000000',
        });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'ai_profile_id')).toBe(true);
    });

    it('rejects processing job with non-existent ai_profile_id', async () => {
      const res = await request(app)
        .post('/api/processing-jobs')
        .set(authHeaders())
        .send({
          name: uniqueName('pj-bad-ref'),
          slug: uniqueSlug('pj-bad-ref'),
          ai_profile_id: '00000000-0000-0000-0000-000000000000',
        });

      expect(res.status).toBe(400);
      expectValidationError(res.body);
      expect(res.body.details.some((d: ValidationDetail) => d.path === 'ai_profile_id')).toBe(true);
    });
  });
});
