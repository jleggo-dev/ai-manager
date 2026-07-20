import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildV2ResumeBody, DevsAiV2Client, createDevsAiV2Client } from '../src/integrations/devs-ai-v2/client.ts';

describe('buildV2ResumeBody', () => {
  it('omits toolOutputs when none are provided', () => {
    expect(buildV2ResumeBody()).toEqual({});
    expect(buildV2ResumeBody([])).toEqual({});
  });

  it('maps camelCase toolOutputs with default status success', () => {
    expect(buildV2ResumeBody([{ toolCallId: 'call_1', output: '{"ok":true}' }], 'tool fulfillment')).toEqual({
      reason: 'tool fulfillment',
      toolOutputs: [{ toolCallId: 'call_1', output: '{"ok":true}', status: 'success' }],
    });
  });

  it('preserves an explicit status and never emits snake_case keys', () => {
    const body = buildV2ResumeBody([{ toolCallId: 'c2', output: 'err', status: 'error' }]);
    expect(body).toEqual({
      toolOutputs: [{ toolCallId: 'c2', output: 'err', status: 'error' }],
    });
    expect(JSON.stringify(body)).not.toContain('tool_outputs');
    expect(JSON.stringify(body)).not.toContain('tool_call_id');
  });
});

describe('DevsAiV2Client.resumeResponse', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('createDevsAiV2Client strips trailing slashes from baseUrl', () => {
    const client = createDevsAiV2Client({ baseUrl: 'https://devs.ai///', apiKey: 'k' });
    expect(client.baseUrl).toBe('https://devs.ai');
    expect(client.apiKey).toBe('k');
  });

  it('POSTs /resume with camelCase toolOutputs (not tool_outputs)', async () => {
    const emptyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: emptyStream,
      text: async () => '',
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new DevsAiV2Client('https://devs.ai', 'secret');
    await client.resumeResponse('resp_abc', [{ toolCallId: 'call_xyz', output: 'pong' }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://devs.ai/api/v2/responses/resp_abc/resume');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      toolOutputs: [{ toolCallId: 'call_xyz', output: 'pong', status: 'success' }],
    });
    expect(body).not.toHaveProperty('tool_outputs');
  });

  it('surfaces non-OK resume errors with status text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: async () => 'Unrecognized key "tool_outputs"',
        json: async () => ({}),
      }),
    );

    const client = new DevsAiV2Client('https://devs.ai', 'k');
    await expect(client.resumeResponse('resp_1', [{ toolCallId: 'c', output: 'x' }])).rejects.toThrow(
      'Devs.ai v2 resume error (400): Unrecognized key "tool_outputs"',
    );
  });
});
