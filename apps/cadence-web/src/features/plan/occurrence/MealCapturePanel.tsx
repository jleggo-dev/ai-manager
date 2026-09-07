import type { OccurrenceDetail } from '../../../lib/api.ts';
import { useNutritionDay } from '../../../lib/query/index.ts';
import { localTodayIso } from '../../../lib/query/keys.ts';
import { MealScreen } from '../../food/meal/MealScreen.tsx';
import { MealCaptureRings } from './MealCaptureRings.tsx';
import { mealForNow, mealFromTitle } from './format.ts';
import { usePlannedMeal } from './usePlannedMeal.ts';

/**
 * The meal capture, from the trail — the cart (owner, 2026-09-07). Today's ring sits in context
 * showing only what is logged, and under it the meal IS the screen: what is in the cart, the
 * doors as one row, the shelf of what they usually have at this slot, and "Log breakfast" pinned
 * at the bottom. Nothing counts before that tap; after it, the same screen stays open to adds,
 * which count as they land.
 *
 * `detail` may still be on its way: the trail already knows the title and the day, and that is
 * everything the meal needs to open (PERF-06 — the screen is real on the first frame, the plate
 * never waits on a round trip it does not need). The detail is only for ticking the row.
 */
export function MealCapturePanel({
  detail,
  known,
  setDetail,
  onLogged,
  onClose,
  onOpenFood,
}: {
  detail: OccurrenceDetail | null;
  known: { title: string; date?: string };
  setDetail: (d: OccurrenceDetail) => void;
  onLogged?: () => void;
  onClose?: () => void;
  /** Leave the capture for the Food screen — the day's whole read, and the way into Nutrients. */
  onOpenFood?: () => void;
}) {
  const title = detail?.title ?? known.title;
  const date = detail?.date ?? known.date ?? localTodayIso();
  const mealKind = mealFromTitle(title) ?? mealForNow();
  const { data: day } = useNutritionDay(date);
  const { planned } = usePlannedMeal(mealKind, date);

  /** The row ticks server-side when the meal closes; this keeps the sheet's own copy honest. */
  const markLogged = () => {
    if (detail && detail.status === 'pending') setDetail({ ...detail, status: 'done' });
    onLogged?.();
    onClose?.();
  };

  return (
    <div className="mc mc-cart">
      <MealCaptureRings day={day} {...(onOpenFood ? { onOpenFood } : {})} />
      <MealScreen meal={mealKind} date={date} planned={planned} onClose={() => onClose?.()} onLogged={markLogged} />
    </div>
  );
}
