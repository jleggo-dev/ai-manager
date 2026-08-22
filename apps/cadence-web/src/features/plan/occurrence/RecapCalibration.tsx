import { useState } from 'react';
import { setMacroTargets, type WeeklyRecap } from '../../../lib/api.ts';

type Calibration = NonNullable<WeeklyRecap['calibration']>;

const WAITING: Record<NonNullable<Calibration['blocker']>, string> = {
  not_enough_logged_days: 'I need a few more logged days before I can work out what your maintenance actually is.',
  not_enough_weigh_ins: 'A few more weigh-ins and I can tell you what your maintenance actually is.',
  window_too_short: 'Still gathering — this one needs a few weeks behind it.',
};

/**
 * A23 §3 — what maintenance is, and the target that follows from it.
 *
 * The number is deliberately labelled "in the units this app counts", because that is what it is:
 * maintenance measured against a ledger, not a laboratory. If the ledger prices everything 20%
 * low, this number is 20% low too — and the deficit it implies still produces the intended weight
 * change, because the bias sits on both sides of the subtraction. Saying so is more honest than
 * presenting a metabolic fact, and it is the sentence that makes the rest of it trustworthy.
 *
 * Suggest-never-auto-apply, unchanged: nothing here moves a target without a tap.
 */
export function RecapCalibration({ calibration, onApplied }: { calibration: Calibration; onApplied?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const { maintenance, proposed, current_kcal, blocker } = calibration;

  if (!maintenance) {
    // "Not yet" is a real answer. Showing the progress makes it a countdown rather than a closed door.
    const line = blocker ? WAITING[blocker] : null;
    if (!line) return null;
    return (
      <div className="recap-cal">
        <div className="recap-k">STILL WORKING IT OUT</div>
        <div className="recap-cal-wait">
          {line}
          {blocker === 'not_enough_logged_days' && (
            <>
              {' '}
              ({calibration.complete_days} of {calibration.complete_days_needed} days so far.)
            </>
          )}
        </div>
      </div>
    );
  }

  const changed = proposed && current_kcal !== null && proposed.kcal !== current_kcal;

  async function apply() {
    if (!proposed || busy) return;
    setBusy(true);
    setErr('');
    try {
      await setMacroTargets({ kcal: proposed.kcal });
      setDone(true);
      onApplied?.();
    } catch {
      setErr("That didn't save — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="recap-cal">
      <div className="recap-k">WHAT YOUR WEEK SAYS</div>
      <div className="recap-fig">
        <b>~{maintenance.maintenance_kcal}</b>
        <span>
          kcal to hold steady, in the units this app counts — from {maintenance.complete_days} logged days
          {maintenance.confidence === 'low' ? ' · still forming' : ''}
        </span>
      </div>

      {proposed && (
        <>
          <div className="recap-fig">
            <b>{proposed.kcal}</b>
            <span>
              {calibration.direction === 'lose'
                ? 'to keep losing at a pace that holds'
                : calibration.direction === 'gain'
                  ? 'to keep gaining steadily'
                  : 'to stay where you are'}
              {current_kcal !== null ? ` · you're aiming ${current_kcal} now` : ''}
            </span>
          </div>

          {/* When a guardrail moved the number, say so — a silent difference is a number nobody
              can question, and this one is deliberately conservative. */}
          {proposed.limited_by === 'maintenance_floor' && (
            <div className="recap-cal-wait">I&apos;ve held this above a floor — going lower isn&apos;t worth it.</div>
          )}
          {proposed.limited_by === 'ratchet' && (
            <div className="recap-cal-wait">
              We&apos;ve already trimmed this month, so I&apos;d rather talk than cut again.
            </div>
          )}

          {done ? (
            <div className="recap-cal-wait">Set. You can always change it in settings.</div>
          ) : (
            changed && (
              <button type="button" className="logbox-btn" disabled={busy} onClick={() => void apply()}>
                {busy ? 'Setting…' : `Use ${proposed.kcal} kcal`}
              </button>
            )
          )}
          {err && <div className="food-empty">{err}</div>}
        </>
      )}
    </div>
  );
}
