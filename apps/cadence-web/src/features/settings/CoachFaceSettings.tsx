import { useState } from 'react';
import { CoachFaceGrid } from '../coach/CoachFaceGrid.tsx';
import { useCoachFace } from '../coach/coachFaceContext.ts';

/**
 * Settings — swap the coach's face.
 *
 * The promise in the sub-line is literal, not reassurance: `PUT /me/coach-face` writes one text
 * column and touches nothing else. Tapping the picked face again clears it and returns Cadence
 * to the mark, so "no face" stays reachable after onboarding instead of being a one-time door.
 */
export function CoachFaceSettings() {
  const { faceId, face, setFaceId } = useCoachFace();
  const [open, setOpen] = useState(false);

  return (
    <div className="set-block">
      <button className="set-row" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <b>Cadence&apos;s face</b>
        <span>{face ? 'Tap to change — your plan and history stay put' : 'Pick a face, or keep the mark'}</span>
      </button>
      {open && (
        <div className="set-face">
          <CoachFaceGrid selected={faceId} onPick={(id) => void setFaceId(id === faceId ? null : id)} />
          <div className="set-face-note">
            {face
              ? 'Tap the same face again to go back to the Cadence mark.'
              : "Same coach, same voice — it's only the picture that changes."}
          </div>
        </div>
      )}
    </div>
  );
}
