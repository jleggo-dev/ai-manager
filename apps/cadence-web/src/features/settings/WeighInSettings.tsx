import { useEffect, useState } from 'react';
import { getReview, updateBaseline, recordWeighInToday } from '../../lib/api.ts';

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
 */
export function WeighInSettings() {
  const [open, setOpen] = useState(false);
  const [cadence, setCadence] = useState<Cadence | null>(null);
  const [unit, setUnit] = useState<'lb' | 'kg'>('lb');
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const r = await getReview();
        setCadence(r.baseline?.weigh_in_cadence ?? 'weekly');
        if (r.baseline?.weight_unit === 'kg') setUnit('kg');
      } catch {
        setCadence('weekly');
      }
    })();
  }, []);

  if (cadence === null) return null;

  async function choose(next: Cadence) {
    setCadence(next);
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
            <button className="wiz-sel" disabled={busy} onClick={() => setUnit(unit === 'lb' ? 'kg' : 'lb')}>
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
