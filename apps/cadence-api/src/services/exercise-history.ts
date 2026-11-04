/**
 * "This exercise, the last N times" (walkthrough v3 Phase 5b): the dates, sets, reps or seconds
 * and load the person logged for one item, read off the stored occurrence logs. The Change sheet's
 * "Last 3 × 10 · 25 lb · Oct 28" rows and the weight sheet's "last time" chip.
 *
 * A client read, not a coach tool (TOOL-HARNESS.md step 1): the coach already gets the same logs
 * rendered as sentences in <recent_logs> when she builds a session, and get_recent_logs hands her
 * the summaries on demand. Nothing here goes in the tool catalog.
 *
 * Names are matched the way the repertoire matches titles (goal-identity.ts): accents folded, case
 * and punctuation ignored, so "Glute bridge" finds the "glute bridge" the walkthrough wrote in
 * lower case, and "Écossaise" finds "ecossaise". The logs are the parse's items, so an item named
 * differently in the person's own words is not found — the rows then say New, which is true of
 * what is on file.
 */
import type { ExerciseHistoryLine, OccurrenceLogItem } from '@cadence/shared';
import { listLoggedOccurrences } from '../repos/occurrence-logs.ts';
import { normTitle } from './goal-identity.ts';

/** How many lines a caller may ask for; the sheet wants three, the chip wants one. */
export const HISTORY_LINES_MAX = 20;
/** How many logged sessions are walked for matches — bounded, newest first. */
const SESSIONS_SCANNED = 200;

export function sameExercise(a: string, b: string): boolean {
  const na = normTitle(a);
  return na.length > 0 && na === normTitle(b);
}

function toLine(date: string, activity: string, item: OccurrenceLogItem): ExerciseHistoryLine {
  const line: ExerciseHistoryLine = { date, activity, name: item.name };
  if (item.sets !== undefined) line.sets = item.sets;
  if (item.reps !== undefined) line.reps = item.reps;
  // A timed effort in sets stores ONE set's minutes (OccurrenceLogItem.duration_min); a plain
  // timed item stores the whole effort. Either way it is the seconds the chip would show.
  if (item.duration_min !== undefined && item.reps === undefined) line.seconds = Math.round(item.duration_min * 60);
  if (item.load) line.load = item.load;
  if (item.swapped_from) line.swapped_from = item.swapped_from;
  return line;
}

/**
 * The last `limit` times `exercise` was logged, newest first. `activity` narrows to one activity's
 * sessions when given. Only items marked done count: a line the person said they skipped is not a
 * time they did it.
 */
export async function exerciseHistory(
  userId: string,
  opts: { exercise: string; activity?: string; limit?: number },
): Promise<ExerciseHistoryLine[]> {
  const limit = Math.min(HISTORY_LINES_MAX, Math.max(1, opts.limit ?? 3));
  if (!normTitle(opts.exercise)) return [];
  const rows = await listLoggedOccurrences(userId, { title: opts.activity, limit: SESSIONS_SCANNED });
  const lines: ExerciseHistoryLine[] = [];
  for (const row of rows) {
    for (const item of row.log.items ?? []) {
      if (item.done === false || !sameExercise(item.name, opts.exercise)) continue;
      lines.push(toLine(row.date, row.title, item));
      if (lines.length >= limit) return lines;
    }
  }
  return lines;
}
