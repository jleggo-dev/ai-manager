import type { WeekReviewFacts } from '../../../lib/api.ts';
import { mealsRollup, mindsetRollup, type KeptTotal } from './week-review-derive.ts';
import { WidgetSection } from '../../progress/widgets/registry.tsx';

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
 * The week's three rollups — MEALS / SESSIONS / MINDSET.
 *
 * Progress Engine parcel W2-2: SESSIONS now renders through the SHARED `rhythm` widget
 * (`WidgetSection` + `RhythmWidget`, the frozen widget grammar in `@cadence/shared`), fed by the
 * facts payload's own `rhythm_week` — a REAL `RhythmWeek` (the review's actual period, one state
 * per calendar date) computed server-side by `week-review-widgets.ts`. This is a genuine,
 * undistorted fit: a week's sessions already ARE one state per date, exactly what `RhythmWeek`
 * models, so nothing about the widget's contract needed bending.
 *
 * MEALS and MINDSET deliberately keep the bespoke `SegmentGrid` cell count instead of following
 * suit — two reasons, both "don't force a worse fit to satisfy purity":
 *   1. No shared widget models "N discrete slots kept of M" at day granularity without
 *      distortion. `weekly_bars` (the nearest kind) hardcodes multi-week copy ("N weeks ago" /
 *      "this week" — WeeklyBarsWidget.tsx) that would misdescribe a single week's per-day meal
 *      count; `count_toward`'s flat bar loses the discrete-cell reading kept/total wants here.
 *   2. Reusing `rhythm` a second and third time in this same list, for something that ISN'T a
 *      real calendar week, would mean inventing a fake `start` (RhythmWeek's own react key) and
 *      repurposing `label` as a category name instead of a date range — bending the contract's
 *      documented meaning twice more just to make all three cards look alike.
 * (The facts payload still additively exposes `meals_week` in the `weekly_bars` SHAPE at day
 * granularity, for a future consumer that isn't `WeeklyBarsWidget` itself — see that field's doc.)
 *
 * A card whose week held none of that kind renders nothing rather than an empty frame — same rule
 * on both paths: `RollupCard` skips total===0, and SESSIONS skips when `rhythm_week` is absent or
 * nothing was scheduled (`scheduled === 0`), never a false "0 of 0".
 */
export function RollupCards({ facts }: { facts: WeekReviewFacts }) {
  const meals = mealsRollup(facts.days);
  const mindset = mindsetRollup(facts.days);
  const rhythmWeek = facts.rhythm_week;

  return (
    <div className="wkr-rollups">
      <RollupCard label="MEALS" columns={7} {...meals} />
      {rhythmWeek && rhythmWeek.scheduled > 0 && (
        <WidgetSection
          spec={{ id: 'wkr-sessions', kind: 'rhythm', title: 'Sessions' }}
          payload={{ kind: 'rhythm', data: { weeks: [rhythmWeek] } }}
        />
      )}
      <RollupCard label="MINDSET" columns={7} {...mindset} />
    </div>
  );
}
