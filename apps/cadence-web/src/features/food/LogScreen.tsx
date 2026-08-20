import { useState } from 'react';
import type { Food } from '@cadence/shared';
import type { Meal, MealKind } from '../../lib/api.ts';
import { useNutritionDay } from '../../lib/query/index.ts';
import { downscalePhoto } from '../plan/occurrence/format.ts';
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
export function LogScreen({
  date,
  initialMeal,
  onClose,
  onLogged,
}: {
  date: string;
  initialMeal: MealKind;
  onClose: () => void;
  /** A meal landed — the host refreshes whatever it shows of the day. */
  onLogged?: () => void;
}) {
  const [meal, setMeal] = useState<MealKind>(initialMeal);
  const [route, setRoute] = useState<Route>({ at: 'home' });
  const [caption, setCaption] = useState('');
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
    if (m === 'chat') setRoute({ at: 'chat', listening: false });
    if (m === 'voice') setRoute({ at: 'chat', listening: true });
    if (m === 'barcode') setRoute({ at: 'barcode' });
    if (m === 'search') setRoute({ at: 'home' });
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
        <select className="fl-slot" value={meal} aria-label="Meal" onChange={(e) => setMeal(e.target.value as MealKind)}>
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
              .logFood({ food_id: route.food.food_id, serving_index: p.servingIndex, quantity: p.quantity, meal: p.meal })
              .then(settle)
          }
        />
      )}

      {route.at === 'photo' && (
        <div className="fl-body fl-photo">
          <img src={route.photo} alt="your plate" />
          <input
            className="mc-cap-in"
            value={caption}
            aria-label="A few words about the photo"
            placeholder="a few words help — “chicken burrito bowl”"
            disabled={act.busy}
            onChange={(e) => setCaption(e.target.value)}
          />
          <button type="button" className="fa-log" disabled={act.busy} onClick={() => void act.logPhoto(route.photo, caption, meal).then(settle)}>
            {act.busy ? 'Writing it down…' : `Log to ${meal}`}
          </button>
          <button type="button" className="lockbtn ghost" disabled={act.busy} onClick={() => setRoute({ at: 'home' })}>
            Back
          </button>
        </div>
      )}

      {route.at === 'drink' && <DrinkComposer onLogged={settle} onBack={() => setRoute({ at: 'home' })} />}
    </div>
  );
}
