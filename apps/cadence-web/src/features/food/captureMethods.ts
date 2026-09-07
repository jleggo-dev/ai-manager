import type { CaptureMethod } from './MethodTiles.tsx';

/**
 * The one order the doors are drawn in, everywhere a meal takes adds. "Find" leads: it is the
 * fastest and most exact way in, so it gets the spot the thumb lands on (owner, 2026-09-07).
 * Its own file so the tile component exports only components (fast refresh).
 */
export const CAPTURE_METHODS: readonly CaptureMethod[] = ['search', 'chat', 'voice', 'picture', 'barcode'];
