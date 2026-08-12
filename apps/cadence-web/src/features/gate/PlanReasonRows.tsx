import { useState } from 'react';
import type { PlanActivity } from '../../lib/api.ts';
import { groupPlanRows, rowMeta } from './planCard.ts';

/**
 * The commitments, each carrying its why as a quoted italic inset — marginalia in her voice, not
 * a second essay. Collapsed, a row teases the why's first words on one clipped line plus "more";
 * the WHOLE row is the tap target, and rows stay put when one opens (the inset grows the row
 * instead of collapsing its neighbours, so a reader can open two and compare).
 *
 * A suggested row says so before it explains itself: hollow dashed dot + "MY ADDITION" chip —
 * built for the adjacent-support plans, where "you didn't ask for this one" must be visible at
 * the consent moment.
 */
export function PlanReasonRows({ activities, startOpen = false }: { activities: PlanActivity[]; startOpen?: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => open[id] ?? startOpen;
  const groups = groupPlanRows(activities);
  return (
    <div className="grow-card">
      {groups.map((g) => (
        <div key={g.key}>
          {g.header && <div className={`grow-h${g.headerArea ? ` is-${g.headerArea}` : ''}`}>{g.header}</div>}
          {g.items.map((a) => (
            <button
              key={a.activity_id}
              type="button"
              className="grow-row"
              onClick={() => a.why && setOpen((s) => ({ ...s, [a.activity_id]: !isOpen(a.activity_id) }))}
              aria-expanded={a.why ? isOpen(a.activity_id) : undefined}
            >
              <span className="grow-t">
                <i className={`grow-dot${a.area ? ` is-${a.area}` : ''}${a.suggested ? ' is-suggested' : ''}`} />
                <b>{a.title}</b>
                {a.suggested && <span className="grow-chip">MY ADDITION</span>}
                <span className="grow-meta">{rowMeta(a)}</span>
              </span>
              {a.why &&
                (isOpen(a.activity_id) ? (
                  <span className="grow-why-open">
                    &ldquo;{a.why}&rdquo; <i aria-hidden>▴</i>
                  </span>
                ) : (
                  <span className="grow-why">
                    <span className="grow-why-cut">&ldquo;{a.why}</span>
                    <i aria-hidden>more</i>
                  </span>
                ))}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
