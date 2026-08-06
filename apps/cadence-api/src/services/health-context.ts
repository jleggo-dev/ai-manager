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

export function renderHealthDigest(digest: HealthDigest, createdAtISO?: string): string {
  if (!digest.totalWorkouts) {
    return `Recent activity (Apple Health, last ${digest.periodDays} days): no workouts recorded.`;
  }
  const lines = [
    `Recent activity (Apple Health, last ${digest.periodDays} days${
      createdAtISO ? `, shared ${createdAtISO.slice(0, 10)}` : ''
    }): ${digest.totalWorkouts} workouts, ~${digest.weeklyFrequency}/week overall.`,
    ...digest.byType.map((t) => fmtType(t, digest.periodDays)),
  ];
  const latest = digest.recent[0];
  if (latest) {
    const bits = [latest.type, latest.start.slice(0, 10)];
    if (latest.durationMin != null) bits.push(`${Math.round(latest.durationMin)} min`);
    lines.push(`  most recent: ${bits.join(', ')}`);
  }
  return lines.join('\n');
}
