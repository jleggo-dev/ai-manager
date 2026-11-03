/**
 * The failure line is a router (which branch the person is sent down), so it ships as a table of
 * positives and near-misses: a network failure must never read as "try again in a moment", and
 * a refused request must never read as "try again".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADD_FAILED, failureWords } from './failureWords.ts';

const withStatus = (status: number) => Object.assign(new Error(`failed: ${status}`), { status });
const timeout = () => Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });

afterEach(() => vi.unstubAllGlobals());

describe('failureWords — what happened, in plain words, and what to do', () => {
  it.each([
    [
      'fetch threw (network)',
      new TypeError('Failed to fetch'),
      'read',
      /offline.*couldn't look that up.*kept here/i,
      true,
    ],
    [
      'fetch threw (network), adding',
      new TypeError('Load failed'),
      'add',
      /offline.*didn't reach your meal.*Nothing was lost/i,
      true,
    ],
    ['timed out', timeout(), 'read', /took too long.*kept here.*fewer foods/i, true],
    ['timed out, adding', timeout(), 'add', /took too long.*Nothing was lost/i, true],
    ['refused (400)', withStatus(400), 'read', /couldn't take that as written.*plainer words/i, false],
    ['refused (400), adding', withStatus(400), 'add', /would not take one of those rows.*Drop the row/i, false],
    ['signed out (401)', withStatus(401), 'read', /signed out/i, false],
    ['signed out (403), adding', withStatus(403), 'add', /signed out/i, false],
    ['the meal is gone (404), adding', withStatus(404), 'add', /isn't open any more/i, false],
    ['our side (500)', withStatus(500), 'read', /my side looking that up.*kept here.*Try again/i, true],
    ['our side (503), answering', withStatus(503), 'answer', /my side looking that up/i, true],
    ['our side (500), adding', withStatus(500), 'add', new RegExp(ADD_FAILED.slice(0, 30)), true],
    // The server lost the run after the phone left (lib/api/kept-answers.ts): ours, with a way to try again.
    [
      'the run was lost on the server',
      Object.assign(withStatus(500), { lost: true }),
      'read',
      /my side looking that up.*kept here.*Try again/i,
      true,
    ],
    // Near-misses: a 404 on a read is not "the meal is gone"; an unknown throw is our side.
    ['404 on a read', withStatus(404), 'read', /my side looking that up/i, true],
    ['a bare throw', 'boom', 'read', /my side looking that up/i, true],
  ] as const)('%s → the right line', (_, err, act, line, retry) => {
    const w = failureWords(err, act);
    expect(w.line).toMatch(line);
    expect(w.retry).toBe(retry);
  });

  it('the browser saying it is offline wins over whatever the error was', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(failureWords(withStatus(500), 'read').line).toMatch(/offline/);
  });
});
