import { useState } from 'react';
import type { CoachFaceId } from '@cadence/shared';
import { CadenceWorking } from '../../components/CadenceWorking.tsx';
import { CoachFace } from '../../components/CoachFace.tsx';
import { CoachFaceGrid } from '../coach/CoachFaceGrid.tsx';
import { useCoachFace } from '../coach/coachFaceContext.ts';
import { useBuildPlan } from './useBuildPlan.ts';

/**
 * The plan is building. Here is something to do while it does.
 *
 * The face pick lives here rather than in the wizard for a reason that is half practical and half
 * about tone: it is the one step that curates nothing, and this is the one wait long enough to
 * need filling. Handing someone a warm, consequence-free choice while the machine works beats a
 * spinner and beats a fake progress bar.
 *
 * The face they met is already ticked — she was drawn at random and kept when they met her, so
 * this grid is "change her if you like", not "choose one". Walking past it is a real answer that
 * keeps her; the mark sits last, as the deliberate opt-out. No names under any tile, as ever.
 *
 * If the build finishes first, the screen stays put until they're done choosing — the plan isn't
 * going anywhere, and yanking a grid out from under a half-made choice is the app deciding for them.
 */
export function BuildingScreen({ onReady, onBackToChat }: { onReady: () => void; onBackToChat: () => void }) {
  const { faceId, setFaceId } = useCoachFace();
  const [built, setBuilt] = useState(false);
  const { phase, note, error, retry } = useBuildPlan({ onDone: () => setBuilt(true) });

  // No toggle-to-clear here: every tile is a positive choice, and the mark tile IS the way to
  // choose no face. Re-tapping the current face should be a no-op, not a quiet un-picking.
  const pick = (id: CoachFaceId | null) => void setFaceId(id);

  if (phase === 'failed') {
    return (
      <div className="building">
        <div className="build-fail">
          <CoachFace size={64} />
          <p>{error}</p>
          <div className="build-fail-acts">
            <button className="cta" onClick={retry}>
              Try again
            </button>
            <button className="build-back" onClick={onBackToChat}>
              Talk it through instead
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="building">
      <CadenceWorking label={built ? 'Your week is ready.' : 'Building your week…'} note={note} />

      <div className="build-say">
        <CoachFace size={40} />
        <p>
          {built
            ? "Done — it's waiting for you. Change my face whenever you like."
            : "This can take a couple of minutes. While I work — happy with the face I'm wearing, or would you rather another?"}
        </p>
      </div>

      <CoachFaceGrid selected={faceId} onPick={pick} withMark />

      <div className="build-note">
        {"Whichever you pick, it's still me — and I'll still remember everything you've told me."}
      </div>

      <div className="build-foot">
        {built ? (
          <button className="cta" onClick={onReady}>
            {'See my week →'}
          </button>
        ) : (
          <span>Swap faces later in Settings — your plan and history stay put.</span>
        )}
      </div>
    </div>
  );
}
