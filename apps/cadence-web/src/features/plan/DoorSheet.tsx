/**
 * The fork behind the felt-statement door (owner ruling 2026-08-31, closing the placement
 * round's open thread): "my plan isn't working — I'm too busy" can mean two different fixes,
 * and the door must not assume which. A time-bound TEMPORARY plan is a detour — the regular
 * plan pauses and comes back, never resets (DetourSetup). A regular tweak is the Adjust flow —
 * steer → preview → confirm, suggest-never-auto-apply as always. One tap either way; Cancel
 * (or the scrim) costs nothing.
 */
export function DoorSheet({
  onTempPlan,
  onAdjust,
  onClose,
}: {
  /** "New temporary plan" → the detour setup (type, how long, what you've got with you). */
  onTempPlan: () => void;
  /** "Adjust my plan" → the AdjustSheet's steer → preview → confirm flow. */
  onAdjust: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet door-sheet" role="dialog" aria-label="Which kind of fix">
        <div className="sheet-grab" aria-hidden />
        <div className="door-sheet-h">
          <b>Two ways I can fix this</b>
          <span>Tell me which fits.</span>
        </div>
        <button className="door-choice" onClick={onTempPlan}>
          <b>New temporary plan</b>
          <span>Time-bound — travel, illness, a busy stretch. We take a detour: your plan pauses, never resets.</span>
        </button>
        <button className="door-choice" onClick={onAdjust}>
          <b>Adjust my plan</b>
          <span>A regular tweak — change what&rsquo;s in this week.</span>
        </button>
        <button className="adhoc-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}
