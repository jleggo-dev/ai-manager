import { NutritionRing } from '../../nutrition/NutritionRing.tsx';
import { fmtKcal } from './mealPlate.ts';
import type { MealMacros } from '../../../lib/api.ts';

const MACRO_BARS: Array<{ key: 'protein_g' | 'carbs_g' | 'fat_g'; label: string; color: string }> = [
  { key: 'protein_g', label: 'PROTEIN', color: 'oklch(52% 0.09 152)' },
  { key: 'carbs_g', label: 'CARBS', color: 'oklch(62% 0.08 250)' },
  { key: 'fat_g', label: 'FAT', color: 'oklch(64% 0.14 268)' },
];

/**
 * Today's two-tone rings in the capture's own context — logged solid, this-meal pale, free grey —
 * all recomputing as the portion changes. Protein reads first, as it does everywhere in Cadence.
 */
export function MealCaptureRings({
  eaten,
  target,
  pendingKcal,
}: {
  eaten: MealMacros;
  target: MealMacros | null;
  pendingKcal: number;
}) {
  const eatenKcal = eaten.kcal ?? 0;
  const targetKcal = target?.kcal ?? null;
  const leftAfter = targetKcal != null ? targetKcal - eatenKcal - pendingKcal : null;

  return (
    <div className="mc-rings">
      <NutritionRing
        logged={eatenKcal}
        pending={pendingKcal}
        target={targetKcal}
        size={74}
        stroke={13}
        className="mc-ring"
      >
        {pendingKcal > 0 && leftAfter != null ? (
          <>
            <b>{fmtKcal(Math.abs(leftAfter))}</b>
            <span>{leftAfter < 0 ? 'KCAL OVER' : 'LEFT AFTER THIS'}</span>
          </>
        ) : targetKcal != null ? (
          <>
            <b>{fmtKcal(eatenKcal)}</b>
            <span>OF {fmtKcal(targetKcal)}</span>
          </>
        ) : (
          <>
            <b>{fmtKcal(eatenKcal)}</b>
            <span>SO FAR</span>
          </>
        )}
      </NutritionRing>
      <div className="mc-rings-r">
        <div className="mc-left">
          {targetKcal != null
            ? `${fmtKcal(Math.max(0, targetKcal - eatenKcal))} kcal left today`
            : `${fmtKcal(eatenKcal)} kcal so far`}
        </div>
        <div className="mc-bars">
          {MACRO_BARS.map((b) => {
            const e = eaten[b.key] ?? 0;
            const t = target?.[b.key] ?? null;
            const pct = t && t > 0 ? Math.min(100, (e / t) * 100) : 0;
            return (
              <div className="mc-bar" key={b.key}>
                <span className="mc-bar-l">{b.label}</span>
                <div className="mc-bar-track">
                  <div className="mc-bar-fill" style={{ width: `${pct}%`, background: b.color }} />
                </div>
                <span className="mc-bar-v">
                  {Math.round(e)}
                  {t != null ? ` / ${Math.round(t)}g` : 'g'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
