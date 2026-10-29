/**
 * Route shape for the model liveness endpoints — models, role check and the provider client are
 * all mocked; the real provider is never called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/models/providers.ts', () => ({ getProvider: vi.fn() }));
vi.mock('../src/models/ai-profiles.ts', () => ({ listAiProfiles: vi.fn() }));
vi.mock('../src/models/app-settings.ts', () => ({ getSetting: vi.fn(), upsertSetting: vi.fn() }));
vi.mock('../src/integrations/client-factory.ts', () => ({ createLlmClientForProvider: vi.fn() }));
vi.mock('../src/middleware/require-role.ts', () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import livenessRouter from '../src/routes/providers-liveness.ts';
import { getProvider } from '../src/models/providers.ts';
import { listAiProfiles } from '../src/models/ai-profiles.ts';
import { getSetting, upsertSetting } from '../src/models/app-settings.ts';
import { createLlmClientForProvider } from '../src/integrations/client-factory.ts';

const app = express();
app.use(express.json());
app.use('/api/providers', livenessRouter);

const provider = {
  id: 'prov-1',
  name: 'Devs.ai v2',
  type: 'devs-ai-v2',
  base_url: 'https://devs.ai',
  api_key: 'secret',
  is_active: true,
  request_timeout_ms: null,
  created_at: '2026-10-28T00:00:00Z',
  workspace_id: 'ws',
};

const profiles = [
  {
    id: 'coach',
    name: 'Coach',
    provider_id: 'prov-1',
    external_ai_id: 'claude-sonnet-5',
    failover_provider_id: 'prov-1',
    failover_external_ai_id: 'gpt-4.1',
    is_active: true,
    workspace_id: 'ws',
    created_at: '2026-10-28T00:00:00Z',
  },
];

describe('POST /api/providers/:id/liveness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProvider).mockResolvedValue(provider);
    vi.mocked(listAiProfiles).mockResolvedValue(profiles);
    vi.mocked(upsertSetting).mockImplementation(async (key, value) => ({
      key,
      value,
      workspace_id: 'ws',
      created_at: '',
      updated_at: '',
    }));
    vi.mocked(createLlmClientForProvider).mockReturnValue({
      chatCompletion: vi.fn(async (model: string) => {
        if (model === 'claude-sonnet-5') {
          throw new Error(
            'Devs.ai v2 API error (400): {"error":{"message":"Model claude-sonnet-5 is not available for this request"}}',
          );
        }
        return { choices: [{ message: { content: 'OK' } }] };
      }),
    } as never);
  });

  it('runs the check, stores the report, and returns verdicts per model and per profile', async () => {
    const res = await request(app).post('/api/providers/prov-1/liveness');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      provider_id: 'prov-1',
      provider_name: 'Devs.ai v2',
      models: [
        {
          model: 'claude-sonnet-5',
          verdict: 'refused',
          message: 'Model claude-sonnet-5 is not available for this request',
        },
        { model: 'gpt-4.1', verdict: 'ok', message: null },
      ],
      profiles: [
        { id: 'coach', name: 'Coach', dead: true, primary: { verdict: 'refused' }, failover: { verdict: 'ok' } },
      ],
    });
    expect(typeof res.body.checked_at).toBe('string');
    expect(typeof res.body.models[0].duration_ms).toBe('number');
    expect(upsertSetting).toHaveBeenCalledWith(
      'provider_liveness:prov-1',
      expect.objectContaining({ provider_id: 'prov-1' }),
      expect.any(String),
    );
    // Never leaks the key.
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('404s for an unknown provider', async () => {
    vi.mocked(getProvider).mockRejectedValue(new Error('not found'));
    const res = await request(app).post('/api/providers/nope/liveness');
    expect(res.status).toBe(404);
    expect(createLlmClientForProvider).not.toHaveBeenCalled();
  });

  it('400s when the provider has no key', async () => {
    vi.mocked(getProvider).mockResolvedValue({ ...provider, api_key: null });
    const res = await request(app).post('/api/providers/prov-1/liveness');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no API key/);
  });

  it('500s with a plain message when the client cannot be built', async () => {
    vi.mocked(createLlmClientForProvider).mockImplementation(() => {
      throw new Error('Unsupported provider type "x"');
    });
    const res = await request(app).post('/api/providers/prov-1/liveness');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Model liveness check failed' });
  });
});

describe('GET /api/providers/:id/liveness', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the last stored report', async () => {
    const report = {
      provider_id: 'prov-1',
      provider_name: 'Devs.ai v2',
      checked_at: 'x',
      duration_ms: 1,
      models: [],
      profiles: [],
    };
    vi.mocked(getSetting).mockResolvedValue({
      key: 'provider_liveness:prov-1',
      value: report,
      workspace_id: 'ws',
      created_at: '',
      updated_at: '',
    });
    const res = await request(app).get('/api/providers/prov-1/liveness');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(report);
    expect(getSetting).toHaveBeenCalledWith('provider_liveness:prov-1');
  });

  it('404s when no check has run', async () => {
    vi.mocked(getSetting).mockResolvedValue(null);
    const res = await request(app).get('/api/providers/prov-1/liveness');
    expect(res.status).toBe(404);
  });
});
