/**
 * Meal plans + shopping list hub (Req 5 Phase 5). Soft-fails warmly when
 * /nutrition/meal-plans isn't deployed yet. Confirm-before-save on generate.
 */
import { useEffect, useState } from 'react';
import {
  getCurrentMealPlan,
  listMealPlans,
  mealPlanDayLabel,
  shoppingListSummary,
  type MealPlanDraft,
  type MealPlanRecord,
} from '../../lib/api.ts';
import { MealPlanGeneratePanel } from './MealPlanGeneratePanel.tsx';
import { MealPlanSaveConfirm } from './MealPlanSaveConfirm.tsx';
import { MealPlanShoppingList } from './MealPlanShoppingList.tsx';

type Mode = 'home' | 'generate' | 'save' | 'detail' | 'shopping';

export function MealPlansPanel({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('home');
  const [plans, setPlans] = useState<MealPlanRecord[]>([]);
  const [current, setCurrent] = useState<MealPlanRecord | null>(null);
  const [listStatus, setListStatus] = useState<'loading' | 'ok' | 'empty' | 'unavailable' | 'error'>('loading');
  const [draft, setDraft] = useState<MealPlanDraft | null>(null);
  const [banner, setBanner] = useState('');

  function applyList(
    listed: Awaited<ReturnType<typeof listMealPlans>>,
    cur: Awaited<ReturnType<typeof getCurrentMealPlan>>,
  ) {
    if (listed.status === 'unavailable') {
      setPlans([]);
      setCurrent(null);
      setListStatus('unavailable');
      return;
    }
    if (listed.status === 'error') {
      setPlans([]);
      setCurrent(null);
      setListStatus('error');
      return;
    }
    setPlans(listed.plans);
    setCurrent(cur.status === 'ok' ? cur.plan : (listed.plans[0] ?? null));
    setListStatus(listed.plans.length || cur.status === 'ok' ? 'ok' : 'empty');
  }

  function reload() {
    setListStatus('loading');
    void Promise.all([listMealPlans(), getCurrentMealPlan()]).then(([listed, cur]) => applyList(listed, cur));
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listMealPlans(), getCurrentMealPlan()]).then(([listed, cur]) => {
      if (!cancelled) applyList(listed, cur);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === 'generate') {
    return (
      <MealPlanGeneratePanel
        onDraft={(d) => {
          setDraft(d);
          setMode('save');
        }}
        onCancel={() => setMode('home')}
      />
    );
  }

  if (mode === 'save' && draft) {
    return (
      <MealPlanSaveConfirm
        draft={draft}
        onCancel={() => {
          setDraft(null);
          setMode('generate');
        }}
        onSaved={(plan) => {
          setDraft(null);
          setCurrent(plan);
          setBanner("Saved — this week's meals and shopping list are yours.");
          setMode('detail');
          reload();
        }}
      />
    );
  }

  if ((mode === 'detail' || mode === 'shopping') && current) {
    return (
      <div className="food-panel" role="region" aria-label="Meal plan detail">
        <div className="food-panel-t">Week of {current.week_of}</div>
        <p className="food-panel-p">{shoppingListSummary(current.shopping_list)}</p>
        {banner && <div className="food-banner">{banner}</div>}

        {mode === 'shopping' ? (
          <MealPlanShoppingList
            plan={current}
            onUpdated={(p) => {
              setCurrent(p);
              setPlans((prev) => prev.map((x) => (x.meal_plan_id === p.meal_plan_id ? p : x)));
            }}
          />
        ) : (
          <>
            {current.days.length === 0 && (
              <div className="food-empty">No days on this plan yet — draft a fresh week if you want.</div>
            )}
            <ul className="food-recipe-ing-list">
              {current.days.map((d) => (
                <li key={d.day}>
                  <b>{mealPlanDayLabel(d.day)}</b>
                  <ul style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
                    {d.meals.map((m, i) => (
                      <li key={`${m.slot}-${i}`}>
                        {m.slot}
                        {m.recipe_name ? `: ${m.recipe_name}` : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="food-confirm-actions">
          {mode === 'detail' && current.shopping_list.length > 0 && (
            <button type="button" className="lockbtn" onClick={() => setMode('shopping')}>
              Open shopping list
            </button>
          )}
          {mode === 'shopping' && (
            <button type="button" className="lockbtn" onClick={() => setMode('detail')}>
              Back to the week
            </button>
          )}
          <button
            type="button"
            className="lockbtn ghost"
            onClick={() => {
              setBanner('');
              setMode('home');
            }}
          >
            Back to meal plans
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="food-panel" role="region" aria-label="Meal plans">
      <div className="food-panel-t">This week&apos;s meals</div>
      <p className="food-panel-p">
        A gentle week of meals plus a shopping list — I draft from your targets and tastes; you confirm before anything
        is saved.
      </p>

      {banner && <div className="food-banner">{banner}</div>}

      <button type="button" className="food-action" style={{ marginBottom: 10 }} onClick={() => setMode('generate')}>
        <b>Plan this week</b>
        <span>Draft meals + a shopping list — nothing sticks until you confirm</span>
      </button>

      {listStatus === 'loading' && (
        <div className="chat-loading">
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      {listStatus === 'unavailable' && (
        <div className="food-empty">
          Meal plans aren&apos;t live on the server yet — you can still explore this screen. Once the API lands, your
          week and shopping list will show up here.
        </div>
      )}
      {listStatus === 'error' && (
        <div className="food-empty">Couldn&apos;t load meal plans just now — try again in a moment.</div>
      )}
      {listStatus === 'empty' && (
        <div className="food-empty">
          No week saved yet — that&apos;s fine. Draft one when you&apos;re ready and I&apos;ll keep the shopping list
          with it.
        </div>
      )}
      {listStatus === 'ok' && current && (
        <button
          type="button"
          className="food-action"
          style={{ marginBottom: 10 }}
          onClick={() => {
            setBanner('');
            setMode('detail');
          }}
        >
          <b>Week of {current.week_of}</b>
          <span>{shoppingListSummary(current.shopping_list)}</span>
        </button>
      )}
      {listStatus === 'ok' && plans.length > 1 && (
        <ul className="food-list" aria-label="Earlier meal plans">
          {plans
            .filter((p) => p.meal_plan_id !== current?.meal_plan_id)
            .map((p) => (
              <li key={p.meal_plan_id}>
                <button
                  type="button"
                  className="food-row"
                  onClick={() => {
                    setCurrent(p);
                    setMode('detail');
                  }}
                >
                  <b>Week of {p.week_of}</b>
                  <span>{shoppingListSummary(p.shopping_list)}</span>
                </button>
              </li>
            ))}
        </ul>
      )}

      <button type="button" className="lockbtn ghost" style={{ marginTop: 12 }} onClick={onClose}>
        Back to Food
      </button>
    </div>
  );
}
