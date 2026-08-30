import type { CountTowardPayload } from '@cadence/shared';
import { CountBar } from '../../../components/viz.tsx';

/** `count_toward` — "78 of 150" over a flat clamped bar. Reuses the existing CountBar (viz.tsx),
 *  which already draws exactly this: a var(--surface-3) track with a sage→forest fill. */
export function CountTowardWidget({ data }: { data: CountTowardPayload }) {
  return (
    <div>
      <div className="pw-count-label">
        {data.current} of {data.target} {data.unit}
      </div>
      <CountBar current={data.current} target={data.target} />
    </div>
  );
}
