import { useEffect, useState } from 'react';
import { getCurrentMealPlan, mealPlanDayLabel, type MealPlanRecord } from '../../lib/api.ts';
import { MealPlansPanel } from '../food/MealPlansPanel.tsx';

/**
 * This week's meals (design 2G/E) — the saved week menu as redesigned day rows: each day, the dish(es)
 * it names, with intentionally-open days shown as such. A "The shop" card and an "Edit this week" door
 * hang off it; editing / generating reuses the existing MealPlansPanel (draft → review → save) so the
 * deep mechanics aren't reinvented. Live cook-night chips + drag-to-reschedule + the "adds trail tasks"
 * wiring are the deeper follow-up; this is the redesigned view + entry points over the same data.
 */
export function WeekMenuSheet({ onOpenShop, onClose }: { onOpenShop: () => void; onClose: () => void }) {
  const [plan, setPlan] = useState<MealPlanRecord | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    getCurrentMealPlan().then((r) => {
      if (!alive) return;
      if (r.status === 'ok' && r.plan) {
        setPlan(r.plan);
        setStatus('ok');
      } else {
        setStatus(r.status === 'unavailable' || r.status === 'error' ? 'error' : 'empty');
      }
    });
    return () => {
      alive = false;
    };
  }, [reload]);

  if (editing) {
    return (
      <MealPlansPanel
        onClose={() => {
          setEditing(false);
          setReload((k) => k + 1);
        }}
      />
    );
  }

  const left = plan?.shopping_list.filter((i) => !i.checked).length ?? 0;

  return (
    <div className="wk">
      <div className="wk-head">
        <button className="shop-back" onClick={onClose} aria-label="Back">
          ‹
        </button>
        <div className="shop-headt">
          <b>This week&apos;s meals</b>
          <span>{status === 'ok' ? 'LIVE · EDITS SAVE AS YOU GO' : 'PLAN A WEEK OF DINNERS'}</span>
        </div>
      </div>

      {status === 'loading' ? (
        <div className="shop-msg">Loading your week…</div>
      ) : status === 'ok' && plan ? (
        <>
          <div className="wk-days">
            {plan.days.map((d) => (
              <div className="wk-day" key={d.day}>
                <div className="wk-date">{mealPlanDayLabel(d.day)}</div>
                <div className="wk-meals">
                  {d.meals.length > 0 ? (
                    d.meals.map((m, i) => (
                      <div className="wk-meal" key={`${d.day}-${i}`}>
                        <b>{m.recipe_name || 'Planned dish'}</b>
                        <span>{m.slot}</span>
                      </div>
                    ))
                  ) : (
                    <div className="wk-open">Left open</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {plan.shopping_list.length > 0 && (
            <button className="wk-shop" onClick={onOpenShop}>
              <div className="wk-shop-t">
                <b>The shop</b>
                <span>
                  {left} thing{left === 1 ? '' : 's'} left
                </span>
              </div>
              <span className="mc-plan-go" aria-hidden>
                ›
              </span>
            </button>
          )}
          <button className="wk-edit" onClick={() => setEditing(true)}>
            Edit this week ·<span> swap dishes, regenerate ›</span>
          </button>
        </>
      ) : (
        <div className="wk-plan">
          <div className="shop-msg">
            {status === 'error'
              ? "Couldn't load your week just now — try again in a moment."
              : "No menu yet — I'll draft a week of dinners you like, with a shopping list derived from them."}
          </div>
          <button className="wk-cta" onClick={() => setEditing(true)}>
            Plan the week&apos;s meals
          </button>
        </div>
      )}
    </div>
  );
}
