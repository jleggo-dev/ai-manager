import { useEffect, useState } from 'react';
import type {
  Goal,
  Equipment,
  Baseline,
  Constraint,
  GoalArea,
  GoalType,
  EquipmentCategory,
  GoalMilestone,
  GoalAssessment,
  PendingPlanActivity,
} from '@cadence/shared';
import {
  getReview,
  getPlan,
  confirmGoals,
  lockPlan,
  previewPlan,
  dismissPlanPreview,
  updateGoal,
  assessGoal,
  deleteGoal,
  addGoal,
  updateEquipment,
  deleteEquipmentItem,
  addEquipment,
  updateBaseline,
  updateName,
  type ReviewData,
} from '../../lib/api.ts';
import { Orb } from '../../components/Orb.tsx';

type Step = 'goals' | 'you' | 'gear' | 'lock';
const ONBOARD_ORDER: Step[] = ['goals', 'you', 'gear', 'lock'];
// Manage mode (from Settings): same curation surface, NO lock step — the plan is already
// committed; changes are offered to the Adjust flow on Done, never re-locked.
const MANAGE_ORDER: Step[] = ['goals', 'you', 'gear'];
const LABELS: Record<Step, string> = { goals: 'Goals', you: 'About you', gear: 'Tools', lock: 'Set your rhythm' };

/**
 * Group the proposed commitments under the objective each serves (the coached ladder made
 * visible), preserving the order goals first appear. Unlinked/system items (a weekly check-in,
 * whole-plan foundational work) fall into a "Foundations" group that sinks to the bottom.
 */
function groupByGoal(
  activities: PendingPlanActivity[],
): { key: string; title: string; items: PendingPlanActivity[] }[] {
  const groups: { key: string; title: string; items: PendingPlanActivity[] }[] = [];
  const index = new Map<string, number>();
  for (const a of activities) {
    const key = a.goal_id ?? '__foundations__';
    let gi = index.get(key);
    if (gi == null) {
      gi = groups.length;
      index.set(key, gi);
      groups.push({ key, title: a.goal_title ?? 'Foundations', items: [] });
    }
    groups[gi]!.items.push(a);
  }
  return groups.sort((x, y) => Number(x.key === '__foundations__') - Number(y.key === '__foundations__'));
}
const GOAL_AREAS: GoalArea[] = ['movement', 'nourishment', 'mind', 'practice'];
const AREA_LABELS: Record<GoalArea, string> = {
  movement: 'Movement',
  nourishment: 'Nourishment',
  mind: 'Mind',
  practice: 'Practice',
};
const GOAL_TYPES: GoalType[] = ['milestone', 'target', 'recurring'];
const TYPE_LABELS: Record<GoalType, string> = {
  milestone: 'A day you’re aiming at',
  target: 'A number you’re moving toward',
  recurring: 'Something you keep doing',
};
const VERDICT_LABELS: Record<GoalAssessment['verdict'], string> = {
  on_track: 'On track',
  stretch: 'A stretch',
  unrealistic: 'Worth right-sizing',
};
const TYPE_HINTS: Record<GoalType, string> = {
  milestone: 'A dated one-off — a race, an exam, a trip.',
  target: 'A number to reach — a goal weight, ≤2 drinks/day, 8 glasses of water.',
  recurring: 'An ongoing habit — meditate daily, eat more veg, journal.',
};
/** Render a target goal's measure as a plain phrase ("Reach 170 lbs", "Reduce to 2 drinks/day"). */
function measurePhrase(m?: Goal['measure']): string {
  if (!m || m.target == null || String(m.target).trim() === '') return '';
  const val = [m.target, m.unit].filter((x) => x != null && String(x).trim() !== '').join(' ');
  const verb = m.direction === 'increase' ? 'Reach' : m.direction === 'decrease' ? 'Reduce to' : 'Toward';
  return `${verb} ${val}`;
}
const EQUIP_CATS: EquipmentCategory[] = [
  'footwear',
  'cardio',
  'strength',
  'accessory',
  'reading',
  'practice',
  'craft',
  'study',
  'other',
];
const EQUIP_LABELS: Record<EquipmentCategory, string> = {
  footwear: 'Footwear',
  cardio: 'Cardio',
  strength: 'Strength',
  accessory: 'Accessory',
  reading: 'Books & reading',
  practice: 'Practice',
  craft: 'Craft supplies',
  study: 'Study & learning',
  other: 'Other',
};
const LB_TO_KG = 0.453592;

const Trash = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
    <path
      className="stroke"
      d="M3 4h10M6.5 4V2.8h3V4M4.5 4l.6 9h5.8l.6-9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Review is a curate wizard (accept / reject / modify what the AI captured), spread over
 * four steps: Goals → About you (baseline + what we work around) → Tools → Set your rhythm.
 * Every edit persists immediately (PATCH/DELETE/POST); the final step confirms + commits.
 */
export function ReviewScreen({
  onBack,
  onLocked,
  mode = 'onboard',
}: {
  onBack: () => void;
  onLocked: () => void;
  mode?: 'onboard' | 'manage';
}) {
  const ORDER = mode === 'manage' ? MANAGE_ORDER : ONBOARD_ORDER;
  const [data, setData] = useState<ReviewData | null>(null);
  const [step, setStep] = useState<Step>('goals');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ activities: PendingPlanActivity[]; note: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [weightDraft, setWeightDraft] = useState<string | null>(null); // raw text while editing; committed on blur
  const [hCmDraft, setHCmDraft] = useState<string | null>(null);
  const [hFtDraft, setHFtDraft] = useState<{ ft: string; in: string } | null>(null);
  const [assessing, setAssessing] = useState<string | null>(null); // goalId currently being assessed
  const [assessments, setAssessments] = useState<Record<string, GoalAssessment>>({});

  useEffect(() => {
    getReview()
      .then(setData)
      .catch(() => setMsg("I couldn't load this — give it a second and try again."));
  }, []);

  const idx = ORDER.indexOf(step);
  const back = () => (idx === 0 ? onBack() : setStep(ORDER[idx - 1] as Step));
  const next = () => idx < ORDER.length - 1 && setStep(ORDER[idx + 1] as Step);

  const head = (
    <>
      <div className="app-head">
        <div className="wordmark">
          <Orb />
          Cadence
        </div>
        <button className="counter" onClick={onBack} title={mode === 'manage' ? 'Back' : 'Back to coach'}>
          <span>{mode === 'manage' ? '✕ close' : 'coach'}</span>
        </button>
      </div>
    </>
  );

  if (!data) {
    return (
      <>
        {head}
        <div className="app">
          <div className="scrollbody">
            <div className="screen-sub" style={{ marginTop: 16 }}>
              {msg || 'Loading…'}
            </div>
          </div>
        </div>
      </>
    );
  }

  const goals = data.goals;
  const equipment = data.equipment;
  const bRaw = (data.baseline ?? {}) as Baseline;
  const baseline: Baseline = {
    ...bRaw,
    constraints: bRaw.constraints ?? [],
    preferences: bRaw.preferences ?? {},
  };

  const setGoals = (g: Goal[]) => setData({ ...data, goals: g });
  const setEquip = (e: Equipment[]) => setData({ ...data, equipment: e });
  const setBaseline = (b: Baseline) => setData({ ...data, baseline: b });

  const patchBaseline = (p: Partial<Baseline>) => {
    setBaseline({ ...baseline, ...p });
    updateBaseline(p).catch(() => {});
  };

  // Weight is stored canonically in kg; display + edit in the user's chosen unit.
  const wUnit = baseline.weight_unit ?? 'kg';
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const plausibleKg = (n?: number): n is number => n != null && n >= 20 && n <= 500;
  // Guard a previously-corrupted `current` (pre-fix data) by falling back to the captured `start`.
  const wKg = plausibleKg(baseline.weight_kg?.current)
    ? baseline.weight_kg!.current
    : plausibleKg(baseline.weight_kg?.start)
      ? baseline.weight_kg!.start
      : undefined;
  const wDisplay = wKg != null ? String(wUnit === 'lbs' ? round1(wKg / LB_TO_KG) : round1(wKg)) : '';
  // While focused we show the raw draft; committing (on blur) converts + clamps ONCE — so typing
  // never round-trips through the lossy kg↔lbs conversion, which was corrupting the stored value.
  const wShown = weightDraft ?? wDisplay;
  const commitWeight = () => {
    const raw = weightDraft;
    setWeightDraft(null);
    if (raw == null || !raw.trim()) return;
    const displayVal = Number(raw.trim());
    if (!Number.isFinite(displayVal) || displayVal <= 0) return;
    const kg = round1(wUnit === 'lbs' ? displayVal * LB_TO_KG : displayVal);
    if (!plausibleKg(kg)) return; // reject implausible weights — a fat-finger can't persist as 5078kg
    patchBaseline({
      weight_kg: {
        current: kg,
        start: baseline.weight_kg?.start ?? kg,
        source: 'manual',
        updated_at: new Date().toISOString(),
      },
    });
  };

  // Height: stored canonically in cm; edit in cm or ft/in (default ft/in when they weigh in lbs).
  // Same draft-then-commit-on-blur pattern so the lossy cm↔in round-trip never corrupts the store.
  const hUnit: 'cm' | 'ft' = baseline.height_unit ?? (wUnit === 'lbs' ? 'ft' : 'cm');
  const hCm = baseline.height_cm;
  const totalIn = hCm != null ? hCm / 2.54 : null;
  const cmShown = hCmDraft ?? (hCm != null ? String(Math.round(hCm)) : '');
  const ftShown = hFtDraft?.ft ?? (totalIn != null ? String(Math.floor(totalIn / 12)) : '');
  const inShown = hFtDraft?.in ?? (totalIn != null ? String(Math.round(totalIn - Math.floor(totalIn / 12) * 12)) : '');
  const commitHeightCm = () => {
    const raw = hCmDraft;
    setHCmDraft(null);
    if (raw == null || !raw.trim()) return;
    const cm = Math.round(Number(raw));
    if (Number.isFinite(cm) && cm >= 80 && cm <= 260) patchBaseline({ height_cm: cm });
  };
  const commitHeightFt = () => {
    const d = hFtDraft;
    setHFtDraft(null);
    if (d == null) return;
    const cm = Math.round(((Number(d.ft) || 0) * 12 + (Number(d.in) || 0)) * 2.54);
    if (cm >= 80 && cm <= 260) patchBaseline({ height_cm: cm });
  };

  // Goal realism assessment (§6.2). Suggest-only: fetch the coach's read, then let the user apply it.
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
  // Accept the coach's read: add its stepping-stones (skipping dup labels) + apply any right-sized
  // target/date, all in one PATCH. Nothing is auto-applied until the user clicks "Use these".
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

  // If a lock already succeeded server-side but the client never advanced (e.g. the response was
  // lost to a connection blip), the goals are already committed and there's an active plan — yet
  // we're still on Review. Detect that and route to the plan instead of dead-ending on a confusing
  // "no confirmed goals" error. Returns true if it navigated.
  async function recoverIfAlreadyCommitted(): Promise<boolean> {
    try {
      if ((await getPlan()).stage === 'committed') {
        onLocked();
        return true;
      }
    } catch {
      /* fall through to the normal error path */
    }
    return false;
  }

  // Step 1: confirm goals, then PREVIEW the plan the coach would build — nothing commits yet.
  async function doPreview() {
    setBusy(true);
    setMsg('');
    try {
      await confirmGoals();
      const r = await previewPlan();
      if (r.status === 'proposed' && r.proposal) {
        setPreview(r.proposal);
      } else if (r.status === 'needs_focus') {
        setMsg(`That's a lot to carry at once — want to pick the few that matter most right now?`);
      } else {
        if (await recoverIfAlreadyCommitted()) return;
        const why = r.violations?.join('; ');
        setMsg(
          why ? `I couldn't put it together yet: ${why}` : `Something went wrong on my end — try again in a moment.`,
        );
      }
      setData(await getReview());
    } catch {
      setMsg('Something went wrong on my end — try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  // Step 2: the user's actual accept — commit exactly what was previewed.
  async function doConfirmLock() {
    setBusy(true);
    setMsg('');
    try {
      const { status, body } = await lockPlan();
      if (status === 200) {
        const n = Number(body.activities ?? 0);
        setPreview(null);
        setMsg(`Your rhythm is set — ${n} ${n === 1 ? 'thing' : 'things'} on your week. It can always bend later.`);
        setTimeout(onLocked, 900); // into the plan view — the plan itself is the confirmation
        return;
      }
      if (await recoverIfAlreadyCommitted()) return;
      const why = (body.violations as string[] | undefined)?.join('; ');
      setMsg(why ? `I couldn't set it yet: ${why}` : `Something went wrong on my end — try again in a moment.`);
      setPreview(null);
      setData(await getReview());
    } catch {
      setMsg('Something went wrong on my end — try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  // The user wants to adjust before committing — discard the preview, stay on this step.
  async function doDismissPreview() {
    setPreview(null);
    setMsg('');
    dismissPlanPreview().catch(() => {});
  }

  return (
    <>
      {head}
      <div className="app">
        <div className="scrollbody">
          <div className="wiz-sub">
            Step {idx + 1} of {ORDER.length} · {LABELS[step]}
          </div>

          {step === 'goals' && (
            <div className="wiz-list">
              <div className="screen-sub">Keep, tweak, or remove what I heard — and add anything I missed.</div>
              {goals.length === 0 && <div className="wiz-empty">No goals yet.</div>}
              {goals.map((g) => {
                const a = assessments[g.goal_id];
                return (
                  <div className="wiz-card" key={g.goal_id}>
                    <div className="wiz-row">
                      <textarea
                        className="wiz-in wiz-title"
                        rows={2}
                        value={g.title}
                        onChange={(e) =>
                          setGoals(goals.map((x) => (x.goal_id === g.goal_id ? { ...x, title: e.target.value } : x)))
                        }
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
                        <Trash />
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
                        {GOAL_AREAS.map((a) => (
                          <option key={a} value={a}>
                            {AREA_LABELS[a]}
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
                    {/* Measure fields are contextual to the goal TYPE — a number only makes sense for a
                      target; a milestone wants a date; a recurring goal neither. Target goals show a
                      plain-English preview of the measure above the editable direction/number/unit. */}
                    {g.type === 'target' && (
                      <>
                        {measurePhrase(g.measure) && (
                          <div className="wiz-measure-preview">{measurePhrase(g.measure)}</div>
                        )}
                        <div className="wiz-fields">
                          <select
                            className="wiz-sel"
                            value={g.measure?.direction ?? ''}
                            onChange={(e) => {
                              const direction: 'increase' | 'decrease' | undefined =
                                e.target.value === 'increase'
                                  ? 'increase'
                                  : e.target.value === 'decrease'
                                    ? 'decrease'
                                    : undefined;
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
                                  x.goal_id === g.goal_id
                                    ? { ...x, measure: { ...x.measure, target: e.target.value } }
                                    : x,
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
                                  x.goal_id === g.goal_id
                                    ? { ...x, measure: { ...x.measure, unit: e.target.value } }
                                    : x,
                                ),
                              )
                            }
                            onBlur={(e) => updateGoal(g.goal_id, { measure: { ...g.measure, unit: e.target.value } })}
                          />
                        </div>
                        {/* Where they are TODAY on this metric — the intake fact the plan calibrates from.
                          Capture fills it when stated in chat; this is the hand-fix when it wasn't. */}
                        <div className="wiz-fields">
                          <span className="wiz-now-label">starting from</span>
                          <input
                            className="wiz-in wiz-target"
                            placeholder="where you are now"
                            value={g.measure?.start != null ? String(g.measure.start) : ''}
                            onChange={(e) =>
                              setGoals(
                                goals.map((x) =>
                                  x.goal_id === g.goal_id
                                    ? { ...x, measure: { ...x.measure, start: e.target.value } }
                                    : x,
                                ),
                              )
                            }
                            onBlur={(e) => updateGoal(g.goal_id, { measure: { ...g.measure, start: e.target.value } })}
                          />
                        </div>
                      </>
                    )}
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
                                x.goal_id === g.goal_id
                                  ? { ...x, timeframe: { ...x.timeframe, end: e.target.value } }
                                  : x,
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

                    {/* Stepping-stones toward the goal (coach-proposed or hand-added), each editable. */}
                    {(g.milestones?.length ?? 0) > 0 && (
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
                                          milestones: (x.milestones ?? []).map((y, j) =>
                                            j === i ? { ...y, label: e.target.value } : y,
                                          ),
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
                                  (g.milestones ?? []).map((y, j) =>
                                    j === i ? { ...y, target_date: e.target.value } : y,
                                  ),
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
                              <Trash />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {a ? (
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
                          <button className="ga-apply" onClick={() => applyAssessment(g, a)}>
                            Use these
                          </button>
                          <button className="ga-dismiss" onClick={() => dismissAssess(g.goal_id)}>
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="goal-assess-btn"
                        onClick={() => runAssess(g.goal_id)}
                        disabled={assessing === g.goal_id}
                      >
                        {assessing === g.goal_id
                          ? 'Getting the coach’s read…'
                          : 'Is this realistic? Get the coach’s read →'}
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                className="wiz-add"
                onClick={async () => {
                  // manage mode inserts as CONFIRMED: replan-visible + immune to capture churn.
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
          )}

          {step === 'you' && (
            <div className="wiz-list">
              <div className="screen-sub">The facts I'll plan around. Fix anything that's off.</div>
              <div className="wiz-card">
                <label className="wiz-field">
                  <span>Your name</span>
                  <input
                    className="wiz-in"
                    value={data.name ?? ''}
                    placeholder="What should I call you?"
                    onChange={(e) => setData({ ...data, name: e.target.value })}
                    onBlur={(e) => updateName(e.target.value)}
                  />
                </label>
                <div className="wiz-fields wiz-body" style={{ marginTop: 10 }}>
                  <label className="wiz-field">
                    <span>Age</span>
                    <input
                      className="wiz-in"
                      type="number"
                      value={baseline.age ?? ''}
                      onChange={(e) => patchBaseline({ age: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </label>
                  <label className="wiz-field">
                    <span>Height</span>
                    <div className="wiz-weight">
                      {hUnit === 'ft' ? (
                        <>
                          <input
                            className="wiz-in"
                            type="number"
                            inputMode="numeric"
                            placeholder="ft"
                            value={ftShown}
                            onChange={(e) => setHFtDraft({ ft: e.target.value, in: inShown })}
                            onBlur={commitHeightFt}
                          />
                          <input
                            className="wiz-in"
                            type="number"
                            inputMode="numeric"
                            placeholder="in"
                            value={inShown}
                            onChange={(e) => setHFtDraft({ ft: ftShown, in: e.target.value })}
                            onBlur={commitHeightFt}
                          />
                        </>
                      ) : (
                        <input
                          className="wiz-in"
                          type="number"
                          inputMode="numeric"
                          placeholder="cm"
                          value={cmShown}
                          onChange={(e) => setHCmDraft(e.target.value)}
                          onBlur={commitHeightCm}
                        />
                      )}
                      <select
                        className="wiz-sel"
                        value={hUnit}
                        onChange={(e) => patchBaseline({ height_unit: e.target.value as 'cm' | 'ft' })}
                      >
                        <option value="cm">cm</option>
                        <option value="ft">ft/in</option>
                      </select>
                    </div>
                  </label>
                  <label className="wiz-field">
                    <span>Weight</span>
                    <div className="wiz-weight">
                      <input
                        className="wiz-in"
                        type="number"
                        inputMode="decimal"
                        value={wShown}
                        onChange={(e) => setWeightDraft(e.target.value)}
                        onBlur={commitWeight}
                      />
                      <select
                        className="wiz-sel"
                        value={wUnit}
                        onChange={(e) => patchBaseline({ weight_unit: e.target.value as 'kg' | 'lbs' })}
                      >
                        <option value="kg">kg</option>
                        <option value="lbs">lbs</option>
                      </select>
                    </div>
                  </label>
                </div>
              </div>

              <div className="wiz-label">What we work around</div>
              {(baseline.constraints ?? []).map((c, i) => (
                <div className="wiz-card wiz-card-tight" key={c.id || i}>
                  <div className="wiz-row">
                    <input
                      className="wiz-in"
                      placeholder="e.g. left knee · burnout · night shifts"
                      value={c.label}
                      onChange={(e) => {
                        const constraints = baseline.constraints.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        );
                        setBaseline({ ...baseline, constraints });
                      }}
                      onBlur={() => updateBaseline({ constraints: baseline.constraints })}
                    />
                    <label className="wiz-check">
                      <input
                        type="checkbox"
                        checked={c.plan_around}
                        onChange={(e) =>
                          patchBaseline({
                            constraints: baseline.constraints.map((x, j) =>
                              j === i ? { ...x, plan_around: e.target.checked } : x,
                            ),
                          })
                        }
                      />
                      plan around it
                    </label>
                    <button
                      className="wiz-del"
                      onClick={() => patchBaseline({ constraints: baseline.constraints.filter((_, j) => j !== i) })}
                      aria-label="Remove"
                    >
                      <Trash />
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="wiz-add"
                onClick={() =>
                  patchBaseline({
                    constraints: [
                      ...(baseline.constraints ?? []),
                      { id: '', label: '', kind: 'other', plan_around: true } as Constraint,
                    ],
                  })
                }
              >
                + Add one
              </button>
            </div>
          )}

          {step === 'gear' && (
            <div className="wiz-list">
              <div className="screen-sub">
                What you're working with — a barbell, a journal, running shoes. Remove anything wrong, add what's
                missing.
              </div>
              {equipment.length === 0 && <div className="wiz-empty">No tools noted yet.</div>}
              {equipment.map((eq) => (
                <div className="wiz-card wiz-card-tight" key={eq.equipment_id}>
                  <div className="wiz-row">
                    <input
                      className="wiz-in"
                      value={eq.name}
                      onChange={(e) =>
                        setEquip(
                          equipment.map((x) =>
                            x.equipment_id === eq.equipment_id ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                      onBlur={(e) => updateEquipment(eq.equipment_id, { name: e.target.value })}
                    />
                    <select
                      className="wiz-sel"
                      value={eq.category}
                      onChange={(e) => {
                        const category = e.target.value as EquipmentCategory;
                        setEquip(equipment.map((x) => (x.equipment_id === eq.equipment_id ? { ...x, category } : x)));
                        updateEquipment(eq.equipment_id, { category });
                      }}
                    >
                      {EQUIP_CATS.map((c) => (
                        <option key={c} value={c}>
                          {EQUIP_LABELS[c]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="wiz-del"
                      onClick={() => {
                        setEquip(equipment.filter((x) => x.equipment_id !== eq.equipment_id));
                        deleteEquipmentItem(eq.equipment_id);
                      }}
                      aria-label="Remove"
                    >
                      <Trash />
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="wiz-add"
                onClick={async () => {
                  const e = await addEquipment({ name: 'New item', category: 'other' });
                  setEquip([...equipment, e]);
                }}
              >
                + Add a tool
              </button>
            </div>
          )}

          {step === 'lock' && !preview && (
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
                      data.name,
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
          )}

          {step === 'lock' && preview && (
            <div className="wiz-list">
              <div className="screen-title">Here's the rhythm I'd build</div>
              <div className="screen-sub">{preview.note || "Take a look — nothing's set until you say go."}</div>
              {groupByGoal(preview.activities).map((grp) => (
                <div className="prev-group" key={grp.key}>
                  <div className="prev-group-h">
                    {grp.key === '__foundations__' ? grp.title : `Toward ${grp.title}`}
                  </div>
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
          )}
        </div>

        <div className="lockbar">
          {step !== 'lock' ? (
            <div className="wiz-nav">
              <button className="wiz-back" onClick={back}>
                {idx === 0 ? (mode === 'manage' ? 'Close' : 'Coach') : 'Back'}
              </button>
              {mode === 'manage' && idx === ORDER.length - 1 ? (
                <button className="lockbtn" onClick={onBack}>
                  Done ✓
                </button>
              ) : (
                <button className="lockbtn" onClick={next}>
                  Continue →
                </button>
              )}
            </div>
          ) : preview ? (
            <div className="wiz-nav">
              <button className="wiz-back" onClick={doDismissPreview} disabled={busy}>
                Not yet
              </button>
              <button className="lockbtn" onClick={doConfirmLock} disabled={busy}>
                {busy ? 'Setting your rhythm…' : 'Set your rhythm'}
              </button>
            </div>
          ) : (
            <div className="wiz-nav">
              <button className="wiz-back" onClick={back}>
                Back
              </button>
              <button className="lockbtn" onClick={doPreview} disabled={busy}>
                {busy ? 'Putting it together…' : 'See my rhythm →'}
              </button>
            </div>
          )}
          {msg && <div className="lock-msg">{msg}</div>}
        </div>
      </div>
    </>
  );
}
