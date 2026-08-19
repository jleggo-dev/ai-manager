import { useNutritionDay } from '../../lib/query/index.ts';
import { NutritionRing } from './NutritionRing.tsx';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * Today's calories, in the day rather than in the chrome (Plan redesign 2a).
 *
 * The count is a per-day number, so it belongs in the day: a white card in the coach bay, under
 * Cadence's face, reading `1,150 / 1,500 · CALORIES` over the real two-tone {@link NutritionRing}
 * at 30px. The bay now reads top to bottom — her line, her face, your number — and tapping the
 * card opens the Today's-food sheet, which is the door `TrailFoodStrip` used to be. Same
 * destination, no header height and no card of its own.
 *
 * **Only for someone tracking.** No kcal target → no card, and the bay simply ends at the face;
 * there is no empty ring and no "set a target" stub, because a number nobody asked for is worse
 * than no number. The gate is the same one the food module has always used — an ACTUAL kcal value,
 * never the truthiness of `targets`, since the API returns `{}` (truthy, and empty) for a user who
 * has never set any (see `TodayDashboard`, which gates its nutrition card on a real macro for
 * exactly this reason).
 *
 * **What this card is not.** `TrailFoodStrip` deliberately rendered WITHOUT a target because it
 * was the only door to the food sheet, and gating the entrance on the thing the entrance leads to
 * left every new user unable to reach Recipes, This week's meals or The shop (device report,
 * 2026-08-15). This card cannot inherit that job: 2a makes it a *readout* of a number, so it has
 * nothing honest to show a user with no targets. Whoever gives the untargeted user a door back
 * into the food sheet has to put it somewhere the tracking gate does not reach.
 */
export function TrailCalorieCard({ date, onOpen }: { date: string; onOpen: () => void }) {
  const { data: day } = useNutritionDay(date);
  const target = day?.targets?.kcal ?? null;

  /**
   * Tracking, but the target is still being earned: the baseline flow will not propose a calorie
   * number until 7 distinct days are logged, and that wait used to be invisible — a committed
   * "Lose weight" with no target, no explanation, no path (owner, 2026-08-18). The countdown makes
   * the absence finite and the ring's arrival earned. Same slot, same door to the food sheet.
   */
  if (day && (target == null || target <= 0) && day.targets_wait) {
    const w = day.targets_wait;
    return (
      <button className="trail-cal" onClick={onOpen} aria-label="Open today's food">
        <span className="trail-cal-body">
          <span className="trail-cal-n">
            {w.days_logged} / {w.days_needed}
          </span>
          <span className="trail-cal-k">DAYS TO YOUR CALORIE TARGET</span>
        </span>
      </button>
    );
  }
  if (!day || target == null || target <= 0) return null;

  const eaten = day.totals.kcal ?? 0;

  return (
    <button className="trail-cal" onClick={onOpen} aria-label="Open today's food">
      <NutritionRing logged={eaten} target={target} size={30} stroke={5} />
      <span className="trail-cal-body">
        <span className="trail-cal-n">
          {fmt(eaten)} / {fmt(target)}
        </span>
        <span className="trail-cal-k">CALORIES</span>
      </span>
    </button>
  );
}
