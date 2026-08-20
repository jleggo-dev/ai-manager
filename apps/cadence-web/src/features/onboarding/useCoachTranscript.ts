/**
 * What is on screen, where it came from, and what the device remembers of it.
 *
 * Split out of `useCoachChat` when adding the local cache pushed that hook past its 150-line
 * function gate — and the seam is the right one regardless. This owns the TRANSCRIPT (paint it,
 * reconcile it with the server, remember it); the hook it left owns the TURN MACHINERY (send,
 * stream, recover). They were only ever tangled because both touch `turns`.
 */
import { useEffect, useState, type MutableRefObject } from 'react';
import { getCurrentCoach } from '../../lib/api.ts';
import { readCachedTranscript, writeCachedTranscript } from './coach-transcript-cache.ts';
import type { CoachTurn } from './useCoachChat.ts';

/** Where reading back begins, and whether there is anything behind the conversation on screen. */
export interface CoachHistoryCursor {
  startedAt: string | null;
  hasEarlier: boolean;
}

/**
 * Restore the conversation from the server — the source of truth, replacing whatever the local
 * cache painted a moment earlier.
 *
 * A stale thread is NOT adopted: `adopt` never fires for it, sessionId stays null, and the next
 * send opens fresh. But its transcript is still theirs — `keepAside` hands it back for read-only
 * display above the fresh conversation (EarlierThread). Hiding it instead left the Coach tab
 * empty after a thread retirement, which read as the coach forgetting every word (owner,
 * 2026-08-20).
 *
 * `none` fires ONLY for an answer the server vouched for (`ok`). A dropped request and an empty
 * account return the identical shape, and treating the first as the second is how a network blip
 * would wipe a painted transcript off the screen — the precise disappearance this exists to stop.
 * So a failed read changes nothing: what was cached stays up, and the next send opens fresh.
 */
async function restoreConversation(on: {
  adopt: (sessionId: string, turns: CoachTurn[]) => void;
  keepAside: (turns: CoachTurn[]) => void;
  none: () => void;
  cursor: (c: CoachHistoryCursor) => void;
}): Promise<void> {
  try {
    const c = await getCurrentCoach();
    on.cursor({ startedAt: c.startedAt ?? null, hasEarlier: c.hasEarlier === true });
    if (!c.sessionId) {
      if (c.ok) on.none();
      return;
    }
    const restored = c.messages.map((m) => ({ role: m.role, text: m.content }));
    if (c.stale) on.keepAside(restored);
    else on.adopt(c.sessionId, restored);
  } catch {
    /* keep what is painted; the next send opens fresh */
  }
}

export function useCoachTranscript(deps: {
  sessionId: MutableRefObject<string | null>;
  /** A turn is streaming — the cache waits for it to settle. */
  streaming: boolean;
  /** Runs once the server has answered, however it answered. */
  onSettled: () => void;
}) {
  /**
   * The conversation, painted from the device before the network is asked anything — so opening
   * Coach shows what was said last time instead of an empty room while `/coach/current` travels.
   * The lazy initializer runs once, synchronously, ahead of the first render.
   *
   * The cached SESSION ID is deliberately not adopted. Only the server decides which thread is
   * live, and seeding it locally would let a device resurrect a conversation the freshness rules
   * had already retired.
   */
  const [turns, setTurns] = useState<CoachTurn[]>(() => readCachedTranscript()?.turns ?? []);
  /** A retired thread's transcript, restored for display only — never sent back upstream. */
  const [earlierTurns, setEarlierTurns] = useState<CoachTurn[]>([]);
  const [cursor, setCursor] = useState<CoachHistoryCursor>({ startedAt: null, hasEarlier: false });
  const [restored, setRestored] = useState(false);

  const { sessionId, streaming, onSettled } = deps;

  // Reconcile with the server. The cache has already painted; this is the authoritative version
  // arriving behind it.
  useEffect(() => {
    void restoreConversation({
      adopt: (sid, next) => {
        sessionId.current = sid;
        setTurns(next);
      },
      keepAside: (aside) => {
        setEarlierTurns(aside);
        // Whatever the cache painted as LIVE was this same conversation, and it has just been
        // retired — leaving it in the live half would render every turn twice.
        setTurns([]);
      },
      none: () => setTurns([]),
      cursor: setCursor,
    }).finally(() => {
      onSettled();
      setRestored(true);
    });
    // Once per mount; the callbacks are stable enough for a one-shot restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Remember the conversation once it has SETTLED — after a turn, never during one.
   *
   * `turns` changes on every SSE delta, so this runs constantly while she is talking and does
   * nothing but read a boolean: a localStorage write serializes the whole transcript
   * synchronously, and doing that dozens of times a second on the main thread would stutter the
   * one animation the user is actually watching. An emptied transcript clears the cache, so
   * "start over" leaves nothing behind on the device.
   */
  useEffect(() => {
    if (streaming || !restored) return;
    writeCachedTranscript(sessionId.current, turns);
  }, [streaming, turns, restored, sessionId]);

  return {
    turns,
    setTurns,
    earlierTurns,
    cursor,
    restored,
    /**
     * There is something to show — either the server has answered, or the cache already painted.
     *
     * Kept apart from `restored` on purpose. This one gates the TRANSCRIPT, so a warm start skips
     * the loading bubble entirely; `restored` still gates everything that must not act on a guess
     * (arming the walkthrough, deciding a conversation is empty), because a cached transcript is a
     * picture of last time, not a fact about now.
     */
    painted: restored || turns.length > 0,
  };
}
