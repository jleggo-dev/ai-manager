/**
 * Every way the account can answer, faked at `fetch`. Table-shaped on purpose: the card plays
 * whatever this hands back, so anything that isn't a real number has to read as "no answer" rather
 * than reach the pacer, and no failure may throw into a practice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBreathPace, saveBreathPace } from './breath-pace.ts';

type Reply = { status: number; body?: unknown } | Error | 'not json';

const calls: { url: string; method: string; body?: unknown }[] = [];
let reply: Reply = { status: 200 };

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}),
    });
    if (reply instanceof Error) throw reply;
    if (reply === 'not json') return new Response('<html>a proxy page</html>', { status: 200 });
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('getBreathPace', () => {
  it.each<[string, Reply, number | null]>([
    ['a stored pace', { status: 200, body: { pace: 1.4 } }, 1.4],
    ['never set', { status: 200, body: { pace: null } }, null],
    ['a pace that came back as a string', { status: 200, body: { pace: '1.4' } }, null],
    ['no pace field', { status: 200, body: {} }, null],
    ['refused', { status: 401, body: { error: 'Missing bearer token' } }, null],
    ['a server error', { status: 500, body: { error: 'failed' } }, null],
    ['a network failure', new Error('offline'), null],
    ['a page that is not JSON', 'not json', null],
  ])('%s', async (_name, answer, pace) => {
    reply = answer;
    await expect(getBreathPace()).resolves.toBe(pace);
    expect(calls[0]?.url).toMatch(/\/me\/breath-pace$/);
    expect(calls[0]?.method).toBe('GET');
  });
});

describe('saveBreathPace', () => {
  it.each<[string, Reply, boolean]>([
    ['stored', { status: 200, body: { pace: 1.4 } }, true],
    ['out of range', { status: 400, body: { error: 'pace must be' } }, false],
    ['a server error', { status: 500, body: { error: 'failed' } }, false],
    ['a network failure', new Error('offline'), false],
  ])('%s', async (_name, answer, saved) => {
    reply = answer;
    await expect(saveBreathPace(1.4)).resolves.toBe(saved);
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { pace: 1.4 } });
    expect(calls[0]?.url).toMatch(/\/me\/breath-pace$/);
  });
});
