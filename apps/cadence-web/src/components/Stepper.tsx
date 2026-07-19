import { Fragment } from 'react';

const STEPS = ['Talk', 'Confirm', 'Set'];

/** The setup flow indicator (Talk → Confirm → Set your rhythm) so the user knows where they are. */
export function Stepper({ active }: { active: number }) {
  return (
    <div className="stepper">
      {STEPS.map((s, i) => (
        <Fragment key={s}>
          <div className={`st ${i === active ? 'active' : i < active ? 'done' : ''}`}>
            <span className="sd">{i < active ? '✓' : i + 1}</span>
            {s}
          </div>
          {i < STEPS.length - 1 && <span className="line" />}
        </Fragment>
      ))}
    </div>
  );
}
