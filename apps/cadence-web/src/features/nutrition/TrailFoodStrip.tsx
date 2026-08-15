import { useNutritionDay } from '../../lib/query/index.ts';
import { NutritionRing } from './NutritionRing.tsx';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * Food on the trail without a Food tab (design 2E). A slim card under the header carrying today's
 * nutrition: a 52px two-tone ring, what's left, and how many meals are in / still to confirm.
 * Tapping opens the "Today's food" sheet (2F).
 *
 * **It renders WITHOUT a target now, and that is the whole point.** It used to return null until a
 * kcal target existed — "never make the user decode an unset ring", which is a good instinct that
 * became a trap. This strip is the ONLY door to the Today's-food sheet, and that sheet is where
 * Recipes, This week's meals and The shop moved when the Food tab was dropped. So a user with no
 * targets — which is EVERY new user, targets being something the coach proposes later — could not
 * reach any of it. The entrance was gated on the thing the entrance leads to. Observed on device
 * 2026-08-15: "Still no place to add recipes or log recipes or ask for help planning my week."
 *
 * The unset case gets its own honest copy rather than an empty ring: what they have eaten so far,
 * and the offer that the targets conversation is a tap away. The deeper IA question — where
 * "manage nutrition" should permanently live — is with design (docs/cadence/DESIGN-BRIEF-nutrition.md);
 * this only guarantees the module is reachable in the meantime.
 */
export function TrailFoodStrip({ date, onOpen }: { date: string; onOpen: () => void }) {
  const { data: day } = useNutritionDay(date);
  if (!day) return null;

  const targetKcal = day.targets?.kcal ?? null;
  const eaten = day.totals.kcal ?? 0;
  const protein = Math.round(day.totals.protein_g ?? 0);
  const proteinT = day.targets?.protein_g != null ? Math.round(day.targets.protein_g) : null;
  const mealsIn = day.confirmed_count + day.provisional_count;
  const toConfirm = day.provisional_count;

  // No target yet: count what happened, promise nothing, and say what tapping does.
  const headline =
    targetKcal != null
      ? `${fmt(Math.max(0, targetKcal - eaten))} kcal left${proteinT != null ? ` · protein ${protein} of ${proteinT}` : ''}`
      : mealsIn > 0
        ? `${fmt(eaten)} kcal so far · protein ${protein}g`
        : 'Recipes, your week, and what to aim for';

  const sub =
    mealsIn > 0
      ? `${mealsIn} meal${mealsIn === 1 ? '' : 's'} in${toConfirm > 0 ? ` · ${toConfirm} to confirm` : ''}`
      : 'Nothing logged yet today';

  return (
    <button className="tfs" onClick={onOpen} aria-label="Open today's food">
      <NutritionRing logged={eaten} target={targetKcal} size={52} stroke={9} />
      <div className="tfs-body">
        <div className="tfs-k">FOOD SO FAR</div>
        <div className="tfs-h">{headline}</div>
        <div className="tfs-s">{sub}</div>
      </div>
      <span className="tfs-arrow" aria-hidden>
        ›
      </span>
    </button>
  );
}
