/**
 * Small numeric + SVG-layout helpers shared by the temporal widgets (trend_vs_target,
 * dated_sessions, weekly_bars). Kept out of the widget render bodies so each stays plain markup —
 * this is genuine arithmetic and earns its own file (CLAUDE.md: split before a function grows).
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-25" -> "Aug". A fixed table, not `toLocaleDateString`, so labels never depend on the
 *  runtime's locale (dev, tests, device all agree). */
export function monthAbbr(dateStr: string): string {
  const idx = Number(dateStr.slice(5, 7)) - 1;
  return MONTH_ABBR[idx] ?? '';
}

/** A simple exponentially-weighted moving average — the client-side stand-in for the server's
 *  smoothed trend when only the raw series ships. Same "smoothed, not jumpy" shape (A23 §2c). */
export function ewma(values: number[], alpha = 0.35): number[] {
  if (values.length === 0) return [];
  const out: number[] = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    out.push(alpha * values[i]! + (1 - alpha) * out[i - 1]!);
  }
  return out;
}

/** `count` evenly spaced values between min and max, inclusive — gridline/tick positions. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (count <= 1 || min === max) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

/** Linear scale: a value in [domainMin, domainMax] to a pixel in [rangeMin, rangeMax]. */
export function scaleLinear(
  value: number,
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): number {
  const span = domainMax - domainMin || 1;
  return rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

/** Sparse x-axis month labels: one per distinct month, placed at that month's first point, so a
 *  dense daily series doesn't repeat "Aug" under every dot. */
export function monthTicks<T extends { date: string }>(
  points: T[],
  x: (i: number) => number,
): { x: number; label: string }[] {
  const seen = new Set<string>();
  const ticks: { x: number; label: string }[] = [];
  points.forEach((p, i) => {
    const month = p.date.slice(0, 7);
    if (seen.has(month)) return;
    seen.add(month);
    ticks.push({ x: x(i), label: monthAbbr(p.date) });
  });
  return ticks;
}
