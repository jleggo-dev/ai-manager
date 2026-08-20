import { ChatTurn } from './ChatTurn.tsx';
import { viewTurns } from './coachTurns.ts';
import type { CoachTurn } from './useCoachChat.ts';

/**
 * The conversation that came before, kept on screen after its thread retires.
 *
 * When a thread goes unadopted (idle too long, or onboarding graduated into a real plan), the
 * next send opens a fresh session — the model genuinely cannot see these turns any more. The
 * first version hid them for exactly that reason, and hiding them was worse: the Coach tab
 * opened onto an empty room, and a coach whose whole promise is "you never repeat yourself"
 * appeared to have forgotten every word (owner, 2026-08-20). So the transcript stays, read-only,
 * and the divider says plainly where the fresh start begins — honest about the seam instead of
 * pretending there isn't one. ("stale" is a wire word; it never reaches the screen.)
 *
 * Read-only means prose only: pick blocks are stripped (viewTurns) and never rendered as
 * buttons, since a tappable answer to a question the retired thread asked would compose a
 * message for a session that will never read it. Turns that were nothing but a block drop out
 * entirely rather than leaving an empty bubble in the record.
 */
export function EarlierThread({ turns }: { turns: readonly CoachTurn[] }) {
  if (!turns.length) return null;
  return (
    <>
      {viewTurns(turns)
        .filter((t) => t.text)
        .map((t, i) => (
          <ChatTurn key={i} role={t.role} text={t.text} />
        ))}
      <div className="chat-earlier" role="separator">
        earlier conversation — your next message starts fresh
      </div>
    </>
  );
}
