import { useEffect, useState } from 'react';
import { getCurrentMealPlan, getRecentMeals, listRecipes, patchMeal, type Meal, type MealKind } from '../../lib/api.ts';
import { localTodayIso, useInvalidateNutritionDay, useNutritionDay } from '../../lib/query/index.ts';
import { RecipesPanel } from '../food/RecipesPanel.tsx';
import { MealPlansPanel } from '../food/MealPlansPanel.tsx';
import { FoodDiary } from './FoodDiary.tsx';
import { MacroBars } from './MacroBars.tsx';
import { NutritionInsightCard } from './NutritionInsightCard.tsx';
import { NutritionRing } from './NutritionRing.tsx';
import { ShopSheet } from './ShopSheet.tsx';
import { WeekMenuSheet } from './WeekMenuSheet.tsx';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export type FoodHomeSub = 'week' | 'shop' | 'cookbook' | 'plan' | null;

/** Sun-start week of local dates around today, for the dots row. */
function weekDates(todayIso: string): string[] {
  const [y, m, d] = todayIso.split('-').map(Number);
  const today = new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1);
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  });
}

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** She takes the meal in words; the confirm card does the saving (nothing counts until a tap). */
function logNote(meal?: MealKind): string {
  const where = meal ? `Log on ${meal}` : 'Log a meal';
  return (
    `They tapped "${where}" on their Food home and switched to you to say what they ate. ` +
    'Open on that — take the meal in their own words, one line is enough; the confirm card does ' +
    'the saving. Keep any amount they state; ask plainly when one is missing rather than guessing.'
  );
}

const TALK_NOTE =
  'They opened "Talk food with me" from their Food home. Open on food with the doors on offer: ' +
  'anything to work around (allergies first — they change every suggestion after), calorie and ' +
  'macro targets, or how the week of eating is going. Read what is on file before asking them to ' +
  'repeat it (get_nutrition; the dietary profile is in your dossier). If they name allergies or ' +
  'foods to avoid, say plainly what you will work around and let the confirm card do the saving. ' +
  'Medical needs stay with professionals — you are not one.';

/**
 * The Food home (Food Journey 02/3D) — a real full screen, not a sheet: the permanent
 * manage-nutrition surface the 2026-08-15 device report asked for, reachable from the trail
 * strip in every state. Today first (dots, ring + bars, today's slots), then the doors — and
 * the doors are EARNED: This week and Shopping appear once a week has been planned; the
 * Cookbook stays, empty but reachable, because it is where her recipes will live.
 *
 * One chart language: a ring for calories, bars for macros — dashed while counting (no target),
 * denominators once targets exist. Nothing is added when they arrive; the same shapes fill in.
 */
export function FoodHome({
  initialSub = null,
  onBack,
  onCoach,
  onLogged,
}: {
  initialSub?: FoodHomeSub;
  onBack: () => void;
  /** Hand the conversation to the coach with app-authored context she reads and the user never sees. */
  onCoach: (note: string) => void;
  onLogged?: () => void;
}) {
  const today = localTodayIso();
  const { data: day = null, refetch } = useNutritionDay();
  const invalidate = useInvalidateNutritionDay();
  const [sub, setSub] = useState<FoodHomeSub>(initialSub);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [loggedDates, setLoggedDates] = useState<Set<string>>(new Set());
  const [hasWeek, setHasWeek] = useState(false);
  const [recipeCount, setRecipeCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    getRecentMeals(7)
      .then((meals: Meal[]) => alive && setLoggedDates(new Set(meals.map((m) => m.date))))
      .catch(() => {});
    getCurrentMealPlan()
      .then((r) => alive && setHasWeek(r.status === 'ok' && !!r.plan))
      .catch(() => {});
    listRecipes()
      .then((r) => alive && setRecipeCount(r.status === 'ok' ? r.recipes.length : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function onConfirm(logId: string) {
    if (confirming) return;
    setConfirming(logId);
    try {
      await patchMeal(logId, { confirm: true });
      await invalidate();
      await refetch();
      onLogged?.();
    } finally {
      setConfirming(null);
    }
  }

  const targetKcal = day?.targets?.kcal ?? null;
  const scored = typeof targetKcal === 'number' && targetKcal > 0;
  const eaten = day?.totals.kcal ?? 0;
  const left = scored ? Math.max(0, Math.round(day?.left?.kcal ?? targetKcal - eaten)) : 0;
  const over = scored && eaten > targetKcal;
  const wait = !scored ? (day?.targets_wait ?? null) : null;
  const week = weekDates(today);
  const cookbookTail = recipeCount == null ? '' : recipeCount === 0 ? ' · nothing saved yet' : ` · ${recipeCount}`;

  return (
    <div className="fh" role="region" aria-label="Food">
      <div className="fh-head">
        <button className="fh-back" onClick={onBack} aria-label="Back to your day">
          ‹
        </button>
        <b className="fh-title">Food</b>
        <span className="fh-daypill">Today</span>
      </div>
      <div className="fh-body">
        <div className="fh-dots">
          {week.map((date, i) => {
            const isToday = date === today;
            const logged = loggedDates.has(date) || (isToday && (day?.meals.length ?? 0) > 0);
            return (
              <span className="fh-dot-col" key={date}>
                <span className="fh-dot-l">{DOW[i]}</span>
                {isToday ? (
                  <span className="fh-dot is-today">{Number(date.slice(8))}</span>
                ) : logged ? (
                  <span className="fh-dot is-logged" aria-label={`${date} — logged`}>
                    ✓
                  </span>
                ) : (
                  <span className="fh-dot" />
                )}
              </span>
            );
          })}
        </div>

        <div className="fh-card">
          <div className="fh-card-row">
            <div className="fh-ringcol">
              <NutritionRing logged={eaten} target={scored ? targetKcal : null} counting size={112} stroke={12}>
                {scored && !over ? (
                  <>
                    <b>{fmt(left)}</b>
                    <span>KCAL LEFT</span>
                  </>
                ) : (
                  <>
                    <b>{fmt(eaten)}</b>
                    <span>KCAL EATEN</span>
                  </>
                )}
              </NutritionRing>
              <span className="fh-ring-sub">
                {scored ? (
                  `${fmt(eaten)} of ${fmt(targetKcal)} kcal`
                ) : wait ? (
                  <>
                    {wait.days_logged} / {wait.days_needed} · days to your calorie target
                  </>
                ) : (
                  'no target yet'
                )}
              </span>
            </div>
            <div className="fh-barscol">
              <MacroBars eaten={day?.totals ?? {}} targets={scored ? (day?.targets ?? null) : null} />
            </div>
          </div>
        </div>

        <NutritionInsightCard compact />

        <button className="fh-log" onClick={() => onCoach(logNote())}>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.1"
            strokeLinecap="round"
            aria-hidden
          >
            <rect x="2.8" y="6.5" width="18.4" height="13" rx="3" />
            <circle cx="12" cy="13" r="3.6" />
            <path d="M8.5 6.5 9.8 4.2h4.4l1.3 2.3" />
          </svg>
          <span>Log a meal</span>
          <i aria-hidden>›</i>
        </button>

        {hasWeek ? (
          <div className="fh-standing">
            <button className="fh-pill" onClick={() => setSub('week')}>
              This week
            </button>
            <button className="fh-pill" onClick={() => setSub('shop')}>
              Shopping
            </button>
            <button className="fh-pill" onClick={() => setSub('cookbook')}>
              Cookbook
            </button>
          </div>
        ) : (
          <button className="fh-pill fh-pill-wide" onClick={() => setSub('cookbook')}>
            Cookbook{cookbookTail}
          </button>
        )}

        <button className="fh-door" onClick={() => setSub('plan')}>
          <span className="fh-door-t">
            <b>Plan your meals</b>
            <span>a week of dinners, a recipe, or a photo of your fridge</span>
          </span>
          <i aria-hidden>›</i>
        </button>
        <button className="fh-door" onClick={() => onCoach(TALK_NOTE)}>
          <span className="fh-door-t">
            <b>Talk food with me</b>
            <span>targets, allergies, how the week is going</span>
          </span>
          <i aria-hidden>›</i>
        </button>

        <FoodDiary day={day} confirming={confirming} onConfirm={onConfirm} onLog={(meal) => onCoach(logNote(meal))} />
      </div>

      {sub && (
        <>
          <div className="sheet-scrim" onClick={() => setSub(null)} aria-hidden />
          <div className="sheet tf" role="dialog" aria-label="Food tools">
            <div className="sheet-grab" aria-hidden />
            <div className="tf-sub">
              {sub === 'shop' ? (
                <ShopSheet onClose={() => setSub(null)} />
              ) : sub === 'week' ? (
                <WeekMenuSheet onOpenShop={() => setSub('shop')} onClose={() => setSub(null)} />
              ) : sub === 'plan' ? (
                <MealPlansPanel onClose={() => setSub(null)} />
              ) : (
                <RecipesPanel
                  onClose={() => setSub(null)}
                  onLogged={() => {
                    void invalidate();
                    void refetch();
                    onLogged?.();
                  }}
                  onOpenMealPlans={() => setSub('plan')}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
