import type { Meal, MealKind, PlateAdvice } from '../../../lib/api.ts';
import { PhotoReadPanel } from '../../food/PhotoReadPanel.tsx';

/**
 * The picture path, from the plan.
 *
 * It used to parse and log in one shot: photo in, row out, nothing shown in between. The Food tab
 * has read-then-confirm — you see what the eyes made of the picture and can fix it before any
 * number is computed — and this surface simply never got it. Owner, 2026-08-22, after a pack of
 * dill-pickle-SEASONED peanuts logged as two foods, one of them invented:
 *
 *   "It didn't present what I was logging (like in the chat, as it's supposed to) so I didn't have
 *    a chance to confirm before logging."
 *
 * Same app, two behaviours, and the one without a brake was on the daily path. So this now renders
 * the SAME panel the Food tab does rather than a second implementation of it — one flow to reason
 * about, and a fix in either place lands in both. That matters more since A23: an unmatched food is
 * pinned permanently, so an unreviewed capture is no longer one bad row.
 *
 * What stays here is what is genuinely this surface's own: the pre-eat read, offered and never
 * imposed, which writes nothing.
 */
export function MealCapturePhoto({
  photo,
  caption,
  mealKind,
  advising,
  advice,
  onClear,
  onAskRead,
  onLogged,
}: {
  photo: string;
  /** Anything typed before the photo was attached — carried in as the caption. */
  caption: string;
  mealKind: MealKind;
  advising: boolean;
  advice: PlateAdvice | null;
  onClear: () => void;
  onAskRead: () => void;
  onLogged: (m: Meal) => void;
}) {
  return (
    <div className="mc-photo">
      {advice ? (
        <div className={`mc-plate pa-${advice.verdict}`}>
          <div className="mc-plate-k">A READ, NOT A RULING</div>
          <div className="mc-plate-a">{advice.advice}</div>
          {advice.estimate_kcal != null && <div className="mc-plate-e">~{advice.estimate_kcal} kcal est.</div>}
        </div>
      ) : (
        <button className="mc-plate-ask" onClick={onAskRead} disabled={advising}>
          {advising ? 'Looking at your plate…' : 'Want a read before you eat? \u203a'}
        </button>
      )}

      <PhotoReadPanel
        photo={photo}
        meal={mealKind}
        initialCaption={caption}
        onLogged={onLogged}
        onBack={onClear}
        backLabel="Use a different photo"
      />
    </div>
  );
}
