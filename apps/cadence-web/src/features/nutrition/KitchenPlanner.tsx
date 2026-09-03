import { useState } from 'react';
import {
  dayTotals,
  landsOnTarget,
  mealPlanLabel,
  weekAverage,
  type MealPlanDay,
  type MealPlanSlotKind,
  type Recipe,
} from '@cadence/shared';
import { recipeMacroHint } from '../../lib/api.ts';
import { MealComposer } from './MealComposer.tsx';
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
  targetKcal,
  readOnly = false,
  onCommit,
  onPendingDone,
}: {
  weekOf: string;
  days: MealPlanDay[];
  recipes: Recipe[];
  busy: boolean;
  /** A past week reads back but takes no edits — every fill/remove door stays home. */
  readOnly?: boolean;
  /** The day's kcal target, when one exists. null until the coach proposes targets (slice 5) —
   *  and every number here degrades to a bare total rather than inventing a denominator. */
  targetKcal: number | null;
  /** A recipe handed over from the cookbook, waiting for a day and a slot. */
  pending: Recipe | null;
  onCommit: (days: MealPlanDay[]) => void;
  onPendingDone: () => void;
}) {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ day: string; slot: string } | null>(null);
  const [pendingDay, setPendingDay] = useState<string | null>(null);
  /** Frame 10a: composing a NAMED meal of several items, rather than dropping one recipe on a slot. */
  const [composing, setComposing] = useState<{ day?: string; slot?: MealPlanSlotKind } | null>(null);
  const week = weekDaysFrom(weekOf);

  function plan(day: string, slot: string, recipe: Recipe) {
    onCommit(addMeal(days, day, slot, { recipe_id: recipe.recipe_id, recipe_name: recipe.name }));
  }

  if (composing) {
    return (
      <MealComposer
        recipes={recipes}
        weekDays={week}
        initialDay={composing.day}
        initialSlot={composing.slot}
        onCancel={() => setComposing(null)}
        onSave={(day, slot, meal) => {
          onCommit(addMeal(days, day, slot, meal));
          setComposing(null);
          setOpenDay(day);
        }}
      />
    );
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

        {/* Frame 10c's header: what the day adds up to, and how it sits. `landsOnTarget` is where
            the brand rule lives — above target is "a little above", never "over budget", and with
            no target it says nothing at all rather than inventing a denominator. */}
        {(() => {
          const t = dayTotals(days.find((d) => d.day === openDay));
          if (t.counted === 0) return null;
          const verdict = landsOnTarget(t.kcal, targetKcal);
          return (
            <div className="kt-dayhead">
              <strong>{t.kcal}</strong>
              <span className="kt-dayhead-l">planned{targetKcal ? ` of ${targetKcal}` : ''}</span>
              <span className="kt-weekhead-m">
                {t.protein_g}g protein · {t.carbs_g}g carbs · {t.fat_g}g fat
              </span>
              <span className="kt-weekhead-n">
                {t.items} {t.items === 1 ? 'thing' : 'things'} planned{verdict ? ` · ${verdict}` : ''}
                {t.counted < t.items ? ` · counted from ${t.counted} of ${t.items}` : ''}
              </span>
            </div>
          );
        })()}

        {KITCHEN_SLOTS.map((slot) => {
          const meal = mealAt(days, openDay, slot);
          return (
            <div className="kt-slotrow" key={slot}>
              <span className="kt-slotrow-l">{SLOT_LABEL[slot]}</span>
              {meal ? (
                <>
                  <span className="kt-slotrow-n">{mealPlanLabel(meal)}</span>
                  {!readOnly && (
                    <button
                      className="kt-off"
                      disabled={busy}
                      onClick={() => onCommit(removeMeal(days, openDay, slot))}
                    >
                      Take it off
                    </button>
                  )}
                </>
              ) : readOnly ? (
                <span className="kt-slotrow-n">—</span>
              ) : (
                <span className="kt-fill-pair">
                  <button className="kt-fill" disabled={busy} onClick={() => setPicking({ day: openDay, slot })}>
                    ＋ Pick a recipe <i aria-hidden>›</i>
                  </button>
                  {/* Frame 10a's door: a meal of several things, under a name. */}
                  <button className="kt-fill" disabled={busy} onClick={() => setComposing({ day: openDay, slot })}>
                    ＋ Build a meal <i aria-hidden>›</i>
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const avg = weekAverage(days);
  return (
    <div className="kt-plan" role="region" aria-label="Plan the week">
      {!readOnly && <p className="kt-lede">Set as much or as little as you like — empty days stay empty.</p>}

      {/* Frame 10b's header. Only once something is planned: an average of nothing is not a number,
          and printing "0 kcal a day" over an empty week would read as a verdict. */}
      {avg.daysSet > 0 && (
        <div className="kt-weekhead">
          <strong>{avg.kcal || '—'}</strong>
          <span className="kt-weekhead-l">kcal a day, planned</span>
          <span className="kt-weekhead-m">
            {avg.protein_g}g protein · {avg.carbs_g}g carbs · {avg.fat_g}g fat
          </span>
          <span className="kt-weekhead-n">
            average across the {avg.daysSet} {avg.daysSet === 1 ? 'day' : 'days'} you have set
          </span>
        </div>
      )}

      {week.map((day) => {
        const t = dayTotals(days.find((d) => d.day === day));
        return (
          <button className="kt-row" key={day} onClick={() => setOpenDay(day)}>
            <span className="kt-row-t">
              <b>{dayLabel(day)}</b>
              <span>{summarise(days, day)}</span>
            </span>
            {/* The kcal a day adds up to, against target when there is one — frame 10b's
                "1,880 of 1,940". Shown only when something was actually counted, so a week of
                legacy plans (which stored no macros) says nothing rather than claiming zero. */}
            {t.counted > 0 && (
              <span className="kt-row-k">
                {t.kcal}
                {targetKcal ? <em> of {targetKcal}</em> : null}
              </span>
            )}
            <i aria-hidden>›</i>
          </button>
        );
      })}

      {!readOnly && (
        <button type="button" className="kt-add" disabled={busy} onClick={() => setComposing({})}>
          ＋ Define a meal
        </button>
      )}
    </div>
  );
}

/** What a day already holds, in its own words — never a scold about what it doesn't. */
function summarise(days: MealPlanDay[], day: string): string {
  const meals = days.find((d) => d.day === day)?.meals ?? [];
  if (!meals.length) return 'open';
  return meals
    .map((m) => `${SLOT_LABEL[m.slot as keyof typeof SLOT_LABEL] ?? m.slot}: ${mealPlanLabel(m)}`)
    .join(' · ');
}
