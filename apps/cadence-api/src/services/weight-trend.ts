/**
 * Deterministic weight-trend reads for adaptive calorie targets (plan §adaptive targets) — a "tool
 * library" entry. Pure, no DB/AI/clock (dates are parsed, not read from now()), so the coach gets a
 * grounded, testable trend to reason about. The coach proposes the target adjustment; this just
 * measures the actual pace and the safe/recommended pace to measure it against.
 */

export interface WeighPoint {
  date: string; // YYYY-MM-DD
  kg: number;
}

/**
 * Signed kg/week from the earliest to the latest weigh-in (negative = losing). Null when there are
 * fewer than 2 points or they span under a week — not enough to trust a rate.
 */
export function actualWeeklyRate(points: WeighPoint[]): number | null {
  const pts = points.filter((p) => Number.isFinite(p.kg) && p.kg > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return null;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const days = (Date.parse(last.date) - Date.parse(first.date)) / 86_400_000;
  if (days < 7) return null;
  return ((last.kg - first.kg) / days) * 7;
}

/** Safe/recommended weekly weight-change magnitude (kg) — ~0.75% of current bodyweight/week (the
 *  midpoint of the 0.5–1% band). Always positive; the goal's direction gives it a sign. */
export function safeWeeklyKg(currentKg: number): number {
  return Math.round(currentKg * 0.0075 * 100) / 100;
}

/**
 * Classify the actual pace against the safe target for a weight-LOSS goal (the case that matters):
 * 'too_fast' (losing faster than 1.5× safe — muscle-loss risk → raise calories), 'too_slow' (under
 * half safe → trim), else 'on_track'. `actualRate` is signed kg/wk; `safe` is the positive magnitude.
 */
export function classifyLossPace(actualRate: number, safe: number): 'too_fast' | 'on_track' | 'too_slow' {
  const loss = -actualRate; // positive when losing weight
  if (loss > safe * 1.5) return 'too_fast';
  if (loss < safe * 0.5) return 'too_slow';
  return 'on_track';
}
