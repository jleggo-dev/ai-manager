import { useId } from 'react';

/**
 * The coach mark: a sunrise — a terracotta arch over a forest-green horizon line (brand team,
 * 2026-07-11). "Hearth, not scoreboard" (BRAND.md), rendered as the warmth of a sunrise.
 *
 * Two levels of finish:
 *  - default: flat vector with a hand-shaded warm gradient in the arch — safe + legible at the
 *    small sizes this lives at (22-30px header/avatar).
 *  - hero: adds a subtle feTurbulence displacement (a hand-drawn, slightly-organic edge) and a
 *    one-shot "sunrise rising" draw-in animation. Only used on the Welcome splash at 84px, where
 *    there's room for the roughened edge to read as craft rather than as a blurry small icon.
 *
 * Renders className="orb" so every existing size-override rule (`.wordmark .orb`, `.consist .orb`,
 * `.welcome .hero .orb`, ...) keeps working unchanged. IDs are per-instance (useId) so the hero's
 * gradient/filter defs never collide with the header/chat instances mounted at the same time.
 */
export function Orb({ className, hero = false }: { className?: string; hero?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const grad = `arch-grad-${uid}`;
  const rough = `arch-rough-${uid}`;
  const cls = ['orb', hero ? 'orb-hero' : '', className].filter(Boolean).join(' ');
  return (
    <svg className={cls} viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        {/* Hand-shaded: light catches the upper-left of the arch, deepening toward the base. */}
        <linearGradient id={grad} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="var(--dawn-1)" />
          <stop offset="0.55" stopColor="var(--dawn-3)" />
          <stop offset="1" stopColor="var(--dawn-4)" />
        </linearGradient>
        {hero && (
          <filter id={rough} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        )}
      </defs>
      <g filter={hero ? `url(#${rough})` : undefined}>
        <path
          className="arch-arc"
          d="M 30,80 A 30 30 0 0 1 90 80"
          fill="none"
          stroke={`url(#${grad})`}
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path className="arch-dome" d="M 45,80 A 15 15 0 0 1 75 80" fill={`url(#${grad})`} />
        <rect className="arch-bar" x="20" y="86" width="80" height="8" rx="4" fill="var(--forest)" />
      </g>
    </svg>
  );
}
