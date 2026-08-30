/**
 * `dated_sessions` widget resolver (Progress Engine W1-3 — docs/cadence/PROGRESS-ENGINE.md).
 *
 * One activity's history is two stores that can both describe the SAME real workout: a plan
 * session (`occurrences`, done, with `log`/`value` carrying distance_km/duration_min — the
 * cross-plan history key is the activity TITLE, same convention as services/progress.ts's
 * paceByTitle/loadByTitle) and a raw `workout_history` row (HealthKit/watch/strava-free imports,
 * the only place `avg_hr` lives — `workoutValue()` never writes avg_hr onto an occurrence).
 * `autoTickFromWorkouts` (services/workout-autotick.ts) means a SINGLE watch run commonly
 * produces both: the raw row AND a ticked occurrence with matching (rounded) numbers. Rendering
 * both would show the same run twice, so this module merges them and folds the workout row's
 * avg_hr onto the surviving plan-derived row rather than dropping it.
 *
 * `buildDatedSessionsPayload` is pure (fixture arrays in, payload out) so the merge/dedupe/best/
 * usual_hr logic is unit-testable without the database; `resolveDatedSessions` is the thin,
 * impure wrapper that fetches from Postgres and calls it.
 */
import type { OccurrenceLog, ProgressWindow } from '@cadence/shared';
import { listLoggedForProgress } from '../repos/occurrences.ts';
import { listWorkoutHistory, type WorkoutHistoryRow } from '../repos/workout-history.ts';
import { canonicalMetrics } from './progress.ts';

/** The contract's DatedSession (packages/cadence-shared/src/types/progress-widgets.ts) has no
 *  `felt` field — that file is FROZEN for this wave and this parcel may only report friction, not
 *  edit it. The drill-down list still wants the felt word when one was reported, so this is an
 *  ADDITIVE, non-breaking superset: every `DatedSessionRow` is still a valid `DatedSession`
 *  (extra fields are structurally fine wherever a `DatedSession` is expected), so a future
 *  ProgressPage assembly can embed `sessions` as-is. Friction reported in the parcel writeup —
 *  the contract may want to grow this field formally once more than one parcel needs it. */
export interface DatedSessionRow {
  date: string;
  title: string;
  distance_km?: number | null;
  duration_min?: number | null;
  avg_hr?: number | null;
  best?: boolean;
  felt?: 'easy' | 'right' | 'hard' | null;
}

export interface DatedSessionsResult {
  activity: string;
  sessions: DatedSessionRow[];
  total: number;
  last_4_weeks: number;
  usual_hr?: number | null;
}

const WINDOW_DAYS: Record<ProgressWindow, number> = { week: 7, month: 30, all: 1825 };
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

/* ── Pure inputs (what the DB rows reduce to before merging) ─────────────────────────────── */

export interface PlanSessionInput {
  date: string; // YYYY-MM-DD
  distanceKm?: number | null;
  durationMin?: number | null;
  felt?: 'easy' | 'right' | 'hard' | null;
}

export interface WorkoutRowInput {
  startedAt: string; // ISO timestamp
  distanceKm: number | null;
  durationMin: number | null;
  avgHr: number | null;
}

/** Item-level fallback when the occurrence's `value` rollup is empty — a small scoped copy of
 *  services/progress.ts's private (unexported) `metricsFromItems`; that file is off-limits to
 *  edit this wave, so this is duplicated rather than imported. Friction: worth exporting the
 *  shared helper once a second parcel needs it. */
function itemMetrics(log: OccurrenceLog | null): { distance_km?: number; duration_min?: number } {
  if (!log?.items?.length) return {};
  let distance_km = 0;
  let duration_min = 0;
  for (const i of log.items) {
    if (i.done === false) continue;
    if (typeof i.distance_km === 'number') distance_km += i.distance_km;
    if (typeof i.duration_min === 'number') duration_min += i.duration_min;
  }
  return { ...(distance_km > 0 ? { distance_km } : {}), ...(duration_min > 0 ? { duration_min } : {}) };
}

/**
 * Which HealthKit-style workout `type` strings plausibly belong to a given activity TITLE.
 * Deliberately a SEPARATE, smaller table from workout-match.ts's `KIND_MATCHES` rather than an
 * import: that table's job is conservative completion-TICKING (a wrong match writes a false
 * record of someone's week); this one's job is display GROUPING for a drill-down list (a wrong
 * match shows one extra row). Different risk, so kept independent on purpose — a title with no
 * recognizable keyword simply matches nothing, which is the safe default in both places.
 */
const ACTIVITY_TYPE_WORDS: Array<{ words: RegExp; types: RegExp }> = [
  { words: /\b(run|running|jog)/i, types: /\b(run|running|jog)/i },
  { words: /\b(walk|walking|hike|hiking)/i, types: /\b(walk|walking|hike|hiking)/i },
  { words: /\b(cycl|bike|biking|ride|riding|spin)/i, types: /\b(cycl|bike|biking|ride|riding|spin)/i },
  { words: /\b(swim|swimming)/i, types: /\b(swim|swimming)/i },
  { words: /\b(row|rowing|erg)/i, types: /\b(row|rowing)/i },
  { words: /\b(strength|lift|lifting|weights|resistance)/i, types: /\b(strength|traditional|functional|weight)/i },
  { words: /\b(yoga|mobility|stretch)/i, types: /\b(yoga|flexibility|mind ?(and )?body|stretch|mobility|pilates)/i },
  {
    words: /\b(hiit|interval|circuit|conditioning|mixed)/i,
    types: /\b(hiit|interval|circuit|cross ?training|mixed|functional)/i,
  },
];

export function workoutTypeMatchesActivity(activityTitle: string, workoutType: string): boolean {
  const type = (workoutType ?? '').trim();
  if (!type) return false;
  return ACTIVITY_TYPE_WORDS.some((m) => m.words.test(activityTitle) && m.types.test(type));
}

/**
 * Dedupe rule (documented here, exercised by progress-sessions.test.ts): a workout row and a plan
 * session are the SAME real workout when they fall on the same (or an adjacent) calendar day —
 * `workout_history.started_at` is a UTC instant with no per-user timezone context in this pure
 * function, while the plan session's `date` is the user's LOCAL day, so a late-night session can
 * legitimately land a day apart — AND at least one shared metric (distance or duration) is close:
 * within 8%, floored at 0.3km / 4min so short/rounded sessions still match. When the plan side has
 * NEITHER number (a felt-only report), same-day is only trusted when it is the ONLY workout row
 * that day — ambiguous same-day multi-workout cases are left unmerged rather than guessed, mirroring
 * workout-match.ts's "no fuzzy guess" stance.
 */
function isSameWorkout(plan: PlanSessionInput, workout: WorkoutRowInput, workoutsOnDate: number): boolean {
  const dayDiff = Math.abs(daysBetween(plan.date, workout.startedAt.slice(0, 10)));
  if (dayDiff > 1) return false;
  const closeEnough = (a: number, b: number, floor: number) =>
    Math.abs(a - b) <= Math.max(floor, 0.08 * Math.max(a, b));
  if (typeof plan.distanceKm === 'number' && typeof workout.distanceKm === 'number') {
    return closeEnough(plan.distanceKm, workout.distanceKm, 0.3);
  }
  if (typeof plan.durationMin === 'number' && typeof workout.durationMin === 'number') {
    return closeEnough(plan.durationMin, workout.durationMin, 4);
  }
  return dayDiff === 0 && workoutsOnDate === 1;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/* ── The pure merge/dedupe/best/usual_hr builder ──────────────────────────────────────────── */

export function buildDatedSessionsPayload(
  activityTitle: string,
  planSessions: PlanSessionInput[],
  workoutRows: WorkoutRowInput[],
  now = Date.now(),
): DatedSessionsResult {
  // Caller (resolveDatedSessions) has already scoped `workoutRows` to types that plausibly match
  // this activity (workoutTypeMatchesActivity) — kept out of this pure function so fixture tests
  // can hand it exactly the rows they mean without also faking a type string per row.
  const candidateWorkouts = workoutRows.map((w, i) => ({ w, i }));
  const countsByDate = new Map<string, number>();
  for (const { w } of candidateWorkouts) {
    const d = w.startedAt.slice(0, 10);
    countsByDate.set(d, (countsByDate.get(d) ?? 0) + 1);
  }

  const claimed = new Set<number>();
  const rows: DatedSessionRow[] = planSessions.map((p) => {
    // At most one workout row folds onto a given plan session — first unclaimed match wins.
    const hit = candidateWorkouts.find(
      ({ w, i }) => !claimed.has(i) && isSameWorkout(p, w, countsByDate.get(w.startedAt.slice(0, 10)) ?? 0),
    );
    if (hit) claimed.add(hit.i);
    return {
      date: p.date,
      title: activityTitle,
      distance_km: p.distanceKm ?? (hit ? hit.w.distanceKm : null) ?? null,
      duration_min: p.durationMin ?? (hit ? hit.w.durationMin : null) ?? null,
      avg_hr: hit ? hit.w.avgHr : null,
      felt: p.felt ?? null,
    };
  });

  // Unmatched workout rows stand as their own sessions — an unplanned run the watch saw.
  for (const { w, i } of candidateWorkouts) {
    if (claimed.has(i)) continue;
    rows.push({
      date: w.startedAt.slice(0, 10),
      title: activityTitle,
      distance_km: w.distanceKm,
      duration_min: w.durationMin,
      avg_hr: w.avgHr,
      felt: null,
    });
  }

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // best = max distance; when NO session has a distance at all, fall back to max duration. Ties
  // keep the first (earliest) row found so exactly one row is ever marked.
  const haveDistance = rows.some((r) => typeof r.distance_km === 'number' && r.distance_km! > 0);
  const metric = (r: DatedSessionRow) => (haveDistance ? (r.distance_km ?? -1) : (r.duration_min ?? -1));
  let bestIdx = -1;
  let bestVal = -1;
  rows.forEach((r, idx) => {
    const v = metric(r);
    if (v > bestVal) {
      bestVal = v;
      bestIdx = idx;
    }
  });
  if (bestIdx >= 0 && bestVal > 0) rows[bestIdx]!.best = true;

  const hrReadings = rows.map((r) => r.avg_hr).filter((v): v is number => typeof v === 'number');
  const usual_hr = hrReadings.length >= 3 ? median(hrReadings) : null;

  const cutoff = iso(now - 28 * 86_400_000);
  const last_4_weeks = rows.filter((r) => r.date >= cutoff).length;

  return { activity: activityTitle, sessions: rows, total: rows.length, last_4_weeks, usual_hr };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return round1(m);
}

/* ── The impure resolver: DB reads + window→days, then the pure builder above ────────────── */

export async function resolveDatedSessions(
  userId: string,
  activityTitle: string,
  window: ProgressWindow,
): Promise<DatedSessionsResult> {
  const days = WINDOW_DAYS[window] ?? WINDOW_DAYS.all;
  const from = iso(Date.now() - days * 86_400_000);

  const [loggedRows, workoutHistoryRows] = await Promise.all([
    listLoggedForProgress(userId, from),
    listWorkoutHistory(userId, days, 300),
  ]);

  const planSessions: PlanSessionInput[] = loggedRows
    .filter((r) => r.title === activityTitle)
    .map((r) => {
      const m = { ...itemMetrics(r.log), ...canonicalMetrics(r.value) };
      const felt = r.log?.items.find((i) => i.felt)?.felt ?? null;
      return { date: r.date, distanceKm: m.distance_km ?? null, durationMin: m.duration_min ?? null, felt };
    });

  const workoutRows: WorkoutRowInput[] = workoutHistoryRows
    .filter((r) => workoutTypeMatchesActivity(activityTitle, r.type))
    .map(toWorkoutRowInput);

  return buildDatedSessionsPayload(activityTitle, planSessions, workoutRows);
}

function toWorkoutRowInput(r: WorkoutHistoryRow): WorkoutRowInput {
  return { startedAt: r.startedAt, distanceKm: r.distanceKm, durationMin: r.durationMin, avgHr: r.avgHr };
}
