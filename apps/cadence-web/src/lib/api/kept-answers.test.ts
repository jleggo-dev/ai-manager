/**
 * `postKept` — a POST whose answer is kept on the server, and every way the connection can fare
 * (kept-answers.ts). Table-shaped on purpose: the branch is a router — which word from the server
 * leads to which next move — and the wrong move shows someone "couldn't reach" for an answer that
 * exists, or re-sends a read the server is already running.
 *
 * The connection is faked at `fetch`: a reply, a thrown network error, or a request that hangs
 * until its signal aborts — which is what an iOS suspend does to a fetch in flight.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postKept, newRequestId } from './kept-answers.ts';

type Call = { url: string; method: string; body?: Record<string, unknown>; signal?: AbortSignal | null };
type Reply = { status: number; body?: unknown } | Error | 'hang';
const calls: Call[] = [];
let script: Reply[] = [];

/** Never settles on its own; rejects with the signal's reason when aborted — the iOS corpse. */
const hang = (signal?: AbortSignal | null) =>
  new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));

beforeEach(() => {
  calls.length = 0;
  script = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined,
      signal: init?.signal,
    };
    calls.push(call);
    const r = script.shift() ?? { status: 200, body: {} };
    if (r === 'hang') return hang(init?.signal);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});
afterEach(() => vi.unstubAllGlobals());

const lostConnection = () => new TypeError('The network connection was lost.');
const ANSWER = { items: [{ name: 'Beer' }] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ask = (path = '/nutrition/meals/preview', extra: Partial<Parameters<typeof postKept>[2]> = {}) =>
  postKept<typeof ANSWER>(
    path,
    { text: 'a pint of beer' },
    { timeoutMs: 5_000, label: 'meal preview', pollMs: 1, ...extra },
  );
const shape = () => calls.map((c) => `${c.method} ${c.url.replace(/^.*?\/api/, '')}`);

describe('postKept — the connection holds', () => {
  it('answers live: one POST under a fresh request id, nothing asked after', async () => {
    script = [{ status: 200, body: ANSWER }];
    await expect(ask()).resolves.toEqual(ANSWER);
    expect(shape()).toEqual(['POST /nutrition/meals/preview']);
    expect(calls[0]!.body).toMatchObject({ text: 'a pint of beer' });
    expect(calls[0]!.body!.request_id).toMatch(UUID);
  });

  it('a live refusal is thrown with its status, as the plain fetch did', async () => {
    script = [{ status: 400, body: { error: 'a meal needs words' } }];
    await expect(ask()).rejects.toMatchObject({ status: 400 });
    expect(shape()).toEqual(['POST /nutrition/meals/preview']);
  });

  it('a 202 — the server already holds a run under this id — means ask after it', async () => {
    script = [
      { status: 202, body: { status: 'running' } },
      { status: 200, body: { status: 'done', answer: ANSWER } },
    ];
    await expect(ask()).resolves.toEqual(ANSWER);
    expect(shape()[1]).toMatch(/^GET \/answers\//);
  });
});

describe('postKept — the connection dies (the app left the screen)', () => {
  it('asks after the answer until it is done, and resolves with it — not with the dead socket', async () => {
    script = [
      lostConnection(),
      { status: 200, body: { status: 'running', started_at: 'now' } },
      { status: 200, body: { status: 'done', answer: ANSWER } },
    ];
    await expect(ask()).resolves.toEqual(ANSWER);
    expect(shape()).toEqual(
      ['POST /nutrition/meals/preview', 'GET /answers/x', 'GET /answers/x'].map((s) =>
        s.replace('x', String(calls[0]!.body!.request_id)),
      ),
    );
  });

  it('a refusal the server kept is thrown with its status, exactly like a live 400', async () => {
    script = [
      lostConnection(),
      { status: 200, body: { status: 'failed', fault: { status: 400, error: 'a meal needs words' } } },
    ];
    await expect(ask()).rejects.toMatchObject({ status: 400 });
  });

  it('a run the server lost is a fault of ours with a way to try again — never an empty answer', async () => {
    script = [lostConnection(), { status: 200, body: { status: 'lost' } }];
    await expect(ask()).rejects.toMatchObject({ status: 500, lost: true });
  });

  it('the server never got it → re-sent once, under the SAME id, and the re-send answers', async () => {
    script = [lostConnection(), { status: 200, body: { status: 'unknown' } }, { status: 200, body: ANSWER }];
    await expect(ask()).resolves.toEqual(ANSWER);
    expect(shape().map((s) => s.split(' ')[0])).toEqual(['POST', 'GET', 'POST']);
    expect(calls[2]!.body!.request_id).toBe(calls[0]!.body!.request_id);
  });

  it('re-sent and still unknown a few asks later → the failure is reported, not spun on until the bound', async () => {
    const unknown = { status: 200, body: { status: 'unknown' } };
    script = [lostConnection(), unknown, lostConnection(), unknown, unknown, unknown, unknown, unknown];
    await expect(ask()).rejects.toBeInstanceOf(TypeError);
    // Two sends, one ask before the re-send, three after it. Then it stops.
    expect(shape().map((s) => s.split(' ')[0])).toEqual(['POST', 'GET', 'POST', 'GET', 'GET', 'GET']);
  });

  it('offline: the error is reported at once, nothing is asked', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    script = [lostConnection()];
    await expect(ask()).rejects.toBeInstanceOf(TypeError);
    expect(shape()).toEqual(['POST /nutrition/meals/preview']);
  });

  it('two asks in a row that cannot reach the server → reported, not spun on until the bound', async () => {
    script = [lostConnection(), lostConnection(), lostConnection()];
    await expect(ask()).rejects.toBeInstanceOf(TypeError);
    expect(shape().map((s) => s.split(' ')[0])).toEqual(['POST', 'GET', 'GET']);
  });

  it('past the bound with the server still running → took too long, after one last ask', async () => {
    script = ['hang', { status: 200, body: { status: 'running', started_at: 'now' } }];
    await expect(ask('/nutrition/meals/preview', { timeoutMs: 30 })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(shape().map((s) => s.split(' ')[0])).toEqual(['POST', 'GET']);
  });
});

describe('postKept — coming back, stopping, picking up', () => {
  it('coming back to the foreground asks at once while the POST hangs, and the kept answer wins', async () => {
    script = ['hang', { status: 200, body: { status: 'done', answer: ANSWER } }];
    const pending = ask();
    await new Promise((r) => setTimeout(r, 5));
    expect(shape()).toEqual(['POST /nutrition/meals/preview']);
    document.dispatchEvent(new Event('visibilitychange'));
    await expect(pending).resolves.toEqual(ANSWER);
    expect(shape().map((s) => s.split(' ')[0])).toEqual(['POST', 'GET']);
    // The corpse is let go.
    expect(calls[0]!.signal?.aborted).toBe(true);
  });

  it("the caller's own stop ends everything at once, with its reason, and asks nothing", async () => {
    script = ['hang'];
    const ctrl = new AbortController();
    const pending = ask('/nutrition/meals/preview', { signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 5));
    ctrl.abort(new DOMException('left', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(shape()).toEqual(['POST /nutrition/meals/preview']);
  });

  it('resume: asks first under the remembered id, sends nothing, and takes the kept answer', async () => {
    const id = newRequestId();
    script = [{ status: 200, body: { status: 'done', answer: ANSWER } }];
    await expect(ask('/nutrition/meals/preview', { requestId: id, resume: true })).resolves.toEqual(ANSWER);
    expect(shape()).toEqual([`GET /answers/${id}`]);
  });

  it('resume on an id the server never saw → sent, once, under that same id', async () => {
    const id = newRequestId();
    script = [
      { status: 200, body: { status: 'unknown' } },
      { status: 200, body: ANSWER },
    ];
    await expect(ask('/nutrition/meals/preview', { requestId: id, resume: true })).resolves.toEqual(ANSWER);
    expect(shape()).toEqual([`GET /answers/${id}`, 'POST /nutrition/meals/preview']);
    expect(calls[1]!.body!.request_id).toBe(id);
  });

  it('newRequestId mints a uuid, and a fresh one each time', () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
  });
});
