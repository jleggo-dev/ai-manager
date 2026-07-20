import { Orb } from '../../../components/Orb.tsx';
import type { BaselineRead, MealMacros } from '../../../lib/api.ts';
import { macroLine } from './format.ts';

/**
 * The Baseline moment after 7+ observed days: coach read + one gradual change + optional
 * proposed daily targets (user must tap — never auto-applied).
 */
export function BaselineReadPanel({
  daysLogged,
  baseline,
  baselineBusy,
  targetsBusy,
  targetsSet,
  err,
  onFetch,
  onApplyTargets,
  onProposeChange,
}: {
  daysLogged: number;
  baseline: BaselineRead | null;
  baselineBusy: boolean;
  targetsBusy: boolean;
  targetsSet: boolean;
  err: string;
  onFetch: () => void;
  onApplyTargets: (t: MealMacros) => void;
  onProposeChange?: (steer: string) => void;
}) {
  return (
    <>
      {err && <div className="auth-error">{err}</div>}
      {daysLogged >= 7 && !baseline && (
        <button className="baseline-cta" onClick={onFetch} disabled={baselineBusy}>
          {baselineBusy ? 'Reading your week…' : 'A week of watching is done — want my read?'}
        </button>
      )}
      {baseline?.ready === true && (
        <div className="baseline-box">
          <div className="sess-note">
            <Orb />
            <span>{baseline.read}</span>
          </div>
          <div className="baseline-sug">
            <b>One small change:</b> {baseline.suggestion}
            {baseline.rationale ? <span className="baseline-why"> — {baseline.rationale}</span> : null}
          </div>
          {onProposeChange && (
            <button className="lockbtn" onClick={() => onProposeChange(baseline.suggestion)}>
              Weave it into my plan →
            </button>
          )}
          {baseline.proposed_targets && !targetsSet && (
            <div className="baseline-targets">
              <div className="baseline-targets-t">Daily targets I'd start you at</div>
              <div className="baseline-targets-n">{macroLine(baseline.proposed_targets).replace(/~/g, '')}</div>
              {baseline.targets_rationale && <div className="baseline-why">{baseline.targets_rationale}</div>}
              <button
                className="lockbtn"
                onClick={() => onApplyTargets(baseline.proposed_targets!)}
                disabled={targetsBusy}
              >
                {targetsBusy ? 'Setting…' : 'Use these targets'}
              </button>
              <div className="baseline-targets-edit">You can fine-tune them anytime in Settings.</div>
            </div>
          )}
          {targetsSet && <div className="baseline-targets-done">Targets set — your day now shows what's left. ✓</div>}
        </div>
      )}
    </>
  );
}
