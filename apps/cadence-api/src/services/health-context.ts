/**
 * Render a stored health digest into the compact context block the Coach/Broker read.
 * One renderer for both doors — the registry's get_health_history section and the
 * immediate in-session injection after POST /me/health-digest — so the coach never
 * sees two phrasings of the same facts.
 *
 * A field nothing renders is what caused the bug this file was rewritten for. The digest has
 * carried the last five sessions since the day it shipped and only ever printed ONE of them, so a
 * man who had run 5–6 km five times that week was told he averages 4.3 km — true of ninety days,
 * false of him. Everything derived on the device gets said here, or it may as well not exist.
 */
import { DIGEST_RECENT_DAYS, type HealthDigest } from '@cadence/shared';
import { isoDay } from './iso-day.ts';

type TypeSummary = HealthDigest['byType'][number];

const km1 = (n: number): string => n.toFixed(1);

function fmtType(t: TypeSummary, periodDays: number): string {
  const weeks = Math.max(1, Math.round((periodDays / 7) * 10) / 10);
  const perWeek = Math.round((t.count / weeks) * 10) / 10;
  const bits = [`${t.count}× (~${perWeek}/wk)`];
  if (t.avgDurationMin != null) bits.push(`avg ${Math.round(t.avgDurationMin)} min`);
  if (t.avgDistanceKm != null) bits.push(`avg ${km1(t.avgDistanceKm)} km`);
  return `  - ${t.type}: ${bits.join(', ')}`;
}

/**
 * The trailing window, on its own line under the baseline one.
 *
 * Absent means the digest predates the field, so we say nothing rather than guess. A count of
 * zero, though, is a fact worth printing: a modality they have not touched this month is exactly
 * what a ninety-day mean hides. It is stated as a plain number — a quiet fortnight can be a taper,
 * a holiday or a hard week, and the persona decides which, not this line.
 */
function fmtRecentWindow(t: TypeSummary): string | null {
  const w = t.last28;
  if (!w) return null;
  if (!w.count) return `      last ${DIGEST_RECENT_DAYS} days: none of this`;
  const bits = [`${w.count}×`];
  if (w.avgDurationMin != null) bits.push(`avg ${Math.round(w.avgDurationMin)} min`);
  if (w.avgDistanceKm != null) bits.push(`avg ${km1(w.avgDistanceKm)} km`);
  if (w.totalDistanceKm != null) bits.push(`${km1(w.totalDistanceKm)} km in total`);
  return `      last ${DIGEST_RECENT_DAYS} days: ${bits.join(', ')}`;
}

/** Previous bests, dated. What makes "you've run 21 km before" sayable at all. */
function fmtBests(t: TypeSummary): string | null {
  const bits: string[] = [];
  if (t.bestDistanceKm) bits.push(`furthest ${km1(t.bestDistanceKm.value)} km (${t.bestDistanceKm.dateISO})`);
  if (t.bestDurationMin) bits.push(`longest ${Math.round(t.bestDurationMin.value)} min (${t.bestDurationMin.dateISO})`);
  return bits.length ? `      previous best: ${bits.join(', ')}` : null;
}

/**
 * The sessions themselves, dated — the cheapest signal in the whole pipeline.
 *
 * Not a statistic: the list. Five 5–6 km runs in nine days is *visible* the moment you stop
 * collapsing them, and it needs no arithmetic to see.
 */
function fmtSessions(digest: HealthDigest): string[] {
  if (!digest.recent.length) return [];
  const head =
    digest.recent.length === 1
      ? '  their last session:'
      : `  their last ${digest.recent.length} sessions (newest first):`;
  const lines = [head];
  for (const r of digest.recent) {
    const bits = [r.type];
    if (r.distanceKm != null) bits.push(`${km1(r.distanceKm)} km`);
    if (r.durationMin != null) bits.push(`${Math.round(r.durationMin)} min`);
    lines.push(`    - ${isoDay(r.start)}: ${bits.join(', ')}`);
  }
  return lines;
}

/**
 * Everyday movement, in the coach's words.
 *
 * It gets its own line rather than being folded into the workout counts because for a lot of
 * people it IS the activity — someone walking 16,000 steps a day and never pressing start on a
 * watch has no workouts at all, and reading only the workout lines would have the coach telling an
 * active person they are sedentary.
 */
function fmtSteps(digest: HealthDigest): string | null {
  const s = digest.dailySteps;
  if (!s || !s.daysObserved) return null;
  const bits = [`~${s.avgPerDay.toLocaleString('en-US')} steps/day across ${s.daysObserved} days`];
  if (s.avgPerDayLast7 != null) bits.push(`~${s.avgPerDayLast7.toLocaleString('en-US')}/day this past week`);
  return `  everyday movement: ${bits.join(', ')}`;
}

/**
 * Which figure answers which question. Without this the coach reads the biggest number on the
 * page — the period average — and quotes it back as though it described this week.
 */
function readingNote(periodDays: number): string {
  return (
    `  (the dated sessions and the last-${DIGEST_RECENT_DAYS}-day figures are what they are doing NOW; ` +
    `the ${periodDays}-day averages are the longer baseline behind them, and a previous best is ` +
    'something they have already done, never a target.)'
  );
}

export function renderHealthDigest(digest: HealthDigest, createdAtISO?: string): string {
  if (!digest.totalWorkouts) {
    const steps = fmtSteps(digest);
    const head = `Recent activity (Apple Health, last ${digest.periodDays} days): no workouts recorded`;
    // "No workouts" alone reads as "does nothing" — say what they DO do whenever we know it.
    return steps ? `${head}, but their phone did record everyday movement.\n${steps}` : `${head}.`;
  }
  const lines: (string | null)[] = [
    `Recent activity (Apple Health, last ${digest.periodDays} days${
      createdAtISO ? `, shared ${isoDay(createdAtISO)}` : ''
    }): ${digest.totalWorkouts} workouts, ~${digest.weeklyFrequency}/week overall.`,
  ];
  for (const t of digest.byType) {
    lines.push(fmtType(t, digest.periodDays), fmtRecentWindow(t), fmtBests(t));
  }
  lines.push(fmtSteps(digest), ...fmtSessions(digest), readingNote(digest.periodDays));
  return lines.filter((l): l is string => l != null).join('\n');
}
