import type { Baseline, Equipment, Goal } from '@cadence/shared';
import { updateBaseline } from '../../lib/api.ts';
import { Orb } from '../../components/Orb.tsx';
import { AboutYouStep } from './AboutYouStep.tsx';
import { GearStep } from './GearStep.tsx';
import { GoalsStep } from './GoalsStep.tsx';
import { useReviewWizard } from './useReviewWizard.ts';

/**
 * Review is a curate wizard (accept / reject / modify what the AI captured), spread over
 * three steps: Goals → About you (baseline + what we work around) → Tools.
 * Every edit persists immediately (PATCH/DELETE/POST); committing a plan happens in the chat.
 */
export function ReviewScreen({ onBack }: { onBack: () => void }) {
  const { ORDER, LABELS, data, setData, step, msg, idx, back, next } = useReviewWizard({ onBack });

  const head = (
    <>
      <div className="app-head">
        <div className="wordmark">
          <Orb />
          Cadence
        </div>
        <button className="counter" onClick={onBack} title="Back">
          <span>✕ close</span>
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

  return (
    <>
      {head}
      <div className="app">
        <div className="scrollbody">
          <div className="wiz-sub">
            Step {idx + 1} of {ORDER.length} · {LABELS[step]}
          </div>

          {step === 'goals' && <GoalsStep goals={goals} setGoals={setGoals} />}
          {step === 'you' && (
            <AboutYouStep
              data={data}
              setData={(d) => setData(d)}
              baseline={baseline}
              setBaseline={setBaseline}
              patchBaseline={patchBaseline}
            />
          )}
          {step === 'gear' && <GearStep equipment={equipment} setEquip={setEquip} />}
        </div>

        <div className="lockbar">
          <div className="wiz-nav">
            <button className="wiz-back" onClick={back}>
              {idx === 0 ? 'Close' : 'Back'}
            </button>
            {idx === ORDER.length - 1 ? (
              <button className="lockbtn" onClick={onBack}>
                Done ✓
              </button>
            ) : (
              <button className="lockbtn" onClick={next}>
                Continue →
              </button>
            )}
          </div>
          {msg && <div className="lock-msg">{msg}</div>}
        </div>
      </div>
    </>
  );
}
