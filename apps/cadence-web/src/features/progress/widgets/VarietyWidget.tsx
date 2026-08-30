import type { VarietyPayload } from '@cadence/shared';

/** `variety` — breadth, one sentence: "{count} {noun}" over a quiet window_label. */
export function VarietyWidget({ data }: { data: VarietyPayload }) {
  return (
    <div>
      <div className="pw-variety-line">
        {data.count} {data.noun}
      </div>
      <div className="prog-sub">{data.window_label}</div>
    </div>
  );
}
