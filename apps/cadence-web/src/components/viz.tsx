import type { ReactNode } from 'react';
import type { SeriesPoint } from '@cadence/shared';
import type { MealMacros } from '../lib/api.ts';

/**
 * Shared inline-SVG viz primitives for the dashboards (Today + Progress). No chart library,
 * no external assets — everything is a handful of <svg> shapes styled from the token palette.
 * The brand rule holds throughout: missed/remaining reads as neutral, never red; "count what's
 * left, not what broke".
 */

/** Tiny min/max-normalized sparkline: polyline + emphasized endpoint. Green when improving. */
export function Sparkline({ series, good }: { series: SeriesPoint[]; good: 'up' | 'down' }) {
  const W = 132;
  const H = 34;
  const P = 3;
  if (series.length < 2) return null;
  const vals = series.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => P + (i / (series.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = series[series.length - 1]!;
  const first = series[0]!;
  const improving = good === 'up' ? last.value >= first.value : last.value <= first.value;
  const stroke = improving ? 'var(--forest)' : 'var(--dawn-4)';
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(series.length - 1)} cy={y(last.value)} r="2.6" fill={stroke} />
    </svg>
  );
}

/** A flat progress bar (books 20/100). Clamped 0–100%. */
export function CountBar({ current, target }: { current: number; target: number }) {
  const pct = Math.max(0, Math.min(100, target > 0 ? (current / target) * 100 : 0));
  return (
    <div className="countbar">
      <div className="countbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A single donut. `fraction` (0–1) draws the colored arc clockwise from 12 o'clock; the rest is
 *  the neutral track. Center holds whatever you pass as children. */
export function Ring({
  fraction,
  color,
  size = 66,
  thickness = 7,
  track = 'var(--line-soft)',
  children,
}: {
  fraction: number;
  color: string;
  size?: number;
  thickness?: number;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const off = c * (1 - f);
  const mid = size / 2;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={mid} cy={mid} r={r} fill="none" stroke={track} strokeWidth={thickness} />
        <circle
          cx={mid}
          cy={mid}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

/** A row of dots — `dots[i]` true = kept/done (colored), false = neutral (never red). */
export function DotRow({ dots, color = 'var(--forest)' }: { dots: boolean[]; color?: string }) {
  return (
    <div className="dotrow">
      {dots.map((on, i) => (
        <span key={i} className="dot" style={{ background: on ? color : 'var(--surface-3)' }} />
      ))}
    </div>
  );
}

const MACRO_RINGS = [
  { k: 'protein_g', label: 'Protein', color: 'var(--forest)' },
  { k: 'carbs_g', label: 'Carbs', color: 'var(--dawn-3)' },
  { k: 'fat_g', label: 'Fat', color: 'var(--sage)' },
] as const;

/** MyFitnessPal-style macro rings — one ring per macro, filling as you eat toward the target;
 *  the caption counts DOWN what's left (never what you're over). kcal sits quietly beneath. */
export function MacroRings({ totals, targets, left }: { totals: MealMacros; targets: MealMacros; left: MealMacros | null }) {
  return (
    <div className="macro-rings">
      <div className="macro-rings-row">
        {MACRO_RINGS.map(({ k, label, color }) => {
          const target = targets[k] ?? 0;
          const eaten = totals[k] ?? 0;
          const rem = left?.[k] ?? Math.max(0, target - eaten);
          const reached = target > 0 && eaten >= target;
          return (
            <div className="macro-ring" key={k}>
              <Ring fraction={target > 0 ? eaten / target : 0} color={color} size={62} thickness={6}>
                <span className="macro-ring-n">{reached ? '✓' : Math.round(rem)}</span>
              </Ring>
              <div className="macro-ring-l">{label}</div>
              <div className="macro-ring-c">{reached ? 'reached' : 'g left'}</div>
            </div>
          );
        })}
      </div>
      {targets.kcal != null && (
        <div className="macro-kcal">
          <span>{Math.round(totals.kcal ?? 0)} / {Math.round(targets.kcal)} kcal</span>
          <span className="macro-kcal-left">{Math.round(left?.kcal ?? Math.max(0, targets.kcal - (totals.kcal ?? 0)))} left</span>
        </div>
      )}
    </div>
  );
}
