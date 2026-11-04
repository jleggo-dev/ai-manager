/**
 * The words the Change sheet and its neighbours write from facts (walkthrough v3 Phase 5): an
 * alternative's target in the header's grammar, the "Last 3 × 10 · 25 lb · Oct 28" line, a short
 * date, a circuit move's target. Pure, and apart from the components so react-refresh stays happy.
 */
import type { CircuitExercise, ExerciseHistoryLine, SessionItemAlternative } from '@cadence/shared';
import { targetText } from './wt-styles.ts';
import { alternativeTool } from './changes.ts';

/** The one-line target of an alternative in the step header's grammar: "12 × 40 lb · 2 sets". */
export function alternativeTarget(alt: SessionItemAlternative): string {
  return targetText({ tool: alternativeTool(alt) });
}

/** "Last 3 × 10 · 25 lb · Oct 28" / "Last 3 × 45 s · Oct 5" / "Last 20 lb · Oct 28": count what happened. */
export function lastLine(h: ExerciseHistoryLine): string {
  const count =
    h.sets && h.reps
      ? `${h.sets} × ${h.reps}`
      : h.sets && h.seconds
        ? `${h.sets} × ${h.seconds} s`
        : h.reps
          ? `${h.reps}`
          : h.seconds
            ? `${h.seconds} s`
            : '';
  return ['Last', count, h.load, shortDate(h.date)].filter(Boolean).join(' · ').replace('Last · ', 'Last ');
}

/** "Oct 28" from an ISO day, read as a local day so it never slips to the day before. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The move's target as the row writes it: "12 reps", "12 reps × 15 lb", "30 s × 40 lb". */
export function moveTarget(ex: CircuitExercise, workingLoad?: string): string {
  const load = workingLoad ?? ex.load;
  const head = ex.reps != null ? `${ex.reps} reps` : `${ex.seconds} s`;
  return load ? `${head} × ${load}` : head;
}
