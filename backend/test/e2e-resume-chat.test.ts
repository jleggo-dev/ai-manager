/**
 * E2E: Resume chat lifecycle (Devs.ai)
 * ------------------------------------
 * Full round trip against the live backend using the real Devs.ai provider
 * already configured in the workspace:
 *   1. Discover a devs-ai, chat-mode agent profile
 *   2. Open a real Devs.ai chat session
 *   3. Close it (remote chat + row preserved)
 *   4. Resume it → remote validated, reactivated, history restored
 *   5. Continue the conversation (must NOT 409 / must NOT 404)
 *   6. Resume-after-delete → 404
 *   7. Compliance: user-data session deletion purges the remote chat
 *
 * Live cases skip when no Devs.ai chat profile is present in the workspace.
 * Not gated by RUN_LIVE_PROVIDER_E2E — resume/close is core API behavior; only
 * the optional live-provider smoke suites are opt-in in CI.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';
import { getServiceSupabase } from '../src/db/service-supabase.ts';
import { findDevsChatProfile } from './helpers/real-providers.ts';
import { LIVE_SSE_REQUEST_TIMEOUT_MS, LIVE_SSE_TEST_TIMEOUT_MS, retryTransient, sleep } from './helpers/e2e-harness.ts';

const TEST_USER_ID = '00000000-0000-4000-8000-0000000000a1';
const COMPLIANCE_USER_ID = '00000000-0000-4000-8000-0000000000a2';
const CALLING_APP = 'e2e-test:resume-chat';

let devsProfileId: string | null = null;
let sessionId: string | null = null;
let contextSessionId: string | null = null;

/**
 * Extract the assistant's text from a buffered SSE response body.
 * Mirrors the accumulation logic in the /messages route handler so the test
 * sees the same content the calling app would.
 */
function parseSseText(raw: string): string {
  let text = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const dataStr = line.slice(6).trim();
    if (!dataStr || dataStr === '[DONE]') continue;
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed.type === 'message.complete') {
        const complete = parsed.text ?? parsed.content ?? parsed.delta ?? '';
        if (complete && typeof complete === 'string') return complete;
        continue;
      }
      const delta =
        parsed.choices?.[0]?.delta?.content ||
        parsed.candidates?.[0]?.content?.parts?.[0]?.text ||
        (typeof parsed.content === 'object' ? parsed.content?.text : parsed.content) ||
        parsed.text ||
        parsed.delta ||
        '';
      if (delta && typeof delta === 'string') text += delta;
    } catch {
      /* non-JSON SSE line (event names, etc.) */
    }
  }
  return text;
}

beforeAll(async () => {
  const profile = await findDevsChatProfile(app, authHeaders);
  devsProfileId = profile?.id ?? null;
});

afterAll(async () => {
  if (sessionId) {
    await request(app).delete(`/api/chat-sessions/${sessionId}`).set(authHeaders());
  }
  if (contextSessionId) {
    await request(app).delete(`/api/chat-sessions/${contextSessionId}`).set(authHeaders());
  }
  /* Remove any compliance-user sessions left behind. */
  try {
    await getServiceSupabase().from('chat_sessions').delete().eq('user_id', COMPLIANCE_USER_ID);
  } catch {
    /* best-effort cleanup */
  }
});

describe('E2E: Resume chat lifecycle (Devs.ai)', () => {
  it('opens a real Devs.ai chat session', async () => {
    if (!devsProfileId) return;
    const res = await retryTransient('open resume-chat session', async () => {
      const r = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
        aiProfileId: devsProfileId,
        userId: TEST_USER_ID,
        callingApplication: CALLING_APP,
      });
      if (r.status >= 500) throw new Error(`open session ${r.status}: ${JSON.stringify(r.body)}`);
      return r;
    });
    expect(res.status).toBe(201);
    sessionId = res.body.sessionId ?? res.body.id;
    expect(sessionId).toBeTruthy();
  });

  it('closes the session (preserves the row + remote chat)', async () => {
    if (!sessionId) return;
    const res = await request(app).put(`/api/chat-sessions/${sessionId}/close`).set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
  });

  it('resumes the closed session and reactivates it', async () => {
    if (!sessionId) return;
    const res = await retryTransient('resume closed session', async () => {
      const r = await request(app).post('/api/chat-sessions/resume').set(authHeaders()).send({ sessionId });
      if (r.status >= 500) throw new Error(`resume ${r.status}: ${JSON.stringify(r.body)}`);
      return r;
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.sessionId).toBe(sessionId);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it(
    'continues the conversation after resume (must NOT 409)',
    async () => {
      if (!sessionId) return;
      /* Brief settle so resume's reactivate write is visible before lock acquire. */
      await sleep(500);
      const res = await request(app)
        .post(`/api/chat-sessions/${sessionId}/messages`)
        .set(authHeaders())
        .timeout({ deadline: LIVE_SSE_REQUEST_TIMEOUT_MS, response: LIVE_SSE_REQUEST_TIMEOUT_MS })
        .send({ message: 'Continue after resume' });
      /* 409 = lock leak; 404 = session reaped (soft-cleanup race) — both are failures. */
      expect(res.status).not.toBe(409);
      expect(res.status).not.toBe(404);
    },
    LIVE_SSE_TEST_TIMEOUT_MS,
  );

  it('resume-after-delete returns 404', async () => {
    if (!sessionId) return;
    const delRes = await request(app).delete(`/api/chat-sessions/${sessionId}`).set(authHeaders());
    expect(delRes.status).toBe(204);
    const resumeRes = await request(app).post('/api/chat-sessions/resume').set(authHeaders()).send({ sessionId });
    expect(resumeRes.status).toBe(404);
    sessionId = null;
  });
});

describe('E2E: Resume preserves conversation (history + AI memory)', () => {
  const CODE_WORD = 'PINEAPPLE42';

  it(
    'starts a chat, exchanges a message, closes, resumes, and the AI still remembers context',
    async () => {
      if (!devsProfileId) return;

      /* 1. Start the chat. */
      const openRes = await retryTransient('open context session', async () => {
        const r = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
          aiProfileId: devsProfileId,
          userId: TEST_USER_ID,
          callingApplication: CALLING_APP,
        });
        if (r.status >= 500) throw new Error(`open ${r.status}`);
        return r;
      });
      expect(openRes.status).toBe(201);
      contextSessionId = openRes.body.sessionId ?? openRes.body.id;
      expect(contextSessionId).toBeTruthy();

      /* 2. Turn 1 — give the AI a fact to remember. */
      const turn1 = await request(app)
        .post(`/api/chat-sessions/${contextSessionId}/messages`)
        .set(authHeaders())
        .timeout({ deadline: LIVE_SSE_REQUEST_TIMEOUT_MS, response: LIVE_SSE_REQUEST_TIMEOUT_MS })
        .send({ message: `Remember this exact code word for later: ${CODE_WORD}. Reply with only: OK` });
      expect(turn1.status).toBe(200);

      /* Let the async user/assistant message persistence settle. */
      await sleep(2000);

      /* 3. Close the chat. */
      const closeRes = await request(app).put(`/api/chat-sessions/${contextSessionId}/close`).set(authHeaders());
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.status).toBe('closed');

      /* 4. Resume — local history must be restored (our turn-1 message is back). */
      const resumeRes = await request(app)
        .post('/api/chat-sessions/resume')
        .set(authHeaders())
        .send({ sessionId: contextSessionId });
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.status).toBe('active');
      const restored = (resumeRes.body.messages || []) as Array<{ role: string; content: string }>;
      const userTurns = restored.filter((m) => m.role === 'user');
      expect(userTurns.some((m) => (m.content || '').includes(CODE_WORD))).toBe(true);

      /* 5. Continue on the resumed session — the AI must recall the code word
         from the provider-side chat history (proves a true resume, not a new chat). */
      const turn2 = await request(app)
        .post(`/api/chat-sessions/${contextSessionId}/messages`)
        .set(authHeaders())
        .timeout({ deadline: LIVE_SSE_REQUEST_TIMEOUT_MS, response: LIVE_SSE_REQUEST_TIMEOUT_MS })
        .send({ message: 'What exact code word did I give you earlier? Reply with only the code word.' });
      expect(turn2.status).toBe(200);
      const reply = parseSseText(turn2.text);
      expect(reply.toUpperCase()).toContain(CODE_WORD);
    },
    LIVE_SSE_TEST_TIMEOUT_MS,
  );
});

describe('E2E: Compliance remote purge on user-data deletion', () => {
  it("purges the remote Devs.ai chat when deleting a user's sessions", async () => {
    if (!devsProfileId) return;
    const openRes = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      aiProfileId: devsProfileId,
      userId: COMPLIANCE_USER_ID,
      callingApplication: CALLING_APP,
    });
    expect(openRes.status).toBe(201);
    const complianceSessionId = openRes.body.sessionId ?? openRes.body.id;
    const hadRemoteChat = Boolean(openRes.body.externalChatId);

    const delRes = await request(app)
      .delete(`/api/user-data/${COMPLIANCE_USER_ID}/sessions`)
      .set(authHeaders())
      .send({ confirm: 'DELETE_USER_DATA' });
    expect(delRes.status).toBe(200);
    expect(delRes.body.deleted.sessions).toBeGreaterThanOrEqual(1);
    expect(typeof delRes.body.deleted.remoteChatsPurged).toBe('number');
    if (hadRemoteChat) {
      expect(delRes.body.deleted.remoteChatsPurged).toBeGreaterThanOrEqual(1);
    }

    /* The session row should be gone after purge. */
    const getRes = await request(app).get(`/api/chat-sessions/${complianceSessionId}`).set(authHeaders());
    expect(getRes.status).toBe(404);
  });
});
