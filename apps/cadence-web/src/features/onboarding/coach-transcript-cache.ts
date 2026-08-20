/**
 * The conversation, kept on the device so the Coach tab is never an empty room.
 *
 * Opening Coach used to paint nothing until `/coach/current` came back — a phone → API → database
 * round trip, on the one screen whose entire promise is that it remembers you. On a cold serverless
 * invocation or a weak connection that is seconds of blank, and blank is indistinguishable from
 * gone. This is the read that happens first: synchronous, local, and already on screen before the
 * network is asked anything.
 *
 * **The server is still the truth.** This is a paint, not a store. Whatever `/coach/current`
 * returns replaces what came from here, and nothing is ever SENT from this cache — the coach's
 * memory lives in AI Admin, and a device that lost its cache has lost a screenful of pixels,
 * nothing more.
 *
 * Only the CURRENT conversation is kept. Archived threads are read back from the server on demand
 * (`getEarlierCoachConversations`) precisely because they are rare, deliberate reads — caching an
 * entire archive here would spend a shared 5MB origin quota on transcripts almost nobody reopens.
 *
 * Scoped to a PERSON, not a phone: the key is registered in `USER_SCOPED_KEYS`, so an identity
 * change clears it (localUserState.ts). Without that, a device with two accounts on it would open
 * the Coach tab and paint the previous person's conversation.
 */
import type { CoachTurn } from './useCoachChat.ts';

export const COACH_TRANSCRIPT_KEY = 'cadence.coachTranscript';

/**
 * How much transcript is worth keeping locally.
 *
 * The tail, not the head: the cache exists to make the screen someone is ABOUT to look at appear
 * instantly, and that screen is the bottom of the conversation. Anything above it arrives with the
 * server's answer a moment later. Two bounds because either one alone leaks — a turn count says
 * nothing about a coach reply that ran to two thousand words, and a character budget alone would
 * happily store one enormous turn and call it a conversation.
 */
const MAX_TURNS = 60;
const MAX_CHARS = 120_000;

interface Cached {
  sessionId: string | null;
  turns: CoachTurn[];
}

function trim(turns: CoachTurn[]): CoachTurn[] {
  const tail = turns.slice(-MAX_TURNS);
  let chars = 0;
  for (let i = tail.length - 1; i >= 0; i--) {
    chars += tail[i]?.text.length ?? 0;
    if (chars > MAX_CHARS) return tail.slice(i + 1);
  }
  return tail;
}

/**
 * What was on screen last time, or null.
 *
 * Never throws and never returns half a thing: private browsing, a disabled store, a key written
 * by an older build, or anything else unreadable is simply "nothing remembered", because a chat
 * that fails to open is far worse than one that opens a beat later.
 */
export function readCachedTranscript(): Cached | null {
  try {
    const raw = window.localStorage.getItem(COACH_TRANSCRIPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Cached>;
    const turns = Array.isArray(parsed.turns) ? parsed.turns : [];
    const clean = turns.filter(
      (t): t is CoachTurn => !!t && (t.role === 'user' || t.role === 'coach') && typeof t.text === 'string',
    );
    if (!clean.length) return null;
    return { sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null, turns: clean };
  } catch {
    return null;
  }
}

/**
 * Remember the conversation as it now stands.
 *
 * Call this when a turn has SETTLED — never per streaming delta. localStorage writes are
 * synchronous and serialize the whole transcript; doing that on every SSE chunk would put a
 * JSON.stringify of the entire conversation on the main thread dozens of times a second, while the
 * user is watching her type.
 *
 * An empty transcript clears rather than storing nothing, so "start over" genuinely leaves nothing
 * behind on the device.
 */
export function writeCachedTranscript(sessionId: string | null, turns: readonly CoachTurn[]): void {
  try {
    if (!turns.length) return clearCachedTranscript();
    const payload: Cached = { sessionId, turns: trim([...turns]) };
    window.localStorage.setItem(COACH_TRANSCRIPT_KEY, JSON.stringify(payload));
  } catch {
    /* over quota or storage disabled — the server still has every word */
  }
}

export function clearCachedTranscript(): void {
  try {
    window.localStorage.removeItem(COACH_TRANSCRIPT_KEY);
  } catch {
    /* nothing to do and nothing at stake */
  }
}
