/**
 * Render a stored health digest into the compact context block the Coach/Broker read.
 * One renderer for both doors — the registry's get_health_history section and the
 * immediate in-session injection after POST /me/health-digest — so the coach never
 * sees two phrasings of the same facts.
 */
import type { HealthDigest } from '@cadence/shared';

function fmtType(t: HealthDigest['byType'][number], periodDays: number): string {
  const weeks = Math.max(1, Math.round((periodDays / 7) * 10) / 10);
  const perWeek = Math.round((t.count / weeks) * 10) / 10;
  const bits = [`${t.count}× (~${perWeek}/wk)`];
  if (t.avgDurationMin != null) bits.push(`avg ${Math.round(t.avgDurationMin)} min`);
  if (t.avgDistanceKm != null) bits.push(`avg ${t.avgDistanceKm.toFixed(1)} km`);
  return `  - ${t.type}: ${bits.join(', ')}`;
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

export function renderHealthDigest(digest: HealthDigest, createdAtISO?: string): string {
  if (!digest.totalWorkouts) {
    const steps = fmtSteps(digest);
    const head = `Recent activity (Apple Health, last ${digest.periodDays} days): no workouts recorded`;
    // "No workouts" alone reads as "does nothing" — say what they DO do whenever we know it.
    return steps ? `${head}, but their phone did record everyday movement.\n${steps}` : `${head}.`;
  }
  const lines = [
    `Recent activity (Apple Health, last ${digest.periodDays} days${
      createdAtISO ? `, shared ${createdAtISO.slice(0, 10)}` : ''
    }): ${digest.totalWorkouts} workouts, ~${digest.weeklyFrequency}/week overall.`,
    ...digest.byType.map((t) => fmtType(t, digest.periodDays)),
  ];
  const steps = fmtSteps(digest);
  if (steps) lines.push(steps);
  const latest = digest.recent[0];
  if (latest) {
    const bits = [latest.type, latest.start.slice(0, 10)];
    if (latest.durationMin != null) bits.push(`${Math.round(latest.durationMin)} min`);
    lines.push(`  most recent: ${bits.join(', ')}`);
  }
  return lines.join('\n');
}
