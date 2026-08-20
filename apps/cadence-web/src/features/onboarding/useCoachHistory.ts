/**
 * Reading back through the conversations that came before this one.
 *
 * The Coach tab restored exactly one conversation and showed nothing else, so every thread before
 * it was simply unreachable — retire one, send a message, and the previous one was gone from the
 * screen for good. Owner, 2026-08-20: *"my entire history of the chat is gone… the visual
 * representation of that history isn't for the coach, it's for me. My memory isn't as good as the
 * coach's. I also need to remember what we talked about and why."*
 *
 * One conversation per request, and only when asked. Nothing here runs while the chat is opening:
 * the archive is a deliberate read, so it costs a round trip at the moment somebody is deliberately
 * waiting on it and never on the path that paints the tab.
 *
 * Display only, always. These threads are not adopted and their session ids are not handed to the
 * send path — an archived conversation's model context is gone, and resuming one would be the
 * coach pretending to remember words she genuinely cannot see.
 */
import { useCallback, useRef, useState } from 'react';
import { getEarlierCoachConversations, type ArchivedConversation } from '../../lib/api.ts';

export type UseCoachHistoryArgs = {
  /** When the conversation on screen began — where reading back starts. */
  startedAt: string | null;
  /** The server's word that there is something behind it, from `/coach/current`. */
  hasEarlier: boolean;
};

export function useCoachHistory({ startedAt, hasEarlier }: UseCoachHistoryArgs) {
  /** Oldest first — the order they are rendered in, so the transcript reads down through time. */
  const [earlier, setEarlier] = useState<ArchivedConversation[]>([]);
  const [loading, setLoading] = useState(false);
  /** The last response's verdict on whether more archive exists; before any load, the server's
   *  `hasEarlier` from `/coach/current` stands in. */
  const [more, setMore] = useState<boolean | null>(null);
  /**
   * Where the next request starts. Null until a load has answered; thereafter it is whatever the
   * response said to use, NOT the oldest conversation on screen — a scan that filtered out every
   * row it looked at still moved, and a cursor that only tracked RESULTS would ask the same
   * question forever (see `nextBefore`, coach-transcript.ts).
   */
  const cursor = useRef<string | null>(null);
  /**
   * A request is in the air. A ref rather than `loading`, because two taps inside one React commit
   * both read the old state: the second would fire on the same cursor and paste the same
   * conversation into the transcript twice.
   */
  const busy = useRef(false);

  const canLoad = (more ?? hasEarlier) && !!(cursor.current ?? startedAt);

  const loadEarlier = useCallback(async () => {
    if (busy.current) return;
    const before = cursor.current ?? startedAt;
    if (!before) return;
    busy.current = true;
    setLoading(true);
    try {
      const r = await getEarlierCoachConversations(before, 1);
      // Left alone on a soft-failed read, so a retry asks from the same place rather than
      // stepping silently over archive nobody actually saw.
      if (r.nextBefore) cursor.current = r.nextBefore;
      setMore(r.hasMore);
      // Server order is newest-first; the screen reads oldest-first, and all of it belongs ABOVE
      // whatever is already on screen.
      if (r.conversations.length) setEarlier((prev) => [...[...r.conversations].reverse(), ...prev]);
    } catch {
      // Keep the offer standing: a blip must not tell someone their history ended here.
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [startedAt]);

  return { earlier, loading, canLoad, loadEarlier };
}
