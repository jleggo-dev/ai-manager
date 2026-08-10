import { useState } from 'react';
import { CoachFace } from '../../components/CoachFace.tsx';
import { useEnsureCoachFace } from '../coach/useEnsureCoachFace.ts';

/**
 * Meeting the coach — and being told she's AI, before she asks anything.
 *
 * The disclosure is the point of this screen existing at all. It could have been a line at the
 * bottom of the first chat turn; it is a screen because the honest version of "a coach who
 * remembers you" is one you know is a machine from the first sentence, not one you work out later.
 * The disclosure card wears her face rather than a warning icon for the same reason — it is her
 * saying it, which is what makes it a disclosure and not a legal notice.
 *
 * **The face is drawn at random here and kept** (owner ruling 2026-08-09). A mark introducing
 * itself as "I'm your coach, Cadence" is a logo pretending to be a person, so she arrives with a
 * face — and that face is hers from this moment, not on loan. The picker during the plan build
 * therefore opens with her already selected; keeping the mark instead is a deliberate tap on a
 * tile at the end of the grid, not the consequence of not choosing.
 *
 * One coach, one name: the portrait carries no label, no temperament, no second name. She is
 * Cadence whichever picture she is wearing.
 */
export function MeetCadence({
  onSayHi,
  onLeave,
  warnUnsaved = false,
}: {
  onSayHi: () => void;
  /** Leave onboarding entirely — signs out, which lands them back on the fork. */
  onLeave?: () => void;
  /** True for an anonymous draft: leaving is unrecoverable, so it asks first. */
  warnUnsaved?: boolean;
}) {
  useEnsureCoachFace(true);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="welcome meetc">
      {onLeave && (
        <div className="meetc-top">
          {/* The only door out of onboarding. Without it an anonymous session — which survives a
              hard close — is a one-way street: every launch lands back in the chat with no way to
              reach sign-in or start over. */}
          <button
            className="chat-back"
            onClick={() => (warnUnsaved ? setConfirming(true) : onLeave())}
            aria-label="Back"
          >
            ←
          </button>
        </div>
      )}

      {confirming && (
        <div className="meetc-leave" role="alertdialog" aria-label="Leave onboarding">
          <p>
            {"Start over? You haven't saved an account yet, so this conversation won't be here when you come back."}
          </p>
          <div className="meetc-leave-acts">
            <button className="meetc-leave-go" onClick={onLeave}>
              Start over
            </button>
            <button className="meetc-leave-stay" onClick={() => setConfirming(false)}>
              Keep going
            </button>
          </div>
        </div>
      )}

      <div className="meetc-mid">
        <div className="meetc-say">
          {
            "Hi — I'm your coach, Cadence. A few questions, and I'll build you a rhythm you can keep — starting with your first week."
          }
        </div>
        <CoachFace size={132} className="meetc-face" />
        <div className="meetc-name">Cadence</div>

        <div className="meetc-disc">
          <CoachFace size={26} ring={false} />
          <p>
            {
              "I'm AI and can make mistakes — please double-check what I say. Answer with a tap or in your own words, whichever you like — it's all one conversation."
            }
          </p>
        </div>
      </div>

      <button className="cta" onClick={onSayHi}>
        Say hi
      </button>
    </div>
  );
}
