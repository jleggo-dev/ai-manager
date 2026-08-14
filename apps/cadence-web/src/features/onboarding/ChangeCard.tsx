import { useEffect, useState } from 'react';
import { dismissPendingChange, getPendingChange, lockPlan } from '../../lib/api.ts';

/**
 * "Here's the one change — apply it?"
 *
 * The narrow sibling of ConfirmCard. That card rebuilds a week from everything known; this one
 * shows a SPECIFIC edit the coach worked out with `propose_plan_change` — move Thursday's run to
 * Friday, cut the sit to ten minutes — and applies exactly that on a tap.
 *
 * **The lines come from the server, not from the turn that announced them.** The tool computed
 * the change and stored it; this card reads it back. So a reply that describes the change loosely,
 * or gets it wrong, still cannot alter what the user is agreeing to — the card is the truth and
 * the tap is the consent.
 *
 * Applying runs the same commit path a first build runs, so a changed plan is a normal new
 * version with its occurrences materialized — not a special case anything downstream has to know
 * about. "Not now" drops the proposal and leaves the plan exactly as it was; the coach can offer
 * again in the same conversation, which is the whole reason this is a repeatable tool and not a
 * one-shot screen.
 */
export function ChangeCard({ onApplied }: { onApplied?: () => void }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [state, setState] = useState<'idle' | 'applying' | 'applied' | 'gone' | 'failed'>('idle');

  useEffect(() => {
    let alive = true;
    void getPendingChange()
      .then((c) => {
        if (alive) setLines(c?.changes ?? null);
      })
      .catch(() => {
        /* the prose still says what she proposed; a missing card is not a broken turn */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Nothing pending (already applied, or dismissed on another device) — render nothing rather
  // than an empty frame promising a change that isn't there.
  if (!lines?.length || state === 'gone') return null;

  async function apply() {
    setState('applying');
    try {
      const { status } = await lockPlan();
      if (status !== 200) return setState('failed');
      setState('applied');
      onApplied?.();
    } catch {
      setState('failed');
    }
  }

  async function dismiss() {
    setState('gone');
    await dismissPendingChange().catch(() => {
      /* it stays pending server-side; the next card will show it again */
    });
  }

  return (
    <div className="cfm chg">
      <div className="chg-t">{state === 'applied' ? "Done — that's your plan now" : "Here's what I'd change"}</div>
      <ul className="chg-list">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {state === 'applied' ? null : (
        <>
          {state === 'failed' && <div className="chg-err">That didn&rsquo;t take — try again?</div>}
          <button type="button" className="cfm-build" onClick={() => void apply()} disabled={state === 'applying'}>
            {state === 'applying' ? 'Changing…' : 'Apply this'}
          </button>
          <button type="button" className="cfm-more" onClick={() => void dismiss()}>
            Not now
          </button>
        </>
      )}
    </div>
  );
}
