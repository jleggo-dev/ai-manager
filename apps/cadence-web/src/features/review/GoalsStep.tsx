import { useState } from 'react';
import type { Goal, GoalArea, GoalAssessment, GoalMilestone, GoalType } from '@cadence/shared';
import { addGoal, assessGoal, deleteGoal, updateGoal } from '../../lib/api.ts';
import {
  AREA_LABELS,
  GOAL_AREAS,
  GOAL_TYPES,
  TYPE_HINTS,
  TYPE_LABELS,
  VERDICT_LABELS,
  measurePhrase,
} from './reviewConstants.ts';
import { TrashIcon } from './TrashIcon.tsx';

type Props = {
  goals: Goal[];
  setGoals: (goals: Goal[]) => void;
  mode: 'onboard' | 'manage';
};

export function GoalsStep({ goals, setGoals, mode }: Props) {
  const [assessing, setAssessing] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<Record<string, GoalAssessment>>({});

  const runAssess = async (goalId: string) => {
    if (assessing) return;
    setAssessing(goalId);
    try {
      const a = await assessGoal(goalId);
      if (a) setAssessments((m) => ({ ...m, [goalId]: a }));
    } finally {
      setAssessing(null);
    }
  };

  const dismissAssess = (goalId: string) =>
    setAssessments((m) => {
      const n = { ...m };
      delete n[goalId];
      return n;
    });

  const setMilestones = (g: Goal, milestones: GoalMilestone[]) => {
    setGoals(goals.map((x) => (x.goal_id === g.goal_id ? { ...x, milestones } : x)));
    updateGoal(g.goal_id, { milestones }).catch(() => {});
  };

  const applyAssessment = (g: Goal, a: GoalAssessment) => {
    const existing = g.milestones ?? [];
    const have = new Set(existing.map((m) => m.label.toLowerCase()));
    const added: GoalMilestone[] = a.milestones
      .filter((m) => m.label && !have.has(m.label.toLowerCase()))
      .map((m) => ({ id: crypto.randomUUID(), label: m.label, target_date: m.target_date }));
    const patch: Partial<Goal> = { milestones: [...existing, ...added] };
    if (a.suggested_target)
      patch.measure = { ...g.measure, target: a.suggested_target.value, unit: a.suggested_target.unit };
    if (a.suggested_end) patch.timeframe = { ...g.timeframe, end: a.suggested_end };
    setGoals(goals.map((x) => (x.goal_id === g.goal_id ? { ...x, ...patch } : x)));
    updateGoal(g.goal_id, patch).catch(() => {});
    dismissAssess(g.goal_id);
  };

  return (
    <div className="wiz-list">
      <div className="screen-sub">Keep, tweak, or remove what I heard — and add anything I missed.</div>
      {goals.length === 0 && <div className="wiz-empty">No goals yet.</div>}
      {goals.map((g) => (
        <GoalCard
          key={g.goal_id}
          g={g}
          goals={goals}
          setGoals={setGoals}
          assessment={assessments[g.goal_id]}
          assessing={assessing === g.goal_id}
          onAssess={() => runAssess(g.goal_id)}
          onDismissAssess={() => dismissAssess(g.goal_id)}
          onApplyAssess={(a) => applyAssessment(g, a)}
          setMilestones={setMilestones}
        />
      ))}
      <button
        className="wiz-add"
        onClick={async () => {
          const g = await addGoal({
            title: 'New goal',
            area: 'practice',
            type: 'recurring',
            ...(mode === 'manage' ? { confirm: true } : {}),
          });
          setGoals([...goals, g]);
        }}
      >
        + Add a goal
      </button>
    </div>
  );
}

function GoalCard({
  g,
  goals,
  setGoals,
  assessment: a,
  assessing,
  onAssess,
  onDismissAssess,
  onApplyAssess,
  setMilestones,
}: {
  g: Goal;
  goals: Goal[];
  setGoals: (goals: Goal[]) => void;
  assessment?: GoalAssessment;
  assessing: boolean;
  onAssess: () => void;
  onDismissAssess: () => void;
  onApplyAssess: (a: GoalAssessment) => void;
  setMilestones: (g: Goal, milestones: GoalMilestone[]) => void;
}) {
  return (
    <div className="wiz-card">
      <div className="wiz-row">
        <textarea
          className="wiz-in wiz-title"
          rows={2}
          value={g.title}
          onChange={(e) => setGoals(goals.map((x) => (x.goal_id === g.goal_id ? { ...x, title: e.target.value } : x)))}
          onBlur={(e) => updateGoal(g.goal_id, { title: e.target.value })}
        />
        <button
          className="wiz-del"
          onClick={() => {
            setGoals(goals.filter((x) => x.goal_id !== g.goal_id));
            deleteGoal(g.goal_id);
          }}
          aria-label="Remove goal"
        >
          <TrashIcon />
        </button>
      </div>
      <div className="wiz-fields">
        <select
          className="wiz-sel"
          value={g.area}
          onChange={(e) => {
            const area = e.target.value as GoalArea;
            setGoals(goals.map((x) => (x.goal_id === g.goal_id ? { ...x, area } : x)));
            updateGoal(g.goal_id, { area });
          }}
        >
          {GOAL_AREAS.map((area) => (
            <option key={area} value={area}>
              {AREA_LABELS[area]}
            </option>
          ))}
        </select>
        <select
          className="wiz-sel"
          value={g.type}
          onChange={(e) => {
            const type = e.target.value as GoalType;
            setGoals(goals.map((x) => (x.goal_id === g.goal_id ? { ...x, type } : x)));
            updateGoal(g.goal_id, { type });
          }}
        >
          {GOAL_TYPES.map((c) => (
            <option key={c} value={c}>
              {TYPE_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div className="wiz-typehint">{TYPE_HINTS[g.type]}</div>
      {g.type === 'target' && <TargetFields g={g} goals={goals} setGoals={setGoals} />}
      {g.type === 'milestone' && (
        <label className="wiz-field wiz-datefield">
          <span>Target date</span>
          <input
            className="wiz-in"
            type="date"
            value={(g.timeframe?.end ?? '').slice(0, 10)}
            onChange={(e) =>
              setGoals(
                goals.map((x) =>
                  x.goal_id === g.goal_id ? { ...x, timeframe: { ...x.timeframe, end: e.target.value } } : x,
                ),
              )
            }
            onBlur={(e) => updateGoal(g.goal_id, { timeframe: { ...g.timeframe, end: e.target.value } })}
          />
        </label>
      )}
      {g.type === 'recurring' && (
        <div className="wiz-hint">No number needed — you’ll set how often at “Set your rhythm.”</div>
      )}
      {(g.milestones?.length ?? 0) > 0 && (
        <MilestoneList g={g} goals={goals} setGoals={setGoals} setMilestones={setMilestones} />
      )}
      {a ? (
        <AssessmentCard a={a} onApply={() => onApplyAssess(a)} onDismiss={onDismissAssess} />
      ) : (
        <button className="goal-assess-btn" onClick={onAssess} disabled={assessing}>
          {assessing ? 'Getting the coach’s read…' : 'Is this realistic? Get the coach’s read →'}
        </button>
      )}
    </div>
  );
}

function TargetFields({ g, goals, setGoals }: { g: Goal; goals: Goal[]; setGoals: (goals: Goal[]) => void }) {
  return (
    <>
      {measurePhrase(g.measure) && <div className="wiz-measure-preview">{measurePhrase(g.measure)}</div>}
      <div className="wiz-fields">
        <select
          className="wiz-sel"
          value={g.measure?.direction ?? ''}
          onChange={(e) => {
            const direction: 'increase' | 'decrease' | undefined =
              e.target.value === 'increase' ? 'increase' : e.target.value === 'decrease' ? 'decrease' : undefined;
            const measure = { ...g.measure, direction };
            setGoals(goals.map((x) => (x.goal_id === g.goal_id ? { ...x, measure } : x)));
            updateGoal(g.goal_id, { measure });
          }}
        >
          <option value="">toward</option>
          <option value="decrease">reduce to</option>
          <option value="increase">reach</option>
        </select>
        <input
          className="wiz-in wiz-target"
          placeholder="number"
          value={g.measure?.target != null ? String(g.measure.target) : ''}
          onChange={(e) =>
            setGoals(
              goals.map((x) =>
                x.goal_id === g.goal_id ? { ...x, measure: { ...x.measure, target: e.target.value } } : x,
              ),
            )
          }
          onBlur={(e) => updateGoal(g.goal_id, { measure: { ...g.measure, target: e.target.value } })}
        />
        <input
          className="wiz-in wiz-unit"
          placeholder="unit (lbs, min…)"
          value={g.measure?.unit ?? ''}
          onChange={(e) =>
            setGoals(
              goals.map((x) =>
                x.goal_id === g.goal_id ? { ...x, measure: { ...x.measure, unit: e.target.value } } : x,
              ),
            )
          }
          onBlur={(e) => updateGoal(g.goal_id, { measure: { ...g.measure, unit: e.target.value } })}
        />
      </div>
      <div className="wiz-fields">
        <span className="wiz-now-label">starting from</span>
        <input
          className="wiz-in wiz-target"
          placeholder="where you are now"
          value={g.measure?.start != null ? String(g.measure.start) : ''}
          onChange={(e) =>
            setGoals(
              goals.map((x) =>
                x.goal_id === g.goal_id ? { ...x, measure: { ...x.measure, start: e.target.value } } : x,
              ),
            )
          }
          onBlur={(e) => updateGoal(g.goal_id, { measure: { ...g.measure, start: e.target.value } })}
        />
      </div>
    </>
  );
}

function MilestoneList({
  g,
  goals,
  setGoals,
  setMilestones,
}: {
  g: Goal;
  goals: Goal[];
  setGoals: (goals: Goal[]) => void;
  setMilestones: (g: Goal, milestones: GoalMilestone[]) => void;
}) {
  return (
    <div className="wiz-miles">
      {g.milestones!.map((m, i) => (
        <div className="wiz-mile" key={m.id || i}>
          <input
            className="wiz-in"
            placeholder="stepping-stone"
            value={m.label}
            onChange={(e) =>
              setGoals(
                goals.map((x) =>
                  x.goal_id === g.goal_id
                    ? {
                        ...x,
                        milestones: (x.milestones ?? []).map((y, j) => (j === i ? { ...y, label: e.target.value } : y)),
                      }
                    : x,
                ),
              )
            }
            onBlur={() => updateGoal(g.goal_id, { milestones: g.milestones })}
          />
          <input
            className="wiz-in wiz-miledate"
            type="date"
            value={(m.target_date ?? '').slice(0, 10)}
            onChange={(e) =>
              setMilestones(
                g,
                (g.milestones ?? []).map((y, j) => (j === i ? { ...y, target_date: e.target.value } : y)),
              )
            }
          />
          <button
            className="wiz-del"
            onClick={() =>
              setMilestones(
                g,
                (g.milestones ?? []).filter((_, j) => j !== i),
              )
            }
            aria-label="Remove stepping-stone"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

function AssessmentCard({ a, onApply, onDismiss }: { a: GoalAssessment; onApply: () => void; onDismiss: () => void }) {
  return (
    <div className={`goal-assess ga-${a.verdict}`}>
      <div className="ga-badge">{VERDICT_LABELS[a.verdict]}</div>
      {a.assessment && <div className="ga-text">{a.assessment}</div>}
      {a.suggested_target && (
        <div className="ga-sug">
          Suggested target: {a.suggested_target.value} {a.suggested_target.unit}
        </div>
      )}
      {a.suggested_end && <div className="ga-sug">Suggested date: {a.suggested_end}</div>}
      {a.milestones.length > 0 && (
        <ul className="ga-miles">
          {a.milestones.map((m, i) => (
            <li key={i}>
              <b>{m.label}</b>
              {m.target_date ? ` · ${m.target_date}` : ''}
            </li>
          ))}
        </ul>
      )}
      {(a.intake?.length ?? 0) > 0 && (
        <div className="ga-intake">
          <div className="ga-intake-t">Worth talking through with your coach:</div>
          <ul>
            {a.intake!.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="ga-actions">
        <button className="ga-apply" onClick={onApply}>
          Use these
        </button>
        <button className="ga-dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
