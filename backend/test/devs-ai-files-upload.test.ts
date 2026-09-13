import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEVS_AI_MULTIPART_MAX_BYTES, uploadStandaloneFile } from '../src/integrations/devs-ai/files.ts';
import type { DevsAiHttp } from '../src/integrations/devs-ai/types.ts';

/**
 * The standalone upload behind `LlmClient.uploadFile` on both Devs.ai clients (owner,
 * 2026-09-11: documents on the coach chat). Pins the spec's contract: multipart to
 * POST /api/v1/files with the bearer key and NO hand-set Content-Type (fetch must write the
 * boundary), the ~4.5 MB ceiling refused up front rather than discovered as a 413, and the
 * "poll until UPLOADED before referencing" rule.
 */
function fakeClient(request: DevsAiHttp['_request']): DevsAiHttp {
  return {
    baseUrl: 'https://devs.test',
    apiKey: 'k',
    _headers: (extra = {}) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer k', ...extra }),
    _request: request,
  };
}

describe('uploadStandaloneFile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs multipart to /api/v1/files with the bearer key and lets fetch set the boundary', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'file_1', status: 'UPLOADED' })));
    vi.stubGlobal('fetch', fetchMock);
    const request = vi.fn();
    const out = await uploadStandaloneFile(fakeClient(request), {
      buffer: Buffer.from('%PDF-1.4'),
      filename: 'labs.pdf',
      mimeType: 'application/pdf',
    });
    expect(out).toEqual({ fileId: 'file_1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://devs.test/api/v1/files');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(request).not.toHaveBeenCalled(); // already UPLOADED — zero poll rounds
  });

  it('polls GET /api/v1/files/{id} until UPLOADED before handing the id back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'file_2', status: 'UPLOADING' }))),
    );
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 'UPLOADING' })
      .mockResolvedValueOnce({ status: 'UPLOADED' });
    vi.useFakeTimers();
    const pending = uploadStandaloneFile(fakeClient(request), {
      buffer: Buffer.from('x'),
      filename: 'a.pdf',
      mimeType: 'application/pdf',
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ fileId: 'file_2' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[1]).toBe('/api/v1/files/file_2');
    vi.useRealTimers();
  });

  it('refuses a file over the multipart ceiling before touching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      uploadStandaloneFile(fakeClient(vi.fn()), {
        buffer: Buffer.alloc(DEVS_AI_MULTIPART_MAX_BYTES + 1),
        filename: 'big.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow(/4\.5 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a provider refusal with its status and body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 413 })),
    );
    await expect(
      uploadStandaloneFile(fakeClient(vi.fn()), {
        buffer: Buffer.from('x'),
        filename: 'a.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow(/413.*nope/);
  });
});
