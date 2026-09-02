import { useState } from 'react';
import type { ClockUnit } from '@cadence/shared';
import { CoachFace } from '../../components/CoachFace.tsx';
import { wasLine, type WeekDiff } from './planDiff.ts';
import { WeekRow } from './ProposedWeek.tsx';
import { rowKey, type WeekRowLike } from './weekGroups.ts';

/**
 * The proposed week as WHAT CHANGES — the thing the person is agreeing to.
 *
 * The Adjust sheet used to open on the whole proposed week, so a one-line tweak was framed as a
 * seven-day decision: "it feels like I have to see the whole plan to accept it… it should
 * visualize only the diff until I press a button to see the whole week" (owner, 2026-09-01).
 * Three lists — new, changed, dropped — each row drawn by the same `WeekRow` the week view uses,
 * so nothing reads differently here than it will on the trail. A changed row shows what it WAS
 * underneath, so a rename or a retime is legible without the old week open beside it.
 *
 * Display only, like ProposedWeek: the toggle to the whole week and the confirm buttons belong
 * to the host.
 */
export function ProposedChanges({ diff, note, clock = '24h' }: { diff: WeekDiff; note?: string; clock?: ClockUnit }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (a: WeekRowLike) => () => setOpen((s) => ({ ...s, [rowKey(a)]: !s[rowKey(a)] }));

  return (
    <div className="wk-list wk-changes">
      {note && (
        <div className="wk-note">
          <CoachFace size={28} ring={false} />
          <span>{note}</span>
        </div>
      )}

      {diff.changed.length > 0 && (
        <Section label="Changed" count={diff.changed.length}>
          {diff.changed.map((c, i) => (
            <div className="wk-change" key={`chg-${rowKey(c.after)}-${i}`}>
              <WeekRow
                a={c.after}
                kind="floating"
                isNew={false}
                withWhy
                open={!!open[rowKey(c.after)]}
                onToggle={toggle(c.after)}
                clock={clock}
                tag="CHANGED"
              />
              <div className="wk-was">{wasLine(c, clock)}</div>
            </div>
          ))}
        </Section>
      )}

      {diff.added.length > 0 && (
        <Section label="New" count={diff.added.length}>
          {diff.added.map((a, i) => (
            <WeekRow
              key={`add-${rowKey(a)}-${i}`}
              a={a}
              kind="floating"
              isNew
              withWhy
              open={!!open[rowKey(a)]}
              onToggle={toggle(a)}
              clock={clock}
            />
          ))}
        </Section>
      )}

      {diff.removed.length > 0 && (
        <Section label="Dropped" count={diff.removed.length}>
          {diff.removed.map((a, i) => (
            <WeekRow
              key={`rm-${rowKey(a)}-${i}`}
              a={a}
              kind="floating"
              isNew={false}
              withWhy={false}
              open={false}
              onToggle={() => {}}
              clock={clock}
              tag="DROPPED"
            />
          ))}
        </Section>
      )}

      <p className="wk-helper">
        Everything else stays as it is — {diff.unchanged.length} {diff.unchanged.length === 1 ? 'row' : 'rows'}{' '}
        unchanged.
      </p>
    </div>
  );
}

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <section className="wk-day wk-day-floating">
      <div className="wk-day-head">
        <span className="wk-day-name">{label}</span>
        <span className="wk-day-rule" aria-hidden />
        <span className="wk-day-min">{count}</span>
      </div>
      <div className="wk-card">{children}</div>
    </section>
  );
}
