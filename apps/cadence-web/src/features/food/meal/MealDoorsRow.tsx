/**
 * The doors, as one row, drawn the same wherever a meal takes adds: Find leads (it is the fastest
 * and most exact way in — owner, 2026-09-07), then Chat, Voice, Picture, Barcode. Icon-only since
 * the quick log (2026-10-28) — the glyphs are the capture set's own and the labels went with the
 * rest of the reading. Everything here is a keyboard, not a destination: each returns into the
 * one meal. The cookbook is a shelf now, not a link under the doors.
 */
import { downscalePhoto } from '../../plan/occurrence/format.ts';
import { CAPTURE_METHODS } from '../captureMethods.ts';
import { MethodTiles, type CaptureMethod } from '../MethodTiles.tsx';
import type { MealDoor } from './MealDoors.tsx';
import { doorForMethod } from './methodDoor.ts';

export function MealDoorsRow({ busy, onOpen }: { busy?: boolean; onOpen: (door: MealDoor) => void }) {
  const pick = (m: CaptureMethod) => {
    const door = doorForMethod(m);
    if (door) onOpen(door);
  };
  return (
    <div className="ms-doors-row">
      <MethodTiles
        methods={[...CAPTURE_METHODS]}
        variant="icons"
        disabled={busy}
        onPick={pick}
        onPhoto={(file) => {
          if (!file) return;
          void downscalePhoto(file).then((photo) => onOpen({ at: 'photo', photo }));
        }}
      />
    </div>
  );
}
