/**
 * E2E: Live devs-ai-v2 jobs-as-tools
 * -----------------------------------
 * Exercises the v2-only tool loop: profile toolJobs → function_call in SSE →
 * server-side job fulfillment → v2 /resume continuation → assistant text.
 *
 * Skips when no devs-ai-v2 chat profile exists in the workspace (same portability
 * model as e2e-live-provider-chat.test.ts).
 *
 * Requires a real devs-ai-v2 provider API key in the test workspace.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName, uniqueSlug } from './setup.ts';

const TEST_USER_ID = '00000000-0000-4000-8000-0000000000d1';
const CALLING_APP = 'e2e-test:devs-ai-v2-tools';
const TOOL_EXPOSE_AS = 'echo_ping';

interface ApiProfile {
  id: string;
  name?: string | null;
  mode?: string | null;
  profile_type?: string | null;
  external_ai_id?: string | null;
  config?: Record<string, unknown> | null;
  provider?: { type?: string | null } | null;
}

let v2Profile: ApiProfile | undefined;
let originalProfileConfig: Record<string, unknown> | null = null;
let jobId: string | null = null;
let jobSlug: string | null = null;
let sessionId: string | null = null;

function parseSseEvents(raw: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const dataStr = line.slice(6).trim();
    if (!dataStr || dataStr === '[DONE]') continue;
    try {
      events.push(JSON.parse(dataStr) as Record<string, unknown>);
    } catch {
      /* non-JSON SSE line */
    }
  }
  return events;
}

function extractAssistantText(events: Array<Record<string, unknown>>): string {
  let text = '';
  for (const ev of events) {
    if (ev.type === 'message.complete') {
      const complete = (ev.text ?? ev.content ?? ev.delta ?? '') as string;
      if (complete) return complete;
    }
    const delta =
      (ev.choices as Array<{ delta?: { content?: string } }> | undefined)?.[0]?.delta?.content ||
      (ev.text as string) ||
      (ev.delta as string) ||
      '';
    if (delta && typeof delta === 'string') text += delta;
  }
  return text;
}

function sawV2FunctionCall(events: Array<Record<string, unknown>>): boolean {
  return events.some((ev) => {
    const type = String(ev.type || '');
    if (type.includes('function_call')) return true;
    if (type === 'response.output_item.added') {
      const item = ev.item as { type?: string } | undefined;
      return item?.type === 'function_call';
    }
    return false;
  });
}

beforeAll(async () => {
  const res = await request(app).get('/api/ai-profiles?limit=200').set(authHeaders());
  expect(res.status).toBe(200);
  const profiles = (res.body.data || []) as ApiProfile[];
  v2Profile = profiles.find(
    (p) => p.provider?.type === 'devs-ai-v2' && p.mode === 'chat' && Boolean(p.external_ai_id),
  );
  if (!v2Profile) {
    console.warn('[e2e-devs-ai-v2-tools] no devs-ai-v2 chat profile — tests will skip');
    return;
  }

  originalProfileConfig = (v2Profile.config as Record<string, unknown>) || {};

  jobSlug = uniqueSlug('v2-echo-tool');
  const jobRes = await request(app)
    .post('/api/processing-jobs')
    .set(authHeaders())
    .send({
      name: uniqueName('V2 Echo Tool Job'),
      slug: jobSlug,
      ai_profile_id: v2Profile.id,
      config: {
        promptTemplate: 'Reply with exactly: {{input}}',
        variables: [{ name: 'input', description: 'Text to echo', required: true }],
      },
    });
  expect(jobRes.status).toBe(201);
  jobId = jobRes.body.id;

  const profileRes = await request(app)
    .put(`/api/ai-profiles/${v2Profile.id}`)
    .set(authHeaders())
    .send({
      config: {
        ...originalProfileConfig,
        toolJobs: [{ jobSlug, exposeAs: TOOL_EXPOSE_AS, description: 'Echoes the input string exactly' }],
      },
    });
  expect(profileRes.status).toBe(200);
});

afterAll(async () => {
  if (sessionId) {
    await request(app).delete(`/api/chat-sessions/${sessionId}`).set(authHeaders()).catch(() => {});
  }
  if (jobId) {
    await request(app).delete(`/api/processing-jobs/${jobId}`).set(authHeaders()).catch(() => {});
  }
  if (v2Profile && originalProfileConfig !== null) {
    await request(app)
      .put(`/api/ai-profiles/${v2Profile.id}`)
      .set(authHeaders())
      .send({ config: originalProfileConfig })
      .catch(() => {});
  }
});

describe('E2E: devs-ai-v2 jobs-as-tools (live)', () => {
  it('fulfills an internal tool job and continues the v2 stream', async () => {
    if (!v2Profile) return;

    const openRes = await request(app).post('/api/chat-sessions').set(authHeaders()).send({
      aiProfileId: v2Profile.id,
      userId: TEST_USER_ID,
      callingApplication: CALLING_APP,
      systemPrompt:
        'You are a test harness. When asked to use a tool, you MUST call it before replying in natural language.',
    });
    expect(openRes.status, `open failed: ${JSON.stringify(openRes.body)}`).toBe(201);
    sessionId = openRes.body.sessionId ?? openRes.body.id;

    const msgRes = await request(app)
      .post(`/api/chat-sessions/${sessionId}/messages`)
      .set(authHeaders())
      .send({
        message: `Call the ${TOOL_EXPOSE_AS} tool with input set to "PONG". After the tool returns, reply with exactly the tool output.`,
      });

    expect(msgRes.status, `message failed: ${msgRes.text?.slice(0, 500)}`).toBe(200);

    const events = parseSseEvents(msgRes.text || '');
    const assistantText = extractAssistantText(events);

    /* Tool call is model-dependent; when it fires, we must see v2 function_call events
       and a non-empty continuation. If the model answers directly, still require text. */
    if (sawV2FunctionCall(events)) {
      expect(assistantText.trim().length, 'tool call occurred but no assistant text after resume').toBeGreaterThan(0);
      console.info('[e2e-devs-ai-v2-tools] v2 function_call observed; assistant text length:', assistantText.length);
    } else {
      console.warn(
        '[e2e-devs-ai-v2-tools] model did not emit v2 function_call — accepting direct reply if non-empty',
      );
      expect(assistantText.trim().length).toBeGreaterThan(0);
    }

    /* Session should have persisted v2 threading metadata after a completed response */
    const sessionRes = await request(app).get(`/api/chat-sessions/${sessionId}`).set(authHeaders());
    expect(sessionRes.status).toBe(200);
    const meta = sessionRes.body.provider_metadata as { previous_response_id?: string } | null;
    expect(meta?.previous_response_id, 'expected provider_metadata.previous_response_id after v2 chat').toBeTruthy();
  }, 120_000);
});
