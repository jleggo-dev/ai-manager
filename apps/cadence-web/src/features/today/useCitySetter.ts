import { useCallback } from 'react';
import { useHomeLocation, useSetHomeLocation } from '../../lib/query/index.ts';
import { readSource } from '../settings/location-source.ts';
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
 * natural place to retype it. Same rule, in one place, as `SettingsLocation`'s three states.
 */
export function canChangeCity(loc: { label?: string } | null): boolean {
  return readSource(loc) !== 'device';
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
