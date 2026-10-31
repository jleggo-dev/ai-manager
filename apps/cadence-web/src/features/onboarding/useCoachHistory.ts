/**
 * Reading back through the conversations that came before this one.
 *
 * The Coach tab restored exactly one conversation and showed nothing else, so every thread before
 * it was simply unreachable — retire one, send a message, and the previous one was gone from the
 * screen for good. Owner, 2026-08-20: *"my entire history of the chat is gone… the visual
 * representation of that history isn't for the coach, it's for me. My memory isn't as good as the
 * coach's. I also need to remember what we talked about and why."*
 *
 * One conversation per request. The chat asks whenever the top of the transcript is in view
 * (EarlierConversations), so history fills in on its own as someone scrolls up — owner, 2026-10-31:
 * a "Read earlier conversations" tap per conversation meant two months of talking looked like two
 * messages. It still never runs on the path that paints the tab: the conversation on screen is up
 * first, and the archive arrives behind it.
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
  /**
   * Answers that moved the cursor. The top marker re-checks whether it is still in view each time
   * this ticks, which is what keeps loading until the screen is full — counted on the CURSOR, not
   * on conversations received, because a scan past nothing but empty rows still has to ask again.
   */
  const [loads, setLoads] = useState(0);
  /** The last ask failed. Nothing retries on its own (a dead network would spin), so the chat
   *  offers a tap instead. */
  const [failed, setFailed] = useState(false);

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
      setFailed(!r.nextBefore && r.hasMore);
      if (r.nextBefore) setLoads((n) => n + 1);
      setMore(r.hasMore);
      // Server order is newest-first; the screen reads oldest-first, and all of it belongs ABOVE
      // whatever is already on screen.
      if (r.conversations.length) setEarlier((prev) => [...[...r.conversations].reverse(), ...prev]);
    } catch {
      // Keep the offer standing: a blip must not tell someone their history ended here.
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [startedAt]);

  return { earlier, loading, canLoad, loadEarlier, loads, failed };
}
