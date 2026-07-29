/**
 * Pure helper for the Broker's captured home location — reads the `location` field the capture-extract
 * job emits (a flat string or `{ city }`). Kept DB/config-free so it's unit-testable in isolation;
 * `runCaptureExtract` geocodes the result and sets it (guarded) in capture.ts.
 */
export function extractCity(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object') {
    const c = (raw as { city?: unknown }).city;
    if (typeof c === 'string') return c.trim();
  }
  return '';
}
