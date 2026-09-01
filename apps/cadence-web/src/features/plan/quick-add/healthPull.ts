import type { WorkoutHistoryListItem } from '../../../lib/api.ts';
import { localTodayIso } from '../../../lib/query/keys.ts';

/**
 * "Pull from Apple Health" (design 2A screen 2's fastest log source) — no device work needed: the
 * phone already syncs workouts into the workout_history dataset (0033), read here via the
 * existing `getWorkoutHistory`. This file is the pure shaping of that read into "which rows can
 * this noun's log door offer, and what do they honestly say" — split out so the filter (three real
 * conditions stacked) and the composed facts (never an invented number) are each testable without
 * mounting the screen.
 */

const NOUN_TYPE_MATCH: Array<[RegExp, RegExp]> = [
  [/\brun\b/, /run|jog/i],
  [/\bwalk\b/, /walk|hik/i],
  [/\bride\b/, /cycl|bike|rid/i],
  [/\bswim\b/, /swim/i],
  [/\brow\b/, /row/i],
];

/** Does this workout's `type` match the noun the screen was opened on? The generic "A workout"
 *  (and anything else that doesn't name one specific movement) matches every type — it's the
 *  fallback noun for exactly the case where the plan doesn't single one out. */
function typeMatchesNoun(noun: string, type: string): boolean {
  const n = noun.toLowerCase();
  for (const [nounWord, typePattern] of NOUN_TYPE_MATCH) {
    if (nounWord.test(n)) return typePattern.test(type);
  }
  return true;
}

/**
 * Which of today's synced workouts this noun's log door can offer to pull — the dataset's own
 * newest-first order, never re-sorted. Three real conditions, all required:
 *   - started TODAY by the LOCAL calendar (`localTodayIso` on both sides, never hand-rolled
 *     timezone math — a workout at 11pm neither vanishes nor arrives a day early for someone west
 *     of Greenwich);
 *   - synced from a DEVICE (`healthkit` or `strava`) only — a `cadence`-sourced row is a session
 *     already logged through this very screen (a chip, the free line, a played walkthrough);
 *     offering to "pull" it back in would double-count the exact thing the pull exists to save
 *     someone from re-typing, so it is excluded here, not filtered at render time;
 *   - type-matched to the noun (`typeMatchesNoun`).
 * The caller caps this to the top 2 actually shown — that stays the caller's job so "how many
 * matched" and "how many are rendered" can be tested apart.
 */
export function pullableWorkouts(
  rows: WorkoutHistoryListItem[],
  noun: string,
  today: string = localTodayIso(),
): WorkoutHistoryListItem[] {
  return rows.filter(
    (r) =>
      (r.source === 'healthkit' || r.source === 'strava') &&
      localTodayIso(new Date(r.startedAt)) === today &&
      typeMatchesNoun(noun, r.type),
  );
}

/** "Apple Health" or "Strava" — never a wrong brand name. `pullableWorkouts` already excludes
 *  `cadence`, so this only ever sees the two real device sources. */
export function healthPullSourceLabel(source: WorkoutHistoryListItem['source']): string {
  return source === 'strava' ? 'Strava' : 'Apple Health';
}

/** "4.8 km" — one decimal, the scale a distance is actually read at. */
function formatDistanceKm(km: number): string {
  return `${Math.round(km * 10) / 10} km`;
}

/** "32 min" — whole minutes, matching every other duration this screen shows. */
function formatDurationMin(min: number): string {
  return `${Math.round(min)} min`;
}

/** "7:02 am" — LOCAL clock time, hand-rolled rather than `toLocaleTimeString`: that call's exact
 *  format (lowercase am/pm, no leading zero on the hour) is locale-dependent, and this one isn't
 *  allowed to drift with the runtime it happens to run on. */
function formatStartTime(iso: string): string {
  const d = new Date(iso);
  const h24 = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h24 >= 12 ? 'pm' : 'am';
  const h = h24 % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

/** Distance + duration, formatted, each only when the row actually carries it — never an invented
 *  number. Feeds BOTH the row's own meta line (`healthPullMeta`) and the composed log text
 *  (QuickAddTense.tsx's `composeLogText`, the same composer the duration chips use), so the two
 *  can never disagree about what's real. */
export function healthPullFacts(row: WorkoutHistoryListItem): string[] {
  const facts: string[] = [];
  if (typeof row.distanceKm === 'number' && row.distanceKm > 0) facts.push(formatDistanceKm(row.distanceKm));
  if (typeof row.durationMin === 'number' && row.durationMin > 0) facts.push(formatDurationMin(row.durationMin));
  return facts;
}

/** The row's own meta line — distance and duration when real, start time always (every row has
 *  one; `startedAt` is required). Distance is shown in km regardless of the Settings › Units
 *  distance preference — see this parcel's report for why (no km→mi conversion helper exists yet
 *  to reach for; a follow-up, not invented here). */
export function healthPullMeta(row: WorkoutHistoryListItem): string {
  return [...healthPullFacts(row), formatStartTime(row.startedAt)].join(' · ');
}
