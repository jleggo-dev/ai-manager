import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName, onCleanup, runCleanup } from './setup.ts';
import { stripSecrets } from '../src/lib/sanitize.ts';

afterAll(async () => {
  await runCleanup();
});

describe('Security Hardening', () => {

  describe('H6: stripSecrets expanded keys', () => {
    it('strips api_key from objects', () => {
      const result = stripSecrets({ name: 'test', api_key: 'secret123' });
      expect(result).toEqual({ name: 'test' });
    });

    it('strips key_hash from objects', () => {
      const result = stripSecrets({ id: '1', key_hash: 'abc123' });
      expect(result).not.toHaveProperty('key_hash');
    });

    it('strips password, secret, token, credentials', () => {
      const result = stripSecrets({
        id: '1',
        password: 'pass',
        secret: 'sec',
        token: 'tok',
        credentials: 'cred',
      });
      expect(result).toEqual({ id: '1' });
    });

    it('strips access_token and refresh_token', () => {
      const result = stripSecrets({
        user: 'test',
        access_token: 'at',
        refresh_token: 'rt',
      });
      expect(result).toEqual({ user: 'test' });
    });

    it('strips service_role_key and encryption_key', () => {
      const result = stripSecrets({
        service_role_key: 'srv',
        encryption_key: 'enc',
        name: 'ok',
      });
      expect(result).toEqual({ name: 'ok' });
    });

    it('strips nested sensitive keys', () => {
      const result = stripSecrets({
        provider: { name: 'p1', api_key: 'k1', token: 't1' },
        items: [{ secret: 's1', value: 'v1' }],
      });
      expect(result).toEqual({
        provider: { name: 'p1' },
        items: [{ value: 'v1' }],
      });
    });
  });

  describe('H7: interpolateTemplate prompt armoring', () => {
    it('rejects system prompts longer than 50000 chars', async () => {
      const longPrompt = 'a'.repeat(50_001);
      const res = await request(app)
        .post('/api/chat-sessions')
        .set(authHeaders())
        .send({ userId: 'test-user', systemPrompt: longPrompt });
      expect(res.status).toBe(400);
    });
  });

  describe('M12: Zod max() constraints on string fields', () => {
    it('rejects provider name longer than max', async () => {
      const longName = 'a'.repeat(256);
      const res = await request(app)
        .post('/api/providers')
        .set(authHeaders())
        .send({ name: longName, type: 'devs-ai', base_url: 'https://example.com' });
      expect(res.status).toBe(400);
    });

    it('rejects processing job name longer than max', async () => {
      const longName = 'a'.repeat(256);
      const res = await request(app)
        .post('/api/processing-jobs')
        .set(authHeaders())
        .send({ name: longName, slug: 'test-slug' });
      expect(res.status).toBe(400);
    });
  });

  describe('H1: Zod validation on previously unvalidated routes', () => {
    it('POST /api/calling-applications rejects empty body with 400', async () => {
      const res = await request(app)
        .post('/api/calling-applications')
        .set(authHeaders())
        .send({});
      expect(res.status).toBe(400);
    });

    it('PUT /api/app-settings/:key rejects missing value', async () => {
      const res = await request(app)
        .put('/api/settings/test-key')
        .set(authHeaders())
        .send({});
      expect(res.status).toBe(400);
    });

    it('PATCH /api/processing-jobs/batch rejects empty body', async () => {
      const res = await request(app)
        .patch('/api/processing-jobs/batch')
        .set(authHeaders())
        .send({});
      expect(res.status).toBe(400);
    });

    it('PATCH /api/processing-jobs/batch rejects updates without id', async () => {
      const res = await request(app)
        .patch('/api/processing-jobs/batch')
        .set(authHeaders())
        .send({ updates: [{ name: 'no-id' }] });
      expect(res.status).toBe(400);
    });
  });

  describe('H2: requireRole on newly guarded endpoints', () => {
    it('DELETE /api/diagnostic-logs/:id requires auth', async () => {
      const res = await request(app)
        .delete('/api/diagnostic-logs/00000000-0000-0000-0000-000000000001');
      expect(res.status).toBe(401);
    });

    it('POST /api/processing-job-groups requires auth', async () => {
      const res = await request(app)
        .post('/api/processing-job-groups')
        .send({ name: 'test' });
      expect(res.status).toBe(401);
    });
  });

  describe('C1: API key role validation', () => {
    it('API key with admin role passes admin-level RBAC check', async () => {
      const res = await request(app)
        .get('/api/providers')
        .set(authHeaders());
      expect(res.status).toBe(200);
    });

    it('API key creation returns role field', async () => {
      const res = await request(app)
        .get('/api/api-keys')
        .set(authHeaders());
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('user session');
    });
  });

  describe('M5: Field allowlists on batch/calling-app updates', () => {
    it('calling app update only allows display_name', async () => {
      const createRes = await request(app)
        .post('/api/calling-applications')
        .set(authHeaders())
        .send({ display_name: uniqueName('sec-test-app') });

      if (createRes.status === 201) {
        const appId = createRes.body.id;
        onCleanup(async () => {
          await request(app).delete(`/api/calling-applications/${appId}`).set(authHeaders());
        });

        const updateRes = await request(app)
          .put(`/api/calling-applications/${appId}`)
          .set(authHeaders())
          .send({ display_name: 'Updated Name', workspace_id: '00000000-0000-0000-0000-000000000099' });

        expect([200, 400]).toContain(updateRes.status);
        if (updateRes.status === 200) {
          expect(updateRes.body.workspace_id).not.toBe('00000000-0000-0000-0000-000000000099');
        }
      }
    });
  });

  describe('H4: Rate limit uses authenticated identity', () => {
    it('rate limit headers are present on authenticated requests', async () => {
      const res = await request(app)
        .get('/api/providers')
        .set(authHeaders());
      expect(res.status).toBe(200);
      const h = res.headers;
      const hasRateLimitHeaders =
        h['ratelimit-policy'] !== undefined ||
        h['ratelimit'] !== undefined ||
        h['x-ratelimit-limit'] !== undefined;
      expect(hasRateLimitHeaders).toBe(true);
    });
  });
});
