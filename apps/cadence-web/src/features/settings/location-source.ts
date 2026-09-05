/**
 * How the stored place got there — and, since 2026-09-05, whether the user has said they want no
 * place at all.
 *
 * `/me/location` has no "how this was set" column, so which of Settings' three states a saved
 * place is in is tracked here rather than invented by re-reading `label`, which a device share can
 * also carry. That was always a UI-copy decision, not a data-integrity one.
 *
 * The third value is new and is NOT cosmetic. The owner's rule (2026-09-05): "location/weather
 * should never be unset — unless I deliberately choose that to be the case in the settings." The
 * first half is the header's auto-detect, which now keeps a place on file whenever it can. Without
 * the second half that becomes a Settings screen you cannot switch off: forget the place, and the
 * next launch silently puts it back. So a deliberate forget writes `off`, auto-detect reads it and
 * stands down, and every path that SETS a place clears it again — turning it back on is just using
 * it.
 *
 * Device-local, like the source it sits beside: it is a statement about this phone's behaviour,
 * and it is registered in `USER_SCOPED_KEYS` so the next person to sign in on this device does not
 * inherit somebody else's decision.
 */
export type Source = 'device' | 'city';

const SOURCE_KEY = 'cadence.locationSource';
const OFF_KEY = 'cadence.locationOff';

export function readSource(loc: { label?: string } | null): Source | null {
  if (!loc) return null;
  try {
    const stored = window.localStorage.getItem(SOURCE_KEY);
    if (stored === 'device' || stored === 'city') return stored;
  } catch {
    /* fall through to the heuristic below */
  }
  // No record (e.g. a place saved before the Settings rebuild, or storage unavailable): a typed
  // city always carries a label; a bare device share usually does not.
  return loc.label ? 'city' : 'device';
}

export function writeSource(source: Source | null): void {
  try {
    if (source) window.localStorage.setItem(SOURCE_KEY, source);
    else window.localStorage.removeItem(SOURCE_KEY);
  } catch {
    /* no localStorage, no matter — the next load falls back to the label heuristic */
  }
}

/**
 * Has the user asked for no location at all?
 *
 * Errs toward FALSE — an unreadable store means auto-detect runs, which is the behaviour someone
 * who never touched the setting wants. The cost of being wrong this way is a place they have to
 * forget again; the cost of the other way is a header that stays blank forever with no way to
 * explain itself.
 */
export function isLocationOff(): boolean {
  try {
    return window.localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
}

/** Record — or lift — "I want no place on file". Every path that saves a place lifts it. */
export function setLocationOff(off: boolean): void {
  try {
    if (off) window.localStorage.setItem(OFF_KEY, '1');
    else window.localStorage.removeItem(OFF_KEY);
  } catch {
    /* storage unavailable — the choice degrades to "auto-detect runs", the safe direction */
  }
}
