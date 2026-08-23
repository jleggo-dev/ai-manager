/**
 * The gates between "the phone measured a new position" and "the header says a new city" (A21).
 *
 * The bug this exists for: the header only moved past 50 km, so the owner's daily 30 km commute
 * into Montreal never registered and the app spent every working day naming the wrong place. The
 * bar had been tuned on a Lisbon → Montreal flight, which is 5,225 km — a factor of ~45 between
 * the noise it had to reject (coarse rounding is 2 d.p., so ~1.1 km of wobble) and the bar it set.
 *
 * Dropping the bar to 5 km fixes the commute and creates a different problem: a commute CROSSES
 * 5 km several times. Île-Perrot → Dorval → Lachine → downtown would rename the header at every
 * leg, and each rename costs a server-side reverse geocode. So we throttle the SAVE, not the read
 * (weather is already two-tier cached and re-reading one place is nearly free):
 *
 *   1. DWELL — never move on the first sighting of a new place. Hold it as a candidate and commit
 *      only when a later mount still finds you within ~2 km of it, ~20 minutes on. A train is never
 *      in the same 2 km twenty minutes later; an office always is.
 *   2. A FLOOR of ~30 minutes between saves, whatever else is true.
 *
 * Net: three app opens on the train change nothing, an hour at the office says Montreal, and one
 * geocode is paid per real relocation. It falls out for free that a long bike ride never settles,
 * so it never fires — which is the behaviour the owner asked for when he said going to work isn't
 * travelling.
 *
 * Coming HOME is the exception to all of it: home already has a name, so returning to it costs
 * nothing and needs no dwell. The transient is simply dropped.
 *
 * There are no timers here. Every decision is taken on a Today-tab mount, from stored state, which
 * is why this file is pure functions plus four lines of localStorage.
 */

/** Far enough to be somewhere else — well clear of the ~1.1 km coarse-rounding jitter. */
export const MOVE_KM = 5;
/** "Still there" — the radius a candidate has to hold to count as dwelt-at. */
export const DWELL_KM = 2;
/** How long a place has to keep you before it earns the header. */
export const DWELL_MS = 20 * 60_000;
/** A hard minimum between saves, so nothing can turn a journey into a stream of geocodes. */
export const SAVE_FLOOR_MS = 30 * 60_000;

export type Point = { lat: number; lon: number };
/** A place we are watching but have not committed to. */
export type Candidate = Point & { firstSeenMs: number };

/** Great-circle km between two points — the yardstick every gate here measures with. */
export function haversineKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export type PlaceDecision =
  /** You are where we already think you are. Anything we were watching can be forgotten. */
  | { kind: 'stay' }
  /** Somewhere else, not yet settled. Keep watching this candidate. */
  | { kind: 'hold'; candidate: Candidate }
  /** Settled. Name it — this is the only branch that costs a request. */
  | { kind: 'commit'; point: Point }
  /** Back within reach of home. Drop the transient; no geocode, because home has a name already. */
  | { kind: 'home' };

/**
 * Pure: given what we have stored and what the device just measured, what should happen?
 *
 * `current` is the transient position (null when the user is home), `home` the anchor everything
 * else in the app reads. Both are compared against, because "have you moved?" is a question about
 * where the header currently points, and "are you back?" is a question about home.
 */
export function decidePlace(input: {
  home: Point | null;
  current: Point | null;
  reading: Point;
  candidate: Candidate | null;
  lastSavedMs: number | null;
  nowMs: number;
}): PlaceDecision {
  const { home, current, reading, candidate, lastSavedMs, nowMs } = input;

  // Home first: if a transient is standing and the reading is back near home, that transient is
  // simply wrong, and correcting it is free.
  if (current && home && haversineKm(home, reading) < MOVE_KM) return { kind: 'home' };

  // Where the header points today. With nothing stored at all this hook has nothing to compare —
  // first-run auto-detect owns that case and sets home.
  const base = current ?? home;
  if (!base) return { kind: 'stay' };
  if (haversineKm(base, reading) < MOVE_KM) return { kind: 'stay' };

  // Somewhere new. A first sighting — or one that has moved on from what we were watching —
  // restarts the clock rather than committing.
  if (!candidate || haversineKm(candidate, reading) >= DWELL_KM) {
    return { kind: 'hold', candidate: { lat: reading.lat, lon: reading.lon, firstSeenMs: nowMs } };
  }
  // Same place, but not for long enough yet — or too soon after the last save. Keep the original
  // `firstSeenMs`: the clock belongs to the place, not to this mount.
  if (nowMs - candidate.firstSeenMs < DWELL_MS) return { kind: 'hold', candidate };
  if (lastSavedMs != null && nowMs - lastSavedMs < SAVE_FLOOR_MS) return { kind: 'hold', candidate };

  // Commit the freshest reading rather than the candidate's first fix — they are within 2 km of
  // each other, and this one is where the user actually is.
  return { kind: 'commit', point: { lat: reading.lat, lon: reading.lon } };
}

// ── the four lines of state ───────────────────────────────────────────────────────────────────
// Device-local on purpose: a candidate is a guess about one phone, worth nothing on the server and
// nothing to another device. Every accessor swallows its errors — storage can be unavailable
// (private mode, a hardened webview), and the cost of that is a header that updates less eagerly,
// never a screen that fails to load.

const CANDIDATE_KEY = 'cadence.place.candidate';
const SAVED_AT_KEY = 'cadence.place.savedAt';

export function loadCandidate(): Candidate | null {
  try {
    const raw = localStorage.getItem(CANDIDATE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<Candidate>;
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon) || !Number.isFinite(c.firstSeenMs)) return null;
    return c as Candidate;
  } catch {
    return null;
  }
}

export function rememberCandidate(candidate: Candidate): void {
  try {
    localStorage.setItem(CANDIDATE_KEY, JSON.stringify(candidate));
  } catch {
    /* storage unavailable — the gate degrades to "never settles", which is the safe direction */
  }
}

export function forgetCandidate(): void {
  try {
    localStorage.removeItem(CANDIDATE_KEY);
  } catch {
    /* nothing to do */
  }
}

export function loadLastSavedMs(): number | null {
  try {
    const raw = Number(localStorage.getItem(SAVED_AT_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function markSaved(nowMs: number): void {
  try {
    localStorage.setItem(SAVED_AT_KEY, String(nowMs));
  } catch {
    /* the floor degrades to "dwell only", which is still 20 minutes of protection */
  }
}
