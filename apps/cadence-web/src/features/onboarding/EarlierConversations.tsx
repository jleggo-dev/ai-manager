import { useMemo } from 'react';
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

export function EarlierConversations({
  conversations,
  canLoad,
  loading,
  onLoad,
}: {
  /** Oldest first — they render in the order they happened. */
  conversations: readonly ArchivedConversation[];
  canLoad: boolean;
  loading: boolean;
  onLoad: () => void;
}) {
  if (!canLoad && !conversations.length) return null;
  return (
    <>
      {/* At the TOP of the transcript, because that is where "further back" is. One conversation
          per tap: nothing about the archive is loaded until somebody asks for it, so opening the
          Coach tab costs exactly what it did before this existed. */}
      {canLoad && (
        <button className="chat-earlier-more" onClick={onLoad} disabled={loading}>
          {loading ? 'Looking back…' : 'Read earlier conversations'}
        </button>
      )}
      {conversations.map((c) => (
        <ArchivedThread key={c.sessionId} conversation={c} />
      ))}
    </>
  );
}
