/**
 * The doors, as one row, drawn the same wherever a meal takes adds: Find leads (it is the fastest
 * and most exact way in — owner, 2026-09-07), then Chat, Voice, Picture, Barcode. The cookbook
 * is a quiet link under them rather than a sixth tile. Everything here is a keyboard, not a
 * destination: each returns into the one meal.
 */
import { downscalePhoto } from '../../plan/occurrence/format.ts';
import { CAPTURE_METHODS } from '../captureMethods.ts';
import { MethodTiles, type CaptureMethod } from '../MethodTiles.tsx';
import type { MealDoor } from './MealDoors.tsx';
import { doorForMethod } from './methodDoor.ts';

export function MealDoorsRow({
  busy,
  onOpen,
  onShelf,
}: {
  busy?: boolean;
  onOpen: (door: MealDoor) => void;
  /** "From your cookbook ›" — absent hides the link. */
  onShelf?: () => void;
}) {
  const pick = (m: CaptureMethod) => {
    const door = doorForMethod(m);
    if (door) onOpen(door);
  };
  return (
    <div className="ms-doors-row">
      <MethodTiles
        methods={[...CAPTURE_METHODS]}
        disabled={busy}
        onPick={pick}
        onPhoto={(file) => {
          if (!file) return;
          void downscalePhoto(file).then((photo) => onOpen({ at: 'photo', photo }));
        }}
      />
      {onShelf && (
        <button type="button" className="ms-express ms-shelf-link" disabled={busy} onClick={onShelf}>
          From your cookbook ›
        </button>
      )}
    </div>
  );
}
