import { useEffect, useMemo, useRef } from 'react';
import { ChatTurn } from './ChatTurn.tsx';
import { viewTurns } from './coachTurns.ts';
import type { ArchivedConversation } from '../../lib/api.ts';
import type { CoachTurn } from './useCoachChat.ts';

/**
 * The conversations from before this one, sitting above it in the same scroll.
 *
 * Deliberately not a separate screen or a list of links. The need is continuity — *"I also need to
 * remember what we talked about and why. It helps me also understand if the coach is serving me
 * properly"* (owner, 2026-08-20) — and a filing cabinet answers a different question than the one
 * being asked. Scrolling up through your own history is the same gesture as scrolling up through
 * today's, so there is one way to look back rather than two, and it extends the read-only thread
 * already shown above a fresh start (EarlierThread) instead of competing with it.
 *
 * Read-only, like that thread and for the same reason: picks are stripped (viewTurns) and never
 * rendered as buttons, because a tappable answer to a question an archived session asked would
 * compose a message for a thread that will never read it. Turns that were nothing but a pick block
 * drop out rather than leaving an empty bubble in the record.
 */

/**
 * The date a conversation happened, in the register the rest of the app uses for time.
 *
 * Weekday and date, no clock: someone reading back is placing a conversation in their week, not
 * timing it. The year appears only when it is not this one, so the common case stays short.
 */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function ArchivedThread({ conversation }: { conversation: ArchivedConversation }) {
  // Memoized for the same reason EarlierThread is: this sits above a LIVE conversation and
  // re-renders on every SSE delta of it, while an archived transcript never changes at all.
  const views = useMemo(
    () =>
      viewTurns(conversation.turns.map((t) => ({ role: t.role, text: t.content }) as CoachTurn)).filter((t) => t.text),
    [conversation],
  );
  if (!views.length) return null;
  return (
    <>
      <div className="chat-earlier" role="separator">
        {whenLabel(conversation.startedAt)}
      </div>
      {conversation.truncated && (
        <div className="chat-earlier-note">Only the last stretch of this conversation is shown.</div>
      )}
      {views.map((t, i) => (
        <ChatTurn key={i} role={t.role} text={t.text} />
      ))}
    </>
  );
}

/**
 * The pane that actually scrolls. Not simply the parent: the marker sits in a fixed-height slot,
 * and an observer rooted on that would see the marker "in view" however far up it had scrolled —
 * which loaded the whole archive on open.
 */
function scrollingParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/**
 * Asks for older history whenever the top of the transcript is within reach — or straight away
 * where there is no observer to ask.
 *
 * Re-observed on every `generation`: an observer only reports CHANGES, and after a short
 * conversation lands above it the marker is often still on screen, so a fresh observer is how it
 * notices that and asks again, until the screen is full or the archive runs out.
 */
function TopMarker({ onTop, generation }: { onTop: () => void; generation: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onTop);
  latest.current = onTop;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      latest.current();
      return;
    }
    // Rooted on the transcript itself: against the window, the margin would be clipped away by
    // the scrolling pane and the next conversation would only be asked for once the very top showed.
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && latest.current(), {
      root: scrollingParent(el),
      rootMargin: '400px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [generation]);
  return <div ref={ref} className="chat-earlier-top" aria-hidden />;
}

export function EarlierConversations({
  conversations,
  canLoad,
  loading,
  failed,
  generation,
  currentStartedAt,
  onLoad,
}: {
  /** Oldest first — they render in the order they happened. */
  conversations: readonly ArchivedConversation[];
  canLoad: boolean;
  loading: boolean;
  /** The last ask failed — offer a tap rather than retrying on our own. */
  failed: boolean;
  /** Ticks each time an ask moves the cursor; see TopMarker. */
  generation: number;
  /** When the conversation below this began, so it gets a dated divider like the ones above it. */
  currentStartedAt: string | null;
  onLoad: () => void;
}) {
  if (!canLoad && !conversations.length) return null;
  return (
    <>
      {/* At the TOP of the transcript, because that is where "further back" is. It loads as it
          comes into view (owner, 2026-10-31: no tap per conversation); a failed ask is the one
          case that waits for a tap, so a dead network never spins. */}
      {/* One fixed-height slot for the marker and the "Looking back…" line, so the line coming
          and going never nudges the conversation someone is reading. */}
      {canLoad && !failed && (
        <div className="chat-earlier-slot">
          {loading ? 'Looking back…' : <TopMarker onTop={onLoad} generation={generation} />}
        </div>
      )}
      {canLoad && failed && !loading && (
        <button className="chat-earlier-more" onClick={onLoad}>
          Try loading earlier conversations again
        </button>
      )}
      {conversations.map((c) => (
        <ArchivedThread key={c.sessionId} conversation={c} />
      ))}
      {/* The seam between the archive and the conversation on screen, dated like the rest. */}
      {conversations.length > 0 && currentStartedAt && (
        <div className="chat-earlier" role="separator">
          {whenLabel(currentStartedAt)}
        </div>
      )}
    </>
  );
}
