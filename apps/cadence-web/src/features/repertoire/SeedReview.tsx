/**
 * Seed a collection — design frame 1c.
 *
 * Someone names a book ("Suzuki Piano Book 2", "ABRSM Grade 3", "Shotokan kata") and this screen
 * lays it out in order, composer and catalogue split off the title so the three minuets in G are
 * three rows and never one. They tap the piece they are on; everything before it becomes Keeping
 * up, that one becomes Learning, everything after stays off the list until they tick it. Ticks
 * correct the exceptions.
 *
 * Two rules hold the screen together:
 *
 *  - **Nothing is saved until Confirm**, and the button says how many rows it will write. The
 *    count comes from the same list the POST is built from (`writableRows`), so it cannot promise
 *    one thing and do another.
 *  - **A fault is not an empty book.** When the lookup breaks, this says so and offers a retry.
 *    It never renders "0 pieces found" over a crash — that is a claim about the person's book,
 *    made in our voice, and they would believe it.
 */
import { useEffect, useMemo, useState } from 'react';
import { confirmSeed, expandCollection } from '../../lib/api/repertoire-seed.ts';
import { getReview } from '../../lib/api/review.ts';
import { SeedGoalChips, type SeedGoal } from './SeedGoalChips.tsx';
import { SeedRow } from './SeedRow.tsx';
import { applyHere, rowStanding, saveLabel, toggleRow, writableRows, type SeedRowState } from './seedRows.ts';
import '../../styles/seed-review.css';

const COACH_LINE =
  "Here's the book in order. Tap the piece you're on now and I'll mark everything before it as Keeping up. Tick or untick anything I got wrong.";
const UNKNOWN_LINE = "I don't know that one — add pieces by hand, or tell me more about it.";
const ADD_BY_HAND = 'Missing something? Add a piece by hand ›';
const LOOKING = 'Reading the book…';

type Load = { kind: 'loading' } | { kind: 'fault'; fault: string } | { kind: 'ready'; found: number };

interface Props {
  /** The collection the person named. */
  collection: string;
  /** Called with the number of rows actually written. Navigation belongs to the caller. */
  onDone: (written: number) => void;
}

export function SeedReview({ collection, onDone }: Props) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [title, setTitle] = useState(collection);
  const [rows, setRows] = useState<SeedRowState[]>([]);
  const [hereRank, setHereRank] = useState<number | null>(null);
  const [goals, setGoals] = useState<SeedGoal[]>([]);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveFault, setSaveFault] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoad({ kind: 'loading' });
    setTitle(collection);
    void expandCollection(collection)
      .then((res) => {
        if (!live) return;
        if (!res.ok) return setLoad({ kind: 'fault', fault: res.fault });
        setTitle(res.collection);
        setRows(res.candidates.map((c) => ({ ...c, selected: false })));
        setHereRank(null);
        setLoad({ kind: 'ready', found: res.candidates.length });
      })
      .catch(() => {
        if (live) setLoad({ kind: 'fault', fault: 'I could not look that up just now — a fault on our side.' });
      });
    return () => {
      live = false;
    };
  }, [collection, attempt]);

  // Best-effort: no goals is a usable screen ("No goal — just keep it" is a real answer), so a
  // failed read leaves the chip row short rather than blocking the seed.
  useEffect(() => {
    let live = true;
    void getReview()
      .then((r) => {
        if (live) setGoals(r.goals.map((g) => ({ goal_id: g.goal_id, title: g.title })));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const toWrite = useMemo(() => writableRows(rows, hereRank), [rows, hereRank]);

  function tapHere(rank: number) {
    setHereRank(rank);
    setRows((rs) => applyHere(rs, rank));
  }

  function addByHand() {
    setRows((rs) => [
      ...rs,
      {
        label: '',
        composer: null,
        catalogue: null,
        collection: title,
        rank: (rs[rs.length - 1]?.rank ?? 0) + 1,
        ambiguous: false,
        selected: true,
        added: true,
      },
    ]);
  }

  async function save() {
    setSaving(true);
    setSaveFault(null);
    const res = await confirmSeed(toWrite, goalId);
    setSaving(false);
    if (!res.ok) return setSaveFault(res.fault);
    onDone(res.written);
  }

  return (
    <div className="scrollbody sr-screen">
      <div className="screen-title">{title}</div>
      {load.kind === 'ready' && load.found > 0 ? (
        <>
          <div className="pw-head-tag sr-count">{`${load.found} PIECES FOUND · NOTHING SAVED YET`}</div>
          <p className="screen-sub">{COACH_LINE}</p>
        </>
      ) : null}

      {load.kind === 'loading' ? <p className="screen-sub">{LOOKING}</p> : null}

      {load.kind === 'fault' ? (
        <div className="pw-card sr-fault">
          <p className="sr-fault-t">{load.fault}</p>
          <button type="button" className="detour-chip" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      ) : null}

      {load.kind === 'ready' ? (
        <>
          {load.found === 0 && rows.length === 0 ? <p className="screen-sub">{UNKNOWN_LINE}</p> : null}
          {rows.length > 0 ? (
            <div className="pw-card">
              <div className="pw-rep sr-rows">
                {rows.map((row, i) => (
                  <SeedRow
                    key={row.rank}
                    row={row}
                    standing={rowStanding(row, hereRank)}
                    here={row.rank === hereRank}
                    onTick={() => setRows((rs) => toggleRow(rs, i))}
                    onHere={() => tapHere(row.rank)}
                    onLabel={(value) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, label: value } : r)))}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <button type="button" className="sr-add" onClick={addByHand}>
            {ADD_BY_HAND}
          </button>

          <SeedGoalChips goals={goals} goalId={goalId} onPick={setGoalId} />

          {saveFault ? <p className="sr-fault-t sr-savefault">{saveFault}</p> : null}
          <button type="button" className="cta sr-save" disabled={toWrite.length === 0 || saving} onClick={save}>
            {saveLabel(toWrite.length)}
          </button>
        </>
      ) : null}
    </div>
  );
}
