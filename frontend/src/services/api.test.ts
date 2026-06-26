import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/auth-session', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
  getWorkspaceId: vi.fn(() => 'test-workspace-id'),
  getSessionUser: vi.fn(() => null),
}));

vi.mock('../lib/api-url', () => ({
  resolveApiUrl: vi.fn((path: string) => path),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  listProviders,
  createProvider,
  deleteProvider,
  listAiProfiles,
  createAiProfile,
  deleteAiProfile,
  listProcessingJobs,
  testProcessingJob,
  deleteProcessingJob,
  listCallingApplications,
  deleteCallingApplication,
  listWorkflows,
  deleteWorkflow,
} from './api';

type FetchCall = [string, RequestInit];

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function paginatedJson<T>(data: T[]) {
  return okJson({
    data,
    pagination: { has_more: false, next_cursor: null, prev_cursor: null, limit: 50 },
  });
}

function noContentResponse() {
  return { ok: true, status: 204, json: async () => null, text: async () => '' };
}

function errorJson(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ error: message }),
    text: async () => JSON.stringify({ error: message }),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

/* ── Request infrastructure ──────────────────────────────────── */

describe('request infrastructure', () => {
  it('sends GET request with auth headers for listProviders', async () => {
    mockFetch.mockResolvedValueOnce(paginatedJson([]));
    await listProviders();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as FetchCall;
    expect(url).toBe('/api/providers');
    expect(opts.method).toBeUndefined();
  });

  it('sends POST with JSON body for createProvider', async () => {
    const body = { name: 'OpenAI', type: 'openai', base_url: 'https://api.openai.com' };
    mockFetch.mockResolvedValueOnce(okJson({ id: 'p1', ...body }));
    await createProvider(body);

    const [, opts] = mockFetch.mock.calls[0] as FetchCall;
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(JSON.stringify(body));
  });

  it('includes Authorization header with the token', async () => {
    mockFetch.mockResolvedValueOnce(paginatedJson([]));
    await listProviders();

    const [, opts] = mockFetch.mock.calls[0] as FetchCall;
    expect(opts.headers).toHaveProperty('Authorization', 'Bearer test-token');
  });

  it('includes X-Workspace-Id header', async () => {
    mockFetch.mockResolvedValueOnce(paginatedJson([]));
    await listProviders();

    const [, opts] = mockFetch.mock.calls[0] as FetchCall;
    expect(opts.headers).toHaveProperty('X-Workspace-Id', 'test-workspace-id');
  });

  it('throws an error with status info on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce(errorJson(422, 'Validation failed'));

    await expect(listProviders()).rejects.toThrow('Validation failed');
    try {
      mockFetch.mockResolvedValueOnce(errorJson(500, 'Server error'));
      await listProviders();
    } catch (err) {
      expect(err).toHaveProperty('status', 500);
      expect(err).toHaveProperty('data', { error: 'Server error' });
    }
  });
});

/* ── Provider API ────────────────────────────────────────────── */

describe('Provider API', () => {
  it('listProviders returns paginated response data', async () => {
    const providers = [{ id: 'p1', name: 'OpenAI' }];
    mockFetch.mockResolvedValueOnce(paginatedJson(providers));
    const result = await listProviders();

    expect(result.data).toEqual(providers);
    expect(result.pagination.has_more).toBe(false);
  });

  it('createProvider sends correct body shape', async () => {
    const payload = { name: 'Anthropic', type: 'anthropic', base_url: 'https://api.anthropic.com', api_key: 'sk-ant' };
    mockFetch.mockResolvedValueOnce(okJson({ id: 'p2', ...payload }));
    const result = await createProvider(payload);

    expect(result).toHaveProperty('id', 'p2');
    const [, opts] = mockFetch.mock.calls[0] as FetchCall;
    expect(JSON.parse(String(opts.body))).toEqual(payload);
  });

  it('deleteProvider sends DELETE to correct URL', async () => {
    mockFetch.mockResolvedValueOnce(noContentResponse());
    await deleteProvider('p1');

    const [url, opts] = mockFetch.mock.calls[0] as FetchCall;
    expect(url).toBe('/api/providers/p1');
    expect(opts.method).toBe('DELETE');
  });
});

/* ── AI Profiles API ─────────────────────────────────────────── */

describe('AI Profiles API', () => {
  it('listAiProfiles returns paginated data', async () => {
    const profiles = [{ id: 'ap1', name: 'GPT-4' }];
    mockFetch.mockResolvedValueOnce(paginatedJson(profiles));
    const result = await listAiProfiles();

    expect(result.data).toEqual(profiles);
    expect(result.pagination).toBeDefined();
  });

  it('createAiProfile sends correct body', async () => {
    const payload = { name: 'Claude', provider_id: 'p2', external_ai_id: 'claude-3' };
    mockFetch.mockResolvedValueOnce(okJson({ id: 'ap2', ...payload }));
    await createAiProfile(payload);

    const [url, opts] = mockFetch.mock.calls[0] as FetchCall;
    expect(url).toBe('/api/ai-profiles');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(String(opts.body))).toEqual(payload);
  });
});

/* ── Processing Jobs API ─────────────────────────────────────── */

describe('Processing Jobs API', () => {
  it('listProcessingJobs calls correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce(paginatedJson([]));
    await listProcessingJobs();

    const [url] = mockFetch.mock.calls[0] as FetchCall;
    expect(url).toBe('/api/processing-jobs');
  });

  it('testProcessingJob sends correct body', async () => {
    const variables = { input: 'hello' };
    mockFetch.mockResolvedValueOnce(okJson({ result: 'world' }));
    await testProcessingJob('job1', variables, 'custom prompt');

    const [url, opts] = mockFetch.mock.calls[0] as FetchCall;
    expect(url).toBe('/api/processing-jobs/job1/test');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(String(opts.body))).toEqual({
      variables,
      promptOverride: 'custom prompt',
    });
  });
});

/* ── General patterns ────────────────────────────────────────── */

describe('General patterns', () => {
  it('all list functions decode paginated response envelope', async () => {
    const envelope = {
      data: [{ id: '1' }],
      pagination: { has_more: true, next_cursor: 'abc', prev_cursor: null, limit: 50 },
    };

    mockFetch.mockResolvedValueOnce(okJson(envelope));
    const providers = await listProviders();
    expect(providers.data).toHaveLength(1);
    expect(providers.pagination.has_more).toBe(true);
    expect(providers.pagination.next_cursor).toBe('abc');

    mockFetch.mockResolvedValueOnce(okJson(envelope));
    const profiles = await listAiProfiles();
    expect(profiles.pagination).toEqual(envelope.pagination);

    mockFetch.mockResolvedValueOnce(okJson(envelope));
    const jobs = await listProcessingJobs();
    expect(jobs.pagination.limit).toBe(50);

    mockFetch.mockResolvedValueOnce(okJson(envelope));
    const apps = await listCallingApplications();
    expect(apps.data).toHaveLength(1);

    mockFetch.mockResolvedValueOnce(okJson(envelope));
    const workflows = await listWorkflows();
    expect(workflows.pagination).toBeDefined();
  });

  it('delete functions return void/undefined', async () => {
    mockFetch.mockResolvedValueOnce(noContentResponse());
    const r1 = await deleteProvider('p1');
    expect(r1).toBeNull();

    mockFetch.mockResolvedValueOnce(noContentResponse());
    const r2 = await deleteAiProfile('ap1');
    expect(r2).toBeNull();

    mockFetch.mockResolvedValueOnce(noContentResponse());
    const r3 = await deleteProcessingJob('j1');
    expect(r3).toBeNull();

    mockFetch.mockResolvedValueOnce(noContentResponse());
    const r4 = await deleteCallingApplication('ca1');
    expect(r4).toBeNull();

    mockFetch.mockResolvedValueOnce(noContentResponse());
    const r5 = await deleteWorkflow('w1');
    expect(r5).toBeNull();
  });

  it('error response includes the error message from server', async () => {
    mockFetch.mockResolvedValueOnce(errorJson(404, 'Provider not found'));

    try {
      await listProviders();
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toHaveProperty('message', 'Provider not found');
      expect(err).toHaveProperty('status', 404);
      expect(err).toHaveProperty('data', { error: 'Provider not found' });
    }
  });
});
