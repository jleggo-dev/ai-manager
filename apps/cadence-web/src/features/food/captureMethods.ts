import type { CaptureMethod } from './MethodTiles.tsx';

/**
 * The one order the doors are drawn in, everywhere a meal takes adds: type it (primary) · voice ·
 * photo · barcode — all four LOG (canvas "Cadence Quick Log", 2026-10-29). Find left the row: it
 * only ever searched your saved foods, so it is a filter bar on the shelves where those foods are.
 * Its own file so the tile component exports only components (fast refresh).
 */
export const CAPTURE_METHODS: readonly CaptureMethod[] = ['chat', 'voice', 'picture', 'barcode'];
