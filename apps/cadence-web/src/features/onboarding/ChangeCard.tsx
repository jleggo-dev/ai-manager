import { useEffect, useState } from 'react';
import { dismissPendingChange, getPendingChange, getPendingChangeDetail, lockPlan } from '../../lib/api.ts';

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
 * **Two branches, decided by whether any item carries a per-item field.** An ordinary requested
 * tweak ("move Thursday's run to Friday") applies inline exactly as it always has — Apply runs the
 * same commit path a first build runs. A change that came from a check-in offer carries a
 * `change_reason` and/or an optional add (propose_plan_change's `reason`/`optional`, stamped onto
 * the stored activities as `change_reason`/`enabled` — plan-edit.ts) — those need the Changes
 * sheet's toggles and NOW/NEXT detail, not a blind inline Apply that would commit every optional
 * add for free. "Not now" drops the proposal either way and leaves the plan exactly as it was; the
 * coach can offer again in the same conversation, which is the whole reason this is a repeatable
 * tool and not a one-shot screen.
 */
export function ChangeCard({
  onApplied,
  onShowChanges,
}: {
  onApplied?: () => void;
  /** Opens the Changes sheet instead of applying inline — set only when this pending change
   *  carries per-item fields, the signature of a check-in offer. Same idiom as WeekReviewCard's
   *  `onOpen`: the host mounts the real surface, this card only asks for it. */
  onShowChanges?: () => void;
}) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [hasOffers, setHasOffers] = useState(false);
  const [state, setState] = useState<'idle' | 'applying' | 'applied' | 'gone' | 'failed'>('idle');

  useEffect(() => {
    let alive = true;
    void Promise.all([getPendingChange(), getPendingChangeDetail()])
      .then(([c, detail]) => {
        if (!alive) return;
        setLines(c?.changes ?? null);
        setHasOffers(detail.items.some((i) => !!i.change_reason || !i.enabled));
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

  // A check-in offer needs the sheet's toggles + NOW/NEXT detail before it commits — an inline
  // Apply here would ship every optional add for free, which is the one thing an offer must not do.
  if (hasOffers && onShowChanges && state === 'idle') {
    return (
      <div className="cfm chg">
        <div className="chg-t">Your coach has some ideas for next week</div>
        <ul className="chg-list">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <button type="button" className="cfm-build" onClick={onShowChanges}>
          Show me
        </button>
        <button type="button" className="cfm-more" onClick={() => void dismiss()}>
          Not now
        </button>
      </div>
    );
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
