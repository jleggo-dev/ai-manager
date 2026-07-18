import { useState } from 'react';
import type { PendingPlanActivity } from '@cadence/shared';
import { previewReplan, replan, dismissReplanPreview } from '../../lib/api.ts';
import { MicButton } from '../../components/MicButton.tsx';
import { Orb } from '../../components/Orb.tsx';

/**
 * "Adjust my plan" as a pop-up sheet (was a persistent bottom bar). Same suggest-never-
 * auto-apply flow: steer (optional, in the user's own words) → preview the coach's proposed
 * week → confirm or "Not now". The sheet owns the whole lifecycle; the parent just refreshes
 * on commit. Voice input on the steer box (MicButton).
 */
export function AdjustSheet({
  onClose,
  onCommitted,
  initialSteer,
}: {
  onClose: () => void;
  onCommitted: (note: string) => void;
  initialSteer?: string; // pre-filled request (e.g. the nutrition baseline's suggested change)
}) {
  const [steer, setSteer] = useState(initialSteer ?? '');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ activities: PendingPlanActivity[]; note: string } | null>(null);
  const [msg, setMsg] = useState('');

  async function doPreview() {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await previewReplan(steer);
      if (r.status === 'proposed' && r.proposal) setPreview(r.proposal);
      else setMsg(r.violations?.join('; ') || "I couldn't put together an adjustment just now — try again in a bit.");
    } catch {
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
            <b>{preview ? "Here's the adjustment I'd make" : 'Adjust my plan'}</b>
            <span>{preview ? '' : 'Committed, not locked — it bends to fit how you’re doing.'}</span>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!preview ? (
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
