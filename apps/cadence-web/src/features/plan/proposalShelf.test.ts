/**
 * Which proposals wait on the shelf (proposalShelf.ts) — a router deciding what greets the plan
 * on open, so it gets its table of positives and near-misses (CLAUDE.md). The near-miss that
 * matters: 'replan' is the coach's own suggestion and must keep showing itself.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { __clearRevealedForTests, isShelvedProposal, rememberRevealed, wasRevealed } from './proposalShelf.ts';

describe('isShelvedProposal — the app-noticed-an-absence asks wait for a pull', () => {
  it.each([
    // [label, action, shelved?]
    ["'enter_disrupted' (Life happened?, four dark days) → shelved", 'enter_disrupted', true],
    ["'rebaseline' (Welcome back, seven dark days) → shelved", 'rebaseline', true],
    ["'replan' (her own suggestion) → shows itself", 'replan', false],
    ['undefined (an old proposal, which means replan) → shows itself', undefined, false],
    ['null → shows itself', null, false],
    ['an unknown action → shows itself (never hide what we cannot name)', 'something_new', false],
    ['a near-miss spelling → shows itself', 'enter-disrupted', false],
  ])('%s', (_label, action, want) => {
    expect(isShelvedProposal(action)).toBe(want);
  });
});

describe('the session memory of a reveal', () => {
  beforeEach(() => __clearRevealedForTests());

  it('remembers a proposal once pulled out, per proposal', () => {
    expect(wasRevealed('2026-09-13T16:10:15.584Z')).toBe(false);
    rememberRevealed('2026-09-13T16:10:15.584Z');
    expect(wasRevealed('2026-09-13T16:10:15.584Z')).toBe(true);
    // A NEW proposal starts on the shelf again.
    expect(wasRevealed('2026-09-20T09:00:00.000Z')).toBe(false);
  });
});
