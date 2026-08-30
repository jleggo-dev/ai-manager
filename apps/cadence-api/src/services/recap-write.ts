/**
 * The write-on-confirm orchestrator (Progress Engine W2-1, docs/cadence/PROGRESS-ENGINE.md
 * "Check-in unification"). Gathers the same week `buildWeekReviewFacts` already computes plus a
 * weigh-in trend read and the week's detour flag, reduces them through recap-facts.ts's pure
 * builders, and upserts the result — nothing here invents math that already exists elsewhere:
 * the trend read is weight-trend.ts's `smoothedWeeklyRate` (same "not enough to trust yet" rule
 * the adaptive-target loop already lives by), and the detour check is the same episode-overlap
 * rule services/progress-rhythm.ts uses for the rhythm widget's own shelter band.
 *
 * `routes/week-review.ts` owns the trust boundary: it resolves `review` from the user's CURRENT
 * `pending_week_review` (never from client-supplied dates) before calling in here, same as
 * `facts`/`dismiss` already do.
 */
import type { PendingWeekReview } from '@cadence/shared';
import { listEpisodeRanges } from '../repos/episodes.ts';
import { listWeighInSeries } from '../repos/occurrences.ts';
import { upsertRecap, type RecapRow } from '../repos/recaps.ts';
import { buildWeekReviewFacts } from './week-review-facts.ts';
import { buildFactsLine, buildRecapFacts } from './recap-facts.ts';
import { mondayOnOrBefore } from './progress-rhythm.ts';
import { smoothedWeeklyRate } from './weight-trend.ts';

/** Signed kg/week as of `to` — weigh-ins logged AFTER the reviewed week never leak into its own
 *  trend read (a recap describes the week it names, not whatever has happened since). 90 days of
 *  lookback comfortably covers `smoothedWeeklyRate`'s own 28-day window even when confirm happens
 *  same-day, per `listWeighInSeries`'s "trailing N days from now" reach. */
async function weighInTrendKg(userId: string, to: string): Promise<number | null> {
  const series = await listWeighInSeries(userId, 90);
  const points = series.filter((p) => p.date <= to).map((p) => ({ date: p.date, kg: p.kg }));
  return smoothedWeeklyRate(points);
}

/** Same overlap rule progress-rhythm.ts's `buildRhythmWeeks` uses for a week's shelter band. */
async function weekHadDetour(userId: string, from: string, to: string): Promise<boolean> {
  const episodes = await listEpisodeRanges(userId, from, to);
  return episodes.some((e) => to >= e.start && from <= e.end);
}

/**
 * Builds and upserts the recap for `review` — the caller's already-verified pending week.
 * `unit` is the user's weight-display preference at confirm time (baked into the stored snapshot
 * so `facts_line` never needs re-deriving if the preference later changes); `line` rides straight
 * through from the confirm body, this function never invents one.
 */
export async function writeRecapForReview(
  userId: string,
  review: PendingWeekReview,
  unit: 'kg' | 'lb',
  line?: string,
): Promise<RecapRow> {
  const [weekFacts, weeklyRateKg, detour] = await Promise.all([
    buildWeekReviewFacts(userId, review.from, review.to),
    weighInTrendKg(userId, review.to),
    weekHadDetour(userId, review.from, review.to),
  ]);

  const recapFacts = buildRecapFacts(weekFacts, weeklyRateKg, unit);
  const factsLine = buildFactsLine(recapFacts);

  return upsertRecap(userId, {
    weekStart: mondayOnOrBefore(review.from),
    facts: recapFacts,
    factsLine,
    line: line ?? null,
    detour,
  });
}
