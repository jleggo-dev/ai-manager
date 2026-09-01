/**
 * After save (design E, trimmed) — "three doors, then the coach" minus the coach turn and minus
 * "Put it on the plan" (scheduling ships with the Settings/store parcels — W3-3/W3-1). Two doors
 * left: run it now, or just leave it saved. Both hand the same routine back to the host via
 * `onSaved` — the host decides what either press leads to (this component owns the save MOMENT,
 * never the navigation after it).
 *
 * `isUpdate` (added for the Settings "Edit steps" door, post-merge) swaps the subtitle for one
 * that's honest about what changed — a fresh save is new to the library; an update just changes
 * an existing routine's future runs, which is a different, narrower claim.
 */
export function SavedMoment({
  name,
  isUpdate = false,
  onRunNow,
  onDone,
}: {
  name: string;
  isUpdate?: boolean;
  onRunNow: () => void;
  onDone: () => void;
}) {
  return (
    <div className="ab-saved" role="region" aria-label="Saved">
      <div className="ab-saved-grab" aria-hidden />
      <div className="ab-saved-head">
        <div className="ab-saved-title">{name} — saved</div>
        <div className="ab-saved-sub">
          {isUpdate ? 'Saved — future runs follow the new steps.' : 'It’s in Your activities and on the ＋ sheet.'}
        </div>
      </div>
      <button type="button" className="ab-saved-run" onClick={onRunNow}>
        Run it now
      </button>
      <button type="button" className="ab-saved-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
