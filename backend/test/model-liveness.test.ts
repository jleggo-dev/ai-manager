/**
 * Model liveness against a fake client: answers, 400 refusal (provider's words kept), timeout,
 * empty-after-reasoning, and the profile marking that follows. No real provider is called.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  checkModel,
  classifyError,
  isAgentPointer,
  markProfiles,
  modelsPointedAt,
  outputBudgetFor,
  runProviderLiveness,
  type LivenessClient,
} from '../src/services/model-liveness.ts';
import type { AiProfileRow, ProviderRow } from '../src/types.ts';

const provider: ProviderRow = {
  id: 'prov-v2',
  name: 'Devs.ai v2',
  type: 'devs-ai-v2',
  base_url: 'https://devs.ai',
  api_key: 'k',
  is_active: true,
  request_timeout_ms: null,
  created_at: '2026-10-28T00:00:00Z',
  workspace_id: 'ws',
};

function profile(partial: Partial<AiProfileRow>): AiProfileRow {
  return {
    id: 'p',
    name: 'Profile',
    provider_id: 'prov-v2',
    external_ai_id: 'gpt-4.1',
    is_active: true,
    workspace_id: 'ws',
    created_at: '2026-10-28T00:00:00Z',
    ...partial,
  };
}

const answers = (text: string) => ({ choices: [{ message: { content: text } }] });

function fakeClient(byModel: Record<string, () => Promise<unknown>>): LivenessClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    chatCompletion: vi.fn(async (model: string) => {
      calls.push(model);
      const fn = byModel[model];
      if (!fn) throw new Error(`no fake for ${model}`);
      return (await fn()) as { choices?: Array<{ message?: { content?: unknown } }> };
    }),
  };
}

const REFUSAL_400 =
  'Devs.ai v2 API error (400): {"error":{"message":"Model claude-sonnet-5 is not available for this request","type":"invalid_request_error"}}';

describe("classifyError — the provider's words survive", () => {
  it.each([
    [REFUSAL_400, 'refused', 'Model claude-sonnet-5 is not available for this request'],
    ['Devs.ai v2 API error (404): {"message":"no such model"}', 'refused', 'no such model'],
    ['Devs.ai v2 API error (400): plain text body', 'refused', 'plain text body'],
    ['Devs.ai v2 API request timed out after 30000ms', 'timeout', 'Devs.ai v2 API request timed out after 30000ms'],
    ['Devs.ai v2 API error (500): {"error":{"message":"upstream exploded"}}', 'error', 'upstream exploded'],
    ['Devs.ai v2 API error (429): {"error":{"message":"slow down"}}', 'error', 'slow down'],
    ['Google Gemini request failed: API key not valid', 'error', 'Google Gemini request failed: API key not valid'],
  ])('%s → %s', (raw, verdict, message) => {
    expect(classifyError(new Error(raw))).toEqual({ verdict, message });
  });
});

describe('checkModel', () => {
  it('ok when the model answers with text, with timing', async () => {
    const client = fakeClient({ 'gpt-4.1': async () => answers('OK') });
    const r = await checkModel(client, 'devs-ai-v2', 'gpt-4.1', 1000);
    expect(r.verdict).toBe('ok');
    expect(r.message).toBeNull();
    expect(r.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('refused carries the 400 body message', async () => {
    const client = fakeClient({
      'claude-sonnet-5': async () => {
        throw new Error(REFUSAL_400);
      },
    });
    const r = await checkModel(client, 'devs-ai-v2', 'claude-sonnet-5', 1000);
    expect(r.verdict).toBe('refused');
    expect(r.message).toBe('Model claude-sonnet-5 is not available for this request');
  });

  it('timeout when the client aborts', async () => {
    const client = fakeClient({
      slow: async () => {
        throw new Error('Devs.ai v2 API request timed out after 50ms');
      },
    });
    expect((await checkModel(client, 'devs-ai-v2', 'slow', 50)).verdict).toBe('timeout');
  });

  it('empty when a reasoning model spends the budget and returns nothing', async () => {
    const client = fakeClient({ 'gpt-5-mini': async () => answers('') });
    const r = await checkModel(client, 'devs-ai-v2', 'gpt-5-mini', 1000);
    expect(r.verdict).toBe('empty');
    expect(r.message).toMatch(/output budget/);
  });

  it('reads array content parts too', async () => {
    const client = fakeClient({
      m: async () => ({ choices: [{ message: { content: [{ type: 'text', text: 'OK' }] } }] }),
    });
    expect((await checkModel(client, 'devs-ai', 'm', 1000)).verdict).toBe('ok');
  });

  it('skips an agent id without calling the provider', async () => {
    const client = fakeClient({});
    const r = await checkModel(client, 'devs-ai', '123e4567-e89b-42d3-a456-426614174000', 1000);
    expect(r.verdict).toBe('skipped');
    expect(client.calls).toEqual([]);
  });

  it('passes the per-provider output cap: ≥400 for gpt-5-class, small otherwise', async () => {
    const client = fakeClient({ 'gpt-5.2': async () => answers('OK'), 'gpt-4.1': async () => answers('OK') });
    await checkModel(client, 'devs-ai-v2', 'gpt-5.2', 1000);
    await checkModel(client, 'devs-ai', 'gpt-4.1', 1000);
    const mock = client.chatCompletion as ReturnType<typeof vi.fn>;
    const [first, second] = mock.mock.calls.map((c) => c[2] as Record<string, unknown>);
    expect(first).toMatchObject({ max_output_tokens: expect.any(Number), timeoutMs: 1000 });
    expect(Number(first?.max_output_tokens)).toBeGreaterThanOrEqual(400);
    expect(second).toMatchObject({ max_tokens: 32, timeoutMs: 1000 });
  });
});

describe('outputBudgetFor / isAgentPointer', () => {
  it.each([
    ['gpt-5', true],
    ['gpt-5-mini', true],
    ['openai/gpt-5.2', true],
    ['o3', true],
    ['o4-mini', true],
    ['claude-opus-5-thinking', true],
    ['gpt-4.1', false],
    ['gpt-4o', false],
    ['anthropic-claude-4-5-sonnet', false],
    ['gemini-3.5-flash', false],
  ])('%s reasoning-class budget: %s', (model, big) => {
    expect(outputBudgetFor(model) >= 400).toBe(big);
  });

  it('tells an agent uuid from a model id', () => {
    expect(isAgentPointer('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    expect(isAgentPointer('gpt-4.1')).toBe(false);
  });
});

describe('modelsPointedAt — one call per distinct model, never per profile', () => {
  it('collects primary and failover on this provider only, from active profiles, deduplicated', () => {
    const profiles = [
      profile({
        id: 'a',
        external_ai_id: 'gpt-4.1',
        failover_provider_id: 'prov-v2',
        failover_external_ai_id: 'gpt-4.1-mini',
      }),
      profile({ id: 'b', external_ai_id: 'gpt-4.1' }),
      profile({
        id: 'c',
        provider_id: 'other',
        external_ai_id: 'elsewhere',
        failover_provider_id: 'prov-v2',
        failover_external_ai_id: 'gpt-4.1-mini',
      }),
      profile({ id: 'd', external_ai_id: 'inactive-model', is_active: false }),
    ];
    expect(modelsPointedAt('prov-v2', profiles)).toEqual(['gpt-4.1', 'gpt-4.1-mini']);
  });
});

describe('markProfiles', () => {
  const models = [
    { model: 'gpt-4.1', verdict: 'ok' as const, message: null, duration_ms: 1 },
    { model: 'claude-sonnet-5', verdict: 'refused' as const, message: 'nope', duration_ms: 1 },
  ];

  it('marks a profile dead when its primary is refused', () => {
    const [p] = markProfiles('prov-v2', [profile({ id: 'x', external_ai_id: 'claude-sonnet-5' })], models);
    expect(p).toMatchObject({
      id: 'x',
      dead: true,
      primary: { model: 'claude-sonnet-5', verdict: 'refused' },
      failover: null,
    });
  });

  it('marks a profile dead when only its failover is refused', () => {
    const [p] = markProfiles(
      'prov-v2',
      [
        profile({
          id: 'y',
          external_ai_id: 'gpt-4.1',
          failover_provider_id: 'prov-v2',
          failover_external_ai_id: 'claude-sonnet-5',
        }),
      ],
      models,
    );
    expect(p).toMatchObject({ dead: true, primary: { verdict: 'ok' }, failover: { verdict: 'refused' } });
  });

  it('leaves a healthy profile alive and ignores pointers on other providers', () => {
    const [p] = markProfiles(
      'prov-v2',
      [
        profile({
          id: 'z',
          external_ai_id: 'gpt-4.1',
          failover_provider_id: 'other',
          failover_external_ai_id: 'claude-sonnet-5',
        }),
      ],
      models,
    );
    expect(p).toMatchObject({ dead: false, failover: null });
  });

  it('drops inactive profiles and profiles not on this provider', () => {
    expect(markProfiles('prov-v2', [profile({ is_active: false }), profile({ provider_id: 'other' })], models)).toEqual(
      [],
    );
  });
});

describe('runProviderLiveness', () => {
  it('checks each distinct model once and marks the profiles', async () => {
    const client = fakeClient({
      'gpt-4.1': async () => answers('OK'),
      'claude-sonnet-5': async () => {
        throw new Error(REFUSAL_400);
      },
    });
    const profiles = [
      profile({
        id: 'coach',
        name: 'Coach',
        external_ai_id: 'claude-sonnet-5',
        failover_provider_id: 'prov-v2',
        failover_external_ai_id: 'claude-sonnet-5',
      }),
      profile({ id: 'broker', name: 'Broker', external_ai_id: 'gpt-4.1' }),
      profile({ id: 'judge', name: 'Judge', external_ai_id: 'gpt-4.1' }),
    ];
    const report = await runProviderLiveness(provider, profiles, client, { timeoutMs: 1000 });

    expect(client.calls.sort()).toEqual(['claude-sonnet-5', 'gpt-4.1']);
    expect(report.provider_id).toBe('prov-v2');
    expect(report.models.map((m) => [m.model, m.verdict])).toEqual([
      ['claude-sonnet-5', 'refused'],
      ['gpt-4.1', 'ok'],
    ]);
    expect(report.profiles.map((p) => [p.name, p.dead])).toEqual([
      ['Coach', true],
      ['Broker', false],
      ['Judge', false],
    ]);
    expect(Date.parse(report.checked_at)).not.toBeNaN();
  });

  it('is an empty report when nothing points at the provider', async () => {
    const client = fakeClient({});
    const report = await runProviderLiveness(provider, [], client);
    expect(report.models).toEqual([]);
    expect(report.profiles).toEqual([]);
    expect(client.calls).toEqual([]);
  });
});
