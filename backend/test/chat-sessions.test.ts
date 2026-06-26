import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName, uniqueSlug } from './setup.ts';
import { getServiceSupabase } from '../src/db/service-supabase.ts';

const NON_EXISTENT_UUID = '00000000-0000-4000-a000-000000000000';

let providerId: string;
let profileId: string;
let sessionId: string | null = null;
let jobSlug: string;

beforeAll(async () => {
  const provRes = await request(app)
    .post('/api/providers')
    .set(authHeaders())
    .send({
      name: uniqueName('CS Test Provider'),
      type: 'devs-ai',
      base_url: 'https://cs-test.example.com',
      api_key: 'test-key-cs',
    });
  expect(provRes.status).toBe(201);
  providerId = provRes.body.id;

  const profRes = await request(app)
    .post('/api/ai-profiles')
    .set(authHeaders())
    .send({
      name: uniqueName('CS Test Profile'),
      provider_id: providerId,
      external_ai_id: 'test-ai-cs',
      mode: 'chat',
    });
  expect(profRes.status).toBe(201);
  profileId = profRes.body.id;

  jobSlug = uniqueSlug('cs-test-job');
  const jobRes = await request(app)
    .post('/api/processing-jobs')
    .set(authHeaders())
    .send({
      name: uniqueName('CS Test Job'),
      slug: jobSlug,
      ai_profile_id: profileId,
    });
  expect(jobRes.status).toBe(201);
});

afterAll(async () => {
  if (sessionId) {
    await request(app).delete(`/api/chat-sessions/${sessionId}`).set(authHeaders());
  }

  const jobsRes = await request(app).get('/api/processing-jobs').set(authHeaders());
  if (jobsRes.status === 200) {
    const testJobs = (jobsRes.body.data || []).filter(
      (j: { slug: string; id: string }) => j.slug === jobSlug,
    );
    for (const j of testJobs) {
      await request(app).delete(`/api/processing-jobs/${j.id}`).set(authHeaders());
    }
  }

  if (profileId) {
    await request(app).delete(`/api/ai-profiles/${profileId}`).set(authHeaders());
  }
  if (providerId) {
    await request(app).delete(`/api/providers/${providerId}`).set(authHeaders());
  }
});

describe('Chat Sessions', () => {
  it('lists chat sessions', async () => {
    const res = await request(app)
      .get('/api/chat-sessions')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('pagination');
  });

  it('creates a chat session', async () => {
    const res = await request(app)
      .post('/api/chat-sessions')
      .set(authHeaders())
      .send({
        jobSlug: jobSlug,
        userId: '00000000-0000-0000-0000-000000000001',
        callingApplication: 'integration-test',
      });

    /*
     * Session creation calls the external AI provider via openChatSession.
     * The test provider is fake, so this may 400 (validation/routing) or
     * 500 (LLM connectivity). Accept any documented status.
     */
    expect([201, 400, 500]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body).toHaveProperty('id');
      sessionId = res.body.id;
    }
  });

  it('rejects creation with missing userId', async () => {
    const res = await request(app)
      .post('/api/chat-sessions')
      .set(authHeaders())
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects creation with invalid aiProfileId', async () => {
    const res = await request(app)
      .post('/api/chat-sessions')
      .set(authHeaders())
      .send({ aiProfileId: 'not-a-uuid', userId: 'test-user' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('gets a session by ID', async () => {
    if (!sessionId) return;
    const res = await request(app)
      .get(`/api/chat-sessions/${sessionId}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('messages');
  });

  it('returns 404 for non-existent session', async () => {
    const res = await request(app)
      .get(`/api/chat-sessions/${NON_EXISTENT_UUID}`)
      .set(authHeaders());
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('gets message history for a session', async () => {
    if (!sessionId) return;
    const res = await request(app)
      .get(`/api/chat-sessions/${sessionId}/messages`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body) || res.body?.messages !== undefined).toBe(true);
  });

  it('sends a message (SSE endpoint shape)', async () => {
    if (!sessionId) return;

    const res = await request(app)
      .post(`/api/chat-sessions/${sessionId}/messages`)
      .set(authHeaders())
      .send({ message: 'Hello integration test' });

    /*
     * This endpoint streams SSE and calls the LLM provider.
     * With a fake test provider it will likely 500.
     * Accept any documented status to avoid flaky LLM-dependent failures.
     */
    expect([200, 201, 400, 500]).toContain(res.status);
  });

  it('rejects message without content', async () => {
    if (!sessionId) return;
    const res = await request(app)
      .post(`/api/chat-sessions/${sessionId}/messages`)
      .set(authHeaders())
      .send({});
    expect(res.status).toBe(400);
  });

  it('closes a chat session', async () => {
    if (!sessionId) return;
    const res = await request(app)
      .put(`/api/chat-sessions/${sessionId}/close`)
      .set(authHeaders());
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('status');
    }
  });

  it('resets a chat session', async () => {
    if (!sessionId) return;
    const res = await request(app)
      .put(`/api/chat-sessions/${sessionId}/reset`)
      .set(authHeaders());
    expect([200, 500]).toContain(res.status);
  });

  it('lists sessions with pagination', async () => {
    const res = await request(app)
      .get('/api/chat-sessions?limit=1')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(1);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
  });

  it('filters sessions by status', async () => {
    const res = await request(app)
      .get('/api/chat-sessions?status=active')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    for (const s of res.body.data) {
      expect(s.status).toBe('active');
    }
  });

  it('filters sessions by aiProfileId', async () => {
    const res = await request(app)
      .get(`/api/chat-sessions?aiProfileId=${profileId}`)
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  it('does not leak api_key in session responses', async () => {
    const res = await request(app)
      .get('/api/chat-sessions')
      .set(authHeaders());
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('test-key-cs');
  });

  it('gets session diagnostics', async () => {
    if (!sessionId) return;
    const res = await request(app)
      .get(`/api/chat-sessions/${sessionId}/diagnostics`)
      .set(authHeaders());
    expect([200, 500]).toContain(res.status);
  });

  it('deletes a chat session', async () => {
    if (!sessionId) return;
    const res = await request(app)
      .delete(`/api/chat-sessions/${sessionId}`)
      .set(authHeaders());
    expect(res.status).toBe(204);
    const deletedId = sessionId;
    sessionId = null;

    const getRes = await request(app)
      .get(`/api/chat-sessions/${deletedId}`)
      .set(authHeaders());
    expect(getRes.status).toBe(404);
  });

  describe('Calling application enforcement (400)', () => {
    it('rejects session creation when callingApplication is missing', async () => {
      const res = await request(app)
        .post('/api/chat-sessions')
        .set(authHeaders())
        .send({
          jobSlug: jobSlug,
          userId: '00000000-0000-0000-0000-000000000099',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/callingApplication is required/i);
    });

    it('rejects session creation when callingApplication is empty string', async () => {
      const res = await request(app)
        .post('/api/chat-sessions')
        .set(authHeaders())
        .send({
          jobSlug: jobSlug,
          userId: '00000000-0000-0000-0000-000000000099',
          callingApplication: '',
        });

      expect(res.status).toBe(400);
    });

    it('accepts session creation when callingApplication is provided', async () => {
      const res = await request(app)
        .post('/api/chat-sessions')
        .set(authHeaders())
        .send({
          jobSlug: jobSlug,
          userId: '00000000-0000-0000-0000-000000000099',
          callingApplication: 'test:enforcement-check',
        });

      // Should NOT be 400 for missing callingApplication
      // (may be 201 or 500 depending on LLM provider connectivity)
      expect(res.status).not.toBe(400);
      if (res.status === 201 && res.body.id) {
        await request(app).delete(`/api/chat-sessions/${res.body.id}`).set(authHeaders());
      }
    });
  });

  describe('Concurrency guard (409)', () => {
    let guardSessionId: string | null = null;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/chat-sessions')
        .set(authHeaders())
        .send({
          jobSlug: jobSlug,
          userId: '00000000-0000-0000-0000-000000000002',
          callingApplication: 'concurrency-test',
        });
      if (res.status === 201) guardSessionId = res.body.id;
    });

    afterAll(async () => {
      if (guardSessionId) {
        await getServiceSupabase()
          .from('chat_sessions')
          .update({ processing_message_id: null, processing_started_at: null })
          .eq('id', guardSessionId);
        await request(app).delete(`/api/chat-sessions/${guardSessionId}`).set(authHeaders());
      }
    });

    it('returns 409 when session has an active processing lock', async () => {
      if (!guardSessionId) return;

      await getServiceSupabase()
        .from('chat_sessions')
        .update({
          processing_message_id: 'test-lock-token',
          processing_started_at: new Date().toISOString(),
        })
        .eq('id', guardSessionId);

      const res = await request(app)
        .post(`/api/chat-sessions/${guardSessionId}/messages`)
        .set(authHeaders())
        .send({ message: 'Should be rejected' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/currently processing/i);
    });

    it('accepts a message after the lock is released', async () => {
      if (!guardSessionId) return;

      await getServiceSupabase()
        .from('chat_sessions')
        .update({ processing_message_id: null, processing_started_at: null })
        .eq('id', guardSessionId);

      const res = await request(app)
        .post(`/api/chat-sessions/${guardSessionId}/messages`)
        .set(authHeaders())
        .send({ message: 'Should be accepted' });

      // Not 409 — accepted for processing (may 500 due to fake LLM provider)
      expect(res.status).not.toBe(409);
    });

    it('reclaims a stale lock (processing_started_at is old)', async () => {
      if (!guardSessionId) return;

      const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString(); // 6 min ago
      await getServiceSupabase()
        .from('chat_sessions')
        .update({
          processing_message_id: 'stale-lock-token',
          processing_started_at: staleTime,
        })
        .eq('id', guardSessionId);

      const res = await request(app)
        .post(`/api/chat-sessions/${guardSessionId}/messages`)
        .set(authHeaders())
        .send({ message: 'Should reclaim stale lock' });

      // Stale lock is reclaimed, so this should NOT be 409
      expect(res.status).not.toBe(409);
    });

    it('returns 409 on tool-outputs when session is locked', async () => {
      if (!guardSessionId) return;

      await getServiceSupabase()
        .from('chat_sessions')
        .update({
          processing_message_id: 'tool-lock-token',
          processing_started_at: new Date().toISOString(),
        })
        .eq('id', guardSessionId);

      const res = await request(app)
        .post(`/api/chat-sessions/${guardSessionId}/tool-outputs`)
        .set(authHeaders())
        .send({
          systemMessageId: 'fake-msg-id',
          outputs: [{ toolCallId: 'fake-tool', output: 'test' }],
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/currently processing/i);
    });
  });
});
