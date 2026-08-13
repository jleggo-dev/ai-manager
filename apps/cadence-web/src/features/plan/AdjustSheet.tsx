import { useEffect, useState } from 'react';
import type { PendingPlanActivity } from '@cadence/shared';
import { confirmGoals, previewReplan, replan, dismissReplanPreview, getPendingReplan } from '../../lib/api.ts';
import { MicButton } from '../../components/MicButton.tsx';
import { Orb } from '../../components/Orb.tsx';

/**
 * "Adjust my plan" as a pop-up sheet (was a persistent bottom bar). Same suggest-never-
 * auto-apply flow: steer (optional, in the user's own words) → preview the coach's proposed
 * week → confirm or "Not now". The sheet owns the whole lifecycle; the parent just refreshes
 * on commit. Voice input on the steer box (MicButton).
 *
 * `mode='rebalance'` is the "review my whole plan" action: no steer box — it opens straight into a
 * no-steer preview (which, with fan-out enabled, runs the holistic reduce over every goal) so the
 * user just reviews and confirms the rebalanced week.
 */
export function AdjustSheet({
  onClose,
  onCommitted,
  initialSteer,
  mode = 'adjust',
  adoptCaptured = false,
}: {
  onClose: () => void;
  onCommitted: (note: string) => void;
  initialSteer?: string; // pre-filled request (e.g. the nutrition baseline's suggested change)
  mode?: 'adjust' | 'rebalance';
  /**
   * Promote anything the Broker captured but the user never confirmed before synthesizing.
   *
   * Set by the coach's build card, and only there. Re-planning reads goals at status `confirmed`
   * or `committed`, but a goal mentioned in the chat two minutes ago is still `captured` — so the
   * card would list "Write a novel" back to them, they'd tap Rebuild, and the week would come back
   * without it. Tapping the build button IS the confirmation; that is the same thing onboarding's
   * build does (useBuildPlan) before it locks. Never set for the automated re-plans, where nobody
   * has agreed to adopt anything.
   */
  adoptCaptured?: boolean;
}) {
  const [steer, setSteer] = useState(initialSteer ?? '');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ activities: PendingPlanActivity[]; note: string } | null>(null);
  const [msg, setMsg] = useState('');

  // Rebalance opens straight into a whole-plan preview — the review IS the action, no steer needed.
  useEffect(() => {
    if (mode === 'rebalance') void doPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doPreview() {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      // Before synthesis, not after: a captured-but-unconfirmed goal is invisible to the re-plan.
      if (adoptCaptured) await confirmGoals().catch(() => undefined);
      const r = await previewReplan(steer);
      if (r.status === 'proposed' && r.proposal) setPreview(r.proposal);
      else setMsg(r.violations?.join('; ') || "I couldn't put together an adjustment just now — try again in a bit.");
    } catch {
      // The FETCH died — on a phone, usually the app being backgrounded while the server kept
      // synthesizing. previewReplan persists its result as pending_plan the moment it finishes,
      // so poll for THAT before reporting a failure that may not have happened (and before
      // paying for a second synthesis).
      const deadline = Date.now() + 3 * 60_000;
      while (Date.now() < deadline) {
        try {
          const { proposal } = await getPendingReplan();
          if (proposal) {
            setPreview(proposal);
            setBusy(false);
            return;
          }
        } catch {
          /* offline blip — keep polling */
        }
        await new Promise((res) => setTimeout(res, 5_000));
      }
      setMsg('Something hiccuped on my end — try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function doConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await replan();
      if (r.status === 'committed') {
        onCommitted(r.note?.trim() || 'Updated your plan to fit how this stretch has been going.');
        onClose();
        return;
      }
      setMsg("I couldn't adjust it just now — give it another try in a bit.");
      setPreview(null);
    } catch {
      setMsg('Something hiccuped on my end — try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  function doDismiss() {
    dismissReplanPreview().catch(() => {});
    onClose();
  }

  return (
    <>
      <div className="sheet-scrim" onClick={busy ? undefined : onClose} aria-hidden />
      <div className="sheet" role="dialog" aria-label="Adjust my plan">
        <div className="sheet-grab" aria-hidden />
        <div className="sheet-head">
          <div className="sheet-title">
            <b>
              {preview
                ? mode === 'rebalance'
                  ? "Here's your rebalanced plan"
                  : "Here's the adjustment I'd make"
                : mode === 'rebalance'
                  ? 'Rebalancing your plan'
                  : 'Adjust my plan'}
            </b>
            <span>
              {preview
                ? ''
                : mode === 'rebalance'
                  ? 'Reviewing every goal so your whole week stays balanced.'
                  : 'Committed, not locked — it bends to fit how you’re doing.'}
            </span>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!preview ? (
          mode === 'rebalance' ? (
            <div className="sheet-body">
              <div className="sess-note">
                <Orb />
                <span>
                  {busy
                    ? 'Looking across all your goals and rebalancing your week…'
                    : msg || 'Reviewing your whole plan so nothing is over- or under-loaded.'}
                </span>
              </div>
              {msg && !busy && (
                <button className="lockbtn" onClick={doPreview}>
                  Try again
                </button>
              )}
            </div>
          ) : (
            <div className="sheet-body">
              <div className="logbox-label">Anything specific you want changed?</div>
              <div className="steer-row">
                <textarea
                  className="steer-in"
                  value={steer}
                  onChange={(e) => setSteer(e.target.value)}
                  placeholder="e.g. one run day isn't enough — I want three"
                  rows={2}
                  disabled={busy}
                />
                <MicButton value={steer} onChange={setSteer} disabled={busy} />
              </div>
              {msg && <div className="auth-error">{msg}</div>}
              <button className="lockbtn" onClick={doPreview} disabled={busy}>
                {busy ? 'Looking at your options…' : 'See the adjustment →'}
              </button>
            </div>
          )
        ) : (
          <div className="sheet-body">
            {preview.note && (
              <div className="sess-note">
                <Orb />
                <span>{preview.note}</span>
              </div>
            )}
            <div className="proposal-levers" style={{ marginTop: 10 }}>
              {preview.activities.map((a, i) => (
                <span className="lever-chip" key={i}>
                  {a.title} · {a.cadence}
                </span>
              ))}
            </div>
            {msg && <div className="auth-error">{msg}</div>}
            <div className="proposal-actions">
              <button className="proposal-accept" onClick={doConfirm} disabled={busy}>
                {busy ? 'Setting it…' : 'Yes, adjust it'}
              </button>
              <button className="proposal-dismiss" onClick={doDismiss} disabled={busy}>
                Not now
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
