import type { ReactNode } from 'react';
import type { SkyCategory } from './skyCategory.ts';
import { bolt, cloud, fog, hail, leaf, rain, snow, wind } from './skyArt.tsx';

/**
 * The eleven skies, composed once at module load (docs/cadence/DESIGN-weather-skies.md).
 *
 * Each scene is three things laid over the UNTOUCHED Linen gradient: a `wash` (a tint, `null`
 * when the day keeps its own colour), the sunrise glow's opacity (`sun` — the sun and the
 * `.trail-horizon` / `.trail-sundisc` pair fade with the cloud), and the `decor` — the vector
 * art, on a `0 0 390 560` canvas. `dark` marks the three skies dim enough that the day label and
 * the node labels flip to the light type the night stops already use.
 *
 * The compositions are the approved artboards' (scratchpad `weather-skies/gen4.mjs`). Cloud
 * positions there went through `cl(x, y, w) = (x·0.92, y−48, w·0.8)` — lifted and trimmed so the
 * art frames the day label instead of sitting on the first node — and the numbers below are the
 * transformed ones. The element trees are built once and shared by every day drawn under the
 * same sky: React renders the same immutable element in many places without complaint, and the
 * seeded scatters mean rebuilding them would produce the identical tree anyway.
 */
export type SkyScene = {
  wash: string | null;
  sun: number;
  dark: boolean;
  decor: ReactNode | null;
};

const dark = { dark: true } as const;

export const SKY_SCENES: Record<SkyCategory, SkyScene> = {
  clear: { wash: null, sun: 1, dark: false, decor: null },
  'partly-cloudy': {
    wash: null,
    sun: 1,
    dark: false,
    decor: [cloud(190, -2, 120, { opacity: 0.96 }), cloud(-20, 48, 142), cloud(241, 120, 83, { opacity: 0.9 })],
  },
  overcast: {
    wash: 'linear-gradient(to bottom, oklch(82% 0.012 250 / 0.55) 0%, oklch(78% 0.014 250 / 0.5) 45%, oklch(64% 0.02 250 / 0.2) 80%, transparent 100%)',
    sun: 0.25,
    dark: false,
    decor: [
      cloud(-37, -30, 184, dark),
      cloud(129, -22, 224, dark),
      cloud(-9, 26, 160),
      cloud(166, 44, 184),
      cloud(74, 72, 152, { opacity: 0.96 }),
    ],
  },
  'light-rain': {
    wash: 'linear-gradient(to bottom, oklch(80% 0.014 250 / 0.5) 0%, oklch(74% 0.018 250 / 0.42) 55%, transparent 100%)',
    sun: 0.15,
    dark: false,
    decor: [cloud(-28, -26, 192, dark), cloud(138, -14, 208, dark), cloud(46, 30, 168), rain(11, 64, { len: [8, 13] })],
  },
  'heavy-rain': {
    wash: 'linear-gradient(to bottom, oklch(58% 0.02 252 / 0.8) 0%, oklch(56% 0.022 252 / 0.72) 55%, oklch(46% 0.03 250 / 0.4) 100%)',
    sun: 0,
    dark: true,
    decor: [
      cloud(-46, -38, 224, dark),
      cloud(120, -30, 240, dark),
      cloud(28, 18, 192, { dark: true, opacity: 0.95 }),
      rain(23, 150, { colour: 'oklch(88% 0.02 250)', len: [12, 20], opacity: 0.7 }),
    ],
  },
  thunderstorm: {
    wash: 'linear-gradient(to bottom, oklch(42% 0.03 262 / 0.82) 0%, oklch(44% 0.03 262 / 0.72) 55%, oklch(40% 0.03 260 / 0.42) 100%)',
    sun: 0,
    dark: true,
    decor: [
      cloud(-55, -42, 240, dark),
      cloud(110, -34, 256, dark),
      cloud(9, 22, 208, { dark: true, opacity: 0.95 }),
      rain(37, 110, { colour: 'oklch(84% 0.02 250)', len: [12, 20], opacity: 0.6 }),
      bolt(250, 96),
    ],
  },
  windy: {
    wash: null,
    sun: 0.95,
    dark: false,
    decor: [
      cloud(180, -8, 112, { opacity: 0.92 }),
      wind(24, 92, 300),
      leaf(318, 106, 18),
      leaf(96, 176, -28, 10),
      leaf(336, 194, 58, 9),
      wind(120, 236, 200, { opacity: 0.6 }),
    ],
  },
  hail: {
    wash: 'linear-gradient(to bottom, oklch(66% 0.016 252 / 0.72) 0%, oklch(62% 0.02 252 / 0.62) 55%, oklch(50% 0.03 250 / 0.35) 100%)',
    sun: 0.1,
    dark: true,
    decor: [
      cloud(-37, -34, 208, dark),
      cloud(129, -26, 224, dark),
      cloud(37, 22, 176, { dark: true, opacity: 0.95 }),
      hail(41, 54),
    ],
  },
  'light-snow': {
    wash: 'linear-gradient(to bottom, oklch(94% 0.006 250 / 0.55) 0%, oklch(90% 0.008 250 / 0.45) 55%, transparent 100%)',
    sun: 0.35,
    dark: false,
    decor: [
      cloud(-28, -24, 192),
      cloud(138, -12, 200),
      cloud(55, 36, 160, { opacity: 0.96 }),
      snow(53, 48, { flakes: 3 }),
    ],
  },
  'heavy-snow': {
    wash: 'linear-gradient(to bottom, oklch(92% 0.006 250 / 0.8) 0%, oklch(88% 0.008 250 / 0.7) 55%, oklch(82% 0.01 250 / 0.4) 100%)',
    sun: 0.1,
    dark: false,
    decor: [
      cloud(-46, -38, 224),
      cloud(120, -32, 240),
      cloud(18, 14, 200, { opacity: 0.96 }),
      snow(67, 150, { flakes: 5 }),
    ],
  },
  fog: {
    wash: 'linear-gradient(to bottom, oklch(96% 0.005 90 / 0.55) 0%, oklch(93% 0.006 90 / 0.5) 40%, oklch(90% 0.008 90 / 0.35) 75%, transparent 100%)',
    sun: 0.15,
    dark: false,
    decor: [fog(71)],
  },
};

/** Light type on this sky? The three dim washes; every other sky keeps the ramp's own rule. */
export function isDarkSky(category: SkyCategory): boolean {
  return SKY_SCENES[category].dark;
}
