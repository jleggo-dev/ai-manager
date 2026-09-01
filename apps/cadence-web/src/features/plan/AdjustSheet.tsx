import { useState } from 'react';
import { replan, dismissReplanPreview } from '../../lib/api.ts';
import { markWeekApplied } from '../../lib/applied-week-note.ts';
import { Orb } from '../../components/Orb.tsx';
import { SteerBox } from './SteerBox.tsx';
import { ProposedWeek } from './ProposedWeek.tsx';
import { useReplanPreview } from './useReplanPreview.ts';

/**
 * "Adjust my plan" as a pop-up sheet (was a persistent bottom bar). Same suggest-never-
 * auto-apply flow: steer (optional, in the user's own words) → preview the coach's proposed
 * week → confirm or "Not now". The sheet owns the whole lifecycle; the parent just refreshes
 * on commit. Voice input on the steer box (SteerBox).
 *
 * The synthesis behind "See the adjustment" runs server-side as a durable background run — see
 * useReplanPreview, which owns the polling, the real stage line, and the honest copy. This file is
 * the surface only, and because the run survives the client, closing the sheet mid-run is safe:
 * the × and the scrim stay live, and the finished week comes back via push + the plan view's
 * mount-time pending check. It gets the taller `sheet-compose` treatment while composing, because
 * the ask is the whole point of the screen and it was being typed into two fixed lines at the
 * bottom of a 78%-height sheet (owner, 2026-08-15: "There's more real-estate here that we can
 * use").
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
  const [committing, setCommitting] = useState(false);
  const [msg, setMsg] = useState('');
  // Rebalance opens straight into a whole-plan preview — the review IS the action, no steer
  // needed. The hook checks for a server-side pending proposal FIRST either way, so a week the
  // coach already drew is shown, never re-synthesized over (2026-08-31).
  const preview = useReplanPreview({ steer: () => steer, adoptCaptured, autoStart: mode === 'rebalance' });
  const busy = preview.busy || committing;

  async function doConfirm() {
    if (busy) return;
    setCommitting(true);
    setMsg('');
    try {
      const r = await replan();
      if (r.status === 'committed') {
        // She opens the next chat visit with one line about the week they just applied
        // (owner pick "B", 2026-08-31) — see lib/applied-week-note.ts.
        markWeekApplied();
        onCommitted(r.note?.trim() || 'Updated your plan to fit how this stretch has been going.');
        onClose();
        return;
      }
      // Not committed — the message goes through preview.setError, not msg, because clearing the
      // proposal returns the sheet to its start screen and only preview.error renders there (the
      // old setMsg lines were written and then never shown). The start screen's button reads
      // "Try again", which draws a fresh preview — exactly the road back.
      if (r.status === 'vetoed') {
        // 422: the pending week expired server-side. Say why in the server's words.
        preview.setError(
          r.violations?.join('; ') || 'That adjustment went stale while it waited — let me draw a fresh one.',
        );
      } else {
        preview.setError("I couldn't adjust it just now — give it another try in a bit.");
      }
      preview.clearProposal();
    } catch {
      setMsg('Something hiccuped on my end — try again in a moment.');
    } finally {
      setCommitting(false);
    }
  }

  function doDismiss() {
    dismissReplanPreview().catch(() => {});
    onClose();
  }

  const p = preview.proposal;
  // Tall for the WHOLE adjust flow, not just while the box has focus: shrinking the sheet the
  // instant they tap 'See the adjustment' is a jump on a screen that then sits still for minutes.
  const composing = !p && mode === 'adjust';

  return (
    <>
      {/* Live even mid-run: the synthesis is server-durable, so closing loses nothing — the
          finished week comes back via push + the plan view's pending check. */}
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div
        className={`sheet${composing ? ' sheet-compose' : ''}${p ? ' sheet-week' : ''}`}
        role="dialog"
        aria-label="Adjust my plan"
      >
        <div className="sheet-grab" aria-hidden />
        <div className="sheet-head">
          <div className="sheet-title">
            <b>
              {p
                ? mode === 'rebalance'
                  ? 'Your rebalanced week'
                  : "Here's the adjustment I'd make"
                : mode === 'rebalance'
                  ? 'Rebalancing your plan'
                  : 'Adjust my plan'}
            </b>
            <span>
              {p
                ? 'Proposed — nothing saves yet.'
                : mode === 'rebalance'
                  ? 'Reviewing every goal so your whole week stays balanced.'
                  : 'Committed, not locked — it bends to fit how you’re doing.'}
            </span>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!p ? (
          <div className="sheet-body">
            {preview.busy ? (
              <Waiting note={preview.note} elapsedMs={preview.elapsedMs} />
            ) : mode === 'rebalance' ? (
              <div className="sess-note">
                <Orb />
                <span>{preview.error || 'Reviewing your whole plan so nothing is over- or under-loaded.'}</span>
              </div>
            ) : (
              <>
                <div className="logbox-label">Anything specific you want changed?</div>
                <SteerBox
                  value={steer}
                  onChange={setSteer}
                  disabled={busy}
                  placeholder="e.g. one run day isn't enough — I want three"
                  autoFocus
                />
                {preview.error && <div className="auth-error">{preview.error}</div>}
              </>
            )}
            {!preview.busy && (
              <button className="lockbtn" onClick={() => void preview.start()}>
                {preview.error ? 'Try again' : 'See the adjustment →'}
              </button>
            )}
          </div>
        ) : (
          <div className="sheet-body wk-body">
            <div className="wk-scroll">
              <ProposedWeek activities={p.activities} note={p.note} />
            </div>
            {msg && <div className="auth-error">{msg}</div>}
            <div className="proposal-actions wk-actions">
              <button className="proposal-accept" onClick={doConfirm} disabled={busy}>
                {committing ? 'Setting it…' : 'Make this my week'}
              </button>
              <button className="proposal-dismiss" onClick={doDismiss} disabled={busy}>
                Not now — keep my current plan
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** The wait, told the truth about itself: the stage the run is ACTUALLY in (reported by the
 *  server, not guessed from the clock), how long it's been, and that leaving is fine — which is
 *  now true in every phase, because the run survives the client. The elapsed clock is the part
 *  that proves the screen isn't frozen. */
function Waiting({ note, elapsedMs }: { note: string; elapsedMs: number }) {
  const s = Math.floor(elapsedMs / 1000);
  const clock = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return (
    <div className="sess-note adjust-wait">
      <Orb />
      <span>
        {note}
        <em className="adjust-elapsed">{clock} · You can leave — I’ll send a notification when it’s ready</em>
      </span>
    </div>
  );
}
