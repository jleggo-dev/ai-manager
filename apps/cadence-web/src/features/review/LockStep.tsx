import type { Baseline, Equipment, Goal, GoalArea } from '@cadence/shared';
import { budgetNote, sessionBudget } from '@cadence/shared';
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

/**
 * "5 mornings · 07:00 · 45 min (allow 55)" — the consent line for one commitment.
 *
 * The minutes are the effort the coach wrote down (owner ruling 2026-08-17); the parenthetical is
 * what to actually keep free, and it appears only when warm-up and cool-down add something. This is
 * the screen where the person agrees to a rhythm, so it must show the real time ask, not just the
 * part that gets counted as training.
 */
function rhythmLine(a: { cadence: string; time_of_day?: string; duration_min?: number }, area?: GoalArea): string {
  const budget = sessionBudget(a.duration_min, area);
  const note = budgetNote(budget);
  const mins = budget ? `${budget.effort_min} min${note ? ` ${note}` : ''}` : null;
  return [a.cadence, a.time_of_day, mins].filter(Boolean).join(' · ') || '—';
}

export function LockStep({ preview, goals, equipment, baseline, name }: Props) {
  // The preview carries goal_id but not the goal's area; the goals are right here, so resolve it
  // rather than widening the broker contract for a display detail.
  const areaOf = new Map(goals.map((g) => [g.goal_id, g.area]));
  const wUnit = baseline.weight_unit ?? 'kg';
  const wKg = resolveWeightKg(baseline.weight_kg);
  const wShown = formatWeightDisplay(wKg, wUnit);

  if (preview) {
    return (
      <div className="wiz-list">
        <div className="screen-title">{"Here's the rhythm I'd build"}</div>
        <div className="screen-sub">{preview.note || "Take a look — nothing's set until you say go."}</div>
        {groupByGoal(preview.activities).map((grp) => (
          <div className="prev-group" key={grp.key}>
            <div className="prev-group-h">{grp.key === '__foundations__' ? grp.title : `Toward ${grp.title}`}</div>
            {grp.items.map((a, i) => (
              <div className="confirm-sec" key={i}>
                <div className="cs-t">
                  <b>{a.title}</b>
                  <span>{rhythmLine(a, a.goal_id ? areaOf.get(a.goal_id) : undefined)}</span>
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
      <div className="screen-sub">{"I'll build your plan from this — and it can always bend later."}</div>
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
