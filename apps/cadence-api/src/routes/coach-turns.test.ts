import { describe, expect, it } from 'vitest';
import { isRealTurn } from './coach.ts';

/**
 * The filter that decides what counts as part of the conversation. It feeds two things at once —
 * the transcript the client restores, and the window the Broker extracts captures from — so a
 * leak here shows up as either a message in the user's bubble they never wrote, or a "goal"
 * extracted from something the app said to itself.
 */
describe('isRealTurn', () => {
  it('keeps what the user and the coach actually said', () => {
    expect(isRealTurn({ role: 'user', content: 'I want to run a 10k' })).toBe(true);
    expect(isRealTurn({ role: 'assistant', content: 'Good — how many days?' })).toBe(true);
  });

  it('drops the injected context packs', () => {
    expect(isRealTurn({ role: 'user', content: '<context source="registry-pack">…</context>' })).toBe(false);
  });

  it('drops the opener the client sends so Cadence speaks first', () => {
    expect(isRealTurn({ role: 'user', content: '<open>The user has just arrived…</open>' })).toBe(false);
    // Providers sometimes hand back a leading newline; the tag is still the first thing said.
    expect(isRealTurn({ role: 'user', content: '\n<open>hello</open>' })).toBe(false);
  });

  it('does not drop a message that merely mentions the tag mid-sentence', () => {
    expect(isRealTurn({ role: 'user', content: 'I want to be more <open> with people' })).toBe(true);
  });

  it('drops system and tool roles entirely', () => {
    expect(isRealTurn({ role: 'system', content: 'You are Cadence' })).toBe(false);
    expect(isRealTurn({ content: 'no role' })).toBe(false);
  });
});

/**
 * Notes the app hands the coach mid-conversation (today: "they just shared their Apple Health
 * history — say what you see in it"). They are the app talking, so they must never render in the
 * user's own bubble, and the Broker must never extract them as something the user said.
 */
describe('app notes', () => {
  it('keeps <note> turns out of the transcript and the capture window', () => {
    expect(isRealTurn({ role: 'user', content: '<note>They just shared Apple Health.</note>' })).toBe(false);
  });

  it('still lets a user write about a note', () => {
    expect(isRealTurn({ role: 'user', content: 'I left a note on the fridge' })).toBe(true);
  });
});
