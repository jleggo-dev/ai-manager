/**
 * E2E: Live provider chat/completion smoke test
 * ---------------------------------------------
 * Drives the *real* providers configured in the workspace (Devs.ai and
 * Google Gemini) end-to-end and asserts they actually return content.
 *
 * Why this exists
 * ---------------
 * Provider `api_key`s are stored encrypted at rest. When an AI profile is
 * loaded via a Supabase join (`getAiProfileWithKeys`), the nested provider
 * key must be decrypted before it reaches the LLM client — otherwise the
 * client authenticates with ciphertext and the call fails. The previous
 * e2e suite tolerated 400/500 on chat sends, so that decryption regression
 * slipped through. This suite is deliberately STRICT:
 *   - For every configured provider TYPE found in the workspace, a real
 *     completion (`POST /ai-profiles/:id/test-chat`) must return 200 with
 *     non-empty content.
 *   - A real chat-mode profile must open a session and stream a non-empty
 *     assistant reply (the exact "chat with Gemini 2.5" flow the UI hit).
 *
 * Portability: a provider type that has no profile in the current workspace
 * is skipped (logged), but any provider that *is* present MUST work — a
 * configured-but-broken provider fails the suite rather than skipping.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';

const TEST_USER_ID = '00000000-0000-4000-8000-0000000000b1';
const CALLING_APP = 'e2e-test:live-provider-chat';

/** Provider types we expect to be able to exercise when present. */
const TARGET_PROVIDER_TYPES = ['devs-ai', 'devs-ai-v2', 'google-gemini'] as const;

interface ApiProfile {
  id: string;
  name?: string | null;
  mode?: string | null;
  profile_type?: string | null;
  external_ai_id?: string | null;
  provider?: { type?: string | null } | null;
}

let profiles: ApiProfile[] = [];
const sessionIdsToCleanup: string[] = [];

/**
 * Extract the assistant's text from a buffered SSE response body. Mirrors the
 * accumulation logic used by the /messages route so the test sees the same
 * content a calling application would receive.
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
      /* non-JSON SSE line (event names, keep-alives, etc.) */
    }
  }
  return text;
}

/** Pick the best completion-test candidate for a provider type. */
function pickCompletionProfile(type: string): ApiProfile | undefined {
  const ofType = profiles.filter((p) => p.provider?.type === type && Boolean(p.external_ai_id));
  /* Prefer concrete model profiles — agent profiles route their external_ai_id
     differently and aren't a clean "model completion" check. */
  return ofType.find((p) => p.profile_type === 'model') ?? ofType[0];
}

/** All chat-mode profiles from target providers (for the streaming round trip). */
function chatProfileCandidates(): ApiProfile[] {
  return profiles.filter(
    (p) =>
      p.mode === 'chat' &&
      Boolean(p.external_ai_id) &&
      TARGET_PROVIDER_TYPES.includes((p.provider?.type ?? '') as (typeof TARGET_PROVIDER_TYPES)[number]),
  );
}

/** A remote "model/AI not found" is a stale profile config, not an auth/decrypt failure. */
function isModelNotFound(status: number, body: unknown): boolean {
  if (status !== 404) return false;
  const msg = JSON.stringify(body ?? '').toLowerCase();
  return msg.includes('not found') || msg.includes('not_found');
}

beforeAll(async () => {
  const res = await request(app).get('/api/ai-profiles?limit=200').set(authHeaders());
  expect(res.status).toBe(200);
  profiles = (res.body.data || []) as ApiProfile[];
  expect(profiles.length).toBeGreaterThan(0);
});

afterAll(async () => {
  for (const id of sessionIdsToCleanup) {
    await request(app).delete(`/api/chat-sessions/${id}`).set(authHeaders()).catch(() => {});
  }
});

describe('E2E: Live provider completion (test-chat)', () => {
  for (const type of TARGET_PROVIDER_TYPES) {
    it(`${type}: real completion returns non-empty content`, async () => {
      const profile = pickCompletionProfile(type);
      if (!profile) {
        console.warn(`[live-provider-chat] no "${type}" profile in workspace — skipping`);
        return;
      }

      const res = await request(app)
        .post(`/api/ai-profiles/${profile.id}/test-chat`)
        .set(authHeaders())
        .send({
          message: 'Reply with exactly the single word: PONG',
          systemPrompt: 'You are a test harness. Follow the user instruction exactly.',
        });

      /* STRICT: a configured provider must authenticate and respond.
         An encrypted-key regression surfaces here as 500 / empty content. */
      expect(
        res.status,
        `${type} test-chat failed (${res.status}): ${JSON.stringify(res.body)}`,
      ).toBe(200);
      expect(typeof res.body.content).toBe('string');
      expect(res.body.content.trim().length).toBeGreaterThan(0);
    });
  }
});

describe('E2E: Live chat session round trip (the UI "chat with" flow)', () => {
  it('opens a real chat session and streams a non-empty assistant reply', async () => {
    const candidates = chatProfileCandidates();
    if (candidates.length === 0) {
      console.warn('[live-provider-chat] no chat-mode profile in workspace — skipping');
      return;
    }

    /* Try each chat profile in turn. A profile that references a stale/unknown
       remote model id 404s at open time — that's a profile-config issue, not the
       auth/decryption path we're verifying, so we move on. An auth/decryption
       regression makes EVERY candidate fail (caught below). */
    let streamedText = '';
    let openedAny = false;
    const failures: string[] = [];

    for (const profile of candidates) {
      const openRes = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
        aiProfileId: profile.id,
        userId: TEST_USER_ID,
        callingApplication: CALLING_APP,
      });

      if (openRes.status !== 201) {
        const label = `${profile.name ?? profile.id} (${profile.provider?.type})`;
        if (isModelNotFound(openRes.status, openRes.body)) {
          console.warn(`[live-provider-chat] skip "${label}" — remote model not found`);
          failures.push(`${label}: model-not-found`);
          continue;
        }
        failures.push(`${label}: open ${openRes.status} ${JSON.stringify(openRes.body)}`);
        continue;
      }

      openedAny = true;
      const sessionId = openRes.body.sessionId ?? openRes.body.id;
      expect(sessionId).toBeTruthy();
      sessionIdsToCleanup.push(sessionId);

      const msgRes = await request(app)
        .post(`/api/chat-sessions/${sessionId}/messages`)
        .set(authHeaders())
        .send({ message: 'Reply with exactly the single word: PONG' });
      expect(
        msgRes.status,
        `message send failed (${msgRes.status}): ${msgRes.text?.slice(0, 500)}`,
      ).toBe(200);

      streamedText = parseSseText(msgRes.text || '');
      if (streamedText.trim().length > 0) break;
    }

    /* If nothing even opened, every candidate hit model-not-found OR an
       auth/decryption failure — surface the details. */
    expect(
      openedAny,
      `no chat profile opened a live session. Failures:\n  ${failures.join('\n  ')}`,
    ).toBe(true);
    expect(streamedText.trim().length, 'opened a session but streamed no assistant text').toBeGreaterThan(0);
  });
});
