import type { SkyCategory } from './skyCategory.ts';
import { SKY_SCENES } from './skyScenes.tsx';

/**
 * The weather layer of one day on the trail (docs/cadence/DESIGN-weather-skies.md).
 *
 * Absolutely positioned over the day and under everything that reads or presses: the wash first,
 * then one SVG carrying the decor on the artboards' `390 × 560` canvas, scaled to the day's width
 * and pinned to its top (`xMidYMin meet`), so the clouds frame the label on every screen width
 * and a taller day simply has clear sky below the art. `pointer-events: none` throughout — the
 * nodes underneath keep their taps.
 *
 * A `clear` sky renders nothing at all: the untouched Linen day, exactly what the trail drew
 * before the forecast reached it. That is also what an absent forecast looks like, on purpose.
 */
export function DaySky({ category }: { category: SkyCategory }) {
  const scene = SKY_SCENES[category];
  if (!scene.wash && !scene.decor) return null;
  return (
    <div className="trail-sky" aria-hidden>
      {scene.wash && <div className="trail-sky-wash" style={{ background: scene.wash }} />}
      {scene.decor && (
        <svg className="trail-sky-art" viewBox="0 0 390 560" preserveAspectRatio="xMidYMin meet" width="100%">
          {scene.decor}
        </svg>
      )}
    </div>
  );
}
