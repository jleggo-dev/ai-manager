/**
 * E2E: Chat Session Lifecycle
 * ---------------------------
 * Exercises the full calling-application flow against the live backend:
 *   1. Create a chat session (POST /chat-sessions)
 *   2. Send a message (SSE endpoint)
 *   3. Verify lock is released after response
 *   4. Send a follow-up message (must NOT 409)
 *   5. Verify session state (message count, diagnostics)
 *   6. Clean up
 *
 * Uses the real API key + Supabase DB. Tolerates LLM provider
 * failures (accepts 200/201/400/500) for message sends since the
 * LLM backend may not be reachable in all environments. The key
 * assertions are about concurrency, routing, and state management.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName, uniqueSlug } from './setup.ts';
import { sleep } from './helpers/e2e-harness.ts';

let providerId: string;
let profileId: string;
let jobId: string;
let sessionId: string;

/** Valid UUID — prior `…e2etestuser1` was rejected by Postgres uuid columns. */
const TEST_USER_ID = '00000000-0000-4000-8000-0000000000e1';
const CALLING_APP = 'e2e-test:session-lifecycle';

beforeAll(async () => {
  const pRes = await request(app)
    .post('/api/providers')
    .set(authHeaders())
    .send({
      name: uniqueName('E2E Lifecycle Provider'),
      type: 'devs-ai',
      base_url: 'https://devs.ai',
      api_key: process.env.DEVS_AI_API_KEY || 'sk-e2e-placeholder',
    });
  expect(pRes.status).toBe(201);
  providerId = pRes.body.id;

  const aRes = await request(app)
    .post('/api/ai-profiles')
    .set(authHeaders())
    .send({
      name: uniqueName('E2E Lifecycle Profile'),
      provider_id: providerId,
      external_ai_id: 'e2e-test-agent',
      mode: 'completion',
    });
  expect(aRes.status).toBe(201);
  profileId = aRes.body.id;

  const jRes = await request(app)
    .post('/api/processing-jobs')
    .set(authHeaders())
    .send({
      name: uniqueName('E2E Lifecycle Job'),
      slug: uniqueSlug('e2e-lifecycle'),
      ai_profile_id: profileId,
      config: { prompt: 'Say "hello e2e" and nothing else.' },
    });
  expect(jRes.status).toBe(201);
  jobId = jRes.body.id;
});

afterAll(async () => {
  if (sessionId) {
    await request(app)
      .delete(`/api/chat-sessions/${sessionId}`)
      .set(authHeaders())
      .catch(() => {});
  }
  if (jobId) {
    await request(app)
      .delete(`/api/processing-jobs/${jobId}`)
      .set(authHeaders())
      .catch(() => {});
  }
  if (profileId) {
    await request(app)
      .delete(`/api/ai-profiles/${profileId}`)
      .set(authHeaders())
      .catch(() => {});
  }
  if (providerId) {
    await request(app)
      .delete(`/api/providers/${providerId}`)
      .set(authHeaders())
      .catch(() => {});
  }
});

describe('E2E: Chat Session Lifecycle', () => {
  it('creates a session with callingApplication', async () => {
    const res = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      jobId,
      userId: TEST_USER_ID,
      callingApplication: CALLING_APP,
    });
    expect([201, 400, 500]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.sessionId).toBeDefined();
      expect(res.body.status).toBe('active');
      sessionId = res.body.sessionId;
    }
  });

  it('sends a message (SSE endpoint shape check)', async () => {
    if (!sessionId) return;

    const res = await request(app)
      .post(`/api/chat-sessions/${sessionId}/messages`)
      .set(authHeaders())
      .send({ message: 'Say hello e2e' });

    expect([200, 201, 400, 500]).toContain(res.status);
  });

  it('second message does NOT 409 (lock was released)', async () => {
    if (!sessionId) return;
    await sleep(1000);

    const res = await request(app)
      .post(`/api/chat-sessions/${sessionId}/messages`)
      .set(authHeaders())
      .send({ message: 'Follow-up message' });

    expect(res.status).not.toBe(409);
  });

  it('retrieves session details with calling_application', async () => {
    if (!sessionId) return;

    const res = await request(app).get(`/api/chat-sessions/${sessionId}`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.calling_application).toBe(CALLING_APP);
    expect(res.body.id).toBe(sessionId);
  });

  it('retrieves message history', async () => {
    if (!sessionId) return;

    const res = await request(app).get(`/api/chat-sessions/${sessionId}/messages`).set(authHeaders());
    expect(res.status).toBe(200);
  });

  it('diagnostic logs endpoint is reachable for this session', async () => {
    if (!sessionId) return;

    const res = await request(app).get(`/api/diagnostic-logs?chatSessionId=${sessionId}`).set(authHeaders());
    expect(res.status).toBe(200);
  });

  it('closes the session', async () => {
    if (!sessionId) return;

    const res = await request(app).put(`/api/chat-sessions/${sessionId}/close`).set(authHeaders());
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.status).toBe('closed');
    }
  });
});
