import { useState } from 'react';
import { recordWeighIn, type OccurrenceDetail } from '../../../lib/api.ts';
import { useInvalidateNutritionDay } from '../../../lib/query/index.ts';

/**
 * Deterministic weigh-in capture — no LLM. Marks the occurrence done with a summary chip.
 * Invalidates nutrition-day after success so shared dashboard caches stay aligned with other
 * observe-phase mutations (CROSS-03), even though weigh-in itself does not mutate meals.
 */
export function WeighInPanel({
  detail,
  setDetail,
  onLogged,
}: {
  detail: OccurrenceDetail;
  setDetail: (d: OccurrenceDetail) => void;
  onLogged?: () => void;
}) {
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<'lb' | 'kg'>('lb');
  const [logBusy, setLogBusy] = useState(false);
  const [logErr, setLogErr] = useState('');
  const invalidateNutritionDay = useInvalidateNutritionDay();

  async function submitWeighIn() {
    const w = parseFloat(weight);
    if (!Number.isFinite(w) || w <= 0 || logBusy) return;
    setLogBusy(true);
    setLogErr('');
    try {
      await recordWeighIn(detail.occurrence_id, w, weightUnit);
      const shown = `${w} ${weightUnit}`;
      setDetail({
        ...detail,
        status: 'done',
        log: { items: [], summary: `Weighed in at ${shown}.`, raw_text: shown, logged_at: new Date().toISOString() },
      });
      await invalidateNutritionDay();
      onLogged?.();
    } catch {
      setLogErr("That didn't save — check the number and try again.");
    } finally {
      setLogBusy(false);
    }
  }

  return (
    <div className="logbox" style={{ borderTop: 'none', paddingTop: 0 }}>
      <div className="logbox-label">What's the scale saying today?</div>
      <div className="weigh-row">
        <input
          className="wiz-in"
          type="number"
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder={weightUnit === 'lb' ? 'e.g. 195' : 'e.g. 88.5'}
          disabled={logBusy}
        />
        <button className="wiz-sel" onClick={() => setWeightUnit(weightUnit === 'lb' ? 'kg' : 'lb')} disabled={logBusy}>
          {weightUnit} ⇄
        </button>
      </div>
      {logErr && <div className="auth-error">{logErr}</div>}
      <button className="logbox-btn" onClick={submitWeighIn} disabled={logBusy || !weight.trim()}>
        {logBusy ? 'Noting it down…' : 'Log it — done ✓'}
      </button>
    </div>
  );
}
