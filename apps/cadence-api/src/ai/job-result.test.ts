import { describe, expect, it } from 'vitest';
import { truncatedVariablesOf } from './job-result.ts';

const cut = { variable: 'book', length: 41_000, cap: 40_000 };

describe('truncatedVariablesOf', () => {
  it.each([
    ['the in-process result', { raw: '', metadata: { model: 'm', truncatedVariables: [cut] } }, [cut]],
    [
      'the remote route body',
      { raw: '', formatted: '', metadata: { model: 'm', durationMs: 1, truncatedVariables: [cut] } },
      [cut],
    ],
    ['a run with no cut', { raw: '', metadata: { model: 'm' } }, []],
    ['a remote body with an empty list', { raw: '', metadata: { truncatedVariables: [] } }, []],
    ['a body with no metadata at all', { raw: '' }, []],
    ['not an object', 'ok', []],
    ['null', null, []],
    ['a non-array where the list should be', { metadata: { truncatedVariables: 'book' } }, []],
  ])('%s', (_name, res, expected) => {
    expect(truncatedVariablesOf(res)).toEqual(expected);
  });
});
