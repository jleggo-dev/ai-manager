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
import type { OccurrenceSession } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import {
  getOccurrenceWithActivity,
  listRecentLogsByTitle,
  setOccurrenceSessionIfEmpty,
  type OccurrenceWithActivity,
} from '../repos/occurrences.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { listEquipment } from '../repos/equipment.ts';
import { getUser } from '../repos/users.ts';
import { logAi } from './ai-log.ts';
import { coachingPhase, normalizeSession } from './session-normalize.ts';

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

// Single-flight per occurrence: a double-tap or two tabs must not double-spend a coach call.
// Per-process only — does not dedupe across instances in a multi-instance deploy.
const inflight = new Map<string, Promise<OccurrenceSession | null>>();

async function generateSession(userId: string, occ: OccurrenceWithActivity): Promise<OccurrenceSession | null> {
  const [goals, equipment, user, history] = await Promise.all([
    listGoalsByStatus(userId, ['committed']),
    listEquipment(userId),
    getUser(userId),
    listRecentLogsByTitle(userId, occ.title, 4),
  ]);
  const phase = coachingPhase(history.length);

  const res = await runJobBySlug(userId, 'prescribe-session', {
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
    phase,
    sessions_logged: String(history.length),
    occurrence_date: occ.date,
  });

  const session = normalizeSession(parseJson(res.formatted ?? res.raw ?? ''));
  void logAi(userId, {
    kind: 'prescribe_session',
    input: { occurrenceId: occ.occurrence_id, title: occ.title, date: occ.date },
    output: session,
    meta: { blocks: session?.blocks.length ?? 0, ok: !!session, phase, sessions_logged: history.length },
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
export async function getOccurrenceDetail(
  userId: string,
  occurrenceId: string,
): Promise<OccurrenceWithActivity | null> {
  const occ = await getOccurrenceWithActivity(userId, occurrenceId);
  if (!occ) return null;

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
