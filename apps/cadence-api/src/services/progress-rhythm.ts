/**
 * The `rhythm` widget's data path (Progress Engine parcel W1-2) — dot-rows of Monday-start weeks,
 * detours drawn as shelter, check-ins counted inside them. See docs/cadence/PROGRESS-ENGINE.md and
 * the frozen contract in packages/cadence-shared/src/types/progress-widgets.ts (`RhythmPayload`).
 *
 * Two layers, deliberately split:
 *   - `buildRhythmWeeks` is PURE (no DB) — fabricated occurrence/check-in/episode arrays in, a
 *     `RhythmPayload` out. This is what the test suite exercises (DB tests share prod data; a pure
 *     resolver is the strongly-preferred shape here).
 *   - `resolveRhythm` is the thin async orchestrator `GET /progress/history` calls: it snaps the
 *     requested range to whole weeks, fetches the three repo reads, and hands them to the pure
 *     builder. Snapping matters — if `from` lands mid-week, that week's earlier days would have no
 *     fetched occurrence data and misread as gaps rather than whatever they actually were.
 */
import type { DisruptedEpisode, OccurrenceStatus, RhythmDayState, RhythmPayload, RhythmWeek } from '@cadence/shared';
import { listOccurrences } from '../repos/occurrences.ts';
import { listCheckInDays } from '../repos/check-ins.ts';
import { listEpisodeRanges } from '../repos/episodes.ts';
import { keptScheduledForDays, type ConsistencyOccurrence } from './metrics.ts';

const DAY_MS = 86_400_000;

/** A single occurrence's date + status — the resolver's own slim input shape (already normalized
 *  to a YYYY-MM-DD string; the DB driver hands back `date` columns as JS Date objects). */
export interface RhythmOccurrence {
  date: string;
  status: OccurrenceStatus;
}

export interface RhythmEpisodeRange {
  start: string;
  end: string;
  type: DisruptedEpisode['type'];
}

/* ── Plain date helpers (UTC, no library) ──────────────────────────────────────────────────── */

function parseIsoUtcMs(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDaysIso(dateIso: string, days: number): string {
  return isoFromMs(parseIsoUtcMs(dateIso) + days * DAY_MS);
}

/** The Monday on/before `dateIso` — every rhythm week starts here. */
export function mondayOnOrBefore(dateIso: string): string {
  const dow = new Date(parseIsoUtcMs(dateIso)).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  return addDaysIso(dateIso, -daysSinceMonday);
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Aug 25–31" (same month) or "Aug 31–Sep 6" (crosses a month). Year is deliberately omitted,
 *  matching the contract's own example — a week label is a caption, not a full date. */
function formatWeekLabel(startIso: string, endIso: string): string {
  const [, sm, sd] = startIso.split('-').map(Number);
  const [, em, ed] = endIso.split('-').map(Number);
  const start = `${MONTH_ABBR[sm! - 1]} ${sd}`;
  const end = sm === em ? `${ed}` : `${MONTH_ABBR[em! - 1]} ${ed}`;
  return `${start}–${end}`;
}

/** Plain, brand-safe ("no euphemism") labels for a detour's shelter band. */
const DETOUR_LABELS: Record<DisruptedEpisode['type'], string> = {
  travel: 'travel detour',
  illness: 'illness detour',
  injury: 'injury detour',
  recovery: 'recovery detour',
  custom: 'a detour',
};

/* ── Pure day/week classification ──────────────────────────────────────────────────────────── */

/**
 * kept > checkin > missed/upcoming > unscheduled. A `checkin` inside a detour takes priority over
 * `missed` because base occurrences are typically PAUSED for a shielded stretch (still "scheduled"
 * by the any-occurrence-that-day rule) — the check-in is the honest "showed up" signal for that
 * day, not the paused row. `missed` itself is brand-neutral (no red anywhere) — see BRAND.md.
 */
function classifyDay(
  date: string,
  doneDays: ReadonlySet<string>,
  scheduledDays: ReadonlySet<string>,
  checkInDays: ReadonlySet<string>,
  inEpisode: (date: string) => boolean,
  todayIso: string,
): RhythmDayState {
  if (doneDays.has(date)) return 'kept';
  if (inEpisode(date) && checkInDays.has(date)) return 'checkin';
  if (scheduledDays.has(date)) return date < todayIso ? 'missed' : 'upcoming';
  return 'unscheduled';
}

/**
 * PURE — see module doc. `from`/`to` need not already be week-aligned; each week is still bucketed
 * Monday-start, most recent first, but `occurrences`/`checkInDays`/`episodes` must already cover
 * the FULL aligned range (`resolveRhythm` guarantees this before calling in).
 */
export function buildRhythmWeeks(
  from: string,
  to: string,
  occurrences: RhythmOccurrence[],
  checkInDays: string[],
  episodes: RhythmEpisodeRange[],
  today = new Date(),
): RhythmPayload {
  const todayIso = today.toISOString().slice(0, 10);
  const doneDays = new Set(occurrences.filter((o) => o.status === 'done').map((o) => o.date));
  const scheduledDays = new Set(occurrences.map((o) => o.date));
  const checkInSet = new Set(checkInDays);
  const inEpisode = (date: string): boolean => episodes.some((e) => date >= e.start && date <= e.end);
  const consistencyInput: ConsistencyOccurrence[] = occurrences;

  const weekStarts: string[] = [];
  for (let ws = mondayOnOrBefore(from); ws <= to; ws = addDaysIso(ws, 7)) weekStarts.push(ws);
  weekStarts.reverse(); // most recent first, per the contract

  const weeks: RhythmWeek[] = weekStarts.map((start) => {
    const end = addDaysIso(start, 6);
    const dayDates = Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
    const days = dayDates.map((date) => ({
      date,
      state: classifyDay(date, doneDays, scheduledDays, checkInSet, inEpisode, todayIso),
    }));
    // Reuses metrics.ts' scheduled-days-only denominator — never a forked copy of that math.
    const { kept, scheduled } = keptScheduledForDays(consistencyInput, dayDates);
    // Earliest overlapping episode wins a tie (listEpisodeRanges is ordered start_date asc).
    const overlap = episodes.find((e) => end >= e.start && start <= e.end);
    return {
      start,
      label: formatWeekLabel(start, end),
      days,
      kept,
      scheduled,
      detour: overlap ? { type: overlap.type, label: DETOUR_LABELS[overlap.type] } : null,
    };
  });

  return { weeks };
}

/**
 * `resolveRhythm(userId, from, to)` — the async entry point `GET /progress/history` calls. Snaps
 * [from, to] out to whole Monday-start weeks, fetches occurrences (ALL statuses) + check-in days +
 * episode ranges once for that aligned span, and folds them through the pure builder above.
 */
export async function resolveRhythm(userId: string, from: string, to: string): Promise<RhythmPayload> {
  const alignedFrom = mondayOnOrBefore(from);
  const alignedTo = addDaysIso(mondayOnOrBefore(to), 6);
  const [occRows, checkInDays, episodes] = await Promise.all([
    listOccurrences(userId, alignedFrom, alignedTo),
    listCheckInDays(userId, alignedFrom, alignedTo),
    listEpisodeRanges(userId, alignedFrom, alignedTo),
  ]);
  const occurrences: RhythmOccurrence[] = occRows.map((r) => ({
    date: new Date(r.date).toISOString().slice(0, 10),
    status: r.status,
  }));
  return buildRhythmWeeks(alignedFrom, alignedTo, occurrences, checkInDays, episodes);
}
