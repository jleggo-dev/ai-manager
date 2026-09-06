import { useState } from 'react';
import { updateBaseline, recordWeighInToday } from '../../lib/api.ts';
import { useReview, useUpdateReview } from '../../lib/query/index.ts';

type Cadence = 'weekly' | 'daily';

/**
 * How often you step on the scale (A23 §2c).
 *
 * Weekly is the default and stays the default. Daily is offered because more readings make the
 * trend converge faster — and it is only safe to offer because the app shows the smoothed TREND
 * rather than the morning's number. The owner's own framing: daily is ideal, and mentally hard for
 * some people. So the copy says what it costs and what it buys, and the choice stays theirs.
 *
 * Choosing daily does not add seven tasks to the week. The plan keeps its one scheduled weigh-in;
 * this just opens a place to enter a number on the days between.
 *
 * The baseline comes off the shared review (`lib/query/useReview.ts`), which is also what the room
 * around it reads — so this row is on screen with the rest of the list instead of appearing a
 * round trip after it, and it costs no request of its own.
 */
export function WeighInSettings() {
  const [open, setOpen] = useState(false);
  const { data: review, isPending } = useReview();
  const updateReview = useUpdateReview();
  const [unitOverride, setUnitOverride] = useState<'lb' | 'kg' | null>(null);
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  /** Weekly is the default and the fallback: a review we could not read is not a reason to hide a
   *  row, only a reason not to claim they chose daily. Null ONLY while the answer is still coming
   *  — the row stays out of the list rather than flip its own sub-line a moment later. */
  const settledCadence: Cadence = review?.baseline?.weigh_in_cadence === 'daily' ? 'daily' : 'weekly';
  const cadence: Cadence | null = !review && isPending ? null : settledCadence;
  const unit = unitOverride ?? (review?.baseline?.weight_unit === 'kg' ? 'kg' : 'lb');

  if (cadence === null) return null;

  async function choose(next: Cadence) {
    // Straight into the shared review, so the choice survives closing the room and coming back —
    // and so nothing here has to hold a second copy of a fact the cache already carries.
    updateReview((r) => ({ ...r, baseline: { ...r.baseline, weigh_in_cadence: next } }));
    setNote('');
    try {
      await updateBaseline({ weigh_in_cadence: next });
    } catch {
      setNote("That didn't save — try again in a moment.");
    }
  }

  async function logToday() {
    const w = parseFloat(weight);
    if (!Number.isFinite(w) || w <= 0 || busy) return;
    setBusy(true);
    setNote('');
    try {
      await recordWeighInToday(w, unit);
      setWeight('');
      setNote("Noted — it feeds the trend, so today's number is only a part of it.");
    } catch (e) {
      // 404 is a real answer, not a failure: there is no weigh-in on their plan to attach it to.
      setNote(
        (e as { status?: number })?.status === 404
          ? "There's no weigh-in on your plan yet — add a weight goal and I'll schedule one."
          : "That didn't save — check the number and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="set-row" onClick={() => setOpen(true)}>
        <b>Weigh-ins</b>
        <span>{cadence === 'daily' ? 'Daily — you see the trend, not the day' : 'Once a week'}</span>
      </button>
    );
  }

  return (
    <div className="set-targets">
      <div className="set-targets-t">Weigh-ins</div>

      <div className="set-cadence">
        {(['weekly', 'daily'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={cadence === k ? 'set-chip set-chip-on' : 'set-chip'}
            onClick={() => void choose(k)}
          >
            {k === 'weekly' ? 'Once a week' : 'Daily'}
          </button>
        ))}
      </div>

      <p className="set-help">
        Whichever you pick, what I show you is the <b>trend</b> — never the morning&apos;s number on its own. Weighing
        daily just lets the trend settle sooner; weighing weekly is a perfectly good way to do this.
      </p>

      {cadence === 'daily' && (
        <div className="logbox" style={{ borderTop: 'none' }}>
          <div className="logbox-label">Today&apos;s weight</div>
          <div className="weigh-row">
            <input
              className="wiz-in"
              type="number"
              inputMode="decimal"
              value={weight}
              disabled={busy}
              aria-label="Today's weight"
              placeholder={unit === 'lb' ? 'e.g. 195' : 'e.g. 88.5'}
              onChange={(e) => setWeight(e.target.value)}
            />
            <button className="wiz-sel" disabled={busy} onClick={() => setUnitOverride(unit === 'lb' ? 'kg' : 'lb')}>
              {unit} ⇄
            </button>
          </div>
          <button className="logbox-btn" disabled={busy || !weight.trim()} onClick={() => void logToday()}>
            {busy ? 'Noting it down…' : 'Add it to the trend'}
          </button>
        </div>
      )}

      {note && <div className="set-help">{note}</div>}

      <div className="set-targets-actions">
        <button className="lockbtn ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}
