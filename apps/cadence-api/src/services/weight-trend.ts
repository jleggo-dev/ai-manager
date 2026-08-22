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

/** Sorted, de-junked points — every read here starts from the same clean series. */
function clean(points: WeighPoint[]): WeighPoint[] {
  return points
    .filter((p) => Number.isFinite(p.kg) && p.kg > 0 && Number.isFinite(Date.parse(`${p.date}T00:00:00Z`)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const daysBetween = (a: string, b: string): number => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/**
 * Exponentially-weighted trend through the weigh-ins — the number the USER should see (A23 §2a).
 *
 * Bodyweight on any given morning is mostly water, so a raw reading is a fact about yesterday's
 * salt as much as about the month. Smoothing is what lets someone weigh in daily without the daily
 * number owning their mood: they see the trend, and today's reading only feeds it. That is "count
 * what happened, never what broke" applied to a scale.
 *
 * Weighting is by ELAPSED DAYS, not by sample index, so a weekly cadence and a daily one produce
 * comparable trends and a missed fortnight does not quietly count as one step.
 */
export function smoothedSeries(points: WeighPoint[], halfLifeDays = 10): WeighPoint[] {
  const pts = clean(points);
  if (pts.length === 0) return [];
  const tau = halfLifeDays / Math.LN2;
  const out: WeighPoint[] = [{ date: pts[0]!.date, kg: pts[0]!.kg }];
  for (let i = 1; i < pts.length; i++) {
    const gap = Math.max(0, daysBetween(pts[i - 1]!.date, pts[i]!.date));
    const w = 1 - Math.exp(-gap / tau);
    const prev = out[i - 1]!.kg;
    out.push({ date: pts[i]!.date, kg: Math.round((prev + w * (pts[i]!.kg - prev)) * 100) / 100 });
  }
  return out;
}

/** The current trend weight — what a display should show instead of this morning's number. */
export function trendWeightKg(points: WeighPoint[], halfLifeDays = 10): number | null {
  const s = smoothedSeries(points, halfLifeDays);
  return s.length ? s[s.length - 1]!.kg : null;
}

/**
 * Signed kg/week from a least-squares fit over the weigh-ins inside `windowDays` (negative =
 * losing). This is the rate the adaptive loop reasons about.
 *
 * Why a regression rather than first-to-last: a straight line between two readings gives both of
 * them infinite leverage, so one bloated Sunday could read as a stalled month and prompt a calorie
 * cut nobody needed. A fit uses every point in the window instead.
 *
 * Why the fit runs on the RAW points and not the smoothed ones (corrected 2026-08-22): a
 * least-squares fit IS the noise reduction, and smoothing first double-counts it. An EWMA lags a
 * sustained trend, so fitting its output returns a slope shallower than the real one — measured at
 * **34% too shallow with five weekly weigh-ins**, converging only after ~13. That error does not
 * cancel anywhere downstream: A23 §3 turns this rate into calories at 7700/kg, so 0.17 kg/wk of
 * attenuation is ~190 kcal/day of wrong maintenance, biased toward "you are eating at maintenance"
 * — the loop would read a real loss as a stall. Smoothing stays where lag is a FEATURE
 * (`trendWeightKg`, the number a person sees each morning); the rate is measured from what
 * actually happened.
 *
 * Null under the same "not enough to trust" rule as before: fewer than 3 points, or a span under
 * a week.
 */
export function smoothedWeeklyRate(points: WeighPoint[], windowDays = 28): number | null {
  const all = clean(points);
  if (all.length === 0) return null;
  const last = all[all.length - 1]!.date;
  const win = all.filter((p) => daysBetween(p.date, last) <= windowDays);
  if (win.length < 3) return null;
  const span = daysBetween(win[0]!.date, last);
  if (span < 7) return null;

  const xs = win.map((p) => daysBetween(win[0]!.date, p.date));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = win.reduce((a, p) => a + p.kg, 0) / win.length;
  let num = 0;
  let den = 0;
  win.forEach((p, i) => {
    const dx = xs[i]! - meanX;
    num += dx * (p.kg - meanY);
    den += dx * dx;
  });
  if (den === 0) return null;
  return Math.round((num / den) * 7 * 1000) / 1000;
}

/**
 * How much the rate can be trusted yet, from how much data is behind it. The coach should say
 * "still watching" rather than prescribe a cut off two weigh-ins, and this is what lets it.
 */
export function trendConfidence(points: WeighPoint[], windowDays = 28): 'none' | 'low' | 'medium' | 'high' {
  const pts = clean(points);
  if (pts.length < 3) return 'none';
  const span = daysBetween(pts[0]!.date, pts[pts.length - 1]!.date);
  const recent = pts.filter((p) => daysBetween(p.date, pts[pts.length - 1]!.date) <= windowDays);
  if (span < 14) return 'low';
  if (recent.length >= 8 || span >= 42) return 'high';
  return 'medium';
}

/**
 * Signed kg/week from the earliest to the latest weigh-in (negative = losing). Null when there are
 * fewer than 2 points or they span under a week — not enough to trust a rate.
 *
 * @deprecated Prefer `smoothedWeeklyRate` — two readings should not decide a month (A23 §2a).
 * Kept for callers not yet migrated and for the thin-data fallback.
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

export interface PaceRead {
  /** Signed kg/week — negative is losing. */
  actual_kg_per_week: number;
  safe_kg_per_week: number;
  pace: 'too_fast' | 'on_track' | 'too_slow';
  /** How much data is behind it, so a reader can hedge instead of prescribing. */
  confidence: 'low' | 'medium' | 'high';
  /** The trend weight, not this morning's reading. */
  trend_kg: number | null;
}

/**
 * The one weight read every caller wants: rate, the safe rate to judge it against, the verdict,
 * and how much to trust it. Prefers the smoothed fit and falls back to the crude first-to-last
 * rate when there is too little data to fit — going silent would switch the adaptive loop off for
 * anyone with only two weigh-ins, which is worse than saying "low confidence" out loud.
 */
export function paceRead(points: WeighPoint[], currentKg: number | null | undefined): PaceRead | null {
  if (typeof currentKg !== 'number' || !Number.isFinite(currentKg) || currentKg <= 0) return null;
  const rate = smoothedWeeklyRate(points) ?? actualWeeklyRate(points);
  if (rate === null) return null;
  const safe = safeWeeklyKg(currentKg);
  const measured = trendConfidence(points);
  return {
    actual_kg_per_week: Math.round(rate * 100) / 100,
    safe_kg_per_week: safe,
    pace: classifyLossPace(rate, safe),
    // 'none' means we fell back to the two-point rate: a real number, thinly evidenced.
    confidence: measured === 'none' ? 'low' : measured,
    trend_kg: trendWeightKg(points),
  };
}
