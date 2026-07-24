import { MicButton } from '../../../components/MicButton.tsx';
import type { MealKind, OccurrenceDetail } from '../../../lib/api.ts';
import { leftLine, macroLine } from './format.ts';
import { BaselineReadPanel } from './BaselineReadPanel.tsx';
import { useMealLog } from './useMealLog.ts';
import { useNutritionBaseline } from './useNutritionBaseline.ts';

/**
 * Observe-phase meal logging: text and/or photo, day totals, tap-to-confirm provisional
 * estimates, and the nested Baseline moment. Photo path is high blast-radius — keep behavior
 * identical to the pre-split sheet.
 */
export function MealLogPanel({
  detail,
  setDetail,
  onLogged,
  onProposeChange,
}: {
  detail: OccurrenceDetail;
  setDetail: (d: OccurrenceDetail) => void;
  onLogged?: () => void;
  onProposeChange?: (steer: string) => void;
}) {
  const meal = useMealLog(detail, setDetail, onLogged);
  const baseline = useNutritionBaseline(meal.refreshDay, detail.date);

  return (
    <div className="logbox" style={{ borderTop: 'none', paddingTop: 0 }}>
      <div className="logbox-label">{"What did you eat? Say it or snap it — I'll read what I can."}</div>
      {meal.day && (meal.day.confirmed_count > 0 || meal.day.provisional_count > 0) && (
        <div className="day-totals">
          <b>Today{macroLine(meal.day.totals) ? `: ${macroLine(meal.day.totals)}` : ''}</b>
          {meal.day.provisional_count > 0 && (
            <span className="day-totals-prov">
              {meal.day.provisional_totals.kcal
                ? ` + ~${meal.day.provisional_totals.kcal} kcal`
                : ` + ${meal.day.provisional_count} meal${meal.day.provisional_count === 1 ? '' : 's'}`}{' '}
              unconfirmed
            </span>
          )}
          {leftLine(meal.day.left) && <div className="day-left">{leftLine(meal.day.left)}</div>}
        </div>
      )}
      {meal.meals.length > 0 && (
        <div className="meal-list">
          {meal.meals.map((m) => (
            <div className={`meal-item${m.provisional ? ' meal-prov' : ''}`} key={m.log_id}>
              <span className="meal-kind">{m.meal}</span>
              {m.photo_url && <img className="meal-thumb" src={m.photo_url} alt="" loading="lazy" />}
              <span className="meal-what">
                {m.items.map((i) => i.name).join(', ') || m.raw_text || (m.photo_url ? '📷 photo' : '')}
                {macroLine(m.macros) && <span className="meal-est"> · {macroLine(m.macros)}</span>}
              </span>
              {m.provisional && (
                <button
                  className="meal-confirm"
                  onClick={() => meal.confirmMeal(m.log_id)}
                  disabled={meal.confirming === m.log_id}
                  title="Looks right — count it"
                  aria-label="Confirm this meal's estimates"
                >
                  {meal.confirming === m.log_id ? '…' : '✓'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="steer-row">
        <textarea
          className="logbox-in"
          value={meal.mealText}
          onChange={(e) => meal.setMealText(e.target.value)}
          placeholder={'e.g. "two eggs, sourdough toast and a coffee" — or just snap it'}
          rows={2}
          disabled={meal.mealBusy}
        />
        <MicButton value={meal.mealText} onChange={meal.setMealText} disabled={meal.mealBusy} />
        {/* capture="environment" opens the rear camera on phones; a file picker on desktop. */}
        <label
          className={`photo-btn${meal.mealPhoto ? ' photo-on' : ''}`}
          title="Snap your plate"
          aria-label="Add a photo"
        >
          📷
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            disabled={meal.mealBusy}
            onChange={(e) => {
              void meal.pickPhoto(e.target.files?.[0]);
              e.target.value = ''; // same photo re-pickable
            }}
          />
        </label>
      </div>
      {meal.mealPhoto && (
        <div className="photo-preview">
          <img src={meal.mealPhoto} alt="your plate" />
          <button className="photo-clear" onClick={meal.clearPhoto} disabled={meal.mealBusy} aria-label="Remove photo">
            ×
          </button>
          <span className="photo-hint">
            {"I'll read what I can from the photo — estimates, not judgments. A few words help."}
          </span>
        </div>
      )}
      {meal.mealPhoto && (
        <div className="plate-advice-row">
          {!meal.plateAdvice ? (
            <button
              className="plate-check-btn"
              onClick={meal.checkPlate}
              disabled={meal.advising || meal.mealBusy}
              title="A quick pre-eat read before you dig in"
            >
              {meal.advising ? 'Looking at your plate…' : '🔎 Check my plate first'}
            </button>
          ) : (
            <div className={`plate-advice pa-${meal.plateAdvice.verdict}`}>
              <span className="pa-text">{meal.plateAdvice.advice}</span>
              {meal.plateAdvice.estimate_kcal != null && (
                <span className="pa-est">~{meal.plateAdvice.estimate_kcal} kcal</span>
              )}
            </div>
          )}
        </div>
      )}
      <div className="weigh-row">
        <select
          className="wiz-sel"
          value={meal.mealKind}
          onChange={(e) => meal.setMealKind(e.target.value as MealKind)}
          disabled={meal.mealBusy}
        >
          <option value="breakfast">breakfast</option>
          <option value="lunch">lunch</option>
          <option value="dinner">dinner</option>
          <option value="snack">snack</option>
          <option value="drink">drink</option>
          <option value="other">other</option>
        </select>
        <button
          className="logbox-btn meal-btn"
          onClick={meal.submitMeal}
          disabled={meal.mealBusy || (!meal.mealText.trim() && !meal.mealPhoto)}
        >
          {meal.mealBusy ? 'Writing it down…' : 'Log this meal'}
        </button>
      </div>
      {meal.logErr && <div className="auth-error">{meal.logErr}</div>}

      <BaselineReadPanel
        daysLogged={meal.daysLogged}
        baseline={baseline.baseline}
        baselineBusy={baseline.baselineBusy}
        targetsBusy={baseline.targetsBusy}
        targetsSet={baseline.targetsSet}
        err={baseline.err}
        onFetch={baseline.fetchBaseline}
        onApplyTargets={baseline.applyTargets}
        onProposeChange={onProposeChange}
      />
    </div>
  );
}
