import { useState } from 'react';
import type { Food } from '@cadence/shared';
import type { Meal, MealKind } from '../../lib/api.ts';
import { useNutritionDay } from '../../lib/query/index.ts';
import { downscalePhoto } from '../plan/occurrence/format.ts';
import { PhotoReadPanel } from './PhotoReadPanel.tsx';
import { AddFoodSheet } from './AddFoodSheet.tsx';
import { DrinkComposer } from './DrinkComposer.tsx';
import { FoodBarcodePanel } from './FoodBarcodePanel.tsx';
import { LogByChat } from './LogByChat.tsx';
import { LogHome } from './LogHome.tsx';
import { MealSlotChoice } from './MealSlotChoice.tsx';
import { foldCandidate } from './mealSlotting.ts';
import { useLogActions } from './useLogActions.ts';
import { useLogScreen } from './useLogScreen.ts';
import type { CaptureMethod } from './MethodTiles.tsx';

const MEALS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'];

type Route =
  | { at: 'home' }
  | { at: 'chat'; listening: boolean }
  | { at: 'barcode' }
  | { at: 'food'; food: Food }
  | { at: 'photo'; photo: string }
  | { at: 'drink' };

/**
 * **The full-screen Log** (design 05b) — reachable from any method tile in quick add, from "Log a
 * meal", or the ＋ on the trail, and it needs no trail task to exist: every write here goes
 * straight to the nutrition log.
 *
 * Six ways in, one screen. Search comes first because most logging is repetition; chat / voice /
 * picture / barcode next; quick add last, planned meals before recently eaten. Whatever route is
 * taken, nothing counts until it is confirmed, and once something lands the screen asks the one
 * question worth asking — where should it sit.
 */
/**
 * One mapping from a chosen method to the route that serves it — used both for the caller's
 * pre-chosen method and for a tile tapped here, so the two can never drift apart.
 * Picture is deliberately absent: it is a file input owned by the tile itself, not a route.
 */
function routeForMethod(m: CaptureMethod | undefined): Route {
  if (m === 'chat') return { at: 'chat', listening: false };
  if (m === 'voice') return { at: 'chat', listening: true };
  if (m === 'barcode') return { at: 'barcode' };
  return { at: 'home' };
}

export function LogScreen({
  date,
  initialMeal,
  initialMethod,
  onClose,
  onLogged,
}: {
  date: string;
  initialMeal: MealKind;
  /**
   * The method the CALLER already chose, so this screen opens on it.
   *
   * The quick-add sheet's tiles used to set only "open the Log screen" and drop which tile was
   * tapped, so Chat landed on the Log home — showing the same five tiles again and asking the user
   * to pick Chat a second time (owner, device, 2026-08-20). A choice already made must not be
   * asked for twice. Absent, this opens on `home`, which is what "Log a meal" and the ＋ want.
   */
  initialMethod?: CaptureMethod;
  onClose: () => void;
  /** A meal landed — the host refreshes whatever it shows of the day. */
  onLogged?: () => void;
}) {
  const [meal, setMeal] = useState<MealKind>(initialMeal);
  const [route, setRoute] = useState<Route>(() => routeForMethod(initialMethod));
  const [landed, setLanded] = useState<Meal | null>(null);
  const [waterMl, setWaterMl] = useState<number | null>(null);
  const data = useLogScreen(meal, date);
  const act = useLogActions();
  const { data: day = null } = useNutritionDay(date);

  const water = waterMl ?? day?.water_ml ?? 0;
  const meals = day?.meals ?? [];

  /** Every finished write lands here: ask where it sits when there is somewhere for it to go. */
  function settle(logged: Meal | null) {
    if (!logged) return;
    onLogged?.();
    setRoute({ at: 'home' });
    if (foldCandidate(meals, logged.log_id)) setLanded(logged);
    else onClose();
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      setRoute({ at: 'photo', photo: await downscalePhoto(file) });
    } catch {
      act.setErr("Couldn't read that photo — try a different one.");
    }
  }

  function onMethod(m: CaptureMethod) {
    setRoute(routeForMethod(m));
  }

  if (landed) {
    return (
      <div className="fl" role="dialog" aria-label="Where should it sit">
        <MealSlotChoice
          logged={landed}
          meals={meals}
          onDone={() => {
            setLanded(null);
            onLogged?.();
            onClose();
          }}
        />
      </div>
    );
  }

  return (
    <div className="fl" role="dialog" aria-label="Log">
      <div className="fl-head">
        <button type="button" className="fd-back" aria-label="Close" onClick={onClose}>
          ‹
        </button>
        <h2>Log</h2>
        <select
          className="fl-slot"
          value={meal}
          aria-label="Meal"
          onChange={(e) => setMeal(e.target.value as MealKind)}
        >
          {MEALS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {act.err && <div className="food-empty">{act.err}</div>}

      {route.at === 'home' && (
        <LogHome
          data={data}
          waterMl={water}
          busy={act.busy}
          onMethod={onMethod}
          onPhoto={(f) => void pickPhoto(f)}
          onPickFood={(id) => void act.openFood(id).then((food) => food && setRoute({ at: 'food', food }))}
          onLogRecipe={(id) => void act.logRecipe(id, meal).then(settle)}
          onWater={setWaterMl}
          onDrink={() => setRoute({ at: 'drink' })}
        />
      )}

      {route.at === 'chat' && (
        <LogByChat
          meal={meal}
          listening={route.listening}
          onLogged={() => {
            onLogged?.();
            onClose();
          }}
          onBack={() => setRoute({ at: 'home' })}
        />
      )}

      {route.at === 'barcode' && (
        <div className="fl-body">
          <FoodBarcodePanel
            onDraft={(d) => (d.kind === 'saved' ? setRoute({ at: 'food', food: d.food }) : setRoute({ at: 'home' }))}
            onCancel={() => setRoute({ at: 'home' })}
          />
        </div>
      )}

      {route.at === 'food' && (
        <AddFoodSheet
          food={route.food}
          meal={meal}
          busy={act.busy}
          err={act.err}
          onBack={() => setRoute({ at: 'home' })}
          onLog={(p) =>
            void act
              .logFood({
                food_id: route.food.food_id,
                serving_index: p.servingIndex,
                quantity: p.quantity,
                meal: p.meal,
              })
              .then(settle)
          }
        />
      )}

      {route.at === 'photo' && (
        <PhotoReadPanel photo={route.photo} meal={meal} onLogged={settle} onBack={() => setRoute({ at: 'home' })} />
      )}

      {route.at === 'drink' && <DrinkComposer onLogged={settle} onBack={() => setRoute({ at: 'home' })} />}
    </div>
  );
}
