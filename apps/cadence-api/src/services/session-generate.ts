/**
 * The Prescribe half of the fitness module's Prescribe → Log → Adapt loop (plan §"Fitness
 * Module"). On first open of a user occurrence, the Coach programs the concrete session
 * (exercises/steps with sets·reps·load) — cached on the occurrence; regenerates lazily after a
 * replan wipes future pending rows. Adaptation needs no extra machinery: prescribe-session
 * receives recent same-TITLE logs (title, not activity_id — replan recreates activities with
 * new ids and would otherwise reset progression memory), so "50 lb felt easy → nudge it up"
 * happens at generation time, explained in the coach's note.
 *
 * Shape cloned from goal-assess.ts: runJobBySlug + parseJson + app-side normalization
 * (expectedSchema is best-effort in the engine — see plan-synthesis.ts normalizeActivity).
 */
import {
  renderCoachToolCatalog,
  renderRepertoire,
  type OccurrenceSession,
  type OccurrenceWeather,
} from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { DEFAULT_HORIZON_DAYS } from './plan-horizon.ts';
import {
  getOccurrenceWithActivity,
  listOccurrences,
  listRecentLogsByTitle,
  getAnchorSessionByTitle,
  setOccurrenceWeatherIfEmpty,
  type OccurrenceWithActivity,
} from '../repos/occurrences.ts';
import { clearOccurrenceSession, setOccurrenceSessionIfEmpty } from '../repos/occurrence-sessions.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { listEquipment } from '../repos/equipment.ts';
import { listRepertoire } from '../repos/repertoire.ts';
import { getUser } from '../repos/users.ts';
import { logAi } from './ai-log.ts';
import { coachingPhase, normalizeSession } from './session-normalize.ts';
import { computeSession, weekIndexBetween } from './progression.ts';
import { getWeatherForUser, isOutdoorActivity, type WeatherSnapshot } from './weather/weather.ts';

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Compact log lines for the prescribe prompt — a few rendered sentences, not raw JSON, so the
 * coach reads history the way a human would ("2026-07-13 — presses 15×50 lb, felt easy").
 */
function renderLogLines(
  rows: Array<{ date: string; log: { summary: string; items: Array<{ felt?: string }> } }>,
): string {
  if (rows.length === 0) return '[]';
  return rows
    .map((r) => {
      const felt = r.log.items.find((i) => i.felt)?.felt;
      return `- ${r.date}: ${r.log.summary}${felt ? ` (felt ${felt})` : ''}`;
    })
    .join('\n');
}

// The coach's tool palette, rendered once — a pure constant (the catalog has no runtime inputs).
// Injected as {{tool_catalog}} so prescribe-session always sees exactly the deployed catalog.
const TOOL_CATALOG = renderCoachToolCatalog();

// Single-flight per occurrence: a double-tap or two tabs must not double-spend a coach call.
// Per-process only — does not dedupe across instances in a multi-instance deploy.
const inflight = new Map<string, Promise<OccurrenceSession | null>>();

/**
 * `steer` is the person's own words about what THIS session should hold ("add chest and abs") —
 * empty on every first-open/prefetch generation, set only by `reviseSession` below. It rides the
 * job's <user_steer> variable, where the prompt's STEER rule makes it the primary driver of the
 * session's contents (never overriding safety or constraints).
 */
async function generateSession(
  userId: string,
  occ: OccurrenceWithActivity,
  steer = '',
): Promise<OccurrenceSession | null> {
  const [goals, equipment, user, history, repertoire] = await Promise.all([
    listGoalsByStatus(userId, ['committed']),
    listEquipment(userId),
    getUser(userId),
    listRecentLogsByTitle(userId, occ.title, 4),
    // null, not [] — a read that broke must not render as "knows nothing" (the crash that read
    // as an empty record for weeks is exactly this shape; CLAUDE.md's guard rule).
    listRepertoire(userId).catch((e): null => {
      console.error('[prescribe] repertoire read failed:', e);
      return null;
    }),
  ]);
  const phase = coachingPhase(history.length);

  // Deterministic mode (plan §deterministic fitness): once past the eval (>=1 logged) for a goal the
  // user set to 'deterministic', with a scheme on the activity, compute the session from the eval
  // template — no coach call, instant and predictable. The eval itself (0 logged) and every coach-mode
  // or non-fitness activity fall through to prescribe-session below.
  // A steer skips this branch: the template arithmetic cannot hear "add chest and abs", so a
  // revision always goes to the coach call below, even for a goal set to deterministic mode.
  const goalMode = goals.find((g) => g.goal_id === occ.goal_id)?.plan_mode;
  const scheme = occ.target?.scheme;
  if (goalMode === 'deterministic' && scheme && history.length >= 1 && !steer) {
    const anchor = await getAnchorSessionByTitle(userId, occ.title);
    if (anchor?.session) {
      const weekIndex = weekIndexBetween(anchor.date, occ.date);
      const lastMissed = history[0]?.log.items?.some((i) => i.done === false) ?? false;
      const session = computeSession(anchor.session, scheme, { weekIndex, lastMissed }, `${occ.date}T00:00:00.000Z`);
      void logAi(userId, {
        kind: 'prescribe_session',
        input: { occurrenceId: occ.occurrence_id, title: occ.title, date: occ.date },
        output: session,
        meta: { deterministic: true, weekIndex, lastMissed, blocks: session.blocks.length },
      });
      return session;
    }
  }

  // Weather is deterministic API data for outdoor sessions — empty string when unavailable
  // (template ignores unused placeholders; never invent conditions in the prompt).
  const weatherLine = isOutdoorActivity(occ.category, occ.title)
    ? await getWeatherForUser(userId)
        .then((w) => (w ? `${Math.round(w.tempC)}°C, ${w.conditions}, wind ${w.windKph} km/h` : ''))
        .catch(() => '')
    : '';

  const variables = {
    activity: JSON.stringify({
      title: occ.title,
      category: occ.category ?? undefined,
      schedule: occ.schedule ?? undefined,
      target: occ.target ?? undefined,
      how_to: occ.how_to ?? undefined,
    }),
    goals: JSON.stringify(
      goals.map((g) => ({ title: g.title, area: g.area, type: g.type, measure: g.measure, timeframe: g.timeframe })),
    ),
    baseline: JSON.stringify(user?.baseline ?? {}),
    equipment: JSON.stringify(equipment.map((e) => ({ name: e.name, category: e.category }))),
    recent_logs: renderLogLines(history),
    // What they are learning / already know FOR THIS SESSION'S GOAL, with the rotation's DUE
    // NEXT computed over that scope — the prescribe coach names ONE piece for a review slot
    // instead of inventing material or freezing a title into plan text (the 2026-08-29 piano
    // failure). Scoped because the prompt promises "for this practice": a karate kata must not
    // come up DUE NEXT in a piano session, and the piano book must not ride every run's prompt.
    // Unlinked items reach practice-area goals only. A failed read says so — never "empty".
    repertoire:
      repertoire === null
        ? 'Could not be read just now — a fault on our side, NOT an empty record. Do not assume they know nothing, and do not invent items.'
        : renderRepertoire(
            repertoire.filter(
              (i) =>
                i.goal_id === occ.goal_id ||
                (i.goal_id == null && goals.find((g) => g.goal_id === occ.goal_id)?.area === 'practice'),
            ),
          ),
    phase,
    sessions_logged: String(history.length),
    occurrence_date: occ.date,
    // Empty on ordinary generations — the template ignores an empty tag, so every existing
    // caller's prompt is byte-compatible with what it was before the steer existed.
    user_steer: steer,
    weather: weatherLine,
    tool_catalog: TOOL_CATALOG,
  };

  // One retry when the output doesn't survive normalization (REQ10 §11's named gap). A
  // normalize-null here is almost always a provider blip — truncation, a refusal preamble, a
  // malformed block — and re-rolling once turns "the user taps retry" into "the user never
  // noticed". One retry only: two consecutive rejections means something real is wrong, and the
  // regenerate-on-next-open path is the right place for that to surface.
  let session: OccurrenceSession | null = null;
  let attempts = 0;
  for (; attempts < 2 && !session; attempts += 1) {
    const res = await runJobBySlug(userId, 'prescribe-session', variables);
    session = normalizeSession(parseJson(res.formatted ?? res.raw ?? ''));
  }
  void logAi(userId, {
    kind: 'prescribe_session',
    input: { occurrenceId: occ.occurrence_id, title: occ.title, date: occ.date, ...(steer ? { steer } : {}) },
    output: session,
    meta: { blocks: session?.blocks.length ?? 0, ok: !!session, phase, sessions_logged: history.length, attempts },
  });
  return session;
}

/**
 * The occurrence detail behind GET /plan/occurrences/:id — occurrence + activity + session,
 * generating-and-caching the session on first open. Generation gates (cost control): only
 * user-kind activities, only pending rows, only today-or-future (UTC, matching ensureHorizon's
 * convention) — a system weigh-in or a past day never spends a coach call. A done/skipped row
 * still returns its stored session/log. Returns null when the occurrence isn't this user's
 * (route → 404; happens legitimately after a replan deletes future pending rows).
 */
function toOccurrenceWeather(w: WeatherSnapshot): OccurrenceWeather {
  return {
    temp_c: w.tempC,
    conditions: w.conditions,
    wind_kph: w.windKph,
    source: 'weather_api',
    logged_at: w.fetchedAt,
  };
}

/** Best-effort: stamp outdoor occurrences with today's weather jsonb (once). */
async function attachOutdoorWeather(userId: string, occ: OccurrenceWithActivity): Promise<OccurrenceWithActivity> {
  if (occ.weather || !isOutdoorActivity(occ.category, occ.title)) return occ;
  const snap = await getWeatherForUser(userId).catch(() => null);
  if (!snap) return occ;
  const weather = toOccurrenceWeather(snap);
  const won = await setOccurrenceWeatherIfEmpty(userId, occ.occurrence_id, weather);
  return won ? { ...occ, weather } : ((await getOccurrenceWithActivity(userId, occ.occurrence_id)) ?? occ);
}

export async function getOccurrenceDetail(
  userId: string,
  occurrenceId: string,
): Promise<OccurrenceWithActivity | null> {
  const base = await getOccurrenceWithActivity(userId, occurrenceId);
  if (!base) return null;
  const occ = await attachOutdoorWeather(userId, base);

  const utcToday = new Date().toISOString().slice(0, 10);
  const shouldGenerate = occ.kind === 'user' && occ.status === 'pending' && occ.date >= utcToday && !occ.session;
  if (!shouldGenerate) return occ;

  let p = inflight.get(occurrenceId);
  if (!p) {
    p = generateSession(userId, occ).finally(() => inflight.delete(occurrenceId));
    inflight.set(occurrenceId, p);
  }
  const session = await p;
  if (!session) return occ; // generation failed — client offers a retry, nothing cached

  const won = await setOccurrenceSessionIfEmpty(userId, occurrenceId, session);
  if (!won) {
    // Lost a race — return whatever actually landed so the user sees one consistent session.
    return (await getOccurrenceWithActivity(userId, occurrenceId)) ?? { ...occ, session };
  }
  return { ...occ, session };
}

/** What a revision came to — words for each outcome live with the caller (the coach tool). */
export type ReviseSessionResult =
  | { status: 'not_found' }
  | { status: 'not_revisable'; reason: 'system_row' | 'not_pending' | 'past'; occ: OccurrenceWithActivity }
  | { status: 'failed'; occ: OccurrenceWithActivity }
  | { status: 'revised'; occ: OccurrenceWithActivity; session: OccurrenceSession };

/**
 * Rung 1 of the plan-change ladder (docs/cadence/PLAN-CHANGES.md): "add chest and abs to today's
 * workout" is a SESSION-CONTENT ask — one prescription (~34s), never a plan re-synthesis. Rebuild
 * ONE occurrence's session with the person's words folded in as the steer.
 *
 * Order matters and is the whole trick: `setOccurrenceSessionIfEmpty` is compare-and-set on
 * EMPTY, so the stored session is cleared FIRST and the rebuilt one lands through the same guarded
 * write every other writer uses. Same gates as first-open generation (user-kind, still pending,
 * today or later — UTC, matching ensureHorizon's convention), and the same single-flight map: a
 * generation already running for this occurrence is awaited out before the clear, and the rebuild
 * registers under the same key, so a tap racing the revise joins the steered generation instead
 * of spending a second coach call.
 */
export async function reviseSession(userId: string, occurrenceId: string, steer: string): Promise<ReviseSessionResult> {
  const occ = await getOccurrenceWithActivity(userId, occurrenceId);
  if (!occ) return { status: 'not_found' };
  if (occ.kind !== 'user') return { status: 'not_revisable', reason: 'system_row', occ };
  if (occ.status !== 'pending') return { status: 'not_revisable', reason: 'not_pending', occ };
  const utcToday = new Date().toISOString().slice(0, 10);
  if (occ.date < utcToday) return { status: 'not_revisable', reason: 'past', occ };

  // A first-open or prefetch generation mid-flight would race the clear below — let it finish
  // (or fail) first. The rebuild replaces whatever it cached anyway.
  const standing = inflight.get(occurrenceId);
  if (standing) await standing.catch((): null => null);

  const p = (async (): Promise<OccurrenceSession | null> => {
    // The clear re-checks pending in SQL: a session logged done between the gate above and here
    // is history now, and the rebuild refuses rather than wiping the record of what was asked.
    const cleared = await clearOccurrenceSession(userId, occurrenceId);
    if (!cleared) return null;
    return generateSession(userId, occ, steer.trim());
  })().finally(() => inflight.delete(occurrenceId));
  inflight.set(occurrenceId, p);
  const session = await p;

  if (!session) {
    // Either the clear refused (row gone / no longer pending) or the generation came back
    // unusable. Re-read once so the caller can say which — and note the honest cost of the second
    // case: the old session is gone, and the next open draws a fresh one without the steer.
    const now = await getOccurrenceWithActivity(userId, occurrenceId);
    if (!now) return { status: 'not_found' };
    if (now.status !== 'pending') return { status: 'not_revisable', reason: 'not_pending', occ: now };
    return { status: 'failed', occ: now };
  }

  const won = await setOccurrenceSessionIfEmpty(userId, occurrenceId, session);
  if (!won) {
    // Lost the write race — return what actually landed so the coach speaks to one consistent
    // session, exactly as getOccurrenceDetail does.
    const landed = await getOccurrenceWithActivity(userId, occurrenceId);
    return landed?.session
      ? { status: 'revised', occ: landed, session: landed.session }
      : { status: 'failed', occ: landed ?? occ };
  }
  return { status: 'revised', occ: { ...occ, session }, session };
}

/** How many session generations may be in flight at once. See prefetchImminentSessions. */
const PREFETCH_CONCURRENCY = 3;

/**
 * Warm the session cache so the first tap is instant (plan §prefetch). Best-effort and
 * fire-and-forget from BOTH its callers — commitActivities (the moment the buttons are born) and
 * GET /plan (a retry backstop for generations that failed or were still in flight when the
 * commit's own pass fired). The 2026-08-25 device report that motivated this backstop — a tapped
 * row nobody had ever warmed — was a rolling-materialized day the horizon top-up invented after
 * the fact; now that the horizon only ever moves at a commit (check-in rebuild, step 6), that
 * specific shape can't recur, but a slow or failed generation from the commit's own fire-and-forget
 * pass is still exactly what this backstop catches on the next load.
 *
 * Cheap to re-run: `has_session` comes back on the list row, so a fully-warm week is one SELECT
 * and zero per-row reads. `kind === 'user'` matters as much as the status filter — a `system` row
 * (Log breakfast, weigh-in) never generates (getOccurrenceDetail's own gate rejects it) but would
 * still occupy a batch slot, delaying the real generations behind it for nothing. Overlapping
 * passes (a commit racing a plan load) share generations per-occurrence via the `inflight` map,
 * so the provider never sees the same session twice.
 *
 * `days` defaults to `DEFAULT_HORIZON_DAYS` — the warm-up window IS the materialization horizon
 * now that both are the view window (7). They remain two different constants that happen to share
 * a value, not one collapsed into the other: re-split them deliberately if they ever diverge again.
 */
export async function prefetchImminentSessions(userId: string, days = DEFAULT_HORIZON_DAYS): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const pending = (await listOccurrences(userId, today, to)).filter(
    (o) => o.kind === 'user' && o.status === 'pending' && !o.has_session,
  );

  /**
   * CONCURRENTLY, in bounded batches — and this is the fix, not a tidy-up.
   *
   * This loop used to `await` each occurrence in turn. A generating session costs one coach call
   * (~34s measured 2026-08-20), so with three of them pending the last one was not warm for a
   * minute and a half, and the user tapping it waited the full 34s on top. The prefetch existed
   * precisely to win that race and was losing it by construction: every occurrence it had already
   * handled made it later for the next.
   *
   * Bounded rather than all-at-once because each slot is a real provider call. The vision jobs hit
   * `MODEL_REQUEST_RATE_LIMIT_EXCEEDED` on 2026-08-20 with the whole gemini family exhausted at
   * once; firing an unbounded fan-out from every `GET /plan` is how you do that to the coach.
   * Three is enough to cover a normal day's imminent work in one or two rounds.
   */
  for (let i = 0; i < pending.length; i += PREFETCH_CONCURRENCY) {
    await Promise.all(
      pending.slice(i, i + PREFETCH_CONCURRENCY).map((o) =>
        // no-op when already cached or non-generating; a failure just means the user waits on tap
        getOccurrenceDetail(userId, o.occurrence_id).catch(() => undefined),
      ),
    );
  }
}
