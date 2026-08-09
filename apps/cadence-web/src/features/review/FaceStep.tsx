import { CoachFaceGrid } from '../coach/CoachFaceGrid.tsx';
import { useCoachFace } from '../coach/coachFaceContext.ts';
import { CoachFace } from '../../components/CoachFace.tsx';

/**
 * "Meet Cadence" — the onboarding step where the coach gets a face.
 *
 * The whole job of the copy here is to stop this reading as a personality quiz. The user is
 * choosing a picture; the coach, the voice and the memory are the same whichever tile they tap,
 * and the line under the grid says so in Cadence's own words rather than as a disclaimer.
 *
 * Skipping is a real answer. The wizard's Continue is never disabled — no pick keeps the mark,
 * which is why there is no "choose one to continue" gate and no pre-selection nudging a default.
 */
export function FaceStep() {
  const { faceId, setFaceId } = useCoachFace();

  return (
    <div className="facestep">
      <div className="screen-h">Meet Cadence</div>
      <div className="screen-sub">
        {
          "One coach, one voice — this is just the face you'll see. Pick whoever you'd rather have in the room, or skip it and keep the mark."
        }
      </div>

      <CoachFaceGrid selected={faceId} onPick={(id) => void setFaceId(id === faceId ? null : id)} />

      <div className="facestep-say">
        <CoachFace size={44} />
        <p>{"Whichever one you pick, it's still me — and I'll still remember everything you've told me."}</p>
      </div>

      <div className="facestep-foot">Swap faces later in Settings — your plan and history stay put.</div>
    </div>
  );
}
