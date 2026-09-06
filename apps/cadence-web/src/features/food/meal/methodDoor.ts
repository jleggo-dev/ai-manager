/**
 * Which door a capture tile opens (design 05a's tiles → 1b's doors).
 *
 * The tile someone taps IS their answer to "how do you want to add this". Landing them on a
 * surface that asks it again is the regression this router exists to prevent: the capture sheet
 * held the tapped method in state and then opened the meal screen without it, so Chat, Voice,
 * Barcode and Search all arrived at the same empty meal (owner, on device, 2026-09-06 — "Select
 * Chat… there's no chat"). The Log screen this replaced carried the method through on purpose.
 *
 * Picture is deliberately absent: its tile is a file input, so the photo is already in hand and
 * the caller opens `{ at: 'photo' }` itself. Anything without a door lands on the meal.
 */
import type { CaptureMethod } from '../MethodTiles.tsx';
import type { MealDoor } from './MealDoors.tsx';

export function doorForMethod(method: CaptureMethod): MealDoor | null {
  switch (method) {
    case 'chat':
      return { at: 'chat' };
    // Voice is the chat door with the mic already live — one screen, never a second mode.
    case 'voice':
      return { at: 'chat', listening: true };
    case 'search':
      return { at: 'add' };
    case 'barcode':
      return { at: 'barcode' };
    default:
      return null;
  }
}
