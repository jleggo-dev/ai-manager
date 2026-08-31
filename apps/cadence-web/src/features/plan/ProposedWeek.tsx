import type { PendingPlanActivity } from '@cadence/shared';
import { CoachFace } from '../../components/CoachFace.tsx';
import { glyphOf } from '../today/glyphs.ts';
import { groupWeek, type WeekGroup } from './weekGroups.ts';

/**
 * The proposed week as a WEEK, not a bag of pills (owner's design project "Cadence Plan
 * Rebalance", 2026-08-31 — screen 1a). The pill dump flattened seventeen activities into
 * unordered chips with the days trailing each one, so the reader had to assemble the week in
 * their head. Here days are the structure: an "Every day" group first, then Sunday → Saturday,
 * each row typed by its glyph chip, each day answering "is this day overloaded" with a minute
 * total. Rows the current plan has no lineage for (`commitment_id` absent) wear a NEW tag —
 * only when the proposal carries lineage at all, so a first-ever week isn't seventeen NEWs.
 *
 * Display only: the accept/decline buttons stay with the sheet that owns the commit lifecycle.
 */
export function ProposedWeek({ activities, note }: { activities: PendingPlanActivity[]; note?: string }) {
  const groups = groupWeek(activities);
  // Lineage exists ⇒ absence of it MEANS new. No lineage anywhere ⇒ it means nothing.
  const tagNew = activities.some((a) => a.commitment_id);
  return (
    <div className="pw-scroll">
      {note && (
        <div className="pw-note">
          <CoachFace size={28} ring={false} />
          <span>{note}</span>
        </div>
      )}
      {groups.map((g) => (
        <section className={`pw-day pw-day-${g.kind}`} key={g.label}>
          <div className="pw-day-head">
            <span className="pw-day-name">{g.label}</span>
            <span className="pw-day-rule" aria-hidden />
            {g.minutes > 0 && <span className="pw-day-min">~{g.minutes} min</span>}
          </div>
          <div className="pw-card">
            {g.rows.map((a, i) => (
              <div className="pw-row" key={`${a.title}-${i}`}>
                <RowChip title={a.title} />
                <span className="pw-row-t">
                  <b>{a.title}</b>
                  {rowMeta(a, g.kind) && <span>{rowMeta(a, g.kind)}</span>}
                </span>
                {tagNew && !a.commitment_id && <span className="pw-tag">NEW</span>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RowChip({ title }: { title: string }) {
  const { d, cat } = glyphOf(title);
  return (
    <span className={`pw-chip pw-chip-${cat}`} aria-hidden>
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path d={d} fill="currentColor" />
      </svg>
    </span>
  );
}

/** time · duration for scheduled rows; the humanized cadence carries the "when" for the rest. */
function rowMeta(a: PendingPlanActivity, kind: WeekGroup['kind']): string {
  const bits =
    kind === 'floating'
      ? [a.cadence, a.time_of_day, a.duration_min ? `${a.duration_min} min` : '']
      : [a.time_of_day, a.duration_min ? `${a.duration_min} min` : ''];
  return bits.filter(Boolean).join(' · ');
}
