import { useState } from 'react';
import { getRoutineSession, type PlanRoutine, type UserRoutine } from '../../../lib/api.ts';
import { categoryOfArea } from '../../today/category.ts';
import { glyphOf, GLYPH } from '../../today/glyphs.ts';
import type { QuickAddArea } from './quickAddRows.ts';
import type { BuilderSeed } from './builderSeed.ts';
import { routineMeta } from './routineShelf.ts';
import { userRoutineMeta } from './userRoutineShelf.ts';
import { FETCH_FAILED, SESSION_GONE } from './useRoutinePlay.tsx';

/**
 * "Build my own" → Start from (Activity Builder 2A, "2A · Build — start from") — three shelves,
 * scoped to the noun's own area: coach routines to copy ("From the coach"), the user's own routines
 * to duplicate ("Yours"), and a truly blank start. Saving is deterministic everywhere past this
 * screen (TURN 1's third law, "the coach reviews, never rewrites") — the only read that happens
 * HERE is a From-Cadence pick's session fetch, the same one `useRoutinePlay` already makes to
 * PLAY a coach routine; picking a Yours row or Blank needs no fetch at all, so there is nothing to
 * fail there. Empty shelves are simply absent — never a dead heading over nothing.
 */
export function StartFromScreen({
  area,
  coachRoutines,
  userRoutines,
  onBack,
  onBuild,
}: {
  area: QuickAddArea;
  /** Already filtered to playable + this noun's area by the caller (QuickAddTense) — this screen
   *  only decides how to SHOW them, not which ones are real. */
  coachRoutines: PlanRoutine[];
  userRoutines: UserRoutine[];
  onBack: () => void;
  onBuild: (seed?: BuilderSeed) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ commitmentId: string; text: string } | null>(null);

  async function pickFromCadence(routine: PlanRoutine) {
    if (busyId) return;
    setError(null);
    setBusyId(routine.commitment_id);
    const { ok, session } = await getRoutineSession(routine.commitment_id);
    setBusyId(null);
    if (!ok) {
      setError({ commitmentId: routine.commitment_id, text: FETCH_FAILED });
      return;
    }
    if (!session) {
      setError({ commitmentId: routine.commitment_id, text: SESSION_GONE });
      return;
    }
    // "<title> — mine": she keeps adapting HER Easy 5k on the plan; this copy is frozen the
    // moment it's edited — the design's own words for why the name says so up front.
    onBuild({
      name: `${routine.title} — mine`,
      session,
      provenance: { kind: 'from_cadence', source_commitment_id: routine.commitment_id },
      area: routine.area ?? area,
    });
  }

  function pickYours(routine: UserRoutine) {
    // A copy, not a link back — `provenance: { kind: 'blank' }` on purpose: it isn't from the
    // coach, so 'from_cadence' would misname where it came from, and the contract has no
    // "duplicated" kind of its own. Runs start at zero (owner ruling, activity-builder.txt §F).
    onBuild({
      name: `${routine.name} 2`,
      session: routine.session,
      provenance: { kind: 'blank' },
      area: routine.area ?? area,
    });
  }

  return (
    <>
      <div className="ld2-back">
        <button onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div>
          <b>Start from</b>
          <span>A copy becomes yours — edit anything.</span>
        </div>
      </div>

      {coachRoutines.length > 0 && (
        <div className="ld2-sec">
          <b>From the coach</b> <span>built for you</span>
          <div className="ld-list">
            {coachRoutines.map((routine) => {
              const routineArea = routine.area ?? area;
              const glyph = glyphOf(routine.title, routineArea);
              const errorText = error?.commitmentId === routine.commitment_id ? error.text : undefined;
              return (
                <button
                  key={routine.commitment_id}
                  className="ld-row"
                  disabled={busyId === routine.commitment_id}
                  onClick={() => void pickFromCadence(routine)}
                  aria-label={routine.title}
                >
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
            })}
          </div>
        </div>
      )}

      {userRoutines.length > 0 && (
        <div className="ld2-sec">
          <b>Yours</b>
          <div className="ld-list">
            {userRoutines.map((routine) => {
              const routineArea = routine.area ?? area;
              const glyph = glyphOf(routine.name, routineArea);
              const meta = userRoutineMeta(routine);
              return (
                <button
                  key={routine.routine_id}
                  className="ld-row"
                  onClick={() => pickYours(routine)}
                  aria-label={routine.name}
                >
                  <span className={`ld-ic ld-ic-${categoryOfArea(routineArea)}`} aria-hidden>
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path d={glyph.d} fill="#fff" />
                    </svg>
                  </span>
                  <span className="ld-row-t">
                    <b>{routine.name}</b>
                    {meta && <span>{meta}</span>}
                  </span>
                  <span className="ld-plus" aria-hidden>
                    ›
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="ld2-sec">
        <div className="ld-list">
          <button className="ld-row" onClick={() => onBuild(undefined)} aria-label="Blank">
            <span className={`ld-ic ld-ic-${categoryOfArea(area)}`} aria-hidden>
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path d={GLYPH.pen} fill="#fff" />
              </svg>
            </span>
            <span className="ld-row-t">
              <b>Blank</b>
              <span>just the ＋ Add step</span>
            </span>
            <span className="ld-plus" aria-hidden>
              ›
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
