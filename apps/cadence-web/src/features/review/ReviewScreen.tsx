import type { Baseline, Equipment, Goal } from '@cadence/shared';
import { updateBaseline } from '../../lib/api.ts';
import { Orb } from '../../components/Orb.tsx';
import { AboutYouStep } from './AboutYouStep.tsx';
import { GearStep } from './GearStep.tsx';
import { GoalsStep } from './GoalsStep.tsx';
import { LockStep } from './LockStep.tsx';
import { FaceStep } from './FaceStep.tsx';
import { useReviewWizard, type ReviewMode } from './useReviewWizard.ts';

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
  mode?: ReviewMode;
}) {
  const {
    ORDER,
    LABELS,
    data,
    setData,
    step,
    busy,
    preview,
    msg,
    idx,
    back,
    next,
    doPreview,
    doConfirmLock,
    doDismissPreview,
  } = useReviewWizard({ mode, onBack, onLocked });

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

  return (
    <>
      {head}
      <div className="app">
        <div className="scrollbody">
          <div className="wiz-sub">
            Step {idx + 1} of {ORDER.length} · {LABELS[step]}
          </div>

          {step === 'goals' && <GoalsStep goals={goals} setGoals={setGoals} mode={mode} />}
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
          {step === 'face' && <FaceStep />}
          {step === 'lock' && (
            <LockStep preview={preview} goals={goals} equipment={equipment} baseline={baseline} name={data.name} />
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
