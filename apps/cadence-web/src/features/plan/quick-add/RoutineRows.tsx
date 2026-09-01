import type { PlanRoutine, UserRoutine } from '../../../lib/api.ts';
import { categoryOfArea } from '../../today/category.ts';
import { glyphOf } from '../../today/glyphs.ts';
import type { QuickAddArea } from './quickAddRows.ts';
import { routineMeta } from './routineShelf.ts';
import { userRoutineMeta } from './userRoutineShelf.ts';

/** One routine row — shared by the shelf's top-2 slice and the "Browse all" full list, so the two
 *  views can never drift in what a row looks like or does. `errorText` swaps in for the meta line
 *  the same way `PhotoQuickRow`'s save-state text does (QuickAddRowViews.tsx): the row's own
 *  honest line lives exactly where its ordinary meta would, never a separate block bolted on. */
export function RoutineRow({
  routine,
  area,
  busy,
  errorText,
  onPlay,
}: {
  routine: PlanRoutine;
  area: QuickAddArea;
  busy: boolean;
  errorText?: string;
  onPlay: () => void;
}) {
  const routineArea = routine.area ?? area;
  const glyph = glyphOf(routine.title, routineArea);
  return (
    <button className="ld-row" onClick={onPlay} disabled={busy} aria-label={routine.title}>
      <span className={`ld-ic ld-ic-${categoryOfArea(routineArea)}`} aria-hidden>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d={glyph.d} fill="#fff" />
        </svg>
      </span>
      <span className="ld-row-t">
        <b>{routine.title}</b>
        <span>{errorText ?? routineMeta(routine)}</span>
      </span>
      <span className="ld-plus" aria-hidden>
        ›
      </span>
    </button>
  );
}

/** A user-built routine's own row — same grammar as `RoutineRow`, but no busy/error state: playing
 *  one needs no fetch (the session is already in hand from `listUserRoutines`), so there is
 *  nothing here that can fail. The "yours" word leads the meta line — a quiet chip, not a
 *  separate line, the same one-line-of-facts shape every row in this sheet already wears. */
export function UserRoutineRow({
  routine,
  area,
  onPlay,
}: {
  routine: UserRoutine;
  area: QuickAddArea;
  onPlay: () => void;
}) {
  const routineArea = routine.area ?? area;
  const glyph = glyphOf(routine.name, routineArea);
  const meta = ['yours', userRoutineMeta(routine)].filter((p): p is string => !!p).join(' · ');
  return (
    <button className="ld-row" onClick={onPlay} aria-label={routine.name}>
      <span className={`ld-ic ld-ic-${categoryOfArea(routineArea)}`} aria-hidden>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d={glyph.d} fill="#fff" />
        </svg>
      </span>
      <span className="ld-row-t">
        <b>{routine.name}</b>
        <span>{meta}</span>
      </span>
      <span className="ld-plus" aria-hidden>
        ›
      </span>
    </button>
  );
}
