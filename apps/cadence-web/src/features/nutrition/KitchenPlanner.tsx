import { useState } from 'react';
import type { MealPlanDay, Recipe } from '@cadence/shared';
import { recipeMacroHint } from '../../lib/api.ts';
import { KITCHEN_SLOTS, SLOT_LABEL, addMeal, dayLabel, mealAt, removeMeal, weekDaysFrom } from './kitchenPlan.ts';

/** One saved recipe, offered as something to cook. */
function RecipeChoice({ recipe, onPick }: { recipe: Recipe; onPick: () => void }) {
  return (
    <button className="kt-row" onClick={onPick}>
      <span className="kt-row-t">
        <b>{recipe.name}</b>
        <span>
          Serves {recipe.servings} · {recipeMacroHint(recipe.macros_per_serving) || 'no numbers yet'} per serving
        </span>
      </span>
      <i aria-hidden>›</i>
    </button>
  );
}

/**
 * Planning a week, and the composer that fills it (Food Journey 10b/10c).
 *
 * Two ways in, because both are how people actually think: from a DAY ("what's Wednesday?" — open
 * the day, fill a slot) and from a RECIPE ("I want to make this" — pick the day and slot it lands
 * on). Both end in the same edit to the same `MealPlanDay[]`.
 *
 * A slot holds one recipe and planning over it replaces what was there. Nothing here logs
 * anything: a planned dinner is an intention, and it stays an intention until it is eaten.
 */
export function KitchenPlanner({
  weekOf,
  days,
  recipes,
  busy,
  pending,
  onCommit,
  onPendingDone,
}: {
  weekOf: string;
  days: MealPlanDay[];
  recipes: Recipe[];
  busy: boolean;
  /** A recipe handed over from the cookbook, waiting for a day and a slot. */
  pending: Recipe | null;
  onCommit: (days: MealPlanDay[]) => void;
  onPendingDone: () => void;
}) {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ day: string; slot: string } | null>(null);
  const [pendingDay, setPendingDay] = useState<string | null>(null);
  const week = weekDaysFrom(weekOf);

  function plan(day: string, slot: string, recipe: Recipe) {
    onCommit(addMeal(days, day, slot, recipe));
  }

  // A recipe arrived from the cookbook — ask for the day, then the slot, then get out of the way.
  if (pending) {
    return (
      <div className="kt-plan" role="region" aria-label="Choose a day">
        <button
          className="kt-linkback"
          onClick={() => {
            setPendingDay(null);
            onPendingDone();
          }}
        >
          ‹ Not now
        </button>
        <b className="kt-plan-t">
          {pendingDay ? `${pending.name} — which meal?` : `When are you making ${pending.name}?`}
        </b>
        {pendingDay ? (
          <div className="kt-slots">
            {KITCHEN_SLOTS.map((slot) => (
              <button
                key={slot}
                className="kt-slotbtn"
                disabled={busy}
                onClick={() => {
                  plan(pendingDay, slot, pending);
                  setPendingDay(null);
                  onPendingDone();
                  setOpenDay(pendingDay);
                }}
              >
                {SLOT_LABEL[slot]}
              </button>
            ))}
          </div>
        ) : (
          week.map((day) => (
            <button className="kt-row" key={day} disabled={busy} onClick={() => setPendingDay(day)}>
              <span className="kt-row-t">
                <b>{dayLabel(day)}</b>
                <span>{summarise(days, day)}</span>
              </span>
              <i aria-hidden>›</i>
            </button>
          ))
        )}
      </div>
    );
  }

  // Choosing what goes in a slot the user tapped.
  if (picking) {
    return (
      <div className="kt-plan" role="region" aria-label="Choose a recipe">
        <button className="kt-linkback" onClick={() => setPicking(null)}>
          ‹ Back to {dayLabel(picking.day)}
        </button>
        <b className="kt-plan-t">
          {SLOT_LABEL[picking.slot as keyof typeof SLOT_LABEL] ?? picking.slot} on {dayLabel(picking.day)}
        </b>
        {recipes.length === 0 ? (
          <div className="kt-msg">No saved recipes yet — paste one in and it will show up here.</div>
        ) : (
          recipes.map((r) => (
            <RecipeChoice
              key={r.recipe_id}
              recipe={r}
              onPick={() => {
                plan(picking.day, picking.slot, r);
                setPicking(null);
              }}
            />
          ))
        )}
      </div>
    );
  }

  // One day, its four slots.
  if (openDay) {
    return (
      <div className="kt-plan" role="region" aria-label={`Plan ${dayLabel(openDay)}`}>
        <button className="kt-linkback" onClick={() => setOpenDay(null)}>
          ‹ The whole week
        </button>
        <b className="kt-plan-t">{dayLabel(openDay)}</b>
        {KITCHEN_SLOTS.map((slot) => {
          const meal = mealAt(days, openDay, slot);
          return (
            <div className="kt-slotrow" key={slot}>
              <span className="kt-slotrow-l">{SLOT_LABEL[slot]}</span>
              {meal ? (
                <>
                  <span className="kt-slotrow-n">{meal.recipe_name ?? 'A saved recipe'}</span>
                  <button className="kt-off" disabled={busy} onClick={() => onCommit(removeMeal(days, openDay, slot))}>
                    Take it off
                  </button>
                </>
              ) : (
                <button className="kt-fill" disabled={busy} onClick={() => setPicking({ day: openDay, slot })}>
                  Plan something <i aria-hidden>›</i>
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="kt-plan" role="region" aria-label="Plan the week">
      {week.map((day) => (
        <button className="kt-row" key={day} onClick={() => setOpenDay(day)}>
          <span className="kt-row-t">
            <b>{dayLabel(day)}</b>
            <span>{summarise(days, day)}</span>
          </span>
          <i aria-hidden>›</i>
        </button>
      ))}
    </div>
  );
}

/** What a day already holds, in its own words — never a scold about what it doesn't. */
function summarise(days: MealPlanDay[], day: string): string {
  const meals = days.find((d) => d.day === day)?.meals ?? [];
  if (!meals.length) return 'open';
  return meals
    .map((m) => `${SLOT_LABEL[m.slot as keyof typeof SLOT_LABEL] ?? m.slot}: ${m.recipe_name ?? 'a recipe'}`)
    .join(' · ');
}
