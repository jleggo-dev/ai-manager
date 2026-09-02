/**
 * The meal's totals and the commit (canvas 1b B2): THIS MEAL kcal, the compact macro line,
 * what's left today when targets exist — and the close button, held by exactly one thing:
 * an amount nobody has settled (MealParseCard's own gate, kept verbatim).
 */
import type { Macros, MealKind } from '@cadence/shared';
import { useNutritionDay } from '../../../lib/query/index.ts';
import { fmtKcal, macroLine } from '../bracket/copy.ts';

export function MealFooter({
  kind,
  total,
  askedCount,
  busy,
  onCloseMeal,
}: {
  kind: MealKind;
  total: Macros;
  askedCount: number;
  busy?: boolean;
  onCloseMeal: () => void;
}) {
  const { data: day } = useNutritionDay();
  const left = day?.targets?.kcal != null && day.left?.kcal != null ? Math.max(0, Math.round(day.left.kcal)) : null;
  const macros = macroLine(total);
  return (
    <div className="ms-foot">
      <div className="ms-tot">
        <b>{fmtKcal(total.kcal)}</b>
        <span className="ms-tot-k">kcal · THIS MEAL</span>
        {macros && <span className="ms-tot-m">{macros}</span>}
        {left != null && <span className="ms-tot-left">{`${left.toLocaleString('en-US')} left today`}</span>}
      </div>
      {askedCount > 0 && (
        <div className="ms-settle">
          {askedCount === 1 ? 'One amount to settle first' : `${askedCount} amounts to settle first`}
        </div>
      )}
      <button type="button" className="fa-log" disabled={busy || askedCount > 0} onClick={onCloseMeal}>
        {busy ? 'Closing…' : `Close ${kind} · ${fmtKcal(total.kcal)} kcal`}
      </button>
    </div>
  );
}
