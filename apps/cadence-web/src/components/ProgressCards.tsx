import type { ProgressCard, ProgressTrend } from '@cadence/shared';
import { Ring, DotRow, CountBar, Sparkline } from './viz.tsx';
import type { GoalEventAddState } from '../features/today/useGoalEventAdd.ts';

/**
 * Shared progress-card renderer for Today (dashboard) and Progress tab.
 *
 * The two surfaces had already drifted before WEB-04 — dashboard uses rings/dots and a
 * richer countdown bar; Progress uses leaner list copy. Preserve both via `variant` so
 * consolidation does not silently change either screen.
 */

export type ProgressCardVariant = 'dashboard' | 'progress';

function ConsistencyCard({
  c,
  variant,
}: {
  c: Extract<ProgressCard, { kind: 'consistency' }>;
  variant: ProgressCardVariant;
}) {
  if (variant === 'dashboard') {
    if (c.area === 'nourishment') return null; // Nutrition card owns this area
    if (c.area === 'movement') {
      return (
        <div className="prog-card dash-ringcard">
          <Ring fraction={c.window > 0 ? c.kept / c.window : 0} color="var(--forest)" size={70}>
            <span className="ring-n">
              {c.kept}
              <i>/{c.window}</i>
            </span>
          </Ring>
          <div className="dash-ringcard-t">
            <div className="prog-title">{c.title}</div>
            <div className="prog-sub">{c.kept === 0 ? 'a fresh week' : `showed up ${c.kept} of ${c.window} days`}</div>
          </div>
        </div>
      );
    }
    const dots = Array.from({ length: c.window }, (_, i) => i < c.kept);
    return (
      <div className="prog-card">
        <div className="prog-title">{c.title}</div>
        <DotRow dots={dots} color="var(--sage)" />
        <div className="prog-sub">
          {c.kept === 0
            ? 'a fresh week — a missed day is information, not failure'
            : `${c.kept} of ${c.window} days this week`}
        </div>
      </div>
    );
  }

  return (
    <div className="prog-card">
      <div className="prog-title">{c.title}</div>
      <div className="prog-big">
        {c.kept}
        <span className="prog-unit"> of {c.window} days</span>
      </div>
      <div className="prog-sub">this week — a missed day is information, not failure</div>
    </div>
  );
}

function CountCard({ c, add }: { c: Extract<ProgressCard, { kind: 'count' }>; add: GoalEventAddState }) {
  const { addFor, addLabel, busy, setAddFor, setAddLabel, submitAdd } = add;
  return (
    <div className="prog-card">
      <div className="prog-title">{c.title}</div>
      <div className="prog-big">
        {c.current}
        <span className="prog-unit">
          /{c.target} {c.unit}
        </span>
      </div>
      <CountBar current={c.current} target={c.target} />
      {addFor === c.goal_id ? (
        <div className="prog-add">
          <input
            className="wiz-in"
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitAdd(c.goal_id)}
            placeholder="What did you finish? e.g. Dune"
            disabled={busy}
            autoFocus
          />
          <button className="logbox-btn" onClick={() => submitAdd(c.goal_id)} disabled={busy || !addLabel.trim()}>
            Add
          </button>
        </div>
      ) : (
        <button
          className="prog-addbtn"
          onClick={() => {
            setAddFor(c.goal_id);
            setAddLabel('');
          }}
        >
          + add one
        </button>
      )}
    </div>
  );
}

function MeasuredCard({
  c,
  variant,
}: {
  c: Extract<ProgressCard, { kind: 'latest_vs_target' }>;
  variant: ProgressCardVariant;
}) {
  const dir = c.start !== null && c.latest !== null ? (c.latest < c.start ? '↓' : c.latest > c.start ? '↑' : '→') : '';
  const startCopy =
    c.start !== null ? `started ${c.start}` : variant === 'dashboard' ? 'no start yet' : 'no starting point yet';

  /**
   * A23 §2c — the headline is the TREND, and today's reading is a footnote to it.
   *
   * The card used to lead with the latest raw number, which is mostly water and mostly noise: the
   * morning after a salty dinner reads as a week undone. Leading with the smoothed value is what
   * makes a daily weigh-in survivable — count what happened, never what broke. Falls back to the
   * raw reading only while there is too little series to smooth.
   */
  const headline = c.trend ?? c.latest;
  const showsTrend = c.trend != null;
  const rate = c.rate_per_week;
  const rateCopy =
    showsTrend && rate != null && Math.abs(rate) >= 0.05
      ? `${rate < 0 ? '↓' : '↑'} ${Math.abs(rate)} ${c.unit}/wk`
      : showsTrend
        ? 'holding steady'
        : '';
  const trendSub = [
    showsTrend ? 'trend' : '',
    rateCopy,
    c.confidence === 'low' && showsTrend ? 'early days' : '',
    c.latest != null && showsTrend ? `today ${c.latest}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  if (variant === 'dashboard') {
    return (
      <div className="prog-card">
        <div className="prog-title">{c.title}</div>
        <div className="prog-trend-row">
          <div>
            <div className="prog-big">
              {headline ?? '—'} <span className="prog-unit">{c.unit}</span>{' '}
              {dir && <span className="prog-dir">{dir}</span>}
            </div>
            {trendSub && <div className="prog-sub prog-quiet">{trendSub}</div>}
            <div className="prog-sub">
              {startCopy} · target {c.target}
            </div>
          </div>
          {c.series.length >= 2 && <Sparkline series={c.series} good="down" />}
        </div>
      </div>
    );
  }

  return (
    <div className="prog-card">
      <div className="prog-title">{c.title}</div>
      <div className="prog-big">
        {headline ?? '—'} <span className="prog-unit">{c.unit}</span> {dir && <span className="prog-dir">{dir}</span>}
      </div>
      {trendSub && <div className="prog-sub prog-quiet">{trendSub}</div>}
      <div className="prog-sub">
        {startCopy} · target {c.target}
      </div>
      {c.series.length >= 2 && <Sparkline series={c.series} good="down" />}
    </div>
  );
}

function CountdownCard({
  c,
  variant,
}: {
  c: Extract<ProgressCard, { kind: 'countdown' }>;
  variant: ProgressCardVariant;
}) {
  if (variant === 'dashboard') {
    const stones = c.milestones_total > 0;
    return (
      <div className="prog-card">
        <div className="prog-title">{c.title}</div>
        <div className="prog-big">
          {c.days_left}
          <span className="prog-unit"> days out</span>
        </div>
        {stones && (
          <>
            <CountBar current={c.milestones_done} target={c.milestones_total} />
            <div className="prog-sub">
              stepping-stones {c.milestones_done}/{c.milestones_total} · {c.end}
            </div>
          </>
        )}
        {!stones && <div className="prog-sub">{c.end}</div>}
      </div>
    );
  }

  return (
    <div className="prog-card">
      <div className="prog-title">{c.title}</div>
      <div className="prog-big">
        {c.days_left}
        <span className="prog-unit"> days out</span>
      </div>
      <div className="prog-sub">
        {c.milestones_total > 0 ? `stepping-stones ${c.milestones_done}/${c.milestones_total} · ` : ''}
        {c.end}
      </div>
    </div>
  );
}

export function ProgressCardView({
  card,
  variant,
  add,
}: {
  card: ProgressCard;
  variant: ProgressCardVariant;
  add: GoalEventAddState;
}) {
  switch (card.kind) {
    case 'consistency':
      return <ConsistencyCard c={card} variant={variant} />;
    case 'count':
      return <CountCard c={card} add={add} />;
    case 'latest_vs_target':
      return <MeasuredCard c={card} variant={variant} />;
    case 'countdown':
      return <CountdownCard c={card} variant={variant} />;
    default: {
      const _exhaustive: never = card;
      void _exhaustive;
      return null;
    }
  }
}

/** Trend sparkline card — layout differs slightly between Today and Progress. */
export function ProgressTrendCard({ trend, variant }: { trend: ProgressTrend; variant: ProgressCardVariant }) {
  const last = trend.series[trend.series.length - 1]!.value;
  const first = trend.series[0]!.value;

  if (variant === 'dashboard') {
    return (
      <div className="prog-card">
        <div className="prog-trend-row">
          <div>
            <div className="prog-title" style={{ marginBottom: 2 }}>
              {trend.title}
            </div>
            <div className="prog-big" style={{ fontSize: 20 }}>
              {last}
              <span className="prog-unit"> {trend.unit}</span>
            </div>
            <div className="prog-sub">
              {trend.label.toLowerCase()} · was {first}
            </div>
          </div>
          <Sparkline series={trend.series} good={trend.direction_good} />
        </div>
      </div>
    );
  }

  return (
    <div className="prog-card">
      <div className="prog-title">{trend.title}</div>
      <div className="prog-trend-row">
        <div>
          <div className="prog-big">
            {last}
            <span className="prog-unit"> {trend.unit}</span>
          </div>
          <div className="prog-sub">
            {trend.label.toLowerCase()} · was {first} {trend.unit}
          </div>
        </div>
        <Sparkline series={trend.series} good={trend.direction_good} />
      </div>
    </div>
  );
}
