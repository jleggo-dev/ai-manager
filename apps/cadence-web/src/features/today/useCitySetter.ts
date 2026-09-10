import { useCallback } from 'react';
import { useHomeLocation, useSetHomeLocation } from '../../lib/query/index.ts';
import { knownSource, type SourcedPlace } from '../settings/location-source.ts';
import { saveCityPlace } from '../settings/save-city.ts';

/** What the weather sheet needs to offer CHANGE: whether it may, and what a save does. */
export interface CitySetter {
  /** True when the place is a typed city or nothing at all — never while the device sets it. */
  canChange: boolean;
  /** Save a typed city; resolves false on a failed save. The header re-reads sky and city after. */
  save: (city: string) => Promise<boolean>;
}

/**
 * Which places may be changed from the sheet (owner, 2026-09-08): with device location ON the city
 * is wherever the phone is, and a CHANGE there would be a door painted on a wall — the old button
 * was exactly that. With device location OFF the city was typed by hand, so the sheet is the
 * natural place to retype it.
 *
 * Only a place KNOWN to be typed gets the door — the server's record, or this device's. Not the
 * label heuristic Settings falls back on: a device fix comes back reverse-geocoded with a label,
 * and on every phone whose place predated the local record that heuristic put CHANGE on a
 * device-set city (owner, on device, 2026-09-09). Unknown means no door; Settings still has one.
 * Nothing on file at all keeps the door, because "Set a city" is the only way in from here.
 */
export function canChangeCity(loc: SourcedPlace | null): boolean {
  return !loc || knownSource(loc) === 'city';
}

export function useCitySetter(onSaved: () => Promise<void>): CitySetter {
  const { data: place } = useHomeLocation();
  const writePlace = useSetHomeLocation();
  const loc = place?.home_location ?? null;
  const save = useCallback(
    async (city: string) => {
      const ok = await saveCityPlace(city, writePlace);
      if (ok) await onSaved();
      return ok;
    },
    [writePlace, onSaved],
  );
  return { canChange: canChangeCity(loc), save };
}
