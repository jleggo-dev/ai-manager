import type { ThenNowPayload } from '@cadence/shared';

/**
 * `then_now` — plain before/after rows (owner design 1a, "THEN → NOW · since Jan 5"): a family
 * dot, the label, then the two ends — "20 lb → 50 lb" — with the early value muted and the recent
 * one strong. Both strings arrive formatted from the resolver; this draws them and adds nothing.
 * The muted/strong weighting marks WHICH end is current, never which is better — a decline
 * renders exactly as plainly as a gain.
 */
export function ThenNowWidget({ data }: { data: ThenNowPayload }) {
  return (
    <div className="pw-tn">
      {data.pairs.map((pair, i) => (
        <div className="pw-tn-row" key={`${pair.label}-${i}`}>
          <span className={`pw-tn-dot pw-tn-dot--${pair.area ?? 'none'}`} aria-hidden />
          <span className="pw-tn-label">{pair.label}</span>
          <span className="pw-tn-ends">
            <span className="pw-tn-then">{pair.then}</span>
            <span className="pw-tn-arrow" aria-hidden>
              →
            </span>
            <span className="pw-tn-now">{pair.now}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
