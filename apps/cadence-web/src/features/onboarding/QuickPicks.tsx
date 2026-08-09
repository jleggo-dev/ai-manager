import { useEffect, useState } from 'react';
import { composePickMessage, type CoachPicks } from '@cadence/shared';

/**
 * The coach's quick picks, rendered under the turn that asked for them.
 *
 * **Tapping writes; it never sends.** A pick composes plain words into the composer and stops
 * there — the send arrow is still the user's. That is what keeps a tap and a typed sentence the
 * same act: someone can tap "3 days", read it back, change it to "3, but not Tuesdays", and
 * send that instead. It also means there is no CONTINUE button and no "something else" row —
 * the composer already is the something-else row, and says so.
 *
 * **Two layouts, no more.** `list` for labelled options, `tiles` for short scalars. The vocabulary
 * is small so the same two shapes can carry weekly check-ins and plan adjustments later without
 * anyone having to learn a third thing.
 *
 * Selection is local and resets with the question (the caller keys this by turn), because the
 * answer belongs to the message being composed, not to the conversation.
 */
export function QuickPicks({
  picks,
  disabled = false,
  onCompose,
}: {
  picks: CoachPicks;
  disabled?: boolean;
  onCompose: (text: string) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);

  // Composing in an effect rather than inside the click handler keeps one code path for both
  // layouts and both multi modes — the composed sentence is a function of the selection, full stop.
  useEffect(() => {
    if (selected.length) onCompose(composePickMessage(picks, selected));
    // onCompose is a setState wrapper from the parent; re-running on its identity would fight the
    // user's own typing on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, picks]);

  // Re-tapping the chosen option clears it: a pick is an answer being drafted, not a commitment,
  // and a single-select grid you cannot back out of is a trap on a touch screen.
  const toggle = (i: number) =>
    setSelected((s) =>
      picks.multi ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]) : s.includes(i) ? [] : [i],
    );

  const Check = () => (
    <span className="qp-check" aria-hidden>
      ✓
    </span>
  );

  if (picks.layout === 'tiles') {
    return (
      <div className="qp qp-tiles" role="group" aria-label="Quick answers">
        {picks.options.map((o, i) => (
          <button
            key={`${o.label}-${i}`}
            type="button"
            aria-pressed={selected.includes(i)}
            disabled={disabled}
            className={`qp-tile${selected.includes(i) ? ' is-picked' : ''}`}
            onClick={() => toggle(i)}
          >
            <b>{o.label}</b>
            {o.hint && <span>{o.hint}</span>}
            {selected.includes(i) && <Check />}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="qp qp-list" role="group" aria-label="Quick answers">
      {picks.options.map((o, i) => (
        <button
          key={`${o.label}-${i}`}
          type="button"
          aria-pressed={selected.includes(i)}
          disabled={disabled}
          className={`qp-row${selected.includes(i) ? ' is-picked' : ''}`}
          onClick={() => toggle(i)}
        >
          <span className={`qp-dot${o.area ? ` is-${o.area}` : ''}`} aria-hidden />
          <span className="qp-label">{o.label}</span>
          {selected.includes(i) && <Check />}
        </button>
      ))}
    </div>
  );
}
