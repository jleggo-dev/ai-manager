import { browserTimezone, saveHomeLocation, type LocationResult } from '../../lib/api.ts';
import { setLocationOff, writeSource } from './location-source.ts';

/**
 * Save a typed city as the home place — the ONE implementation, shared by Settings' Set flow and
 * the weather sheet's CHANGE (owner, 2026-09-08: when device location is off, the sheet is where
 * you would look to change the city, so it gets the same setter rather than a second one).
 *
 * Order matters and is the same as it always was in Settings: the source is recorded BEFORE the
 * cache write, because `readSource` derives the row's state from it on the re-render that write
 * causes; and saving a place lifts the deliberate "no location" switch, since asking for a place
 * is how that switch is turned back on.
 *
 * Resolves `false` rather than throwing on a failed save — the callers show their own line.
 */
export async function saveCityPlace(city: string, writePlace: (next: LocationResult) => void): Promise<boolean> {
  const trimmed = city.trim();
  if (!trimmed) return false;
  try {
    const tz = browserTimezone();
    const saved = await saveHomeLocation({ city: trimmed, label: trimmed, ...(tz ? { timezone: tz } : {}) });
    writeSource('city');
    writePlace(saved);
    setLocationOff(false);
    return true;
  } catch {
    return false;
  }
}
