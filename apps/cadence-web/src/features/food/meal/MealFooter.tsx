/**
 * The meal's totals and the commit (canvas 1b B2): THIS MEAL kcal and the compact macro line —
 * the one place the foods are all together, so the one place a total belongs (owner,
 * 2026-09-07) — and the button, held by exactly one thing: an amount nobody has settled
 * (MealParseCard's own gate, kept verbatim).
 *
 * The button says what it does. "Close breakfast" named the window's mechanics; nobody closes a
 * breakfast, they log one. And "N left today" is gone from here: it was the day's number keyed
 * to TODAY even while logging yesterday's missed meal, and the rings above already carry it.
 *
 * Once logged, the meal is still open to adds (they count as they land), so the footer's only
 * job is the totals and a way out.
 */
import type { Macros, MealKind } from '@cadence/shared';
import { fmtKcal, macroLine } from '../bracket/copy.ts';

export function MealFooter({
  kind,
  total,
  askedCount,
  logged,
  busy,
  onLog,
  onDone,
}: {
  kind: MealKind;
  total: Macros;
  askedCount: number;
  logged: boolean;
  busy?: boolean;
  onLog: () => void;
  onDone: () => void;
}) {
  const macros = macroLine(total);
  return (
    <div className="ms-foot">
      <div className="ms-tot">
        <b>{fmtKcal(total.kcal)}</b>
        <span className="ms-tot-k">kcal · THIS MEAL</span>
        {macros && <span className="ms-tot-m">{macros}</span>}
      </div>
      {askedCount > 0 && (
        <div className="ms-settle">
          {askedCount === 1 ? 'One amount to settle first' : `${askedCount} amounts to settle first`}
        </div>
      )}
      {logged ? (
        <button type="button" className="fa-log" disabled={busy} onClick={onDone}>
          Done
        </button>
      ) : (
        <button type="button" className="fa-log" disabled={busy || askedCount > 0} onClick={onLog}>
          {busy ? 'Logging…' : `Log ${kind} · ${fmtKcal(total.kcal)} kcal`}
        </button>
      )}
    </div>
  );
}
