import type { OccurrenceDetail } from '../../../lib/api.ts';
import { localTodayIso } from '../../../lib/query/keys.ts';
import { MealScreen } from '../../food/meal/MealScreen.tsx';
import { mealForNow, mealFromTitle } from './format.ts';

/**
 * The meal capture, from the trail — the quick log (2026-10-28). The meal IS the sheet: its
 * own title row, the day's ring and bars with the cart previewed on them, the doors, the
 * shelves, and "Log breakfast" pinned at the bottom. The ring strip that used to sit above the
 * meal is inside it now, so there is nothing of the capture's own left to draw.
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
  onCoach,
}: {
  detail: OccurrenceDetail | null;
  known: { title: string; date?: string };
  setDetail: (d: OccurrenceDetail) => void;
  onLogged?: () => void;
  onClose?: () => void;
  /** Leave the capture for the Food screen — the day's whole read, and the way into Nutrients. */
  onOpenFood?: () => void;
  /** Cadence's face: hand the conversation to the coach with the meal in her note. */
  onCoach?: (note: string) => void;
}) {
  const title = detail?.title ?? known.title;
  const date = detail?.date ?? known.date ?? localTodayIso();
  const mealKind = mealFromTitle(title) ?? mealForNow();

  /** The row ticks server-side when the meal closes; this keeps the sheet's own copy honest. */
  const markLogged = () => {
    if (detail && detail.status === 'pending') setDetail({ ...detail, status: 'done' });
    onLogged?.();
    onClose?.();
  };

  return (
    <div className="mc mc-cart">
      <MealScreen
        meal={mealKind}
        date={date}
        onClose={() => onClose?.()}
        onLogged={markLogged}
        onOpenDay={onOpenFood}
        onCoach={onCoach}
      />
    </div>
  );
}
