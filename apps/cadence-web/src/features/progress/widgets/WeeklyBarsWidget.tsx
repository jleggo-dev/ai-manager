import type { WeeklyBarsPayload } from '@cadence/shared';

/** A rect with only its top corners rounded — SVG's `rx`/`ry` round all four, and the spec wants
 *  the "grows from the baseline" look a bottom radius would undercut. */
function topRoundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rad = Math.max(0, Math.min(r, h, w / 2));
  return `M ${x} ${y + h} L ${x} ${y + rad} Q ${x} ${y} ${x + rad} ${y} L ${x + w - rad} ${y} Q ${x + w} ${y} ${x + w} ${y + rad} L ${x + w} ${y + h} Z`;
}

/**
 * `weekly_bars` — quiet weekly bars (steps, kcal). `weeks` runs oldest → newest (left → right,
 * ending at "this week"), matching how a bar chart reads. A `null` week is "the phone wasn't
 * along", not a bad week: it draws as a mono middot at the baseline, never a zero-height bar —
 * the one brand-physics rule this whole widget exists to enforce.
 */
export function WeeklyBarsWidget({ data }: { data: WeeklyBarsPayload }) {
  const W = 328;
  const H = 120;
  const BASE = H - 18; // room for the value label above the tallest bar
  const n = data.weeks.length;
  const gap = 6;
  const barW = n > 0 ? Math.min(28, (W - gap * (n - 1)) / n) : 0;
  const values = data.weeks.map((w) => w.value).filter((v): v is number => v != null);
  const max = values.length > 0 ? Math.max(...values) : 1;
  const lastIdx = n - 1;
  const latestValue = data.latest ?? data.weeks[lastIdx]?.value ?? null;

  return (
    <div>
      <svg className="pw-bars-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
        {data.weeks.map((w, i) => {
          const x = i * (barW + gap);
          const isLatest = i === lastIdx;
          if (w.value == null) {
            return (
              <text
                key={i}
                x={x + barW / 2}
                y={BASE + 4}
                textAnchor="middle"
                fontFamily="var(--mono)"
                fontSize="13"
                fill="var(--text-mute)"
              >
                &middot;
              </text>
            );
          }
          const barH = Math.max(3, (w.value / max) * (BASE - 14));
          return (
            <g key={i}>
              {isLatest && (
                <text
                  x={x + barW / 2}
                  y={BASE - barH - 6}
                  textAnchor="middle"
                  fontFamily="var(--display)"
                  fontWeight={700}
                  fontSize="11.5"
                  fill="var(--forest)"
                >
                  {latestValue ?? w.value}
                </text>
              )}
              <path
                d={topRoundedRectPath(x, BASE - barH, barW, barH, 4)}
                fill={isLatest ? 'var(--forest)' : 'var(--sage)'}
                opacity={isLatest ? 1 : 0.75}
              />
            </g>
          );
        })}
        <line x1={0} y1={BASE} x2={W} y2={BASE} stroke="var(--line-soft)" strokeWidth={1} />
        <text x={0} y={H - 2} fontFamily="var(--mono)" fontSize="10" fill="var(--text-mute)">
          {n > 1 ? `${n - 1} weeks ago` : ''}
        </text>
        <text x={W} y={H - 2} textAnchor="end" fontFamily="var(--mono)" fontSize="10" fill="var(--text-mute)">
          this week
        </text>
      </svg>
      <div className="pw-footer">{"a quiet week means the phone wasn't along — never zero"}</div>
    </div>
  );
}
