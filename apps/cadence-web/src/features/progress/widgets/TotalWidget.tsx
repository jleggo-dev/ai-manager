import type { TotalPayload } from '@cadence/shared';

/**
 * `total` — presence, not slope ("340 minutes sat", "31,200 words"). Reuses the existing
 * .prog-big/.prog-unit/.prog-sub type scale verbatim (styles.css "Progress tab" section) since it
 * already matches this exact spec (26px/800 value, 14px/600 dim unit, quiet sub-line).
 */
export function TotalWidget({ data }: { data: TotalPayload }) {
  return (
    <div>
      <div className="prog-big">
        {data.value}
        <span className="prog-unit"> {data.unit}</span>
      </div>
      <div className="prog-sub">{data.window_label}</div>
    </div>
  );
}
