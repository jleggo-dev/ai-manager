import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName, uniqueSlug } from './setup.ts';
import { getServiceSupabase } from '../src/db/service-supabase.ts';

/**
 * Tests for the job-level requires_user_credentials enforcement
 * and session-level uses_user_credentials continuity.
 *
 * These tests use the API key auth path (which has no real user identity),
 * so a job with requires_user_credentials: true should reject session creation
 * because no authUserId is resolved.
 */

let providerId: string;
let profileId: string;
let credJobId: string;
let credJobSlug: string;
let normalJobSlug: string;
let normalJobId: string;

beforeAll(async () => {
  const provRes = await request(app)
    .post('/api/providers')
    .set(authHeaders())
    .send({
      name: uniqueName('Cred Test Provider'),
      type: 'devs-ai',
      base_url: 'https://cred-test.example.com',
      api_key: 'test-key-cred',
    });
  expect(provRes.status).toBe(201);
  providerId = provRes.body.id;

  const profRes = await request(app)
    .post('/api/ai-profiles')
    .set(authHeaders())
    .send({
      name: uniqueName('Cred Test Profile'),
      provider_id: providerId,
      external_ai_id: 'test-ai-cred',
      mode: 'chat',
    });
  expect(profRes.status).toBe(201);
  profileId = profRes.body.id;

  credJobSlug = uniqueSlug('cred-required-job');
  const credJobRes = await request(app)
    .post('/api/processing-jobs')
    .set(authHeaders())
    .send({
      name: uniqueName('Cred Required Job'),
      slug: credJobSlug,
      ai_profile_id: profileId,
      requires_user_credentials: true,
    });
  expect(credJobRes.status).toBe(201);
  credJobId = credJobRes.body.id;

  normalJobSlug = uniqueSlug('normal-job');
  const normalJobRes = await request(app)
    .post('/api/processing-jobs')
    .set(authHeaders())
    .send({
      name: uniqueName('Normal Job'),
      slug: normalJobSlug,
      ai_profile_id: profileId,
    });
  expect(normalJobRes.status).toBe(201);
  normalJobId = normalJobRes.body.id;
});

afterAll(async () => {
  if (credJobId) {
    await request(app).delete(`/api/processing-jobs/${credJobId}`).set(authHeaders());
  }
  if (normalJobId) {
    await request(app).delete(`/api/processing-jobs/${normalJobId}`).set(authHeaders());
  }
  if (profileId) {
    await request(app).delete(`/api/ai-profiles/${profileId}`).set(authHeaders());
  }
  if (providerId) {
    await request(app).delete(`/api/providers/${providerId}`).set(authHeaders());
  }
});

describe('Job-level credential enforcement', () => {
  it('rejects session creation when job requires user credentials but no user identity is forwarded', async () => {
    const res = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      jobSlug: credJobSlug,
      userId: '00000000-0000-0000-0000-000000000050',
      callingApplication: 'cred-test',
    });

    // The API key auth path does not forward a real user identity by default,
    // so requires_user_credentials should cause a 403 (credential gate).
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/personal credentials/i);
  });

  it('accepts session creation when job does NOT require user credentials', async () => {
    const res = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      jobSlug: normalJobSlug,
      userId: '00000000-0000-0000-0000-000000000051',
      callingApplication: 'cred-test',
    });

    // May succeed (201) or fail on LLM connectivity (500), but NOT the credential gate
    if (res.status === 500) {
      expect(res.body.error).not.toMatch(/personal credentials/i);
    }
    expect([201, 500]).toContain(res.status);

    if (res.status === 201 && res.body.id) {
      await request(app).delete(`/api/chat-sessions/${res.body.id}`).set(authHeaders());
    }
  });
});

describe('Session uses_user_credentials tracking', () => {
  it('stamps uses_user_credentials=false for API key sessions (no user identity)', async () => {
    const res = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      jobSlug: normalJobSlug,
      userId: '00000000-0000-0000-0000-000000000052',
      callingApplication: 'cred-test',
    });

    if (res.status !== 201) return;
    const sessionId = res.body.id;

    const { data: row } = await getServiceSupabase()
      .from('chat_sessions')
      .select('uses_user_credentials')
      .eq('id', sessionId)
      .single();

    expect(row).toBeTruthy();
    const dbRow = row as NonNullable<typeof row>;
    expect(dbRow.uses_user_credentials).toBe(false);

    await request(app).delete(`/api/chat-sessions/${sessionId}`).set(authHeaders());
  });
});

describe('Session credential continuity', () => {
  it('rejects messages on a user-credential session when no identity is present', async () => {
    // Create a normal session first, then manually flip uses_user_credentials to true
    // to simulate a session that was opened with user credentials.
    const res = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      jobSlug: normalJobSlug,
      userId: '00000000-0000-0000-0000-000000000053',
      callingApplication: 'cred-test',
    });

    if (res.status !== 201) return;
    const sessionId = res.body.id;

    // Flip the flag to simulate a user-credential session
    await getServiceSupabase().from('chat_sessions').update({ uses_user_credentials: true }).eq('id', sessionId);

    const msgRes = await request(app)
      .post(`/api/chat-sessions/${sessionId}/messages`)
      .set(authHeaders())
      .send({ message: 'Should fail credential continuity' });

    // Should fail because the session expects user credentials but the API key
    // caller has no forwarded user identity
    expect(msgRes.status).toBe(500);
    expect(msgRes.body.error).toMatch(/personal credentials/i);

    // Cleanup
    await getServiceSupabase().from('chat_sessions').update({ uses_user_credentials: false }).eq('id', sessionId);
    await request(app).delete(`/api/chat-sessions/${sessionId}`).set(authHeaders());
  });
});
