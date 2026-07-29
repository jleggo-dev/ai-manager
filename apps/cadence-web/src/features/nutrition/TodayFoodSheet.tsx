import { useState } from 'react';
import { patchMeal, type MealMacros, type NutritionDayData } from '../../lib/api.ts';
import { useInvalidateNutritionDay, useNutritionDay } from '../../lib/query/index.ts';
import { MealPlansPanel } from '../food/MealPlansPanel.tsx';
import { RecipesPanel } from '../food/RecipesPanel.tsx';
import { NutritionInsightCard } from './NutritionInsightCard.tsx';
import { NutritionRing } from './NutritionRing.tsx';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function stamp(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d ?? ''} ${MONTHS[(m ?? 1) - 1] ?? ''}`;
}

const LEGEND: Array<{ key: 'kcal' | 'protein_g' | 'carbs_g'; label: string; unit: string; color: string }> = [
  { key: 'kcal', label: 'kcal', unit: '', color: 'oklch(72% 0.15 68)' },
  { key: 'protein_g', label: 'protein', unit: 'g', color: 'oklch(52% 0.09 152)' },
  { key: 'carbs_g', label: 'carbs', unit: 'g', color: 'oklch(62% 0.08 250)' },
];

function mealName(m: NutritionDayData['meals'][number]): string {
  return (
    m.items
      .map((i) => i.name)
      .filter(Boolean)
      .join(', ') ||
    m.raw_text ||
    (m.photo_url ? 'photo' : 'meal')
  );
}

/** The home layer of the sheet: rings + legend, one insight, today's meals, and the deeper tools. */
function TodayFoodHome({
  day,
  confirming,
  onConfirm,
  onSub,
  onClose,
}: {
  day: NutritionDayData | null;
  confirming: string | null;
  onConfirm: (logId: string) => void;
  onSub: (s: 'meals' | 'recipes') => void;
  onClose: () => void;
}) {
  const target = day?.targets ?? null;
  const eaten: MealMacros = day?.totals ?? {};
  const eatenKcal = eaten.kcal ?? 0;
  const targetKcal = target?.kcal ?? null;
  const left = targetKcal != null ? Math.max(0, targetKcal - eatenKcal) : null;
  const meals = day?.meals ?? [];

  return (
    <div className="tf-home">
      <div className="tf-head">
        <div className="tf-headt">
          <b>Today&apos;s food</b>
          <span>{day ? stamp(day.date) : ''}</span>
        </div>
        <button className="sheet-x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="tf-rings">
        <NutritionRing logged={eatenKcal} target={targetKcal} size={100} stroke={14}>
          {targetKcal != null ? (
            <>
              <b>{fmt(left ?? 0)}</b>
              <span>KCAL LEFT</span>
            </>
          ) : (
            <>
              <b>{fmt(eatenKcal)}</b>
              <span>KCAL</span>
            </>
          )}
        </NutritionRing>
        <div className="tf-legend">
          {LEGEND.map((row) => {
            const e = eaten[row.key] ?? 0;
            const t = target?.[row.key] ?? null;
            return (
              <div className="tf-leg" key={row.key}>
                <span className="tf-dot" style={{ background: row.color }} />
                <span>
                  {Math.round(e)}
                  {t != null ? ` of ${fmt(t)}` : ''} {row.label}
                  {row.unit}
                </span>
              </div>
            );
          })}
          <div className="tf-leg-foot">
            {day?.confirmed_count ?? 0} meal{(day?.confirmed_count ?? 0) === 1 ? '' : 's'} in
            {day && day.provisional_count > 0 ? ` · ${day.provisional_count} still provisional` : ''}
          </div>
        </div>
      </div>

      <NutritionInsightCard compact />

      {meals.length > 0 && (
        <div className="tf-sec">
          <div className="tf-sec-l">LOGGED</div>
          {meals.map((m) => (
            <div className={`tf-meal${m.provisional ? ' is-prov' : ''}`} key={m.log_id}>
              <div className="tf-meal-t">
                <b>{mealName(m)}</b>
                <span>
                  {m.meal}
                  {m.macros?.kcal ? ` · ${Math.round(m.macros.kcal)} kcal` : ''}
                  {m.provisional ? ' · provisional' : ''}
                </span>
              </div>
              {m.provisional && (
                <button
                  className="tf-confirm"
                  onClick={() => onConfirm(m.log_id)}
                  disabled={confirming === m.log_id}
                  aria-label="Confirm this meal's estimate"
                >
                  {confirming === m.log_id ? '…' : '✓'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="tf-tools">
        <button className="tf-tool" onClick={() => onSub('meals')}>
          This week&apos;s meals
        </button>
        <button className="tf-tool" onClick={() => onSub('recipes')}>
          Recipes
        </button>
        <button className="tf-tool" onClick={() => onSub('meals')}>
          The shop
        </button>
      </div>
    </div>
  );
}

/**
 * "Today's food" (design 2F) — the whole old Food tab, minus its four-mode top bar, reachable from
 * the trail food-strip. Rings + legend, one insight, today's logged meals (provisional ones confirm
 * inline), then three doors to the deeper planning tools (week's meals, recipes, the shop) — which
 * relocate here now that food has no tab of its own. Reuses the existing MealPlansPanel / RecipesPanel.
 */
export function TodayFoodSheet({
  date,
  onClose,
  onLogged,
}: {
  date: string;
  onClose: () => void;
  onLogged?: () => void;
}) {
  const { data: day = null, refetch } = useNutritionDay(date);
  const invalidate = useInvalidateNutritionDay();
  const [sub, setSub] = useState<'home' | 'meals' | 'recipes'>('home');
  const [confirming, setConfirming] = useState<string | null>(null);

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

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet tf" role="dialog" aria-label="Today's food">
        <div className="sheet-grab" aria-hidden />
        {sub === 'meals' ? (
          <div className="tf-sub">
            <MealPlansPanel onClose={() => setSub('home')} />
          </div>
        ) : sub === 'recipes' ? (
          <div className="tf-sub">
            <RecipesPanel
              onClose={() => setSub('home')}
              onLogged={() => {
                void invalidate();
                onLogged?.();
              }}
              onOpenMealPlans={() => setSub('meals')}
            />
          </div>
        ) : (
          <TodayFoodHome day={day} confirming={confirming} onConfirm={onConfirm} onSub={setSub} onClose={onClose} />
        )}
      </div>
    </>
  );
}
