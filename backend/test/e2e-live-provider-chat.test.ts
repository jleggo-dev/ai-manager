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
 *
 * CI gating (flake / upstream credential noise)
 * ---------------------------------------------
 * GitHub Actions sets `CI=true`. Under CI this suite is SKIPPED unless
 * `RUN_LIVE_PROVIDER_E2E=1` is also set on the job (repo Variable). Intermittent
 * upstream 500s from Devs.ai v2 were turning otherwise-green PRs red without a
 * code regression (see refactoring_plan.md §4.6 / CI-01). Local `npm test` still
 * runs these by default. To exercise them in Actions: set repo Variable
 * `RUN_LIVE_PROVIDER_E2E=1` (and keep `DEVS_AI_API_KEY`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders } from './setup.ts';
import { filterRealProviderProfiles, type ProfileLite, type ProviderLite } from './helpers/real-providers.ts';

const TEST_USER_ID = '00000000-0000-4000-8000-0000000000b1';
const CALLING_APP = 'e2e-test:live-provider-chat';

/** Provider types we expect to be able to exercise when present. */
const TARGET_PROVIDER_TYPES = ['devs-ai', 'devs-ai-v2', 'google-gemini'] as const;

/**
 * Skip live provider smokes in CI unless explicitly opted in. Local runs keep
 * the previous always-on behavior so decrypt regressions still surface on a
 * developer machine with real workspace credentials.
 */
const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const runLiveProviderE2E =
  !isCi || process.env.RUN_LIVE_PROVIDER_E2E === '1' || process.env.RUN_LIVE_PROVIDER_E2E === 'true';

/**
 * CI-01 — Devs.ai v1 live-credential quarantine (cleared 2026-07-20)
 * ------------------------------------------------------------------
 * Historically the "devs-ai" (v1) provider row returned
 * `401 Unauthorized: {"message":"Unauthorized"}` from the real Devs.ai API
 * while "devs-ai-v2" (same decrypt path) worked — an expired upstream key,
 * not a decryption regression. Human rotated the stored v1 key; flag is
 * `false` so the live case runs again.
 *
 * If v1 starts failing with 401 again: set this back to `true`, quarantine
 * via `it.skipIf` below, and rotate the key on the Providers page (or
 * `POST /api/providers/:id`) before flipping back to `false`.
 */
const DEVS_AI_V1_KEY_KNOWN_EXPIRED = false;

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
  if (!runLiveProviderE2E) {
    console.warn('[live-provider-chat] skipped in CI (set RUN_LIVE_PROVIDER_E2E=1 to enable live provider smokes)');
    return;
  }
  const [profRes, provRes] = await Promise.all([
    request(app).get('/api/ai-profiles?limit=200').set(authHeaders()),
    request(app).get('/api/providers?limit=100').set(authHeaders()),
  ]);
  expect(profRes.status).toBe(200);
  const providers = provRes.status === 200 ? ((provRes.body.data || []) as ProviderLite[]) : [];
  profiles = filterRealProviderProfiles((profRes.body.data || []) as ProfileLite[], providers) as ApiProfile[];
  expect(profiles.length).toBeGreaterThan(0);
});

afterAll(async () => {
  for (const id of sessionIdsToCleanup) {
    await request(app)
      .delete(`/api/chat-sessions/${id}`)
      .set(authHeaders())
      .catch(() => {});
  }
});

describe.skipIf(!runLiveProviderE2E)('E2E: Live provider completion (test-chat)', () => {
  for (const type of TARGET_PROVIDER_TYPES) {
    it.skipIf(type === 'devs-ai' && DEVS_AI_V1_KEY_KNOWN_EXPIRED)(
      `${type}: real completion returns non-empty content`,
      async () => {
        const profile = pickCompletionProfile(type);
        if (!profile) {
          console.warn(`[live-provider-chat] no "${type}" profile in workspace — skipping`);
          return;
        }

        const res = await request(app).post(`/api/ai-profiles/${profile.id}/test-chat`).set(authHeaders()).send({
          message: 'Reply with exactly the single word: PONG',
          systemPrompt: 'You are a test harness. Follow the user instruction exactly.',
        });

        /* STRICT: a configured provider must authenticate and respond.
         An encrypted-key regression surfaces here as 500 / empty content. */
        expect(res.status, `${type} test-chat failed (${res.status}): ${JSON.stringify(res.body)}`).toBe(200);
        expect(typeof res.body.content).toBe('string');
        expect(res.body.content.trim().length).toBeGreaterThan(0);
      },
    );
  }
});

describe.skipIf(!runLiveProviderE2E)('E2E: Live chat session round trip (the UI "chat with" flow)', () => {
  it('opens a real chat session and streams a non-empty assistant reply', async () => {
    const candidates = chatProfileCandidates();
    if (candidates.length === 0) {
      console.warn('[live-provider-chat] no chat-mode profile in workspace — skipping');
      return;
    }

    /* Try each chat profile in turn. A profile that references a stale/unknown
       remote model id 404s at open time — that's a profile-config issue, not the
       auth/decryption path we're verifying, so we move on. Upstream/provider
       500s on send are treated the same (try next candidate) so one flaky
       Devs.ai row cannot fail the suite when Gemini (or another profile) works.
       An auth/decryption regression that breaks EVERY candidate is still caught. */
    let streamedText = '';
    let openedAny = false;
    const failures: string[] = [];

    for (const profile of candidates) {
      const label = `${profile.name ?? profile.id} (${profile.provider?.type})`;
      const openRes = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
        aiProfileId: profile.id,
        userId: TEST_USER_ID,
        callingApplication: CALLING_APP,
      });

      if (openRes.status !== 201) {
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

      if (msgRes.status !== 200) {
        console.warn(
          `[live-provider-chat] skip "${label}" — message send ${msgRes.status}: ${msgRes.text?.slice(0, 200)}`,
        );
        failures.push(`${label}: send ${msgRes.status}`);
        continue;
      }

      streamedText = parseSseText(msgRes.text || '');
      if (streamedText.trim().length > 0) break;
      failures.push(`${label}: empty stream`);
    }

    /* If nothing even opened, every candidate hit model-not-found OR an
       auth/decryption failure — surface the details. */
    expect(openedAny, `no chat profile opened a live session. Failures:\n  ${failures.join('\n  ')}`).toBe(true);
    expect(
      streamedText.trim().length,
      `opened a session but streamed no assistant text. Failures:\n  ${failures.join('\n  ')}`,
    ).toBeGreaterThan(0);
  });
});
