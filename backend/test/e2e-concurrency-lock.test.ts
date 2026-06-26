/**
 * E2E: Concurrency Lock
 * ----------------------
 * Tests the session concurrency guard end-to-end against the real DB.
 * These tests DO NOT require a live LLM provider — they manipulate lock
 * columns directly and verify the 409 rejection path, stale lock reclaim,
 * and lock release.
 *
 * This catches the exact bug class that caused the Lovable 409 error:
 * a held lock that was never released.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { app, authHeaders, uniqueName, uniqueSlug } from './setup.ts';

const url = process.env.AI_MANAGER_SUPABASE_URL ?? '';
const serviceKey = process.env.AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY ?? '';
const supabase = createClient(url, serviceKey);

let providerId: string;
let profileId: string;
let jobId: string;
let sessionId: string;

beforeAll(async () => {
  const pRes = await request(app)
    .post('/api/providers')
    .set(authHeaders())
    .send({
      name: uniqueName('E2E Lock Provider'),
      type: 'devs-ai',
      base_url: 'https://devs.ai',
      api_key: process.env.DEVS_AI_API_KEY || 'sk-e2e-placeholder',
    });
  providerId = pRes.body.id;

  const aRes = await request(app)
    .post('/api/ai-profiles')
    .set(authHeaders())
    .send({
      name: uniqueName('E2E Lock Profile'),
      provider_id: providerId,
      external_ai_id: 'e2e-lock-agent',
      mode: 'completion',
    });
  profileId = aRes.body.id;

  const jRes = await request(app)
    .post('/api/processing-jobs')
    .set(authHeaders())
    .send({
      name: uniqueName('E2E Lock Job'),
      slug: uniqueSlug('e2e-lock'),
      ai_profile_id: profileId,
      config: { prompt: 'Reply "locked" in one word.' },
    });
  jobId = jRes.body.id;

  const sRes = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
    jobId,
    userId: '00000000-0000-0000-0000-e2elocktest1',
    callingApplication: 'e2e-test:concurrency-lock',
  });
  if (sRes.status === 201) {
    sessionId = sRes.body.sessionId;
  }
});

afterAll(async () => {
  if (sessionId) {
    await supabase
      .from('chat_sessions')
      .update({ processing_message_id: null, processing_started_at: null })
      .eq('id', sessionId);
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

describe('E2E: Concurrency Lock — 409 rejection', () => {
  it('rejects message with 409 when session has an active lock', async () => {
    if (!sessionId) return;

    await supabase
      .from('chat_sessions')
      .update({
        processing_message_id: 'e2e-held-lock',
        processing_started_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    const res = await request(app)
      .post(`/api/chat-sessions/${sessionId}/messages`)
      .set(authHeaders())
      .send({ message: 'Should be rejected' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/currently processing/i);
  });

  it('rejects tool-outputs with 409 when session has an active lock', async () => {
    if (!sessionId) return;

    await supabase
      .from('chat_sessions')
      .update({
        processing_message_id: 'e2e-tool-lock',
        processing_started_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    const res = await request(app)
      .post(`/api/chat-sessions/${sessionId}/tool-outputs`)
      .set(authHeaders())
      .send({
        systemMessageId: 'fake-msg-id',
        outputs: [{ toolCallId: 'fake-tool', output: 'test' }],
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/currently processing/i);
  });

  it('accepts message after lock is explicitly released', async () => {
    if (!sessionId) return;

    await supabase
      .from('chat_sessions')
      .update({ processing_message_id: null, processing_started_at: null })
      .eq('id', sessionId);

    const res = await request(app)
      .post(`/api/chat-sessions/${sessionId}/messages`)
      .set(authHeaders())
      .send({ message: 'Lock was released — should be accepted' });

    expect(res.status).not.toBe(409);
  });

  it('automatically reclaims a stale lock (>60s old)', async () => {
    if (!sessionId) return;

    await supabase
      .from('chat_sessions')
      .update({ processing_message_id: null, processing_started_at: null })
      .eq('id', sessionId);

    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    await supabase
      .from('chat_sessions')
      .update({
        processing_message_id: 'e2e-stale-lock',
        processing_started_at: staleTime,
      })
      .eq('id', sessionId);

    const res = await request(app)
      .post(`/api/chat-sessions/${sessionId}/messages`)
      .set(authHeaders())
      .send({ message: 'Stale lock should be overridden' });

    expect(res.status).not.toBe(409);
  });

  it('verifies lock columns are cleared after the above message finishes', async () => {
    if (!sessionId) return;

    await new Promise((r) => setTimeout(r, 3000));

    const { data, error } = await supabase
      .from('chat_sessions')
      .select('processing_message_id, processing_started_at')
      .eq('id', sessionId)
      .single();

    expect(error).toBeNull();
    expect(data?.processing_message_id).toBeNull();
    expect(data?.processing_started_at).toBeNull();
  });
});
