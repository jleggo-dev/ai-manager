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
 */
export function CapturedPills({ goals, onFix }: { goals: readonly CapturedGoal[]; onFix?: (id: string) => void }) {
  if (!goals.length) return null;
  return (
    <div className="cappills">
      <div className="cappills-k">{"What I've got so far — tap to fix"}</div>
      <div className="cappills-row">
        {goals.map((g) => (
          <button key={g.id} type="button" className="cappill" onClick={() => onFix?.(g.id)}>
            <span aria-hidden>✓</span>
            {g.title}
          </button>
        ))}
      </div>
    </div>
  );
}
