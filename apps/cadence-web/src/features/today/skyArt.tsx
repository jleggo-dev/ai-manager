import type { ReactNode } from 'react';

/**
 * Illustrated weather for the trail — vector art in the discs' own language (owner's pick,
 * 2026-09-07, over tiled CSS patterns; docs/cadence/DESIGN-weather-skies.md): rounded silhouettes,
 * a top-left glint, a solid bottom edge (the disc's `0 8px 0 edge` shadow). Every recipe returns
 * SVG content for ONE `viewBox="0 0 390 560"` canvas that `DaySky` lays over the day, and every
 * scatter is drawn by a seeded generator, so the art is identical on every render and on every
 * day that shares a sky. The scenes call these once, at module load (`skyScenes.tsx`).
 *
 * Ported from the approved vector pass (scratchpad `weather-skies/art.mjs`); the geometry is the
 * artboards', not a re-draw. A raster sky per category can replace this layer later behind the
 * same `skyCategory` router.
 */

/** A small LCG, so a seed always draws the same scatter. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CLOUD_FACE = 'oklch(98% 0.004 90)';
const CLOUD_EDGE = 'oklch(86% 0.012 250)';
const CLOUD_DARK_FACE = 'oklch(84% 0.014 252)';
const CLOUD_DARK_EDGE = 'oklch(66% 0.02 252)';
const WHITE = 'oklch(99% 0 0)';

const f1 = (n: number) => n.toFixed(1);

/**
 * A cloud: three lobes and a base, drawn twice — the edge copy 7px lower (the disc's solid drop),
 * then the face — with a glint ellipse on the top-left lobe, the way `.trail-disc::before` sits.
 * `w` is the cloud's width; everything else scales from it.
 */
export function cloud(
  x: number,
  y: number,
  w: number,
  { dark = false, opacity = 1 }: { dark?: boolean; opacity?: number } = {},
): ReactNode {
  const face = dark ? CLOUD_DARK_FACE : CLOUD_FACE;
  const edge = dark ? CLOUD_DARK_EDGE : CLOUD_EDGE;
  const h = w * 0.42;
  const shape = (dy: number, fill: string) => (
    <g transform={`translate(0 ${dy})`} fill={fill}>
      <circle cx={w * 0.3} cy={h * 0.62} r={h * 0.42} />
      <circle cx={w * 0.52} cy={h * 0.42} r={h * 0.55} />
      <circle cx={w * 0.74} cy={h * 0.66} r={h * 0.38} />
      <rect x={w * 0.22} y={h * 0.56} width={w * 0.6} height={h * 0.44} rx={h * 0.22} />
    </g>
  );
  return (
    <g key={`cloud-${x}-${y}-${w}`} transform={`translate(${x} ${y})`} opacity={opacity}>
      {shape(7, edge)}
      {shape(0, face)}
      <ellipse
        cx={w * 0.42}
        cy={h * 0.22}
        rx={w * 0.14}
        ry={h * 0.12}
        transform={`rotate(-16 ${w * 0.42} ${h * 0.22})`}
        fill="oklch(100% 0 0 / 0.5)"
      />
    </g>
  );
}

/** Rain: short rounded strokes, scattered by the seed, leaning 14° the way the wind carries them. */
export function rain(
  seed: number,
  count: number,
  {
    colour = 'oklch(70% 0.04 250)',
    len = [9, 15],
    top = 70,
    bottom = 520,
    opacity = 0.75,
  }: { colour?: string; len?: [number, number]; top?: number; bottom?: number; opacity?: number } = {},
): ReactNode {
  const r = rng(seed);
  const drops: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const x = 10 + r() * 370;
    const y = top + r() * (bottom - top);
    const l = len[0] + r() * (len[1] - len[0]);
    const a = 0.45 + r() * 0.55;
    drops.push(
      <line key={i} x1={f1(x)} y1={f1(y)} x2={f1(x - l * 0.25)} y2={f1(y + l)} strokeOpacity={a.toFixed(2)} />,
    );
  }
  return (
    <g key={`rain-${seed}`} opacity={opacity} stroke={colour} strokeWidth={2.2} strokeLinecap="round">
      {drops}
    </g>
  );
}

/** Snow: soft round flakes at three sizes with a faint halo, plus a few drawn six-arm flakes. */
export function snow(
  seed: number,
  count: number,
  {
    flakes = 3,
    opacity = 0.9,
    top = 60,
    bottom = 540,
  }: { flakes?: number; opacity?: number; top?: number; bottom?: number } = {},
): ReactNode {
  const r = rng(seed);
  const dots: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const x = 8 + r() * 374;
    const y = top + r() * (bottom - top);
    const rad = 1.4 + r() * 2.2;
    const a = 0.55 + r() * 0.45;
    dots.push(<circle key={i} cx={f1(x)} cy={f1(y)} r={f1(rad)} fillOpacity={a.toFixed(2)} />);
  }
  const arms: ReactNode[] = [];
  for (let i = 0; i < flakes; i++) {
    const x = 30 + r() * 330;
    const y = top + 20 + r() * (bottom - top - 60);
    const s = 7 + r() * 5;
    const lines: ReactNode[] = [];
    for (let k = 0; k < 3; k++) {
      const rot = `rotate(${k * 60})`;
      lines.push(<line key={`${k}a`} x1={-s} y1={0} x2={s} y2={0} transform={rot} />);
      lines.push(<line key={`${k}b`} x1={s * 0.55} y1={0} x2={s * 0.75} y2={-s * 0.22} transform={rot} />);
      lines.push(<line key={`${k}c`} x1={s * 0.55} y1={0} x2={s * 0.75} y2={s * 0.22} transform={rot} />);
      lines.push(<line key={`${k}d`} x1={-s * 0.55} y1={0} x2={-s * 0.75} y2={-s * 0.22} transform={rot} />);
      lines.push(<line key={`${k}e`} x1={-s * 0.55} y1={0} x2={-s * 0.75} y2={s * 0.22} transform={rot} />);
    }
    arms.push(
      <g
        key={i}
        transform={`translate(${f1(x)} ${f1(y)})`}
        stroke={WHITE}
        strokeWidth={1.6}
        strokeLinecap="round"
        opacity={0.9}
      >
        {lines}
      </g>,
    );
  }
  const halo = `sky-halo-${seed}`;
  return (
    <g key={`snow-${seed}`} opacity={opacity}>
      <defs>
        <filter id={halo} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>
      <g fill={WHITE} filter={`url(#${halo})`}>
        {dots}
      </g>
      <g fill={WHITE}>{dots}</g>
      {arms}
    </g>
  );
}

/** Hail: pellets — a slate edge under a pale face, the disc idiom at 4px. */
export function hail(
  seed: number,
  count: number,
  { top = 90, bottom = 520 }: { top?: number; bottom?: number } = {},
): ReactNode {
  const r = rng(seed);
  const pellets: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const x = 12 + r() * 366;
    const y = top + r() * (bottom - top);
    const rad = 2 + r() * 1.6;
    pellets.push(<circle key={`${i}e`} cx={f1(x)} cy={f1(y + 1.4)} r={f1(rad)} fill="oklch(62% 0.03 252)" />);
    pellets.push(<circle key={`${i}f`} cx={f1(x)} cy={f1(y)} r={f1(rad)} fill="oklch(95% 0.008 250)" />);
  }
  return (
    <g key={`hail-${seed}`} opacity={0.9}>
      {pellets}
    </g>
  );
}

const BOLT = 'M24 0 L4 40 L18 40 L10 78 L40 30 L25 30 L34 0 Z';

/** The bolt: the sun's own yellow with a terracotta edge — the one warm thing in a storm. */
export function bolt(x: number, y: number, scale = 1): ReactNode {
  return (
    <g key={`bolt-${x}-${y}`} transform={`translate(${x} ${y}) scale(${scale})`}>
      <defs>
        <filter id="sky-bolt-glow" x="-100%" y="-50%" width="300%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <path d={BOLT} fill="oklch(93% 0.14 88 / 0.55)" filter="url(#sky-bolt-glow)" />
      <path d={BOLT} fill="oklch(70% 0.15 45)" transform="translate(0 5)" />
      <path d={BOLT} fill="oklch(93% 0.14 88)" />
      <path d="M24 0 L4 40 L14 40 Z" fill="oklch(100% 0 0 / 0.35)" />
    </g>
  );
}

/** Wind: three flowing lines with a curl, fading along their length. */
export function wind(x: number, y: number, w: number, { opacity = 0.85 }: { opacity?: number } = {}): ReactNode {
  const line = (dy: number, len: number, curl: number) => (
    <path
      key={dy}
      d={`M0 ${dy} C ${len * 0.35} ${dy - 4}, ${len * 0.7} ${dy + 4}, ${len} ${dy} c ${curl} 0, ${curl} ${-curl * 1.6}, ${curl * 0.2} ${-curl * 1.6}`}
      fill="none"
      stroke="url(#sky-wind-fade)"
      strokeWidth={3.2}
      strokeLinecap="round"
    />
  );
  return (
    <g key={`wind-${x}-${y}`} transform={`translate(${x} ${y})`} opacity={opacity}>
      <defs>
        <linearGradient id="sky-wind-fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={CLOUD_FACE} stopOpacity="0" />
          <stop offset="0.35" stopColor={CLOUD_FACE} stopOpacity="0.95" />
          <stop offset="1" stopColor={CLOUD_FACE} stopOpacity="0.95" />
        </linearGradient>
      </defs>
      {line(14, w * 0.62, 10)}
      {line(38, w * 0.86, 12)}
      {line(62, w * 0.5, 8)}
    </g>
  );
}

/** A leaf the wind carries — a small terracotta almond with a stem, the brand's human accent. */
export function leaf(x: number, y: number, rot: number, size = 12): ReactNode {
  // The artboard drew this in a 24-unit box `size * 2` wide, centred on (x + size, y + size).
  return (
    <g key={`leaf-${x}-${y}`} transform={`translate(${x + size} ${y + size}) scale(${size / 12}) rotate(${rot})`}>
      <path d="M-9 0 C -6 -7, 6 -7, 9 0 C 6 7, -6 7, -9 0 Z" fill="oklch(66% 0.11 50)" />
      <path d="M-9 0 L9 0" stroke="oklch(50% 0.1 45)" strokeWidth={1} strokeLinecap="round" />
    </g>
  );
}

/** Fog: layered bands with soft edges that sit across the trail and thin toward the bottom. */
export function fog(seed: number): ReactNode {
  const r = rng(seed);
  const bands = [40, 130, 210, 300, 390, 470].map((y, i) => {
    const h = 34 + r() * 26;
    const x = -60 + r() * 60;
    const w = 380 + r() * 120;
    const a = 0.72 - i * 0.09;
    return (
      <rect
        key={y}
        x={x.toFixed(0)}
        y={y}
        width={w.toFixed(0)}
        height={h.toFixed(0)}
        rx={(h / 2).toFixed(0)}
        fill="oklch(97% 0.005 90)"
        fillOpacity={a.toFixed(2)}
        filter="url(#sky-fog-soft)"
      />
    );
  });
  return (
    <g key={`fog-${seed}`}>
      <defs>
        <filter id="sky-fog-soft" x="-20%" y="-100%" width="140%" height="300%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>
      {bands}
    </g>
  );
}
