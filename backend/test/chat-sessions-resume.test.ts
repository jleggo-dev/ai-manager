/**
 * Integration tests – Resume chat sessions (Devs.ai)
 * ---------------------------------------------------
 * Exercises POST /api/chat-sessions/resume and supporting behavior (close
 * preserves the remote chat, externalChatId list filter) against a live
 * Supabase + the real Devs.ai provider already configured in the workspace.
 *
 * Rather than fabricating a provider/agent, these tests DISCOVER an existing
 * devs-ai, chat-mode profile (with its DB-stored, encrypted key) and open
 * real Devs.ai chat sessions through it. If no such profile exists in the
 * workspace, the live cases skip (CI without Devs.ai stays green).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';
import { getServiceSupabase } from '../src/db/service-supabase.ts';
import { findDevsChatProfile } from './helpers/real-providers.ts';

const NON_EXISTENT_UUID = '00000000-0000-4000-a000-000000000000';
const TEST_USER_ID = '00000000-0000-0000-0000-0000000000aa';

let devsProfileId: string | null = null;
let workspaceId: string | null = null;

/* Sessions opened/inserted during the run — cleaned up in afterAll. */
const createdSessionIds: string[] = [];

beforeAll(async () => {
  const profile = await findDevsChatProfile(app, authHeaders);
  if (profile) {
    devsProfileId = profile.id;
    const { data } = await getServiceSupabase()
      .from('ai_profiles')
      .select('workspace_id')
      .eq('id', profile.id)
      .maybeSingle();
    workspaceId = (data?.workspace_id as string) ?? null;
  }
});

afterAll(async () => {
  for (const id of createdSessionIds) {
    await request(app).delete(`/api/chat-sessions/${id}`).set(authHeaders());
  }
});

describe('POST /api/chat-sessions/resume — validation', () => {
  it('returns 400 when neither sessionId nor externalChatId is provided', async () => {
    const res = await request(app).post('/api/chat-sessions/resume').set(authHeaders()).send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 for a non-existent sessionId', async () => {
    const res = await request(app)
      .post('/api/chat-sessions/resume')
      .set(authHeaders())
      .send({ sessionId: NON_EXISTENT_UUID });
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown externalChatId', async () => {
    const res = await request(app)
      .post('/api/chat-sessions/resume')
      .set(authHeaders())
      .send({ externalChatId: `never-existed-${Date.now()}` });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/chat-sessions/resume — Devs.ai live session', () => {
  let liveSessionId: string | null = null;
  let liveExternalChatId: string | null = null;

  it('opens a real Devs.ai chat session', async () => {
    if (!devsProfileId) return;
    const res = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      aiProfileId: devsProfileId,
      userId: TEST_USER_ID,
      callingApplication: 'resume-test',
    });
    expect(res.status).toBe(201);
    liveSessionId = res.body.sessionId ?? res.body.id;
    liveExternalChatId = res.body.externalChatId ?? null;
    expect(liveSessionId).toBeTruthy();
    if (liveSessionId) createdSessionIds.push(liveSessionId);
    /* A Devs.ai agent session should have a provider-side chat id. */
    expect(liveExternalChatId).toBeTruthy();
  });

  it('close preserves the session + remote chat for resume', async () => {
    if (!liveSessionId) return;
    const closeRes = await request(app).put(`/api/chat-sessions/${liveSessionId}/close`).set(authHeaders());
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe('closed');

    /* Row still present and external_chat_id retained (not purged on close). */
    const getRes = await request(app).get(`/api/chat-sessions/${liveSessionId}`).set(authHeaders());
    expect(getRes.status).toBe(200);
    expect(getRes.body.external_chat_id ?? getRes.body.externalChatId).toBe(liveExternalChatId);
  });

  it('resumes the closed session by sessionId (validates remote, reactivates)', async () => {
    if (!liveSessionId) return;
    const res = await request(app)
      .post('/api/chat-sessions/resume')
      .set(authHeaders())
      .send({ sessionId: liveSessionId });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(liveSessionId);
    expect(res.body.status).toBe('active');
    expect(res.body.externalChatId).toBe(liveExternalChatId);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(Array.isArray(res.body.completedSteps)).toBe(true);
    expect(res.body).toHaveProperty('workflowVariables');
  });

  it('is idempotent — resuming an already-active session succeeds', async () => {
    if (!liveSessionId) return;
    const res = await request(app)
      .post('/api/chat-sessions/resume')
      .set(authHeaders())
      .send({ sessionId: liveSessionId });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('finds and resumes a session by externalChatId (list filter + resume)', async () => {
    if (!liveSessionId || !liveExternalChatId) return;

    const listRes = await request(app)
      .get(`/api/chat-sessions?externalChatId=${encodeURIComponent(liveExternalChatId)}`)
      .set(authHeaders());
    expect(listRes.status).toBe(200);
    const ids = (listRes.body.data || []).map((s: { id: string }) => s.id);
    expect(ids).toContain(liveSessionId);

    const resumeRes = await request(app)
      .post('/api/chat-sessions/resume')
      .set(authHeaders())
      .send({ externalChatId: liveExternalChatId });
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.sessionId).toBe(liveSessionId);
  });
});

describe('POST /api/chat-sessions/resume — remote chat gone', () => {
  let goneSessionId: string | null = null;

  it('inserts a closed Devs.ai session pointing at a non-existent remote chat', async () => {
    if (!devsProfileId || !workspaceId) return;
    const { data, error } = await getServiceSupabase()
      .from('chat_sessions')
      .insert({
        ai_profile_id: devsProfileId,
        user_id: TEST_USER_ID,
        calling_application: 'resume-test',
        provider_type: 'devs-ai',
        external_chat_id: `nonexistent-remote-${Date.now()}`,
        status: 'closed',
        uses_user_credentials: false,
        workspace_id: workspaceId,
      })
      .select()
      .single();
    expect(error).toBeFalsy();
    goneSessionId = data?.id ?? null;
    if (goneSessionId) createdSessionIds.push(goneSessionId);
    expect(goneSessionId).toBeTruthy();
  });

  it('returns 409 when the remote chat cannot be validated (no fallback)', async () => {
    if (!goneSessionId) return;
    const res = await request(app)
      .post('/api/chat-sessions/resume')
      .set(authHeaders())
      .send({ sessionId: goneSessionId });
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  it('with fallbackToLocal:true, drops external_chat_id and resumes locally', async () => {
    if (!goneSessionId) return;
    const res = await request(app)
      .post('/api/chat-sessions/resume')
      .set(authHeaders())
      .send({ sessionId: goneSessionId, fallbackToLocal: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.externalChatId).toBeNull();
  });
});
