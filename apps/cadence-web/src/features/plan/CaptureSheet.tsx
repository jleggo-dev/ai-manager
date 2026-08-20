import { useOccurrenceDetail } from './occurrence/useOccurrenceDetail.ts';
import { isFoodRow } from './occurrence/format.ts';
import { MealCapturePanel } from './occurrence/MealCapturePanel.tsx';
import { WeighInPanel } from './occurrence/WeighInPanel.tsx';
import { ICON } from '../today/category.ts';

/** A bathroom-scale glyph for the weigh-in capture (there's no scale in the four trail categories). */
const SCALE =
  'M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5zm7 3a1 1 0 0 0-.72 1.7l.72.72 2-2.24A1 1 0 0 0 12 7.5zM7.5 7a.6.6 0 100 1.2A.6.6 0 007.5 7zm9 0a.6.6 0 100 1.2A.6.6 0 0016.5 7z';

/**
 * The **capture sheet** (REQ8 task shapes) — a weigh-in or a meal is one data entry, so it opens
 * minimal: a clean redesign header + the capture, and nothing else. No "start", no step summary, no
 * "I have less time" — there's nothing to walk through or shorten. The weigh-in is a deterministic
 * number; the meal is the redesigned two-tone-ring capture (say / snap / type, resolver draft card,
 * quantities, two-tap recents), pre-selecting the meal the task names. Sessions keep the StartSheet
 * walkthrough; the Week view keeps its own OccurrenceSheet (with the fuller meal log + baseline).
 */
export function CaptureSheet({
  occurrenceId,
  onClose,
  onLogged,
  onOpenFood,
}: {
  occurrenceId: string;
  onClose: () => void;
  onLogged?: () => void;
  /** Leave the capture for the Food screen — the meal ring is the door (device report, 2026-08-20). */
  onOpenFood?: () => void;
}) {
  const { detail, setDetail, state } = useOccurrenceDetail(occurrenceId);
  const isWeigh = !!detail && /weigh/i.test(detail.title);
  const time = detail?.schedule?.time_of_day ?? null;

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet ss" role="dialog" aria-label="Log">
        <div className="sheet-grab" aria-hidden />
        {state === 'loading' ? (
          <div className="sheet-loading">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          </div>
        ) : state === 'gone' ? (
          <div className="sheet-msg">This one moved with your new plan — close and take a fresh look at your week.</div>
        ) : state === 'error' || !detail ? (
          <div className="sheet-msg">{"Couldn't open this just now — close and tap it again in a moment."}</div>
        ) : (
          <>
            <div className="ss-head">
              <div className={`ss-disc ss-disc-${isWeigh ? 'weigh' : 'meal'}`} aria-hidden>
                <svg viewBox="0 0 24 24" width="24" height="24">
                  <path d={isWeigh ? SCALE : ICON.nutrition} fill="#fff" />
                </svg>
              </div>
              <div className="ss-headt">
                <b>{detail.title}</b>
                <span>
                  {isWeigh
                    ? (time ?? 'weekly')
                    : [time, 'CAPTURE · NOTHING COUNTS UNTIL YOU CONFIRM'].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>

            {isWeigh ? (
              detail.status === 'pending' ? (
                <WeighInPanel detail={detail} setDetail={setDetail} onLogged={onLogged} />
              ) : (
                <div className="log-chip">
                  <b>Logged:</b> {detail.log?.summary ?? 'done'}
                </div>
              )
            ) : isFoodRow(detail) ? (
              <MealCapturePanel
                detail={detail}
                setDetail={setDetail}
                onLogged={onLogged}
                onClose={onClose}
                onOpenFood={onOpenFood}
              />
            ) : (
              <div className="sheet-msg">Tap it done when it happens.</div>
            )}
          </>
        )}
      </div>
    </>
  );
}
