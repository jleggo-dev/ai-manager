import type { PendingProposal, SituationAssessResult, Tripwire } from '@cadence/shared';
import { getUser, setPendingProposal, touchAssessedAt } from '../repos/users.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { listOccurrences, getLastDoneOccurrenceDate } from '../repos/occurrences.ts';
import { getActiveEpisode } from '../repos/episodes.ts';
import { getLastCheckInDate } from '../repos/check-ins.ts';
import { rollingConsistency } from './metrics.ts';
import { detectTripwires, type TripwireSnapshot } from './tripwires.ts';
import { runJob } from '../ai/aim.ts';
import { cadenceConfig } from '../config.ts';
import { getWeatherForUser } from './weather/weather.ts';

const ASSESS_INTERVAL_DAYS = 7;
const RETURN_GAP_DAYS = 4; // dark days after which we ask, on return, "was your schedule disrupted?"
const REBASELINE_GAP_DAYS = 7; // a longer absence → offer a coach re-baseline, not just a detour
const iso = (d: string | Date): string => new Date(d).toISOString().slice(0, 10);
const daysBetweenIso = (a: string, b: string): number => {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0]!, pb[1]! - 1, pb[2]!) - Date.UTC(pa[0]!, pa[1]! - 1, pa[2]!)) / 86_400_000);
};

/** The most recent day the user did anything real — a completed session OR an explicit check-in.
 *  Null if they've never engaged (a brand-new user has no "return" to detect). */
async function lastEngagementDate(userId: string): Promise<string | null> {
  const [lastDone, lastCheckIn] = await Promise.all([getLastDoneOccurrenceDate(userId), getLastCheckInDate(userId)]);
  const dates = [lastDone, lastCheckIn].filter((d): d is string => !!d);
  return dates.length ? dates.sort().at(-1)! : null; // lexical max works for YYYY-MM-DD
}

/** A travel-shaped disruption (timezone/location shift) → a 'travel' detour; else a generic one. */
function inferEpisodeType(fired: Tripwire[]): PendingProposal['episode_type'] {
  return fired.includes('timezone_shift') || fired.includes('location_move') ? 'travel' : 'custom';
}

function parseJson(text: string): Partial<SituationAssessResult> | null {
  try {
    return JSON.parse(text) as Partial<SituationAssessResult>;
  } catch {
    return null;
  }
}

/** Offset minutes east of UTC for an IANA timezone at `now` (null if tz missing/invalid). */
function timezoneOffsetMin(timezone: string | null | undefined, now = new Date()): number | null {
  const tz = timezone?.trim();
  if (!tz) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(now);
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    // "GMT", "GMT+5", "GMT-4:30", "UTC"
    const m = /(?:GMT|UTC)([+-]\d{1,2})(?::(\d{2}))?/.exec(raw);
    if (!m) return raw === 'GMT' || raw === 'UTC' ? 0 : null;
    const hours = Number(m[1]);
    const mins = Number(m[2] ?? '0');
    if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
    return hours * 60 + Math.sign(hours || 1) * mins;
  } catch {
    return null;
  }
}

/**
 * Deterministic snapshot (spec §B4) — no LLM, only signals the app can actually observe today:
 * rolling consistency, its week-over-week dip, past-due-still-pending occurrences read as
 * "missed", home timezone/location when persisted, and weatherTempC from OpenWeatherMap at
 * home_location (§B1). detectTripwires guards every check on `!= null`.
 */
async function buildSnapshot(userId: string): Promise<TripwireSnapshot> {
  const user = await getUser(userId);
  const missedThreshold = user?.steer_back?.missed_threshold ?? 3;

  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const occ = await listOccurrences(userId, iso(new Date(base - 13 * 86_400_000)), iso(new Date(base)));

  const last7 = rollingConsistency(occ, now, 7);
  const prev7 = rollingConsistency(occ, new Date(base - 7 * 86_400_000), 7);
  const missedCount = occ.filter((o) => o.status === 'pending' && iso(o.date) < iso(new Date(base))).length;

  const weather = await getWeatherForUser(userId).catch(() => null);
  const homeTzOff = timezoneOffsetMin(user?.timezone, now);
  const loc = user?.home_location;

  return {
    missedCount,
    missedThreshold,
    // A meaningful dip, not noise: was showing up most days, now down by 2+ — a fresh plan's
    // empty prior window (prev7.kept === 0) correctly never trips this.
    consistencyDropped: prev7.kept >= 4 && last7.kept <= prev7.kept - 2,
    ...(weather ? { weatherTempC: weather.tempC } : {}),
    ...(homeTzOff != null ? { homeTimezoneOffsetMin: homeTzOff, currentTimezoneOffsetMin: homeTzOff } : {}),
    ...(loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)
      ? { homeLat: loc.lat, homeLon: loc.lon, currentLat: loc.lat, currentLon: loc.lon }
      : {}),
  };
}

/**
 * Session-start assessment (spec §B4), gated to run at most weekly per user. The deterministic
 * tripwires are the ONLY gate on the Broker call — empty means no LLM call at all. When
 * situation_assess recommends a re-plan, it's stored as a pending proposal for the user to accept
 * or dismiss from the plan view; it is never auto-applied (suggest-never-auto-apply).
 */
export async function assessIfDue(userId: string): Promise<void> {
  const user = await getUser(userId);
  if (!user) return;
  if (user.pending_proposal) return; // one's already outstanding — wait for accept/dismiss

  const lastAssessed = user.last_assessed_at ? new Date(user.last_assessed_at).getTime() : 0;
  if (Date.now() - lastAssessed < ASSESS_INTERVAL_DAYS * 86_400_000) return;

  const plan = await getActivePlan(userId);
  if (!plan) return; // nothing to assess before a plan exists

  const activeEpisode = await getActiveEpisode(userId);

  // (1) On-return "was this a detour?" (Req 4) — friendliest, most specific, so checked first. If
  // the user's been dark for a stretch and just came back, ASK whether life got disrupted and offer
  // a detour (never auto-applied). Skipped when already on a detour. NB: shares the weekly throttle
  // above, so after a real gap (when the gate is stale from the dark days) this fires on return.
  if (!activeEpisode) {
    const last = await lastEngagementDate(userId);
    const gap = last ? daysBetweenIso(last, iso(new Date())) : 0;
    if (gap >= REBASELINE_GAP_DAYS) {
      // A long absence — the old plan may no longer fit. Offer a coach re-baseline (a fresh look at
      // where they're starting from), not a silent resume of the old level.
      await touchAssessedAt(userId);
      await setPendingProposal(userId, {
        action: 'rebaseline',
        reason:
          "You've been away a little while — want me to take a fresh look at where you're starting from and ease you back in?",
        suggested_levers: [],
        created_at: new Date().toISOString(),
      });
      return;
    }
    if (gap >= RETURN_GAP_DAYS) {
      // A shorter absence — a detour to ease back in, without reassessing everything.
      await touchAssessedAt(userId);
      await setPendingProposal(userId, {
        action: 'enter_disrupted',
        episode_type: 'custom',
        reason:
          'Welcome back. Want to ease in with a short detour while you find your rhythm again? Your plan stays put.',
        suggested_levers: [],
        created_at: new Date().toISOString(),
      });
      return;
    }
  }

  // (2) Monthly rebuild checkpoint (deterministic, no LLM): after ~4 weeks the progression engine has
  // been evolving a deterministic-mode plan on its own — offer a coach rebuild for the next block.
  // Reuses the pending_proposal → accept-runs-replan machinery; the pending guard above stops it
  // re-firing until acted on (re-offers the following week if dismissed while still a month in).
  const planAgeDays = (Date.now() - new Date(plan.generated_at).getTime()) / 86_400_000;
  if (planAgeDays >= 28) {
    const goals = await listGoalsByStatus(userId, ['committed']);
    if (goals.some((g) => g.plan_mode === 'deterministic')) {
      await touchAssessedAt(userId);
      await setPendingProposal(userId, {
        reason: "You've held this rhythm about a month — want me to take a fresh look and build your next block?",
        suggested_levers: ['Build my next block'],
        created_at: new Date().toISOString(),
      });
      return;
    }
  }

  // (3) Tripwires → situation_assess (Broker). The recommendation may be a detour OR a re-plan.
  const snapshot = await buildSnapshot(userId);
  const fired = detectTripwires(snapshot);
  await touchAssessedAt(userId); // gate advances whether or not anything fired

  if (fired.length === 0) return;

  const res = await runJob(userId, cadenceConfig.aim.jobs.situationAssess, {
    snapshot: JSON.stringify({ ...snapshot, fired }),
  });
  const out = parseJson(res.formatted ?? res.raw ?? '');
  if (!out) return;

  const reason =
    typeof out.reason === 'string' && out.reason.trim()
      ? out.reason.trim()
      : 'Your coach noticed a shift worth adjusting for.';
  const suggested_levers = Array.isArray(out.suggested_levers)
    ? out.suggested_levers.filter((l): l is string => typeof l === 'string')
    : [];
  const created_at = new Date().toISOString();

  // Prefer the disruption recommendation (the more specific signal) over a generic re-plan.
  if (out.enter_disrupted && !activeEpisode) {
    await setPendingProposal(userId, {
      action: 'enter_disrupted',
      episode_type: inferEpisodeType(fired),
      reason,
      suggested_levers,
      created_at,
    });
    return;
  }
  if (out.recommend_replan) {
    await setPendingProposal(userId, { action: 'replan', reason, suggested_levers, created_at });
  }
}
