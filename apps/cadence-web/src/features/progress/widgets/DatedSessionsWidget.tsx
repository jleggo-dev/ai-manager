import type { DatedSessionsPayload, DatedSession } from '@cadence/shared';
import { monthTicks, scaleLinear } from './chartMath.ts';

const W = 328;
const H = 150;
const P = 24;
const BASE = H - 26;

/** distance_km when present, else duration_min — whichever the resolver shipped for this
 *  activity, so one widget covers both a run's distance and a sit's plain duration. */
function magnitude(s: DatedSession): number {
  return s.distance_km ?? s.duration_min ?? 0;
}

function bestLabel(s: DatedSession): string {
  if (s.distance_km != null) return `${s.distance_km} km — your longest yet`;
  if (s.duration_min != null) return `${s.duration_min} min — your longest yet`;
  return 'your longest yet';
}

/** Under-line: "{total} sessions · {last_4_weeks} in the last 4 weeks · usually around {hr} bpm",
 *  the bpm clause omitted entirely when there's no HR to report (never "around null bpm"). */
function underLine(data: DatedSessionsPayload): string {
  const base = `${data.total} sessions · ${data.last_4_weeks} in the last 4 weeks`;
  return data.usual_hr != null ? `${base} · usually around ${data.usual_hr} bpm` : base;
}

export function DatedSessionsWidget({ data }: { data: DatedSessionsPayload }) {
  const mags = data.sessions.map(magnitude);
  const max = Math.max(1, ...mags);
  const n = data.sessions.length;
  const x = (i: number) => (n <= 1 ? W / 2 : scaleLinear(i, 0, n - 1, P, W - P));
  const y = (v: number) => scaleLinear(v, 0, max, BASE, P);
  const ticks = monthTicks(data.sessions, x);

  return (
    <div>
      <svg className="pw-sessions-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
        <line x1={0} y1={BASE} x2={W} y2={BASE} stroke="var(--line-soft)" strokeWidth={1} />
        {data.sessions.map((s, i) => {
          const cx = x(i);
          const cy = y(magnitude(s));
          const color = s.best ? 'var(--dawn-3)' : 'var(--forest)';
          return (
            <g key={`${s.date}-${i}`}>
              <line x1={cx} y1={BASE} x2={cx} y2={cy} stroke={color} strokeWidth={2} opacity={s.best ? 1 : 0.82} />
              <circle cx={cx} cy={cy} r={3.3} fill={color} />
              {s.best && (
                <text
                  x={cx}
                  y={cy - 8}
                  textAnchor="middle"
                  fontFamily="var(--display)"
                  fontWeight={700}
                  fontSize="10.5"
                  fill="var(--dawn-4)"
                >
                  {bestLabel(s)}
                </text>
              )}
            </g>
          );
        })}
        {ticks.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={H - 4}
            textAnchor="middle"
            fontFamily="var(--mono)"
            fontSize="10"
            fill="var(--text-mute)"
          >
            {t.label}
          </text>
        ))}
      </svg>
      <div className="pw-sessions-under">{underLine(data)}</div>
    </div>
  );
}
