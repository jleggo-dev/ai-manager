import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName } from './setup.ts';
import { getServiceSupabase } from '../src/db/service-supabase.ts';

const TEST_USER_ID = '00000000-0000-4000-8000-0000000000c1';

let v2ProviderId: string;
let v2ProfileId: string;
let v1SessionId: string;
let v2SessionId: string;

beforeAll(async () => {
  const provRes = await request(app)
    .post('/api/providers')
    .set(authHeaders())
    .send({
      name: uniqueName('V2 Lifecycle Provider'),
      type: 'devs-ai-v2',
      base_url: 'https://devs.ai',
      api_key: 'test-key-v2-lifecycle',
    });
  expect(provRes.status).toBe(201);
  v2ProviderId = provRes.body.id;

  const profRes = await request(app)
    .post('/api/ai-profiles')
    .set(authHeaders())
    .send({
      name: uniqueName('V2 Lifecycle Profile'),
      provider_id: v2ProviderId,
      external_ai_id: 'gpt-4.1-mini',
      mode: 'chat',
      profile_type: 'model',
    });
  expect(profRes.status).toBe(201);
  v2ProfileId = profRes.body.id;

  const v1Prov = await request(app)
    .post('/api/providers')
    .set(authHeaders())
    .send({
      name: uniqueName('V1 Lifecycle Provider'),
      type: 'devs-ai',
      base_url: 'https://devs.ai',
      api_key: 'test-key-v1-lifecycle',
    });
  expect(v1Prov.status).toBe(201);

  const v1Prof = await request(app)
    .post('/api/ai-profiles')
    .set(authHeaders())
    .send({
      name: uniqueName('V1 Lifecycle Profile'),
      provider_id: v1Prov.body.id,
      external_ai_id: 'test-model',
      mode: 'completion',
      profile_type: 'model',
    });
  expect(v1Prof.status).toBe(201);

  const openV1 = await request(app)
    .post('/api/chat-sessions')
    .set(authHeaders())
    .send({ aiProfileId: v1Prof.body.id, userId: TEST_USER_ID, callingApplication: 'e2e-test:v2-lifecycle' });
  expect(openV1.status).toBe(201);
  v1SessionId = openV1.body.sessionId;

  const openV2 = await request(app)
    .post('/api/chat-sessions')
    .set(authHeaders())
    .send({ aiProfileId: v2ProfileId, userId: TEST_USER_ID, callingApplication: 'e2e-test:v2-lifecycle' });
  expect(openV2.status).toBe(201);
  v2SessionId = openV2.body.sessionId;
});

afterAll(async () => {
  if (v1SessionId)
    await request(app)
      .delete(`/api/chat-sessions/${v1SessionId}`)
      .set(authHeaders())
      .catch(() => {});
  if (v2SessionId)
    await request(app)
      .delete(`/api/chat-sessions/${v2SessionId}`)
      .set(authHeaders())
      .catch(() => {});
  if (v2ProfileId)
    await request(app)
      .delete(`/api/ai-profiles/${v2ProfileId}`)
      .set(authHeaders())
      .catch(() => {});
  if (v2ProviderId)
    await request(app)
      .delete(`/api/providers/${v2ProviderId}`)
      .set(authHeaders())
      .catch(() => {});
});

describe('devs-ai-v2 lifecycle routes', () => {
  it('rejects cancel on non-v2 sessions', async () => {
    const res = await request(app).post(`/api/chat-sessions/${v1SessionId}/cancel`).set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/devs-ai-v2/i);
  });

  it('rejects reconnect-stream on non-v2 sessions', async () => {
    const res = await request(app)
      .post(`/api/chat-sessions/${v1SessionId}/reconnect-stream`)
      .set(authHeaders())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/devs-ai-v2/i);
  });

  /* The route wraps the "no v2 response id" internal error through safeClientError()
     (src/lib/safe-error.ts), which only lets allowlisted "safe domain" messages
     through to the client and otherwise masks everything else with a generic
     fallback — so the client-facing message is the fallback text, not the raw
     internal error. Assert on the fallback wording rather than the masked detail. */
  it('rejects cancel on v2 session without provider_metadata', async () => {
    const res = await request(app).post(`/api/chat-sessions/${v2SessionId}/cancel`).set(authHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/failed to cancel v2 response/i);
  });

  it('rejects reconnect-stream on v2 session without provider_metadata', async () => {
    const res = await request(app)
      .post(`/api/chat-sessions/${v2SessionId}/reconnect-stream`)
      .set(authHeaders())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/failed to reconnect v2 stream/i);
  });

  it('accepts cancel route when provider_metadata has response id (provider call may fail in test env)', async () => {
    const { error } = await getServiceSupabase()
      .from('chat_sessions')
      .update({
        provider_metadata: { previous_response_id: 'resp_test_cancel', last_sequence: 3 },
      })
      .eq('id', v2SessionId);
    expect(error).toBeNull();

    const res = await request(app).post(`/api/chat-sessions/${v2SessionId}/cancel`).set(authHeaders());
    /* Route reached ai-manager; live cancel against devs.ai may fail without a real response id */
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.cancelled).toBe(true);
      expect(res.body.responseId).toBe('resp_test_cancel');
    }
  });
});
