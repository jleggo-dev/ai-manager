import type { ReactNode } from 'react';

/**
 * Shared inline-SVG viz primitives for the dashboards (Today + Progress). No chart library,
 * no external assets — everything is a handful of <svg> shapes styled from the token palette.
 * The brand rule holds throughout: missed/remaining reads as neutral, never red; "count what's
 * left, not what broke".
 */

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
