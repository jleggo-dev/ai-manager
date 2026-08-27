import type { WeekReviewFacts } from '../../../lib/api.ts';
import { mealsRollup, mindsetRollup, sessionsRollup, type KeptTotal } from './week-review-derive.ts';

/** A small grid of cells, kept ones read forest and the rest a quiet neutral track — never red
 *  (BRAND.md: count what happened, not what broke). Purely decorative; the count beside it is
 *  what a screen reader hears. */
function SegmentGrid({ kept, total, columns }: KeptTotal & { columns: number }) {
  return (
    <div className="wkr-segrid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }} aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`wkr-seg${i < kept ? ' is-kept' : ''}`} />
      ))}
    </div>
  );
}

function RollupCard({ label, kept, total, columns }: KeptTotal & { label: string; columns: number }) {
  // A week with none of this kind at all (no mind/practice goal, say) has nothing to roll up —
  // render nothing rather than a false "0 of 0" (BRAND.md's own example of the shame it forbids).
  if (total === 0) return null;
  return (
    <div className="prog-card wkr-rollup">
      <div className="wkr-rollup-head">
        <span className="wkr-rollup-label">{label}</span>
        <span className="wkr-rollup-n" aria-label={`${kept} of ${total} kept`}>
          {kept}/{total}
        </span>
      </div>
      <SegmentGrid kept={kept} total={total} columns={columns} />
    </div>
  );
}

/**
 * The week's three rollups — MEALS / SESSIONS / MINDSET — each a "kept/total" count over a cell
 * grid of the same units DayChips' rings summarize per day (week-review-derive.ts is the one
 * place both read). Any card whose week held none of that kind renders nothing rather than an
 * empty frame — same rule the standalone `RollupCard` applies per-card.
 */
export function RollupCards({ facts }: { facts: WeekReviewFacts }) {
  const meals = mealsRollup(facts.days);
  const sessions = sessionsRollup(facts.days);
  const mindset = mindsetRollup(facts.days);

  return (
    <div className="wkr-rollups">
      <RollupCard label="MEALS" columns={7} {...meals} />
      <RollupCard label="SESSIONS" columns={7} {...sessions} />
      <RollupCard label="MINDSET" columns={7} {...mindset} />
    </div>
  );
}
