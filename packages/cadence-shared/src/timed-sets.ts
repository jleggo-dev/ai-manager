/**
 * A timed effort done in sets — a carry, a hang, a plank held three times (walkthrough v3 R1,
 * owner 2026-11-03). Not a tool of its own: it is the `timer` tool with `sets`, and these are the
 * few pure rules both the API (bounding what is stored) and the web (the log line) need. No React,
 * no clock.
 */
import type { SessionItem } from './types/occurrence.ts';

/** Rest between timed sets is stored bounded: nothing above ten minutes, whole seconds. */
export const MAX_REST_SEC = 600;

export function clampRestSec(sec: number | undefined): number | undefined {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return undefined;
  return Math.min(MAX_REST_SEC, Math.round(sec));
}

/**
 * Sets of a timed effort: `sets` and `duration_min` with no `reps`. The one quantity shape that is
 * not ambiguous: a count of sets with a length and no rep count is a thing held or carried for
 * that long, that many times. (`sets` + `reps` + a duration stays reps, as it always did — the
 * duration there is a tempo note, not the set.)
 */
export function isTimedSets(item: SessionItem): boolean {
  return (
    typeof item.sets === 'number' &&
    item.sets > 0 &&
    typeof item.duration_min === 'number' &&
    item.duration_min > 0 &&
    item.reps == null
  );
}

/** Seconds as the target line and the chips write them: "45 s" under a minute, "2 min" on a whole
 *  minute, "1:30" otherwise. */
export function secondsText(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The receipt for sets of a timed effort, in the reps line's grammar: "4×40 s @ 2×40 lb" when
 * every set ran the same, "45 · 53 · 32 · 45 s @ 2×40 lb" when they did not. Seconds as logged,
 * never the target, and never a word about which were over or under.
 */
export function timedSetsLogLine(secondsPerSet: readonly number[], load?: string): string {
  const tail = load ? ` @ ${load}` : '';
  const [first] = secondsPerSet;
  if (first === undefined) return '';
  const uniform = secondsPerSet.every((s) => s === first);
  return uniform ? `${secondsPerSet.length}×${first} s${tail}` : `${secondsPerSet.join(' · ')} s${tail}`;
}
