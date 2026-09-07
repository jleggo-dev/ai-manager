import { useOccurrenceDetail } from './occurrence/useOccurrenceDetail.ts';
import { isFoodRow } from './occurrence/format.ts';
import { MealCapturePanel } from './occurrence/MealCapturePanel.tsx';
import { WeighInPanel } from './occurrence/WeighInPanel.tsx';
import { WeighInSkeleton } from './SheetSkeletons.tsx';
import { GLYPH } from '../today/glyphs.ts';
import { isFoodTitle, isWeighTitle } from '../../components/occurrence-mod.ts';

/**
 * The **capture sheet** (REQ8 task shapes) — a weigh-in or a meal is one data entry, so it opens
 * minimal. No "start", no step summary, no "I have less time" — there's nothing to walk through
 * or shorten.
 *
 * A weigh-in keeps the disc-and-title header over a deterministic number. A meal has no header
 * of its own any more: the meal screen underneath names itself ("Breakfast"), and the band that
 * sat above it — "Log breakfast · 08:00 · CAPTURE · NOTHING COUNTS UNTIL YOU CONFIRM" — said
 * the same thing twice and cost the cart its room (owner, on device, 2026-09-07). The meal also
 * opens on the FIRST frame from what the trail already knows (title, day), rather than waiting
 * for `/plan/occurrences/:id` — the detail only ticks the row afterwards (PERF-06).
 */
export function CaptureSheet({
  occurrenceId,
  known,
  onClose,
  onLogged,
  onOpenFood,
}: {
  occurrenceId: string;
  /**
   * What the trail ALREADY knows about this row at the moment it was tapped — its title, time of
   * day and the day it sits on, all carried in the plan the trail is drawn from.
   *
   * This is the difference between a placeholder and a real screen. The sheet used to render
   * nothing at all until `/plan/occurrences/:id` came back, so tapping "Log breakfast" opened a
   * blank sheet with the coach's typing dots in it, and only then did the words "Log breakfast"
   * appear — data the phone had been holding the whole time (owner, 2026-08-20: "Show the Log
   * breakfast screen"). With this, the meal is real on the first frame.
   */
  known?: { title: string; time_of_day?: string; date?: string };
  onClose: () => void;
  onLogged?: () => void;
  /** Leave the capture for the Food screen — the meal ring is the door (device report, 2026-08-20). */
  onOpenFood?: () => void;
}) {
  const { detail, setDetail, state } = useOccurrenceDetail(occurrenceId);
  const title = detail?.title ?? known?.title ?? '';
  const isWeigh = isWeighTitle(title);
  const time = detail?.schedule?.time_of_day ?? known?.time_of_day ?? null;
  /** The header can paint before the fetch lands; the body cannot invent a plate. */
  const headable = !!detail || !!known;
  /** A meal from the trail — the title says so before the detail does (the shared matcher). */
  const isMeal = detail ? isFoodRow(detail) : !!known && !isWeigh && isFoodTitle(known.title);

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet ss" role="dialog" aria-label="Log">
        <div className="sheet-grab" aria-hidden />
        {state === 'gone' ? (
          <div className="sheet-msg">This one moved with your new plan — close and take a fresh look at your week.</div>
        ) : state === 'error' || (state === 'ready' && !detail) ? (
          <div className="sheet-msg">{"Couldn't open this just now — close and tap it again in a moment."}</div>
        ) : isMeal && headable ? (
          <MealCapturePanel
            detail={detail}
            known={{ title, ...(known?.date ? { date: known.date } : {}) }}
            setDetail={setDetail}
            onLogged={onLogged}
            onClose={onClose}
            onOpenFood={onOpenFood}
          />
        ) : (
          <>
            {headable && (
              <div className="ss-head">
                <div className={`ss-disc ss-disc-${isWeigh ? 'weigh' : 'meal'}`} aria-hidden>
                  <svg viewBox="0 0 24 24" width="24" height="24">
                    <path d={isWeigh ? GLYPH.gauge : GLYPH.bowl} fill="#fff" />
                  </svg>
                </div>
                <div className="ss-headt">
                  <b>{title}</b>
                  <span>{isWeigh ? (time ?? 'weekly') : time}</span>
                </div>
              </div>
            )}

            {!detail ? (
              // Still reading. The header above is already real; this is the body's shape only —
              // shapes, never numbers (components/Skeleton.tsx).
              <WeighInSkeleton />
            ) : isWeigh ? (
              detail.status === 'pending' ? (
                <WeighInPanel detail={detail} setDetail={setDetail} onLogged={onLogged} />
              ) : (
                <div className="log-chip">
                  <b>Logged:</b> {detail.log?.summary ?? 'done'}
                </div>
              )
            ) : (
              <div className="sheet-msg">Tap it done when it happens.</div>
            )}
          </>
        )}
      </div>
    </>
  );
}
