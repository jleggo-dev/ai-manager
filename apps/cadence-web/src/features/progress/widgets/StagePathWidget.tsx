import type { StagePathPayload } from '@cadence/shared';

/** `stage_path` — "outline · part one · **part two** · revision": done/current/ahead chips. */
export function StagePathWidget({ data }: { data: StagePathPayload }) {
  return (
    <div>
      <div className="pw-stages">
        {data.stages.map((s, i) => (
          <span key={`${s.label}-${i}`} className={`pw-stage-chip pw-stage-chip--${s.state}`}>
            {s.label}
          </span>
        ))}
      </div>
      {data.note && <div className="pw-stage-note">{data.note}</div>}
    </div>
  );
}
