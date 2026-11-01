import { describe, expect, it } from 'vitest';
import { countPhrase, GATE_PHRASE, renderGate } from './tool-mutates.ts';

/**
 * The generator behind every action's safety sentence (HARNESS-V3 C4). What it decides is the
 * capital letter: the same phrase opens a sentence in most descriptions and sits mid-sentence in a
 * few ("This does NOT change anything…", "…and takes effect immediately"), and both have to come out
 * exactly as they read before the field existed. A table of both, with the near-misses.
 */
describe('renderGate — the phrase, capitalized only where a sentence starts', () => {
  it.each([
    // [template, mutates, expected]
    ['{gate}. Use it when…', 'immediate', 'Takes effect immediately. Use it when…'],
    ['Records it. {gate}. Use it when…', 'immediate', 'Records it. Takes effect immediately. Use it when…'],
    ['Records it. {gate}: a goal is one fact', 'immediate', 'Records it. Takes effect immediately: a goal is one fact'],
    ['Done? {gate}.', 'immediate', 'Done? Takes effect immediately.'],
    [
      'Propose it. {gate} — the card needs a tap',
      'proposes',
      'Propose it. Does NOT change anything — the card needs a tap',
    ],
    // Mid-sentence: lower-case, so the old wording survives byte for byte.
    ['This {gate} in their plan', 'proposes', 'This does NOT change anything in their plan'],
    [
      'a card they tap to apply; {gate} until that tap.',
      'proposes',
      'a card they tap to apply; does NOT change anything until that tap.',
    ],
    ['one upcoming session and {gate} (', 'immediate', 'one upcoming session and takes effect immediately ('],
    ['one action per call, and each {gate}.', 'immediate', 'one action per call, and each takes effect immediately.'],
    // Near-miss: a full stop with no space after it is not a sentence end ("v1.{gate}").
    ['v1.{gate}', 'immediate', 'v1.takes effect immediately'],
  ] as const)('%s (%s)', (template, mutates, expected) => {
    expect(renderGate(template, mutates)).toBe(expected);
  });

  it('gives a read no sentence at all — the template is returned as written', () => {
    expect(renderGate('Read their plan. Use it when…', 'none')).toBe('Read their plan. Use it when…');
  });

  it('the two phrases share no words a skimming model could confuse', () => {
    const [a, b] = [GATE_PHRASE.immediate, GATE_PHRASE.proposes].map((p) => new Set(p.toLowerCase().split(' ')));
    expect([...a!].filter((w) => b!.has(w))).toEqual([]);
  });
});

describe('countPhrase', () => {
  it('counts every occurrence, ignoring case', () => {
    expect(countPhrase('Takes effect immediately. It takes effect immediately.', GATE_PHRASE.immediate)).toBe(2);
    expect(countPhrase('This does NOT change anything', GATE_PHRASE.proposes)).toBe(1);
    expect(countPhrase('nothing changes until that tap', GATE_PHRASE.proposes)).toBe(0);
  });
});
