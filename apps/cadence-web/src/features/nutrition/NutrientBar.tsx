import type { NutrientReading } from './nutrients.ts';

/**
 * The two nutrient shapes (Food Journey 09/5C). They are deliberately not the same object with a
 * different colour — a floor and a ceiling mean opposite things, and someone glancing at the screen
 * has to be able to tell which one they are looking at before they read a single word.
 *
 *  • **Floor** — a rounded track filling from the left, with a hard tick standing at the reference
 *    intake. "Get to the mark." Past the mark the bar rescales so the tick slides inside it, which
 *    is how "more than enough" looks without a bar that lies about its own length.
 *  • **Ceiling** — a squared channel held between two posts, filling toward a wall it should not
 *    reach. "Stay inside." No round caps, no green, and no red either: going past the line is a
 *    fact the number states, never a warning the bar shouts (BRAND — count what happened).
 */

/** Where the fill ends and the goal tick stands, both as percentages of the drawn track. */
function floorGeometry(pct: number): { fill: number; tick: number } {
  const max = Math.max(pct, 100);
  return { fill: (pct / max) * 100, tick: (100 / max) * 100 };
}

export function FloorBar({ r }: { r: NutrientReading }) {
  const { fill, tick } = floorGeometry(r.pct);
  return (
    <span className="nb-floor" aria-hidden>
      <span className="nb-track" />
      <span className="nb-fill" style={{ width: `${fill}%` }} />
      <span className="nb-tick" style={{ left: `${tick}%` }} />
    </span>
  );
}

export function CeilingBar({ r }: { r: NutrientReading }) {
  return (
    <span className="nb-ceil" aria-hidden>
      <span className="nb-post" />
      <span className="nb-chan">
        <span className="nb-cfill" style={{ width: `${Math.min(100, r.pct)}%` }} />
      </span>
      <span className="nb-post" />
    </span>
  );
}

/** The compact bar for "also counted" — same floor language, small enough to sit in a list row. */
export function MiniFloorBar({ r }: { r: NutrientReading }) {
  return (
    <span className="nb-mini" aria-hidden>
      <span className="nb-mini-fill" style={{ width: `${Math.min(100, r.pct)}%` }} />
    </span>
  );
}
