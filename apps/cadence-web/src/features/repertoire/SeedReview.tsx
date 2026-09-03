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
 *
 * Its stylesheet (`styles/seed-review.css`) loads centrally from main.tsx now (P6: this screen is
 * real navigation from the list screen, not preview-only, so its rules load like every other
 * screen's rather than riding in with whichever component happens to mount first).
 */
import { useEffect, useMemo, useState } from 'react';
import { confirmSeed, expandCollection } from '../../lib/api/repertoire-seed.ts';
import { getReview } from '../../lib/api/review.ts';
import { SeedGoalChips, type SeedGoal } from './SeedGoalChips.tsx';
import { SeedRow } from './SeedRow.tsx';
import {
  ambiguityNote,
  applyHere,
  blockedRanks,
  markedRanks,
  refusedNote,
  rowStanding,
  saveLabel,
  toggleRow,
  writableRows,
  type SeedRowState,
} from './seedRows.ts';

const COACH_LINE =
  "Here's everything in it, in order. Tap the one you're on now and I'll mark everything before it as known. Tick or untick anything I got wrong.";
/** The same screen, opened from the conversation: she already heard where they are, so asking them
 *  to tap what is already tapped would read as if she had not been listening. */
const PREFILLED_LINE =
  "Here's everything in it, in order. I've marked where I think you are, from what you told me — move it or untick anything I got wrong.";
const UNKNOWN_LINE = "I don't know that one — add items by hand, or tell me more about it.";
const ADD_BY_HAND = 'Missing something? Add one by hand ›';
const LOOKING = 'Looking it up…';

type Load = { kind: 'loading' } | { kind: 'fault'; fault: string } | { kind: 'ready'; found: number };

interface Props {
  /** The collection the person named. */
  collection: string;
  /**
   * The piece the coach heard them say they are on, in their own words (P7, design frame 1e) —
   * the ONE thing her door adds. It is applied exactly as a tap on that row is, and it resolves to
   * nothing whenever the words fit more than one piece: she may pre-mark, she may not pick between
   * two titles (`resolveHereRank`, server-side). Omitted for the person's own ＋ door, which marks nothing.
   */
  whereYouAre?: string;
  /** Called with the number of rows actually written. Navigation belongs to the caller. */
  onDone: (written: number) => void;
}

export function SeedReview({ collection, whereYouAre, onDone }: Props) {
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
    void expandCollection(collection, whereYouAre)
      .then((res) => {
        if (!live) return;
        if (!res.ok) return setLoad({ kind: 'fault', fault: res.fault });
        setTitle(res.collection);
        const fresh = res.candidates.map((c) => ({ ...c, selected: false }));
        // Her heard split, applied through the SAME function the tap runs, so a prefilled screen
        // and a tapped one cannot differ. The RANK is the server's (`resolveHereRank`) — this
        // screen never matches a title itself. Null when she heard nothing, or heard something
        // several pieces answer to; then this is the person's own door exactly as it was.
        const here = res.here_rank;
        setRows(here === null ? fresh : applyHere(fresh, here));
        setHereRank(here);
        setLoad({ kind: 'ready', found: res.candidates.length });
      })
      .catch(() => {
        if (live) setLoad({ kind: 'fault', fault: 'I could not look that up just now — a fault on our side.' });
      });
    return () => {
      live = false;
    };
  }, [collection, whereYouAre, attempt]);

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
  // `marked` is a fact about the NAME (the row becomes a field to correct); `blocked` is the
  // subset that would actually be written, and it is what holds the button.
  const marked = useMemo(() => markedRanks(rows), [rows]);
  const blocked = useMemo(() => blockedRanks(rows, hereRank), [rows, hereRank]);

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
    // The button is already disabled here; this is the second lock, so a name the seed would be
    // refused for cannot reach the server by any route the screen offers.
    if (blocked.size > 0) return;
    setSaving(true);
    setSaveFault(null);
    const res = await confirmSeed(toWrite, goalId);
    setSaving(false);
    if (!res.ok) return setSaveFault(res.fault);

    // The server applies the full rule against the whole shelf, so it can refuse a name this
    // screen had no way to judge. Mark those rows so they come back as fields, say what landed,
    // and do NOT report done — there is still something for the person to do here.
    if (res.refused.length > 0) {
      const refusedLabels = new Set(res.refused.map((r) => r.label));
      setRows((rs) => rs.map((r) => (refusedLabels.has(r.label) ? { ...r, ambiguous: true } : r)));
      setSaveFault(refusedNote(res.written, [...refusedLabels]));
      return;
    }
    onDone(res.written);
  }

  return (
    <div className="scrollbody sr-screen">
      <div className="screen-title">{title}</div>
      {load.kind === 'ready' && load.found > 0 ? (
        <>
          <div className="pw-head-tag sr-count">{`${load.found} FOUND · NOTHING SAVED YET`}</div>
          <p className="screen-sub">{hereRank === null ? COACH_LINE : PREFILLED_LINE}</p>
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
                    blocked={marked.has(row.rank)}
                    onTick={() => setRows((rs) => toggleRow(rs, i))}
                    onHere={() => tapHere(row.rank)}
                    // A rename clears the server's mark: the label it judged is gone. If the new
                    // one is still no good, the server refuses again and says so — it is the
                    // authority, and this screen does not re-run its rule.
                    onLabel={(value) =>
                      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, label: value, ambiguous: false } : r)))
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}

          <button type="button" className="sr-add" onClick={addByHand}>
            {ADD_BY_HAND}
          </button>

          <SeedGoalChips goals={goals} goalId={goalId} onPick={setGoalId} />

          <button
            type="button"
            className="cta sr-save"
            disabled={toWrite.length === 0 || saving || blocked.size > 0}
            onClick={save}
          >
            {saveLabel(toWrite.length)}
          </button>
          {blocked.size > 0 ? <p className="sr-fault-t sr-hold">{ambiguityNote(blocked.size)}</p> : null}
          {saveFault ? <p className="sr-fault-t sr-savefault">{saveFault}</p> : null}
        </>
      ) : null}
    </div>
  );
}
