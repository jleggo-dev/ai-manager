import { useState } from 'react';
import type { Recipe } from '@cadence/shared';
import { KitchenPaste } from './KitchenPaste.tsx';
import { KitchenPlanner } from './KitchenPlanner.tsx';
import { KitchenRecipes } from './KitchenRecipes.tsx';
import { KitchenShopList } from './KitchenShopList.tsx';
import { plannedCount } from './kitchenPlan.ts';
import { useKitchen } from './useKitchen.ts';

type KitchenView = 'recipes' | 'week' | 'shop' | 'paste';

/**
 * The Kitchen (Food Journey 10) — the third tab of the Food screen, and the prep surface.
 *
 * **The Kitchen is prep, not one-tap logging** (the slice's own ruling). Everything here is about
 * what you are GOING to cook: a recipe pasted in and turned into per-serving numbers, a week
 * composed onto days and slots, a shopping list worked out from it. Nothing on this tab writes a
 * meal to a day's totals — a planned dinner is an intention, and it becomes food that counted when
 * it is eaten and logged on the Day tab.
 *
 * That separation is why this tab does not reuse the cookbook panel the Day tab's doors open: that
 * one offers "log N servings", which is exactly the tap this surface must not have.
 */
export function FoodKitchen({ targetKcal = null }: { targetKcal?: number | null } = {}) {
  const kitchen = useKitchen();
  const [view, setView] = useState<KitchenView>('recipes');
  const [pending, setPending] = useState<Recipe | null>(null);

  const days = kitchen.plan?.days ?? [];
  const planned = plannedCount(days);

  if (view === 'paste') {
    return (
      <div className="kt">
        <KitchenPaste
          onCancel={() => setView('recipes')}
          onSaved={() => {
            kitchen.reload();
            setView('recipes');
          }}
        />
      </div>
    );
  }

  return (
    <div className="kt" role="region" aria-label="Kitchen">
      <button className="kt-paste" onClick={() => setView('paste')}>
        <span className="kt-paste-t">
          <b>Paste a recipe</b>
          <span>I&apos;ll work out what a serving comes to</span>
        </span>
        <i aria-hidden>›</i>
      </button>

      <div className="kt-seg" role="tablist" aria-label="Kitchen sections">
        <button
          role="tab"
          aria-selected={view === 'recipes'}
          className={view === 'recipes' ? 'is-on' : ''}
          onClick={() => {
            setPending(null);
            setView('recipes');
          }}
        >
          Recipes
        </button>
        <button
          role="tab"
          aria-selected={view === 'week'}
          className={view === 'week' ? 'is-on' : ''}
          onClick={() => setView('week')}
        >
          The week
        </button>
        <button
          role="tab"
          aria-selected={view === 'shop'}
          className={view === 'shop' ? 'is-on' : ''}
          onClick={() => {
            setPending(null);
            setView('shop');
          }}
        >
          Shopping
        </button>
      </div>

      {kitchen.note && <div className="kt-note">{kitchen.note}</div>}

      {view === 'recipes' && (
        <KitchenRecipes
          recipes={kitchen.recipes}
          status={kitchen.status}
          onPaste={() => setView('paste')}
          onPlan={(recipe) => {
            setPending(recipe);
            setView('week');
          }}
        />
      )}

      {view === 'week' && (
        <>
          <div className="kt-count">
            {planned === 0
              ? 'Nothing planned this week yet.'
              : `${planned} meal${planned === 1 ? '' : 's'} planned this week.`}
          </div>
          <KitchenPlanner
            targetKcal={targetKcal}
            weekOf={kitchen.weekOf}
            days={days}
            recipes={kitchen.recipes}
            busy={kitchen.busy}
            pending={pending}
            onCommit={(next) => void kitchen.commitDays(next)}
            onPendingDone={() => setPending(null)}
          />
        </>
      )}

      {view === 'shop' && <KitchenShopList days={days} byId={kitchen.byId} onPlanWeek={() => setView('week')} />}

      <p className="kt-foot">Planning something doesn&apos;t count it — log it when you eat it.</p>
    </div>
  );
}
