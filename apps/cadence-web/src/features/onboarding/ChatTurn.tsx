import type { ReactNode } from 'react';
import { CoachFace } from '../../components/CoachFace.tsx';

/** Three dots in an otherwise-empty coach bubble — the wait has a face on it, not a spinner. */
export const TypingDots = () => (
  <span className="typing" role="status" aria-label="Cadence is replying">
    <i />
    <i />
    <i />
  </span>
);

/**
 * One turn of the conversation.
 *
 * Cadence gets a portrait and a bubble; the user gets a bubble and no portrait. That asymmetry is
 * the point of the redesign — the previous chat had the coach speaking as unattributed full-width
 * text, which reads as the *app* talking. Cadence speaks as "I", so every one of her turns is
 * attributed to a face, and the AI disclosure under the composer wears the same face rather than
 * an abstract mark.
 *
 * `after` is where a turn's quick picks land: indented to the bubble's left edge so the answers
 * clearly belong to the question above them rather than floating in the thread.
 */
export function ChatTurn({
  role,
  text,
  pending = false,
  activity = '',
  after,
}: {
  role: 'user' | 'coach';
  text: string;
  /** Coach turn with nothing streamed yet — show the dots instead of an empty bubble. */
  pending?: boolean;
  /** What she is doing right now, in plain words — shown instead of bare dots while a tool runs. */
  activity?: string;
  after?: ReactNode;
}) {
  if (role === 'user') return <div className="ct-me">{text}</div>;
  return (
    <div className="ct-coach">
      <div className="ct-row">
        <CoachFace size={44} className="ct-face" />
        <div className="ct-bubble">
          {pending ? <TypingDots /> : text}
          {/**
           * The activity line sits OUTSIDE the pending branch, and that placement is the whole fix.
           *
           * It was rendered only when `pending` — which is `!text` — so it could only ever show
           * while she had said nothing at all. But she streams a preamble ("Let me look…") BEFORE
           * calling anything, so by the time a tool actually runs there is text, `pending` is
           * false, and the line was unreachable in exactly the moment it exists for. Shipped and
           * silently dead until the owner said so: *"the feature we put in to show in the UI that
           * Cadence is calling/using a tool - that doesn't seem to be working."*
           *
           * `activity` is cleared on every path that ends a turn (useCoachActivity), and the parent
           * only passes it for the newest turn, so an empty string is the resting state and this
           * renders nothing at all the rest of the time.
           */}
          {activity && (
            <span className="ct-doing">
              <TypingDots />
              <em>{activity}…</em>
            </span>
          )}
        </div>
      </div>
      {after && <div className="ct-after">{after}</div>}
    </div>
  );
}
