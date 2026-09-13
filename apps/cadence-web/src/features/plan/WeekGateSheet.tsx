import type { GateVariant } from './checkinGate.ts';

/**
 * The gate prompt (owner, 2026-09-09) — what a tap past the weekly check-in asks. One sheet,
 * three wordings (checkinGate.ts decides which), in the door-sheet idiom (DoorSheet.tsx): the
 * question up top, one tap per answer, the quiet exit last. "Just build my week" is the skipped
 * check-in's name everywhere in the app (DESIGN-check-in.md: never "Skip" — this is trust, not
 * dismissal), so the owner's "skip til next week" wears it here too.
 */
export function WeekGateSheet({
  variant,
  day,
  busy,
  error,
  onCheckIn,
  onBuild,
  onLater,
  onSkip,
  onClose,
}: {
  variant: GateVariant;
  /** Day N of the plan — the early wording names it. */
  day: number;
  busy: boolean;
  error: string | null;
  /** "Check in now" — the visible send to the coach (MainTabs' autoSend bridge). */
  onCheckIn: () => void;
  /** "Build next week" — writes the following week; the check-in stays where it is. */
  onBuild: () => void;
  /** "Later today" — quiet for the rest of the day; the tapped activity opens. */
  onLater: () => void;
  /** "Just build my week" — the skipped check-in: the same rhythm rolls into a new week. */
  onSkip: () => void;
  onClose: () => void;
}) {
  const building = busy ? 'Building…' : null;
  return (
    <>
      <div className="sheet-scrim" onClick={busy ? undefined : onClose} />
      <div className="sheet door-sheet week-gate" role="dialog" aria-label="Your weekly check-in">
        <div className="sheet-grab" aria-hidden />
        {variant === 'early' && (
          <>
            <div className="door-sheet-h">
              <b>It&rsquo;s only day {day} of your plan</b>
              <span>
                Want me to build next week already? It&rsquo;ll follow the same rhythm, and your check-in stays where it
                is.
              </span>
            </div>
            {error && <span className="eot-err">{error}</span>}
            <button className="door-choice" onClick={onBuild} disabled={busy}>
              <b>{building ?? 'Build next week'}</b>
            </button>
            <button className="adhoc-cancel" onClick={onClose} disabled={busy}>
              Not yet
            </button>
          </>
        )}
        {variant === 'midweek' && (
          <>
            <div className="door-sheet-h">
              <b>We&rsquo;re still working through this week</b>
              <span>The days past your check-in open once we&rsquo;ve had it. Would you like to:</span>
            </div>
            {error && <span className="eot-err">{error}</span>}
            <button className="door-choice" onClick={onCheckIn} disabled={busy}>
              <b>Check in now</b>
              <span>We go through this week early, and I plan the next one from there.</span>
            </button>
            <button className="door-choice" onClick={onBuild} disabled={busy}>
              <b>{building ?? 'Build next week'}</b>
              <span>Same rhythm, written now. Your check-in stays where it is.</span>
            </button>
            <button className="adhoc-cancel" onClick={onClose} disabled={busy}>
              Just browsing
            </button>
          </>
        )}
        {variant === 'due' && (
          <>
            <div className="door-sheet-h">
              <b>Do you want to check in today?</b>
              <span>Your week wraps up here. A check-in lets me tailor next week around how it went.</span>
            </div>
            {error && <span className="eot-err">{error}</span>}
            <button className="door-choice" onClick={onCheckIn} disabled={busy}>
              <b>Check in now</b>
            </button>
            <button className="door-choice" onClick={onLater} disabled={busy}>
              <b>Later today</b>
              <span>I&rsquo;ll leave the card on your trail; start it from there when you&rsquo;re ready.</span>
            </button>
            <button className="door-choice" onClick={onSkip} disabled={busy}>
              <b>{building ?? 'Just build my week'}</b>
              <span>Keep the same rhythm, no check-in this time. Next one in a week.</span>
            </button>
            <button className="adhoc-cancel" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </>
        )}
      </div>
    </>
  );
}
