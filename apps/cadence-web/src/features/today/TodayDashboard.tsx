import { useEffect, useState } from 'react';
import type { ProgressData } from '@cadence/shared';
import { MacroRings, DotRow } from '../../components/viz.tsx';
import { OccurrenceRow } from '../../components/OccurrenceRow.tsx';
import { ProgressCardView, ProgressTrendCard } from '../../components/ProgressCards.tsx';
import { isFoodTitle } from '../../components/occurrence-mod.ts';
import { rankProgressCard } from './rank.ts';
import { useGoalEventAdd } from './useGoalEventAdd.ts';
import { useNutritionDay, useInvalidateNutritionDay } from '../../lib/query/index.ts';
import {
  getProgress,
  getRecentMeals,
  setEatbackPct,
  type PlanViewData,
  type PlanOccurrence,
  type PlanDay,
} from '../../lib/api.ts';

/**
 * The Visual Today — a module dashboard, not a week list. STABLE CHROME, VARIABLE CONTENT: every
 * card is gated by (area, goal type, data presence), so a books-and-prayer user never sees a
 * macro ring and a runner-with-food sees rings + a consistency ring but no reading bar. Composed
 * ENTIRELY client-side from /plan (passed in) + /progress + /nutrition/day — no LLM, no new
 * aggregate endpoint (S6). Shared card/row renderers live in components/ (WEB-04). Nutrition day
 * comes from the shared TanStack query (CROSS-03); progress still refreshes via `reloadKey`.
 */

export function TodayDashboard({
  plan,
  reloadKey,
  onCheck,
  onOpen,
}: {
  plan: PlanViewData;
  reloadKey: number;
  onCheck: (o: PlanOccurrence, status: 'pending' | 'done' | 'skipped') => void;
  onOpen: (occId: string) => void;
}) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [recentDays, setRecentDays] = useState(0);
  const { data: nutrition = null } = useNutritionDay();
  const invalidateDay = useInvalidateNutritionDay();

  const refreshProgress = () =>
    getProgress()
      .then(setProgress)
      .catch(() => {});

  const add = useGoalEventAdd(refreshProgress);

  useEffect(() => {
    getProgress()
      .then(setProgress)
      .catch(() => setProgress({ cards: [], trends: [], history: [] }));
    getRecentMeals(7)
      .then((ms) => setRecentDays(new Set(ms.map((m) => m.date)).size))
      .catch(() => {});
  }, [reloadKey]);

  const today = plan.week.find((d) => d.isToday);
  const todaysOccs = today?.occurrences ?? [];
  const nextUp = plan.week
    .filter((d) => !d.isToday)
    .flatMap((d) => d.occurrences.filter((o) => o.status === 'pending').map((o) => ({ o, d })))[0] as
    { o: PlanOccurrence; d: PlanDay } | undefined;

  const cards = [...(progress?.cards ?? [])].sort((a, b) => rankProgressCard(a) - rankProgressCard(b));
  const trends = progress?.trends ?? [];

  const todayFoodOcc = todaysOccs.find((o) => isFoodTitle(o.title));
  const hasFoodInPlan = plan.week.some((d) => d.occurrences.some((o) => isFoodTitle(o.title)));
  // The API returns `{}` (not null) for an unset user, and `{}` is truthy — so gate on an
  // ACTUAL macro value. No real target → the observe card, never empty "0g left" rings.
  const targets =
    nutrition?.targets &&
    (nutrition.targets.kcal || nutrition.targets.protein_g || nutrition.targets.carbs_g || nutrition.targets.fat_g)
      ? nutrition.targets
      : null;
  const nutritionEngaged = !!nutrition && (!!targets || nutrition.meals.length > 0 || recentDays > 0 || hasFoodInPlan);

  return (
    <>
      {/* 1 — Today's rhythm: the anchor card, always first. */}
      <div className="prog-card dash-rhythm">
        <div className="dash-h">
          <b>{"Today's rhythm"}</b>
          <span>{today ? `${today.weekday} ${today.dayNum}` : ''}</span>
        </div>
        {todaysOccs.length === 0 ? (
          <div className="pd-empty">{"Your day's clear — rest counts too."}</div>
        ) : (
          todaysOccs.map((o) => (
            <OccurrenceRow key={o.occurrence_id} o={o} variant="dashboard" onCheck={onCheck} onOpen={onOpen} />
          ))
        )}
        {nextUp && (
          <div className="dash-next">
            Next up · <b>{nextUp.o.title}</b> · {nextUp.d.weekday}
          </div>
        )}
      </div>

      {/* 2 — Nutrition: macro rings once targets exist, else the observe card. */}
      {nutritionEngaged && nutrition && (
        <div className="prog-card">
          <div className="dash-h">
            <b>Nutrition</b>
            <span>{targets ? 'today' : 'observing'}</span>
          </div>
          {targets ? (
            <>
              <MacroRings totals={nutrition.totals} targets={targets} left={nutrition.left} />
              {nutrition.burn_kcal > 0 && (
                <label className="dash-eatback">
                  <span className="prog-sub">
                    🔥 {nutrition.burn_kcal} burned · +{nutrition.eatback_kcal} eaten back ({nutrition.eatback_pct}%)
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={10}
                    defaultValue={nutrition.eatback_pct}
                    onChange={(e) => void setEatbackPct(Number(e.currentTarget.value)).then(invalidateDay)}
                    aria-label="How much exercise to eat back"
                  />
                </label>
              )}
            </>
          ) : (
            <div className="dash-observe">
              <DotRow dots={Array.from({ length: 7 }, (_, i) => i < Math.min(7, recentDays))} color="var(--dawn-3)" />
              <div className="prog-sub">
                {recentDays === 0 ? 'No meals logged yet this week' : `Logged ${recentDays} of the last 7 days`}
                {nutrition.meals.length > 0 ? ` · ${nutrition.meals.length} today` : ''}
              </div>
            </div>
          )}
          {todayFoodOcc && (
            <button className="dash-snap" onClick={() => onOpen(todayFoodOcc.occurrence_id)}>
              📷 Log a meal
            </button>
          )}
        </div>
      )}

      {/* 3–7 — everything else derives from /progress, ordered by the S6 registry. */}
      {cards.map((c, i) => (
        <ProgressCardView key={i} card={c} variant="dashboard" add={add} />
      ))}

      {/* Movement trends (pace / top load) — self-contained sparklines, no goal-matching needed. */}
      {trends.map((t, i) => (
        <ProgressTrendCard key={`t${i}`} trend={t} variant="dashboard" />
      ))}
    </>
  );
}
