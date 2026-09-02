import { useState } from 'react';
import type { ClockUnit } from '@cadence/shared';
import { CoachFace } from '../../components/CoachFace.tsx';
import { glyphOf } from '../today/glyphs.ts';
import { groupWeek, rowKey, rowMeta, type WeekGroup, type WeekRowLike } from './weekGroups.ts';

/**
 * The week as a WEEK, not a bag of pills (owner's design project "Cadence Plan Rebalance",
 * 2026-08-31 — screen 1a). Days are the structure: an "Every day" group first, then Sunday →
 * Saturday, each day answering "is this day overloaded" with a minute total, each row typed by
 * its glyph chip.
 *
 * ONE surface with several hosts (the same rule as the old plan card): the Adjust/rebalance
 * sheet shows a proposed week here, the sign-up gate and the chat's "See your whole week" show
 * the committed one. What varies is what the data carries, not the layout —
 *   • NEW tags appear only on proposals whose rows carry lineage (`commitment_id`), where
 *     absence honestly means new; a committed week (or a first-ever one) shows none.
 *   • A row's `why` renders as marginalia in her voice on the row's FIRST appearance in the
 *     week — tap to open the full quote; repeats of the same commitment stay lean.
 *   • `suggested` rows say so ("MY ADDITION") at that same first appearance — the consent
 *     moment, never a permanent asterisk (owner ruling 2026-08-12).
 *
 * Display only: accept/decline buttons and the scroll container belong to the hosts.
 */
export function ProposedWeek({
  activities,
  note,
  clock = '24h',
}: {
  activities: WeekRowLike[];
  note?: string;
  /** How the row times are written (Settings → Units → Clock). Hosts inside the app pass the
   *  user's choice; a bare mount reads 24-hour, the dialect every stored time is already in. */
  clock?: ClockUnit;
}) {
  const groups = groupWeek(activities);
  // Lineage exists ⇒ absence of it MEANS new. No lineage anywhere ⇒ it means nothing.
  const tagNew = activities.some((a) => a.commitment_id);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="wk-list">
      {note && (
        <div className="wk-note">
          <CoachFace size={28} ring={false} />
          <span>{note}</span>
        </div>
      )}
      {groups.map((g) => (
        <section className={`wk-day wk-day-${g.kind}`} key={g.label}>
          <div className="wk-day-head">
            <span className="wk-day-name">{g.label}</span>
            <span className="wk-day-rule" aria-hidden />
            {g.minutes > 0 && <span className="wk-day-min">~{g.minutes} min</span>}
          </div>
          <div className="wk-card">
            {g.rows.map(({ a, first }, i) => (
              <WeekRow
                key={`${rowKey(a)}-${i}`}
                a={a}
                kind={g.kind}
                isNew={tagNew && !a.commitment_id}
                withWhy={first}
                open={!!open[rowKey(a)]}
                onToggle={() => setOpen((s) => ({ ...s, [rowKey(a)]: !s[rowKey(a)] }))}
                clock={clock}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** One row of a week — shared with the changes-first view (ProposedChanges.tsx), so a row reads
 *  the same whether it is shown in its day or as one of the things being changed. */
export function WeekRow({
  a,
  kind,
  isNew,
  withWhy,
  open,
  onToggle,
  clock = '24h',
  tag,
}: {
  a: WeekRowLike;
  kind: WeekGroup['kind'];
  isNew: boolean;
  withWhy: boolean;
  open: boolean;
  onToggle: () => void;
  clock?: ClockUnit;
  /** An extra tag word the host wants on the row ("CHANGED", "DROPPED"). */
  tag?: string;
}) {
  const { d, cat } = glyphOf(a.title, a.area);
  const expandable = withWhy && !!a.why;
  const body = (
    <>
      <span className={`wk-chip wk-chip-${cat}`} aria-hidden>
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path d={d} fill="currentColor" />
        </svg>
      </span>
      <span className="wk-row-t">
        <b>{a.title}</b>
        {rowMeta(a, kind, clock) && <span>{rowMeta(a, kind, clock)}</span>}
        {expandable &&
          (open ? (
            <span className="wk-why-open">
              &ldquo;{a.why}&rdquo; <i aria-hidden>▴</i>
            </span>
          ) : (
            <span className="wk-why">
              <span className="wk-why-cut">&ldquo;{a.why}</span>
              <i aria-hidden>more</i>
            </span>
          ))}
      </span>
      {withWhy && a.suggested && <span className="wk-tag wk-tag-add">MY ADDITION</span>}
      {isNew && <span className="wk-tag">NEW</span>}
      {tag && <span className="wk-tag wk-tag-diff">{tag}</span>}
    </>
  );
  if (!expandable) return <div className="wk-row">{body}</div>;
  return (
    <button type="button" className="wk-row wk-row-btn" onClick={onToggle} aria-expanded={open}>
      {body}
    </button>
  );
}
