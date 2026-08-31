import type { TrendVsTargetPayload, WidgetCaption } from '@cadence/shared';
import { ewma, scaleLinear } from './chartMath.ts';
import { flatFields, formatCaptionNumber, renderCaption } from './caption.ts';

const W = 170;
const H = 44;

/** "up"/"down"/"steady" from the signed weekly rate — a convenience field for the coach's caption
 *  template (e.g. "easing {direction} about {rate_per_week} a week") that isn't itself a payload
 *  field, so it's computed here rather than asked of the resolver. */
function directionWord(ratePerWeek: number | null | undefined): string {
  if (ratePerWeek == null) return '';
  return ratePerWeek < 0 ? 'down' : ratePerWeek > 0 ? 'up' : 'steady';
}

/** "Jul 1" from the series' first date — the delta names the window it was measured over. */
function sinceLabel(isoDate: string): string {
  try {
    return new Date(`${isoDate.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

/**
 * `trend_vs_target` — compact per the owner design (1a, steady-weight card): the big number is
 * still the SMOOTHED trend (A23 §2c — a morning's raw weight is mostly water), with the change
 * across the on-screen series under it, beside a small sparkline with a dashed target line and a
 * dot on the last point. `trend == null` (too little series) keeps the honest fallback: raw
 * readings as pale dots, no line drawn over nothing. The delta moving TOWARD target wears forest;
 * away is merely muted — never var(--danger).
 */
export function TrendVsTargetWidget({ data, caption }: { data: TrendVsTargetPayload; caption?: WidgetCaption }) {
  const headlineValue = data.trend ?? data.latest;
  const showsTrend = data.trend != null && data.series.length > 0;

  if (data.series.length === 0) {
    return (
      <div>
        <div className="pw-trend-headline">
          <span className="pw-trend-big">{headlineValue ?? '—'}</span>
          <span className="prog-unit">{data.unit}</span>
        </div>
      </div>
    );
  }

  const values = data.series.map((p) => p.value);
  const domainMin = Math.min(...values, data.target);
  const domainMax = Math.max(...values, data.target);
  const pad = (domainMax - domainMin || 1) * 0.15;
  const x = (i: number) => scaleLinear(i, 0, Math.max(1, values.length - 1), 4, W - 6);
  const y = (v: number) => scaleLinear(v, domainMin - pad, domainMax + pad, H - 4, 4);
  const line = showsTrend ? ewma(values) : [];

  const first = values[0]!;
  const last = values[values.length - 1]!;
  const delta = last - first;
  const towardTarget = delta !== 0 && Math.sign(delta) === Math.sign(data.target - first);
  const deltaText =
    delta === 0
      ? `flat since ${sinceLabel(data.series[0]!.date)}`
      : `${delta < 0 ? '−' : '+'}${formatCaptionNumber(Math.abs(delta))} ${data.unit} since ${sinceLabel(data.series[0]!.date)}`;

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
      <div className="pw-trend-row">
        <div>
          <div className="pw-trend-headline">
            <span className="pw-trend-big">{headlineValue != null ? formatCaptionNumber(headlineValue) : '—'}</span>
            <span className="prog-unit">{data.unit}</span>
          </div>
          <div className={`pw-trend-delta${towardTarget ? '' : ' pw-trend-delta--drift'}`}>{deltaText}</div>
        </div>
        <svg className="pw-trend-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
          <line
            x1={0}
            y1={y(data.target)}
            x2={W}
            y2={y(data.target)}
            stroke="var(--line)"
            strokeWidth={1.5}
            strokeDasharray="3 4"
          />
          {showsTrend ? (
            <>
              <polyline
                points={line.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                fill="none"
                stroke="var(--forest)"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={x(line.length - 1)} cy={y(line[line.length - 1]!)} r={3.2} fill="var(--forest)" />
            </>
          ) : (
            values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2} fill="var(--sage)" opacity={0.55} />)
          )}
        </svg>
      </div>
      {sub && <div className="pw-trend-sub">{sub}</div>}
    </div>
  );
}
