import type { MealKind, PlateAdvice } from '../../../lib/api.ts';

/**
 * The picture path. Cadence supplies the quantity herself here — there is nothing to ask, so the
 * photo goes straight to a provisional log and stays dashed until it is confirmed. A read before
 * eating is offered, never imposed, and it writes nothing.
 */
export function MealCapturePhoto({
  photo,
  caption,
  setCaption,
  mealKind,
  busy,
  advising,
  advice,
  logErr,
  onClear,
  onAskRead,
  onLog,
}: {
  photo: string;
  caption: string;
  setCaption: (s: string) => void;
  mealKind: MealKind;
  busy: boolean;
  advising: boolean;
  advice: PlateAdvice | null;
  logErr: string;
  onClear: () => void;
  onAskRead: () => void;
  onLog: () => void;
}) {
  return (
    <div className="mc-photo">
      <div className="mc-photo-prev">
        <img src={photo} alt="your plate" />
        <button className="mc-photo-x" onClick={onClear} disabled={busy} aria-label="Remove photo">
          ×
        </button>
      </div>
      {advice ? (
        <div className={`mc-plate pa-${advice.verdict}`}>
          <div className="mc-plate-k">A READ, NOT A RULING</div>
          <div className="mc-plate-a">{advice.advice}</div>
          {advice.estimate_kcal != null && <div className="mc-plate-e">~{advice.estimate_kcal} kcal est.</div>}
        </div>
      ) : (
        <button className="mc-plate-ask" onClick={onAskRead} disabled={advising}>
          {advising ? 'Looking at your plate…' : 'Want a read before you eat? ›'}
        </button>
      )}
      <input
        className="mc-cap-in"
        value={caption}
        placeholder="a few words help — “chicken burrito bowl”"
        disabled={busy}
        onChange={(e) => setCaption(e.target.value)}
      />
      {logErr && <div className="mc-err">{logErr}</div>}
      <button className="mc-log" disabled={busy} onClick={onLog}>
        {busy ? 'Writing it down…' : `Log ${mealKind}`}
      </button>
    </div>
  );
}
