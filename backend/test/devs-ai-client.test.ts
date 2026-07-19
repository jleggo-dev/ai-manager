import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevsAiClient, createDevsAiClient } from '../src/integrations/devs-ai/client.ts';
import { normalizeModelListPayload } from '../src/integrations/devs-ai/normalize-models.ts';

describe('normalizeModelListPayload', () => {
  it('extracts string ids from a bare array', () => {
    expect(normalizeModelListPayload(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('extracts id/model/name from object rows', () => {
    expect(normalizeModelListPayload([{ id: 'gpt-4' }, { model: 'claude' }, { name: 'gemini' }, { other: 1 }])).toEqual(
      ['gpt-4', 'claude', 'gemini'],
    );
  });

  it('prefers payload.data then payload.models', () => {
    expect(normalizeModelListPayload({ data: [{ id: 'from-data' }] })).toEqual(['from-data']);
    expect(normalizeModelListPayload({ models: [{ id: 'from-models' }] })).toEqual(['from-models']);
  });

  it('returns [] for empty or non-object payloads', () => {
    expect(normalizeModelListPayload(null)).toEqual([]);
    expect(normalizeModelListPayload({})).toEqual([]);
    expect(normalizeModelListPayload('nope')).toEqual([]);
  });
});

describe('DevsAiClient (structural split)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('createDevsAiClient strips trailing slashes from baseUrl', () => {
    const client = createDevsAiClient({ baseUrl: 'https://api.example.com///', apiKey: 'k' });
    expect(client.baseUrl).toBe('https://api.example.com');
    expect(client.apiKey).toBe('k');
  });

  it('listAIs delegates to GET /api/v1/me/ai', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [{ id: 'ai-1' }],
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new DevsAiClient('https://api.example.com', 'secret');
    const result = await client.listAIs('OWNED');

    expect(result).toEqual([{ id: 'ai-1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/v1/me/ai?scope=OWNED');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });

  it('listModels tries fallback paths and normalizes data[].id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => 'missing',
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [{ id: 'model-a' }, { id: 'model-b' }] }),
        text: async () => '',
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new DevsAiClient('https://api.example.com', 'k');
    await expect(client.listModels()).resolves.toEqual(['model-a', 'model-b']);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://api.example.com/api/v1/models',
      'https://api.example.com/v1/models',
    ]);
  });

  it('listChatSessions returns [] when payload.data is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new DevsAiClient('https://api.example.com', 'k');
    await expect(client.listChatSessions('ai-9')).resolves.toEqual([]);
  });

  it('messageChatSession opens an SSE POST and attaches abort handles', async () => {
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      text: async () => '',
      json: async () => ({}),
    };
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse);
    vi.stubGlobal('fetch', fetchMock);

    const client = new DevsAiClient('https://api.example.com', 'k');
    const response = await client.messageChatSession('chat-1', 'hello', { timeoutMs: 5_000 });

    expect(response).toBe(fakeResponse);
    expect((response as { _abortTimer?: unknown })._abortTimer).toBeDefined();
    expect((response as { _abortController?: unknown })._abortController).toBeDefined();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/v1/chats/chat-1');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { prompt: string; date: string };
    expect(body.prompt).toBe('hello');
    expect(typeof body.date).toBe('string');
  });

  it('_request surfaces non-OK status text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => 'unauthorized',
        json: async () => ({}),
      }),
    );

    const client = new DevsAiClient('https://api.example.com', 'bad');
    await expect(client.getAI('x')).rejects.toThrow('Devs.ai API error (401): unauthorized');
  });
});
