import { useNutritionDay } from '../../lib/query/index.ts';
import { MacroBars } from './MacroBars.tsx';
import { NutritionRing } from './NutritionRing.tsx';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * Food on the trail (Food Journey 01/3B): one ring for calories, three bars for macros, the day's
 * meal count, and the chevron that makes the whole card a door to the Food home. Lives in the
 * coach bay, under Cadence's face — the 2a ruling that a per-day number belongs in the day.
 *
 * Three honest states, and the door outlives the score — the fix for the 2026-08-15 device report,
 * where gating the only entrance on a kcal target left every new user unable to reach recipes,
 * this week's meals or the shop:
 *   • scored — a kcal target exists: the ring fills (what's left in the centre), filled bars with
 *     denominators. Nothing is added when targets arrive; the same shapes gain a fill.
 *   • counting — food is active but no target: the SAME smooth ring, simply unfilled, with bare
 *     grams and — while a goal is still EARNING its target — the 7-day countdown as a footer, so
 *     the wait stays finite and visible (owner, 2026-08-18). `counting` still gates whether the
 *     strip renders at all; it no longer changes how the ring is drawn (owner, 2026-08-20).
 *   • nothing — no food signal at all (`has_recent_food` false): the bay simply ends at the face.
 *     A mind-only user never grows a calorie strip (owner ruling, PLAN §"calorie counter").
 */
export function TrailFoodStrip({ date, onOpen }: { date: string; onOpen: () => void }) {
  const { data: day } = useNutritionDay(date);
  if (!day) return null;

  const target = day.targets?.kcal ?? null;
  const scored = typeof target === 'number' && target > 0;
  const counting = !scored && (day.meals.length > 0 || !!day.targets_wait || !!day.has_recent_food);
  if (!scored && !counting) return null;

  const eaten = day.totals.kcal ?? 0;
  const left = scored ? Math.max(0, Math.round(day.left?.kcal ?? target - eaten)) : 0;
  const over = scored && eaten > target;
  const wait = !scored ? (day.targets_wait ?? null) : null;

  return (
    <button className="trail-food" onClick={onOpen} aria-label="Open your food">
      <span className="trail-food-row">
        <NutritionRing logged={eaten} target={scored ? target : null} size={52} stroke={9}>
          {scored && !over ? (
            <>
              <b>{fmt(left)}</b>
              <span>LEFT</span>
            </>
          ) : (
            <>
              <b>{fmt(eaten)}</b>
              <span>KCAL</span>
            </>
          )}
        </NutritionRing>
        <MacroBars eaten={day.totals} targets={scored ? day.targets : null} dense />
        <span className="trail-food-meals">
          <b>{day.meals.length}</b>
          <span>{day.meals.length === 1 ? 'MEAL' : 'MEALS'}</span>
        </span>
        <span className="trail-food-chev" aria-hidden>
          ›
        </span>
      </span>
      {wait && (
        <span className="trail-food-wait">
          <span className="trail-food-wait-n">
            {wait.days_logged} / {wait.days_needed}
          </span>
          <span className="trail-food-wait-k">DAYS TO YOUR CALORIE TARGET</span>
        </span>
      )}
    </button>
  );
}
