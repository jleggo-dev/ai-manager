import { useNutritionDay } from '../../lib/query/index.ts';
import { NutritionRing } from './NutritionRing.tsx';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * Food on the trail without a Food tab (design 2E). A slim card under the header carrying today's
 * nutrition: a 52px two-tone ring, what's left, and how many meals are in / still to confirm. Tapping
 * opens the "Today's food" sheet (2F). It only appears once a target exists — a day with no macro goal
 * shows nothing rather than an empty ring (design: never make the user decode an unset ring).
 */
export function TrailFoodStrip({ date, onOpen }: { date: string; onOpen: () => void }) {
  const { data: day } = useNutritionDay(date);
  const targetKcal = day?.targets?.kcal ?? null;
  if (!day || !targetKcal) return null;

  const eaten = day.totals.kcal ?? 0;
  const left = Math.max(0, targetKcal - eaten);
  const protein = Math.round(day.totals.protein_g ?? 0);
  const proteinT = day.targets?.protein_g != null ? Math.round(day.targets.protein_g) : null;
  const mealsIn = day.confirmed_count + day.provisional_count;
  const toConfirm = day.provisional_count;

  return (
    <button className="tfs" onClick={onOpen} aria-label="Open today's food">
      <NutritionRing logged={eaten} target={targetKcal} size={52} stroke={9} />
      <div className="tfs-body">
        <div className="tfs-k">FOOD SO FAR</div>
        <div className="tfs-h">
          {fmt(left)} kcal left{proteinT != null ? ` · protein ${protein} of ${proteinT}` : ''}
        </div>
        <div className="tfs-s">
          {mealsIn} meal{mealsIn === 1 ? '' : 's'} in{toConfirm > 0 ? ` · ${toConfirm} to confirm` : ''}
        </div>
      </div>
      <span className="tfs-arrow" aria-hidden>
        ›
      </span>
    </button>
  );
}
