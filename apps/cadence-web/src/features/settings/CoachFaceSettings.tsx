import { useState } from 'react';
import { CoachFaceGrid } from '../coach/CoachFaceGrid.tsx';
import { useCoachFace } from '../coach/coachFaceContext.ts';

/**
 * Settings — swap the coach's face.
 *
 * `PUT /me/coach-face` writes one text column and touches nothing else. Tapping the picked face
 * again clears it and returns Cadence to the mark, so "no face" stays reachable after onboarding
 * instead of being a one-time door. Neither of those facts is spelled out on screen any more
 * (owner, 2026-09-07: "if you're explaining it, the UI is bad") — the grid is the whole control.
 *
 * `startOpen` (Settings Room, SR-3): the room reaches this component through its own "Cadence"
 * door, so a second tap to reveal the grid would be a redundant step behind a step. Defaults to
 * false so the original SettingsSheet mount — a self-toggling row — is unaffected.
 */
export function CoachFaceSettings({ startOpen = false }: { startOpen?: boolean } = {}) {
  const { faceId, setFaceId } = useCoachFace();
  const [open, setOpen] = useState(startOpen);

  return (
    <div className="set-block">
      <button className="set-row" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <b>Cadence&apos;s face</b>
      </button>
      {open && (
        <div className="set-face">
          <CoachFaceGrid selected={faceId} onPick={(id) => void setFaceId(id === faceId ? null : id)} />
        </div>
      )}
    </div>
  );
}
