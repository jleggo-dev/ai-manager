import { NutritionRing } from '../nutrition/NutritionRing.tsx';
import { macroEnergyShare } from './amounts.ts';
import type { MealMacros } from '../../lib/api.ts';

const COLS: Array<{ key: 'protein_g' | 'carbs_g' | 'fat_g'; share: 'protein' | 'carbs' | 'fat'; label: string }> = [
  { key: 'protein_g', share: 'protein', label: 'PROTEIN' },
  { key: 'carbs_g', share: 'carbs', label: 'CARBS' },
  { key: 'fat_g', share: 'fat', label: 'FAT' },
];

/**
 * What one portion carries — the ring, then the three macros with the share of its energy each
 * one is. **Protein first, everywhere in Cadence** (design 05d). No target and no denominator:
 * this is what the food is, not how you are doing.
 */
export function FoodMacroCard({ macros }: { macros: MealMacros }) {
  const share = macroEnergyShare(macros);
  return (
    <div className="fd-macro">
      <NutritionRing logged={macros.kcal ?? 0} target={null} counting size={86} stroke={11} className="fd-ring">
        <b>{Math.round(macros.kcal ?? 0)}</b>
        <span>KCAL</span>
      </NutritionRing>
      <div className="fd-macro-cols">
        {COLS.map((c) => (
          <div className="fd-macro-c" key={c.key}>
            <span className={`fd-macro-p fd-macro-p-${c.share}`}>{share ? `${share[c.share]}%` : '—'}</span>
            <b>{Math.round((macros[c.key] ?? 0) * 10) / 10} g</b>
            <span className="fd-macro-l">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
