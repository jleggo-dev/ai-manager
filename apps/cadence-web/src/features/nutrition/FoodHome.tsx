import { useEffect, useState } from 'react';
import { getCurrentMealPlan, getRecentMeals, listRecipes, patchMeal, type Meal } from '../../lib/api.ts';
import { localTodayIso, useInvalidateNutritionDay, useNutritionDay } from '../../lib/query/index.ts';
import type { MealKind } from '@cadence/shared';
import { LogScreen } from '../food/LogScreen.tsx';
import { FoodDay } from './FoodDay.tsx';
import { FoodKitchen } from './FoodKitchen.tsx';
import { FoodSubSheet } from './FoodSubSheet.tsx';
import { FoodWeek } from './FoodWeek.tsx';
import { NutrientsPanel } from './NutrientsPanel.tsx';
import { buildWeek } from './foodWeekModel.ts';
import type { FoodHomeSub } from './foodHomeSub.ts';

export type { FoodHomeSub } from './foodHomeSub.ts';

/** Sun-start week of local dates around today, for the Day tab's dot row (frame 02 draws it S–S). */
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

/** "Sat 15 Aug" — the date pill's own words once you have navigated off today. */
function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The Food screen (Food Journey 02 + 08/08b/09) — a real full screen, not a sheet: the permanent
 * manage-nutrition surface, reachable from the trail strip in every state.
 *
 * This file is the shell and nothing else: which tab, which day, which sheet. The three reads each
 * own a file — `FoodDay` (what's left, the day's parts, water), `FoodWeek` (averages then every
 * day), `NutrientsPanel` (the eight micronutrients) — because each is a major section and a screen
 * that hosts three reads has no business also drawing them.
 *
 * Day and Week are one surface with two tabs and no new navigation, per 08b. Nutrients is a
 * drill-down off the macro block rather than a third tab, per 09: it answers a question you only
 * ask once the day's read has raised it.
 *
 * One chart language: a ring for calories, bars for macros — unfilled while counting (no target),
 * denominators once targets exist. Nothing is added when they arrive; the same shapes fill in.
 * The ring's track is always smooth: "no target yet" is said by the line under it, never by
 * breaking the ring into a crenulated one (owner, 2026-08-20).
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
  const [date, setDate] = useState(today);
  const [tab, setTab] = useState<'day' | 'week' | 'kitchen'>('day');
  const [nutrients, setNutrients] = useState(false);
  /** The full-screen Log (05b), opened by "Log a meal" or an empty meal slot. */
  const [logMeal, setLogMeal] = useState<MealKind | 'any' | null>(null);
  // `isPending` is react-query's "no answer yet, first fetch in flight" — it is what tells FoodDay
  // to hold bars where the numbers go instead of settled zeroes (PERF-06). The header, the day
  // dots, the tabs and every door below paint immediately either way: none of them read the day.
  const { data: day = null, isPending: dayPending, refetch } = useNutritionDay(date);
  const invalidate = useInvalidateNutritionDay();
  const [sub, setSub] = useState<FoodHomeSub>(initialSub);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [recent, setRecent] = useState<Meal[]>([]);
  const [hasWeek, setHasWeek] = useState(false);
  const [recipeCount, setRecipeCount] = useState<number | null>(null);
  /** Mirrors the day's water so a tap moves the row now; tagged with its date so it cannot leak
   *  onto another day when you navigate off today and back. */
  const [water, setWater] = useState<{ date: string; ml: number } | null>(null);

  useEffect(() => {
    let alive = true;
    // Eight days, not seven: the Mon–Sun week and the Sun-start dot row each reach up to six days
    // back, and a window that stops one short would silently blank a Monday.
    getRecentMeals(8)
      .then((meals: Meal[]) => alive && setRecent(meals))
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

  /** A correction rewrote the meal server-side — re-read rather than patch state by hand. */
  async function onCorrected() {
    await invalidate();
    await refetch();
    onLogged?.();
  }

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

  const isToday = date === today;
  const week = buildWeek(today, recent);
  const loggedDates = new Set(recent.map((m) => m.date));
  const cookbookTail = recipeCount == null ? '' : recipeCount === 0 ? ' · nothing saved yet' : ` · ${recipeCount}`;

  if (logMeal) {
    return (
      <LogScreen
        date={date}
        initialMeal={logMeal === 'any' ? 'breakfast' : logMeal}
        onClose={() => setLogMeal(null)}
        onLogged={() => {
          void invalidate();
          onLogged?.();
        }}
      />
    );
  }

  if (nutrients) {
    return (
      <NutrientsPanel
        dateLabel={isToday ? 'Today' : dayLabel(date)}
        dayTotals={day?.totals ?? {}}
        dayMeals={day?.meals ?? []}
        week={{ avg: week.avg, meals: recent, days: week.avgDays }}
        onBack={() => setNutrients(false)}
        onCoach={onCoach}
      />
    );
  }

  return (
    <div className="fh" role="region" aria-label="Food">
      <div className="fh-head">
        <button className="fh-back" onClick={onBack} aria-label="Back to your day">
          ‹
        </button>
        <b className="fh-title">Food</b>
        {/* The date pill steers the two READING tabs. The Kitchen is about a week ahead, not a day
            behind, so it does not carry one. */}
        {tab === 'kitchen' ? null : isToday ? (
          <span className="fh-daypill">Today</span>
        ) : (
          <button className="fh-daypill is-btn" onClick={() => setDate(today)}>
            {dayLabel(date)} <i aria-hidden>×</i>
          </button>
        )}
      </div>

      <div className="fh-seg" role="tablist" aria-label="Food range">
        <button
          role="tab"
          aria-selected={tab === 'day'}
          className={tab === 'day' ? 'is-on' : ''}
          onClick={() => setTab('day')}
        >
          Day
        </button>
        <button
          role="tab"
          aria-selected={tab === 'week'}
          className={tab === 'week' ? 'is-on' : ''}
          onClick={() => setTab('week')}
        >
          Week
        </button>
        <button
          role="tab"
          aria-selected={tab === 'kitchen'}
          className={tab === 'kitchen' ? 'is-on' : ''}
          onClick={() => setTab('kitchen')}
        >
          Kitchen
        </button>
      </div>

      <div className="fh-body">
        {tab === 'kitchen' ? (
          <FoodKitchen targetKcal={day?.targets?.kcal ?? null} />
        ) : tab === 'week' ? (
          <FoodWeek
            today={today}
            meals={recent}
            targets={day?.targets ?? null}
            onOpenDay={(d) => {
              setDate(d);
              setTab('day');
            }}
          />
        ) : (
          <FoodDay
            day={day}
            pending={!day && dayPending}
            isToday={isToday}
            weekDates={weekDates(today)}
            loggedDates={loggedDates}
            hasWeek={hasWeek}
            cookbookTail={cookbookTail}
            confirming={confirming}
            onConfirm={onConfirm}
            onCorrected={onCorrected}
            onCoach={onCoach}
            onLog={(meal) => setLogMeal(meal ?? 'any')}
            onSub={setSub}
            onNutrients={() => setNutrients(true)}
            waterMl={water?.date === date ? water.ml : null}
            onWater={(ml) => setWater({ date, ml })}
          />
        )}
      </div>

      {sub && (
        <FoodSubSheet
          sub={sub}
          onClose={() => setSub(null)}
          onOpen={setSub}
          onLogged={() => {
            void invalidate();
            void refetch();
            onLogged?.();
          }}
        />
      )}
    </div>
  );
}
