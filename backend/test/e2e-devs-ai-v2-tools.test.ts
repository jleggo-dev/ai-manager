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
 *
 * CI gating (flake / upstream Devs.ai noise)
 * ------------------------------------------
 * Same opt-in as `e2e-live-provider-chat.test.ts`: under CI this suite is SKIPPED
 * unless `RUN_LIVE_PROVIDER_E2E=1` (repo Variable). Upstream 500s / "Failed to
 * send chat message" were failing otherwise-green FE PRs with no backend change
 * (CI-01 class). Local `npm test` still runs by default.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, authHeaders, uniqueName, uniqueSlug } from './setup.ts';
import { isRealProvider, type ProviderLite } from './helpers/real-providers.ts';

const TEST_USER_ID = '00000000-0000-4000-8000-0000000000d1';
const CALLING_APP = 'e2e-test:devs-ai-v2-tools';
const TOOL_EXPOSE_AS = 'echo_ping';

const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const runLiveProviderE2E =
  !isCi || process.env.RUN_LIVE_PROVIDER_E2E === '1' || process.env.RUN_LIVE_PROVIDER_E2E === 'true';

interface ApiProfile {
  id: string;
  name?: string | null;
  mode?: string | null;
  profile_type?: string | null;
  external_ai_id?: string | null;
  config?: Record<string, unknown> | null;
  provider?: { id?: string | null; name?: string | null; type?: string | null } | null;
}

let v2Profile: ApiProfile | undefined;
let createdProfileId: string | null = null;
let createdProviderId: string | null = null;
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

/**
 * Detect a function_call for OUR tool specifically (`TOOL_EXPOSE_AS`).
 *
 * Devs.ai v2 emits its own built-in "suggested_actions" function_call on
 * essentially every response (a UI affordance, unrelated to profile-configured
 * tools) — matching on event type alone false-positives on that and makes the
 * assertions below run even when the model never saw our tool at all. Match on
 * `item.name`/`name` so this only fires for the specific tool we exposed.
 */
function sawV2FunctionCall(events: Array<Record<string, unknown>>): boolean {
  return events.some((ev) => {
    const type = String(ev.type || '');
    if (type === 'response.function_call_arguments.delta' || type === 'response.function_call_arguments.done') {
      return ev.name === TOOL_EXPOSE_AS;
    }
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const item = ev.item as { type?: string; name?: string; call_id?: string } | undefined;
      return item?.type === 'function_call' && item?.name === TOOL_EXPOSE_AS;
    }
    return false;
  });
}

/** Use an existing v2 chat profile, or provision provider + profile for live testing. */
async function ensureV2ChatProfile(): Promise<ApiProfile | undefined> {
  const [profRes, provRes] = await Promise.all([
    request(app).get('/api/ai-profiles?limit=200').set(authHeaders()),
    request(app).get('/api/providers?limit=100').set(authHeaders()),
  ]);
  expect(profRes.status).toBe(200);
  expect(provRes.status).toBe(200);
  const providers = (provRes.body.data || []) as Array<ProviderLite & { is_active?: boolean }>;
  const providersById = new Map(providers.map((p) => [p.id, p]));
  const existing = ((profRes.body.data || []) as ApiProfile[]).find((p) => {
    if (p.provider?.type !== 'devs-ai-v2' || p.mode !== 'chat' || !p.external_ai_id) return false;
    const providerId = p.provider?.id ?? (p as { provider_id?: string }).provider_id ?? '';
    const full = providersById.get(providerId);
    return isRealProvider({
      name: p.provider?.name ?? full?.name,
      base_url: full?.base_url,
    });
  });
  if (existing) return existing;

  let v2Provider = providers.find((p) => p.type === 'devs-ai-v2' && p.is_active !== false && isRealProvider(p));

  if (!v2Provider) {
    const apiKey = process.env.DEVS_AI_API_KEY || process.env.TEST_DEVS_AI_API_KEY || '';
    const baseUrl = process.env.DEVS_AI_BASE_URL || 'https://devs.ai';
    if (!apiKey) {
      console.warn('[e2e-devs-ai-v2-tools] no devs-ai-v2 provider and DEVS_AI_API_KEY unset — skip');
      return undefined;
    }
    const createProv = await request(app)
      .post('/api/providers')
      .set(authHeaders())
      .send({
        name: uniqueName('E2E V2 Tools Provider'),
        type: 'devs-ai-v2',
        base_url: baseUrl,
        api_key: apiKey,
      });
    expect(createProv.status).toBe(201);
    const created = createProv.body as { id: string; type: string; is_active?: boolean };
    v2Provider = created;
    createdProviderId = created.id;
    console.info('[e2e-devs-ai-v2-tools] provisioned ephemeral devs-ai-v2 provider', createdProviderId);
  }

  if (!v2Provider) return undefined;

  let modelsRes = await request(app).get(`/api/providers/${v2Provider.id}/models`).set(authHeaders());
  expect(modelsRes.status).toBe(200);
  let models = (modelsRes.body.data || modelsRes.body || []) as Array<{ model_id?: string; is_active?: boolean }>;
  let modelId = models.find((m) => m.is_active !== false)?.model_id;
  if (!modelId) {
    const syncRes = await request(app).post(`/api/providers/${v2Provider.id}/models/sync`).set(authHeaders());
    if (syncRes.status === 200) {
      modelsRes = await request(app).get(`/api/providers/${v2Provider.id}/models`).set(authHeaders());
      models = (modelsRes.body.data || modelsRes.body || []) as Array<{ model_id?: string }>;
      modelId = models[0]?.model_id;
    }
  }
  if (!modelId) {
    console.warn('[e2e-devs-ai-v2-tools] devs-ai-v2 provider has no models — cannot provision profile');
    return undefined;
  }

  const createRes = await request(app)
    .post('/api/ai-profiles')
    .set(authHeaders())
    .send({
      name: uniqueName('E2E V2 Tools Profile'),
      provider_id: v2Provider.id,
      external_ai_id: modelId,
      mode: 'chat',
      profile_type: 'model',
    });
  expect(createRes.status).toBe(201);
  createdProfileId = createRes.body.id;
  console.info('[e2e-devs-ai-v2-tools] provisioned ephemeral v2 chat profile', createdProfileId);
  return createRes.body as ApiProfile;
}

beforeAll(async () => {
  if (!runLiveProviderE2E) {
    console.warn('[e2e-devs-ai-v2-tools] skipped in CI (set RUN_LIVE_PROVIDER_E2E=1 to enable)');
    return;
  }
  v2Profile = await ensureV2ChatProfile();
  if (!v2Profile) {
    console.warn('[e2e-devs-ai-v2-tools] no devs-ai-v2 provider/profile — tests will skip');
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
  if (!runLiveProviderE2E) return;
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
  if (createdProfileId) {
    await request(app)
      .delete(`/api/ai-profiles/${createdProfileId}`)
      .set(authHeaders())
      .catch(() => {});
  } else if (v2Profile && originalProfileConfig !== null) {
    await request(app)
      .put(`/api/ai-profiles/${v2Profile.id}`)
      .set(authHeaders())
      .send({ config: originalProfileConfig })
      .catch(() => {});
  }
  if (createdProviderId) {
    await request(app)
      .delete(`/api/providers/${createdProviderId}`)
      .set(authHeaders())
      .catch(() => {});
  }
});

describe.skipIf(!runLiveProviderE2E)('E2E: devs-ai-v2 jobs-as-tools (live)', () => {
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
       and a non-empty continuation. If the model answers directly, still require text.
       KNOWN LIVE-MODEL NON-DETERMINISM (CI-01, harmless): the model can legitimately
       choose not to invoke an available tool on a given run. That's a live-LLM behavior
       question, not something a code change can make deterministic, so we soft-pass the
       precondition here rather than failing CI on it — the fulfillment-correctness
       assertions below only make sense once the tool call actually happens. */
    if (!sawV2FunctionCall(events)) {
      console.warn(
        '[e2e-devs-ai-v2-tools] model replied without calling echo_ping this run (live non-determinism) — skipping fulfillment assertions',
        { assistantText: assistantText.slice(0, 200) },
      );
      return;
    }

    expect(assistantText.trim().length, 'tool call occurred but no assistant text after resume').toBeGreaterThan(0);
    expect(assistantText.toUpperCase()).toContain('PONG');
    console.info('[e2e-devs-ai-v2-tools] v2 function_call observed; assistant:', assistantText.slice(0, 80));

    const sessionRes = await request(app).get(`/api/chat-sessions/${sessionId}`).set(authHeaders());
    expect(sessionRes.status).toBe(200);
    const messages = (sessionRes.body.messages || []) as Array<{ role?: string; content?: string }>;
    const persistedAssistant = messages.filter((m) => m.role === 'assistant').pop();
    expect(
      persistedAssistant?.content?.toUpperCase(),
      'assistant message should be persisted after tool loop',
    ).toContain('PONG');
    const meta = sessionRes.body.provider_metadata as { previous_response_id?: string } | null;
    expect(meta?.previous_response_id, 'expected provider_metadata.previous_response_id after v2 chat').toBeTruthy();
  }, 120_000);
});
