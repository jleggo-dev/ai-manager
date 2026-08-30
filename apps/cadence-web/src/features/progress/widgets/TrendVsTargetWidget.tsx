import type { TrendVsTargetPayload, WidgetCaption } from '@cadence/shared';
import { ewma, monthTicks, niceTicks, scaleLinear } from './chartMath.ts';
import { flatFields, formatCaptionNumber, renderCaption } from './caption.ts';

const W = 328;
const H = 168;
const LEFT = 30;
const RIGHT = 12;
const TOP = 14;
const BOTTOM = 20;

/** "up"/"down"/"steady" from the signed weekly rate — a convenience field for the coach's caption
 *  template (e.g. "easing {direction} about {rate_per_week} a week") that isn't itself a payload
 *  field, so it's computed here rather than asked of the resolver. */
function directionWord(ratePerWeek: number | null | undefined): string {
  if (ratePerWeek == null) return '';
  return ratePerWeek < 0 ? 'down' : ratePerWeek > 0 ? 'up' : 'steady';
}

/** A23 §2c's rule reapplied here: the headline is the smoothed trend, today's raw reading is a
 *  footnote. `trend == null` (too little series yet) is the ONLY case that hedges and skips the
 *  smoothed line — a bare series of pale dots is more honest than a line with nothing behind it. */
export function TrendVsTargetWidget({ data, caption }: { data: TrendVsTargetPayload; caption?: WidgetCaption }) {
  const headlineValue = data.trend ?? data.latest;
  const showsTrend = data.trend != null && data.series.length > 0;

  if (data.series.length === 0) {
    return (
      <div>
        <div className="pw-trend-headline">
          <span className="prog-big">{headlineValue ?? '—'}</span>
          <span className="prog-unit">{data.unit}</span>
        </div>
      </div>
    );
  }

  const values = data.series.map((p) => p.value);
  const domainMin = Math.min(...values, data.target);
  const domainMax = Math.max(...values, data.target);
  const pad = (domainMax - domainMin || 1) * 0.12;
  const yMin = domainMin - pad;
  const yMax = domainMax + pad;
  const x = (i: number) => scaleLinear(i, 0, Math.max(1, data.series.length - 1), LEFT, W - RIGHT);
  const y = (v: number) => scaleLinear(v, yMin, yMax, H - BOTTOM, TOP);
  const gridVals = niceTicks(yMin, yMax, 3);
  const smoothed = showsTrend ? ewma(values) : [];
  const ticks = monthTicks(data.series, x);

  const fields = {
    ...flatFields(data as unknown as Record<string, unknown>),
    direction: directionWord(data.rate_per_week),
  };
  const sub =
    data.confidence === 'low'
      ? 'early days — the line firms up as readings accumulate'
      : caption
        ? renderCaption(caption.template, fields)
        : '';

  return (
    <div>
      <div className="pw-trend-headline">
        <span className="prog-big">{headlineValue ?? '—'}</span>
        <span className="prog-unit">{data.unit}</span>
        {showsTrend && <span className="prog-unit">trend</span>}
      </div>
      {sub && <div className="pw-trend-sub">{sub}</div>}
      <svg className="pw-trend-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={LEFT} y1={y(v)} x2={W - RIGHT} y2={y(v)} stroke="var(--line-soft)" strokeWidth={1} />
            <text x={0} y={y(v) + 3} fontFamily="var(--mono)" fontSize="10" fill="var(--text-mute)">
              {formatCaptionNumber(v)}
            </text>
          </g>
        ))}
        <line
          x1={LEFT}
          y1={y(data.target)}
          x2={W - RIGHT}
          y2={y(data.target)}
          stroke="var(--line)"
          strokeWidth={1.3}
          strokeDasharray="4 3"
        />
        <text
          x={W - RIGHT}
          y={y(data.target) - 4}
          textAnchor="end"
          fontFamily="var(--mono)"
          fontSize="10"
          fill="var(--text-mute)"
        >
          target {formatCaptionNumber(data.target)}
        </text>
        {data.series.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={2.4} fill="var(--sage)" opacity={0.55} />
        ))}
        {showsTrend && (
          <>
            <polyline
              points={smoothed.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke="var(--forest)"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx={x(smoothed.length - 1)} cy={y(smoothed[smoothed.length - 1]!)} r={3.4} fill="var(--forest)" />
          </>
        )}
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
      <div className="pw-footer">the pale dots are single mornings — the line is the story</div>
    </div>
  );
}
