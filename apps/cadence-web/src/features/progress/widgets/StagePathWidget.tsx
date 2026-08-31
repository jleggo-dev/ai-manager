import { Fragment } from 'react';
import type { StagePathPayload } from '@cadence/shared';

/**
 * `stage_path` — the gate track (owner design 1a, obstacle-race card): done stages are filled
 * forest circles with a check, the current stage is a white circle ringed in --sun with its label
 * in the same color, stages ahead are quiet grey. A connector turns forest only once BOTH its
 * ends are done — the track shows ground actually covered, never ground assumed. More stages than
 * fit simply scroll; nothing collapses to a percent bar.
 */
export function StagePathWidget({ data }: { data: StagePathPayload }) {
  return (
    <div>
      <div className="pw-gates">
        {data.stages.map((s, i) => (
          <Fragment key={`${s.label}-${i}`}>
            {i > 0 && (
              <span
                className={`pw-gate-line${
                  data.stages[i - 1]!.state === 'done' && s.state === 'done' ? ' pw-gate-line--cleared' : ''
                }`}
              />
            )}
            <span className={`pw-gate pw-gate--${s.state}`}>
              <span className="pw-gate-dot" aria-hidden>
                {s.state === 'done' ? '✓' : ''}
              </span>
              <span className="pw-gate-label">{s.label}</span>
            </span>
          </Fragment>
        ))}
      </div>
      {data.note && <div className="pw-stage-note">{data.note}</div>}
    </div>
  );
}
