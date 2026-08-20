import { describe, expect, it } from 'vitest';
import {
  COACH_TRANSCRIPT_KEY,
  clearCachedTranscript,
  readCachedTranscript,
  writeCachedTranscript,
} from './coach-transcript-cache.ts';
import type { CoachTurn } from './useCoachChat.ts';

const turn = (role: 'user' | 'coach', text: string): CoachTurn => ({ role, text });

/**
 * The device's copy of the conversation — the thing that makes the Coach tab paint before the
 * network answers. Everything here is about it failing SAFELY: a cache that throws, or hands back
 * half a transcript, is worse than no cache at all, because the screen it breaks is the one whose
 * whole promise is that it remembers you.
 */
describe('coach transcript cache', () => {
  it('hands back what was stored', () => {
    writeCachedTranscript('sess-1', [turn('user', 'I want to run a 10k'), turn('coach', 'How many days?')]);
    expect(readCachedTranscript()).toEqual({
      sessionId: 'sess-1',
      turns: [
        { role: 'user', text: 'I want to run a 10k' },
        { role: 'coach', text: 'How many days?' },
      ],
    });
  });

  it('remembers nothing when nothing was stored', () => {
    expect(readCachedTranscript()).toBeNull();
  });

  it('treats an unreadable entry as nothing remembered, rather than throwing at the chat', () => {
    window.localStorage.setItem(COACH_TRANSCRIPT_KEY, '{not json');
    expect(readCachedTranscript()).toBeNull();
  });

  it('drops turns that are not turns — a shape from an older build must not reach the screen', () => {
    window.localStorage.setItem(
      COACH_TRANSCRIPT_KEY,
      JSON.stringify({ sessionId: 's', turns: [{ role: 'user', text: 'kept' }, { role: 'wat' }, null, { text: 42 }] }),
    );
    expect(readCachedTranscript()?.turns).toEqual([{ role: 'user', text: 'kept' }]);
  });

  it('keeps the TAIL when a conversation runs long — the bottom is the screen about to be looked at', () => {
    const many = Array.from({ length: 200 }, (_, i) => turn('user', `m${i}`));
    writeCachedTranscript('s', many);
    const kept = readCachedTranscript()!.turns;
    expect(kept.length).toBeLessThan(200);
    expect(kept.at(-1)).toEqual({ role: 'user', text: 'm199' });
  });

  it('stays inside a character budget however few the turns', () => {
    // Three turns, but enormous ones: a turn cap alone would happily store all of this.
    const huge = [turn('coach', 'a'.repeat(90_000)), turn('user', 'b'.repeat(90_000)), turn('coach', 'tail')];
    writeCachedTranscript('s', huge);
    const kept = readCachedTranscript()!.turns;
    expect(kept.reduce((n, t) => n + t.text.length, 0)).toBeLessThanOrEqual(120_000);
    expect(kept.at(-1)).toEqual({ role: 'coach', text: 'tail' });
  });

  it('leaves nothing behind when the conversation is emptied — "start over" means the device too', () => {
    writeCachedTranscript('s', [turn('user', 'hello')]);
    writeCachedTranscript(null, []);
    expect(readCachedTranscript()).toBeNull();
    expect(window.localStorage.getItem(COACH_TRANSCRIPT_KEY)).toBeNull();
  });

  it('clears on request', () => {
    writeCachedTranscript('s', [turn('user', 'hello')]);
    clearCachedTranscript();
    expect(readCachedTranscript()).toBeNull();
  });
});
