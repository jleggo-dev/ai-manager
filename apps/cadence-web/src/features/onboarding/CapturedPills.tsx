import type { CapturedGoal } from './useCoachChat.ts';

/**
 * What the Broker has heard, surfaced while the conversation is still going.
 *
 * The old chat hid this behind a counter — "2 goals · Review →" — which tells you something was
 * heard but not *what*, so the first time you saw your own words back was at the end, when being
 * wrong meant unpicking a review. These are the captures in the coach's own summary form, landing
 * as they land, so nothing at the confirmation is a surprise. Tapping one goes and fixes it.
 *
 * Nothing renders until there is something to show: an empty "here's what I've got" strip on the
 * first question is a promise the coach hasn't earned yet.
 *
 * **Tapping one corrects it in the conversation, not in a wizard.** These used to open the curate
 * screens — the pre-v2 UI the redesign exists to replace — which meant "tap to fix" threw you out
 * of the chat you were mid-way through and into a form. A tap now drafts the correction into the
 * composer, exactly like a quick pick: same gesture, same place, and Cadence can just be told.
 */
export function CapturedPills({
  goals,
  onFix,
}: {
  goals: readonly CapturedGoal[];
  onFix?: (goal: CapturedGoal) => void;
}) {
  if (!goals.length) return null;
  return (
    <div className="cappills">
      <div className="cappills-k">{"What I've got so far — tap to fix"}</div>
      <div className="cappills-row">
        {goals.map((g) => (
          <button key={g.id} type="button" className="cappill" onClick={() => onFix?.(g)}>
            <span aria-hidden>✓</span>
            {g.title}
          </button>
        ))}
      </div>
    </div>
  );
}
