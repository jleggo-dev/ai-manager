/**
 * The gateway client against a stubbed fetch: the URL and auth it sends, the response it maps,
 * the error shape liveness parses, the timeout, and the streaming entry point that refuses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VercelAiGatewayClient,
  VERCEL_AI_GATEWAY_BASE_URL,
  STREAMING_NOT_SUPPORTED_MESSAGE,
  createVercelAiGatewayClient,
} from '../src/integrations/vercel-ai-gateway/client.ts';

const completed = (text: string) => ({
  id: 'resp_1',
  status: 'completed',
  model: 'openai/gpt-4.1-mini',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 14, output_tokens: 2, total_tokens: 16 },
});

function stubFetch(status: number, payload: unknown, contentType = 'application/json') {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    json: async () => payload,
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VercelAiGatewayClient', () => {
  it('defaults to the gateway origin and strips trailing slashes', () => {
    expect(new VercelAiGatewayClient('', 'k').baseUrl).toBe(VERCEL_AI_GATEWAY_BASE_URL);
    expect(createVercelAiGatewayClient({ baseUrl: 'https://ai-gateway.vercel.sh/v1///', apiKey: 'k' }).baseUrl).toBe(
      'https://ai-gateway.vercel.sh/v1',
    );
  });

  it('POSTs /responses with the bearer key and maps the answer to the engine shape', async () => {
    const fetchMock = stubFetch(200, completed('OK'));
    const client = new VercelAiGatewayClient(VERCEL_AI_GATEWAY_BASE_URL, 'secret');
    const res = await client.chatCompletion('openai/gpt-4.1-mini', [{ role: 'user', content: 'hi' }], {
      max_output_tokens: 16,
      chat_mode: 'execute',
      timeoutMs: 1000,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/responses');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('openai/gpt-4.1-mini');
    expect(body.store).toBe(false);
    expect(body).not.toHaveProperty('chat_mode');
    expect(body).not.toHaveProperty('timeoutMs');

    expect(res.choices[0]?.message.content).toBe('OK');
    expect(res.choices[0]?.finish_reason).toBe('stop');
    expect(res.usage).toEqual({ prompt_tokens: 14, completion_tokens: 2, total_tokens: 16 });
    expect(res.model).toBe('openai/gpt-4.1-mini');
  });

  it('throws with the status and the provider text on a non-OK answer (what liveness parses)', async () => {
    stubFetch(400, { error: { message: 'Model openai/nope is not available', type: 'AI_APICallError' } });
    const client = new VercelAiGatewayClient(VERCEL_AI_GATEWAY_BASE_URL, 'k');
    await expect(client.chatCompletion('openai/nope', [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /Vercel AI Gateway error \(400\): .*not available/,
    );
  });

  it('throws when the response failed with no text', async () => {
    stubFetch(200, { id: 'r', status: 'failed', output: [], error: { message: 'upstream exploded' } });
    const client = new VercelAiGatewayClient(VERCEL_AI_GATEWAY_BASE_URL, 'k');
    await expect(client.chatCompletion('openai/gpt-4.1-mini', [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'upstream exploded',
    );
  });

  it('turns an aborted fetch into a plain timeout error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        });
      }),
    );
    const client = new VercelAiGatewayClient(VERCEL_AI_GATEWAY_BASE_URL, 'k');
    await expect(
      client.chatCompletion('openai/gpt-4.1-mini', [{ role: 'user', content: 'hi' }], { timeoutMs: 5 }),
    ).rejects.toThrow(/timed out after 5ms/);
  });

  it('refuses to stream, with a message that says so, instead of hanging', async () => {
    const fetchMock = stubFetch(200, completed('never'));
    const client = new VercelAiGatewayClient(VERCEL_AI_GATEWAY_BASE_URL, 'k');
    await expect(client.chatCompletionStream()).rejects.toThrow(STREAMING_NOT_SUPPORTED_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(STREAMING_NOT_SUPPORTED_MESSAGE).toMatch(/not supported yet on vercel-ai-gateway/);
  });

  it('has no file store, so the engine never sends it a file_id', () => {
    const client = new VercelAiGatewayClient(VERCEL_AI_GATEWAY_BASE_URL, 'k') as unknown as Record<string, unknown>;
    expect(client.uploadFile).toBeUndefined();
  });

  it('lists model ids from GET /models and keeps the published prices on the catalogue call', async () => {
    const fetchMock = stubFetch(200, {
      data: [
        { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 mini', pricing: { input: '0.0000004', output: '0.0000016' } },
        { id: 'anthropic/claude-sonnet-5.5' },
        { nope: true },
      ],
    });
    const client = new VercelAiGatewayClient(VERCEL_AI_GATEWAY_BASE_URL, 'k');
    expect(await client.listModels()).toEqual(['openai/gpt-4.1-mini', 'anthropic/claude-sonnet-5.5']);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://ai-gateway.vercel.sh/v1/models');
    const catalogue = await client.listModelCatalog();
    expect(catalogue[0]).toEqual({
      id: 'openai/gpt-4.1-mini',
      name: 'GPT-4.1 mini',
      pricing: { input: '0.0000004', output: '0.0000016' },
    });
  });

  it('lets a failed model listing throw (no seed fallback for the gateway)', async () => {
    stubFetch(503, 'unavailable', 'text/plain');
    const client = new VercelAiGatewayClient(VERCEL_AI_GATEWAY_BASE_URL, 'k');
    await expect(client.listModels()).rejects.toThrow(/\(503\)/);
  });
});
