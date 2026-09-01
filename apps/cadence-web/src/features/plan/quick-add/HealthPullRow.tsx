import type { WorkoutHistoryListItem } from '../../../lib/api.ts';
import { GLYPH } from '../../today/glyphs.ts';
import { healthPullMeta, healthPullSourceLabel } from './healthPull.ts';

/**
 * One synced workout offered as the fastest log ("Pull from Apple Health" / "Pull from Strava") —
 * a single row, so the tap target and the honest-facts meta line can't drift from each other.
 * `healthPullSourceLabel` is the one place that decides which brand name it wears.
 */
export function HealthPullRow({
  row,
  busy,
  onPull,
}: {
  row: WorkoutHistoryListItem;
  busy: boolean;
  onPull: () => void;
}) {
  const label = `Pull from ${healthPullSourceLabel(row.source)}`;
  return (
    <button className="ld-row" disabled={busy} onClick={onPull} aria-label={label}>
      <span className="ld-ic ld-ic-movement" aria-hidden>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d={GLYPH.dumbbell} fill="#fff" />
        </svg>
      </span>
      <span className="ld-row-t">
        <b>{label}</b>
        <span>{healthPullMeta(row)}</span>
      </span>
      <span className="ld-plus" aria-hidden>
        ›
      </span>
    </button>
  );
}
