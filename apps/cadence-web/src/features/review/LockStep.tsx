import type { Baseline, Equipment, Goal } from '@cadence/shared';
import { groupByGoal } from './groupByGoal.ts';
import type { PlanPreview } from './useReviewWizard.ts';
import { formatWeightDisplay, resolveWeightKg } from './unitConversion.ts';

type Props = {
  preview: PlanPreview | null;
  goals: Goal[];
  equipment: Equipment[];
  baseline: Baseline;
  name?: string | null;
};

export function LockStep({ preview, goals, equipment, baseline, name }: Props) {
  const wUnit = baseline.weight_unit ?? 'kg';
  const wKg = resolveWeightKg(baseline.weight_kg);
  const wShown = formatWeightDisplay(wKg, wUnit);

  if (preview) {
    return (
      <div className="wiz-list">
        <div className="screen-title">Here's the rhythm I'd build</div>
        <div className="screen-sub">{preview.note || "Take a look — nothing's set until you say go."}</div>
        {groupByGoal(preview.activities).map((grp) => (
          <div className="prev-group" key={grp.key}>
            <div className="prev-group-h">{grp.key === '__foundations__' ? grp.title : `Toward ${grp.title}`}</div>
            {grp.items.map((a, i) => (
              <div className="confirm-sec" key={i}>
                <div className="cs-t">
                  <b>{a.title}</b>
                  <span>
                    {[a.cadence, a.time_of_day, a.duration_min ? `${a.duration_min} min` : null]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </span>
                  {a.why && <div className="cs-why">{a.why}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="wiz-list">
      <div className="screen-title">Ready to set your rhythm</div>
      <div className="screen-sub">I'll build your plan from this — and it can always bend later.</div>
      <div className="confirm-sec">
        <div className="cs-t">
          <b>
            {goals.length} goal{goals.length === 1 ? '' : 's'}
          </b>
          <span>{goals.map((g) => g.title).join(' · ') || '—'}</span>
        </div>
      </div>
      <div className="confirm-sec">
        <div className="cs-t">
          <b>About you</b>
          <span>
            {[
              name,
              baseline.age && `${baseline.age} yrs`,
              wKg != null && `${wShown} ${wUnit}`,
              (baseline.constraints ?? []).length &&
                `working around ${baseline.constraints.length} thing${baseline.constraints.length === 1 ? '' : 's'}`,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </span>
        </div>
      </div>
      <div className="confirm-sec">
        <div className="cs-t">
          <b>
            {equipment.length} tool{equipment.length === 1 ? '' : 's'}
          </b>
          <span>{equipment.map((e) => e.name).join(', ') || '—'}</span>
        </div>
      </div>
    </div>
  );
}
