import { useState } from 'react';
import type { Recipe } from '@cadence/shared';
import { KitchenDraftWeek } from './KitchenDraftWeek.tsx';
import { KitchenIntake, type KitchenIntakeSource } from './KitchenIntake.tsx';
import { KitchenPlanner } from './KitchenPlanner.tsx';
import { KitchenRecipes } from './KitchenRecipes.tsx';
import { KitchenShopList } from './KitchenShopList.tsx';
import { plannedCount } from './kitchenPlan.ts';
import { useKitchen } from './useKitchen.ts';

/** The Kitchen's three standing sections — what the Day tab's pills and doors navigate to. */
export type KitchenView = 'recipes' | 'week' | 'shop';

type KitchenScreen = KitchenView | KitchenIntakeSource | 'draft';

/** "Week of 31 Aug" — the paging header's own words. */
function weekLabel(weekOf: string): string {
  const [y, m, d] = weekOf.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * The Kitchen (Food Journey 10) — the third tab of the Food screen, and the prep surface.
 *
 * **The Kitchen is prep, not one-tap logging** (the slice's own ruling). Everything here is about
 * what you are GOING to cook: a recipe pasted in and turned into per-serving numbers, a week
 * composed onto days and slots, a shopping list worked out from it. Nothing on this tab writes a
 * meal to a day's totals — a planned dinner is an intention, and it becomes food that counted when
 * it is eaten and logged on the Day tab.
 *
 * That separation is why the cookbook here offers "put it on a day" and never "log N servings" —
 * logging a saved recipe lives on the Day tab's Log screen, where counting belongs.
 */
export function FoodKitchen({
  targetKcal = null,
  initialView = 'recipes',
}: { targetKcal?: number | null; initialView?: KitchenView } = {}) {
  const kitchen = useKitchen();
  const [view, setView] = useState<KitchenScreen>(initialView);
  const [pending, setPending] = useState<Recipe | null>(null);

  const days = kitchen.plan?.days ?? [];
  const planned = plannedCount(days);

  if (view === 'draft') {
    return (
      <div className="kt">
        <KitchenDraftWeek
          weekOf={kitchen.weekOf}
          hasPlan={!!kitchen.plan}
          busy={kitchen.busy}
          onKeep={(draft) => void kitchen.saveDraft(draft).then((ok) => ok && setView('week'))}
          onCancel={() => setView('week')}
        />
      </div>
    );
  }

  if (view === 'paste' || view === 'snap' || view === 'discover') {
    return (
      <div className="kt">
        <KitchenIntake
          source={view}
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
          onSnap={() => setView('snap')}
          onDiscover={kitchen.discoveryLive ? () => setView('discover') : null}
          onPlan={(recipe) => {
            setPending(recipe);
            setView('week');
          }}
        />
      )}

      {view === 'week' && (
        <>
          {/* Week paging (owner ruling 2026-09-02): ‹ walks into past weeks, read-only; › comes
              back, never past the running week — planning lives there. */}
          <div className="kt-weeknav">
            <button aria-label="Earlier week" onClick={() => kitchen.goWeek(-1)}>
              ‹
            </button>
            <b>Week of {weekLabel(kitchen.weekOf)}</b>
            <button aria-label="Later week" disabled={kitchen.isCurrentWeek} onClick={() => kitchen.goWeek(1)}>
              ›
            </button>
          </div>
          {kitchen.isCurrentWeek ? (
            <button className="kt-row" onClick={() => setView('draft')}>
              <span className="kt-row-t">
                <b>Draft this week</b>
                <span>A week of dinners you&apos;d like — nothing sticks until you keep it</span>
              </span>
              <i aria-hidden>›</i>
            </button>
          ) : (
            <button className="kt-inline" onClick={kitchen.goToCurrentWeek}>
              Back to this week
            </button>
          )}
          <div className="kt-count">
            {planned === 0
              ? kitchen.isCurrentWeek
                ? 'Nothing planned this week yet.'
                : 'Nothing was planned that week.'
              : `${planned} meal${planned === 1 ? '' : 's'} planned ${kitchen.isCurrentWeek ? 'this' : 'that'} week.`}
          </div>
          <KitchenPlanner
            targetKcal={targetKcal}
            weekOf={kitchen.weekOf}
            days={days}
            recipes={kitchen.recipes}
            busy={kitchen.busy}
            pending={pending}
            readOnly={!kitchen.isCurrentWeek}
            onCommit={(next) => void kitchen.commitDays(next)}
            onPendingDone={() => setPending(null)}
          />
        </>
      )}

      {view === 'shop' && (
        <KitchenShopList
          days={days}
          byId={kitchen.byId}
          savedTicks={kitchen.plan?.shopping_list ?? []}
          onSaveTicks={(list) => void kitchen.saveTicks(list)}
          onPlanWeek={() => setView('week')}
        />
      )}

      <p className="kt-foot">Planning something doesn&apos;t count it — log it when you eat it.</p>
    </div>
  );
}
