import { useEffect, useState } from 'react';
import { getRoutines, type PlanRoutine } from '../../../lib/api.ts';
import { categoryOfArea } from '../../today/category.ts';
import { glyphOf } from '../../today/glyphs.ts';

/**
 * The express lane (Activity Builder 2A, "the one cost to watch" — Now Door §4d's promotion rule,
 * unchanged): if someone runs the same routine over and over, the ordinary path — pick the noun,
 * pick the tense, tap the row — costs three taps where a shortcut should cost one. A labelled row
 * for the user's single most-used routine sits above the sheet's derived quick-add rows, wearing
 * the same `.ld-row`/`.ld-ic` chrome as everything below it — a labelled row, never a floating
 * disc, and the pillar tone lives only on the puck, never the row's own surface.
 *
 * It never appears without having been used: no candidate (nothing crosses the finishes floor, or
 * the plan has no routines at all), or a failed read, renders NOTHING — a shortcut to something
 * unused is not a shortcut, and a blip must never invent one. `getRoutines()` is already
 * finishes-ranked (the honest signal, not recency); the first eligible entry wins, never re-sorted.
 */
export function QuickAddPill({
  suppressed,
  onPlay,
}: {
  /** The coach's own pinned "do something now" item outranks a usage-stats shortcut (Now Door's
   *  hierarchy) — true whenever DoNowSection currently has one, via its `onPinnedChange`. */
  suppressed: boolean;
  /** Wired at integration to `useRoutinePlay` (parcel/routines-shelf) — this component only knows
   *  THAT a tap should play the routine, never HOW. */
  onPlay: (routine: PlanRoutine) => void;
}) {
  const [routine, setRoutine] = useState<PlanRoutine | null>(null);

  useEffect(() => {
    let alive = true;
    getRoutines()
      .then((routines) => {
        if (!alive) return;
        // A candidate needs to have actually been finished a few times AND have a real step list
        // cached — an unfinished or stepless lineage has nothing to shortcut to.
        setRoutine(routines?.find((r) => r.finishes >= 3 && r.steps.length > 0) ?? null);
      })
      .catch(() => {
        if (alive) setRoutine(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (suppressed || !routine) return null;

  const cat = categoryOfArea(routine.area ?? 'movement');
  const glyph = glyphOf(routine.title, routine.area);

  return (
    <button className="ld-row qa-pill" onClick={() => onPlay(routine)} aria-label={routine.title}>
      <span className={`ld-ic ld-ic-${cat}`} aria-hidden>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d={glyph.d} fill="#fff" />
        </svg>
      </span>
      <span className="ld-row-t">
        <b>{routine.title}</b>
        <span>{`finished ${routine.finishes} times`}</span>
      </span>
      <span className="ld-plus" aria-hidden>
        ›
      </span>
    </button>
  );
}
