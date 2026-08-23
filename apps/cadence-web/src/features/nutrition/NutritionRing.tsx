import type { ReactNode } from 'react';
import { ringArcs } from './nutritionRingMath.ts';

/* Food-module palette (design redlines §"The two-tone ring"). */
const TRACK = 'oklch(94% 0.015 80)';
const LOGGED = 'oklch(72% 0.15 68)';
const PENDING = 'oklch(88% 0.10 74)';
const PENDING_OVER = 'oklch(84% 0.10 40)';

/**
 * The two-tone nutrition ring — one SVG, three arcs on the same radius, rotated −90 so noon is the
 * start. Draw order matters: track, then the **pending** arc (butt caps, so its leading edge reads as
 * a hard tick = "what this meal adds"), then the **logged** arc (round caps) on top. Used at five sizes
 * across the module (52 trail strip → 118 hero); `stroke` scales 11–16 so it stays legible small.
 * `children` is the centre readout ("530 / KCAL LEFT AFTER THIS"), absolutely centred in the hole.
 * With no target the ring shows the track only (days with no goal draw nothing to decode).
 *
 * **The track is ALWAYS smooth.** A target-less day used to draw it dashed — the Food Journey's
 * first mark for "counting, not scoring" — but at these stroke widths the round dash caps overlap
 * their own gaps and fuse into one scalloped, crenulated loop: not a dotted line, a ring with a
 * chewed edge. It read as damage. BRAND.md — *count what happened, never what broke* — so an
 * ordinary morning before anyone has eaten must not render as a fractured thing. "No target" is
 * said in the COPY beside the ring ("no target yet", the days-to-target countdown), never in the
 * texture of the ring itself. Empty and smooth says "nothing yet"; that is the whole message.
 */
export function NutritionRing({
  logged,
  pending = 0,
  target,
  size = 74,
  stroke = 13,
  className,
  children,
}: {
  logged: number;
  pending?: number;
  target: number | null | undefined;
  size?: number;
  stroke?: number;
  className?: string;
  children?: ReactNode;
}) {
  const c = size / 2;
  const r = (size - stroke) / 2;
  const hasTarget = typeof target === 'number' && target > 0;
  const arcs = hasTarget ? ringArcs(logged, pending, target) : null;

  return (
    <div className={`nring${className ? ` ${className}` : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {/* One track, one colour, every state. The darker shade that used to mark "counting" went
            with the dashes: a target-less ring that is merely a different grey is the same claim in
            a quieter voice, and the ring beside it on a scored day would still look like the real
            one. Scored-and-empty and target-less now render identically — which is honest, because
            both mean "nothing yet", and the copy underneath is what tells them apart. */}
        <circle cx={c} cy={c} r={r} fill="none" stroke={TRACK} strokeWidth={stroke} />
        {arcs && arcs.pendingLen > 0 && (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={arcs.over ? PENDING_OVER : PENDING}
            strokeWidth={stroke}
            strokeLinecap="butt"
            pathLength={100}
            strokeDasharray={`${arcs.pendingLen} ${100 - arcs.pendingLen}`}
            strokeDashoffset={-arcs.pendingOffset}
            transform={`rotate(-90 ${c} ${c})`}
          />
        )}
        {arcs && arcs.loggedLen > 0 && (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={LOGGED}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${arcs.loggedLen} ${100 - arcs.loggedLen}`}
            transform={`rotate(-90 ${c} ${c})`}
          />
        )}
      </svg>
      {children != null && <div className="nring-c">{children}</div>}
    </div>
  );
}
