import type { CSSProperties, ReactNode } from 'react';

/**
 * The skeleton primitives (PERF-06). One bar, one circle, one ring track, one screen wrapper —
 * every deterministic screen composes its own placeholder from these four so they cannot drift
 * into four different ideas of what "loading" looks like.
 *
 * **A skeleton draws shapes, never numbers.** The temptation on a screen full of totals is to
 * paint zeroes and let them fill in, which is what the owner literally asked for ("show everything
 * at 0 and then update", 2026-08-20). Shapes are that request done honestly: a real 0 is a real
 * answer — 0 kcal eaten at eight in the morning is simply true — so a placeholder 0 and a settled
 * 0 are the same pixels, and the moment the ring jumps from 0 to 740 the earlier screen turns out
 * to have been a lie. A bar is never mistaken for a value. Structure arrives instantly either way,
 * which was the point.
 *
 * Styles: styles/skeleton.css.
 */

/** A placeholder bar. `w` accepts any CSS length (`'60%'`, `120`); `h` is px. */
export function Skeleton({
  w = '100%',
  h = 12,
  radius,
  className = '',
  style,
}: {
  w?: number | string;
  h?: number | string;
  radius?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`sk ${className}`.trim()}
      style={{ width: w, height: h, ...(radius === undefined ? null : { borderRadius: radius }), ...style }}
      aria-hidden
    />
  );
}

/** A placeholder disc — an avatar, a category glyph, a trail node. */
export function SkeletonCircle({ size = 40 }: { size?: number }) {
  return <Skeleton className="sk-circle" w={size} h={size} />;
}

/**
 * A ring's track with no progress arc. The chart language survives the wait (a ring is coming,
 * and it is this big, here) while the answer stays visibly absent — no arc, no number.
 */
export function SkeletonRing({
  size = 112,
  stroke = 12,
  children,
}: {
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  return (
    <span className="sk sk-ring" style={{ width: size, height: size, borderWidth: stroke }} aria-hidden>
      {children}
    </span>
  );
}

/**
 * The wrapper every screen skeleton returns. Carries `aria-busy` and ONE spoken line — a screen
 * reader hearing forty decorative bars hears nothing useful, so the bars are hidden and the
 * sentence does the work.
 *
 * `label` is in the coach's voice and says what is ARRIVING, never what is missing (BRAND.md:
 * count what happened, never what broke — an empty state is awaiting, not broken).
 */
export function SkeletonScreen({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`sk-screen ${className}`.trim()} aria-busy="true">
      <span className="sk-sr" role="status">
        {label}
      </span>
      {children}
    </div>
  );
}
