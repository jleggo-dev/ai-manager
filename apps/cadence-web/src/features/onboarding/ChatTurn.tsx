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
  after,
}: {
  role: 'user' | 'coach';
  text: string;
  /** Coach turn with nothing streamed yet — show the dots instead of an empty bubble. */
  pending?: boolean;
  after?: ReactNode;
}) {
  if (role === 'user') return <div className="ct-me">{text}</div>;
  return (
    <div className="ct-coach">
      <div className="ct-row">
        <CoachFace size={44} className="ct-face" />
        <div className="ct-bubble">{pending ? <TypingDots /> : text}</div>
      </div>
      {after && <div className="ct-after">{after}</div>}
    </div>
  );
}
