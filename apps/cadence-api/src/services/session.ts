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
import type { OccurrenceLog, OccurrenceLogItem, OccurrenceSession, SessionBlock, SessionItem } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import {
  getOccurrenceWithActivity,
  listRecentLogsByTitle,
  recordOccurrenceLog,
  setOccurrenceSessionIfEmpty,
  type OccurrenceWithActivity,
} from '../repos/occurrences.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { listEquipment } from '../repos/equipment.ts';
import { getUser, mergeBaseline } from '../repos/users.ts';
import { insertGoalEvent } from '../repos/goal-events.ts';
import { logAi } from './ai-log.ts';

const MAX_BLOCKS = 6;
const MAX_ITEMS = 12;

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

/**
 * App-side contract assertion (the normalizeActivity pattern): coerce whatever the model
 * returned into a bounded, render-safe OccurrenceSession — or null if there's nothing usable.
 * video_query is mechanically de-URLed: the client builds YouTube SEARCH links itself, and a
 * model-invented URL must never reach the UI.
 */
export function normalizeSession(raw: Record<string, unknown> | null): OccurrenceSession | null {
  if (!raw || !Array.isArray(raw.blocks)) return null;
  const blocks: SessionBlock[] = (raw.blocks as unknown[])
    .slice(0, MAX_BLOCKS)
    .map((b): SessionBlock | null => {
      const blk = b as { label?: unknown; items?: unknown };
      if (!blk || !Array.isArray(blk.items)) return null;
      const items: SessionItem[] = (blk.items as unknown[])
        .slice(0, MAX_ITEMS)
        .map((it): SessionItem | null => {
          const i = it as Record<string, unknown>;
          const name = str(i.name, 120);
          if (!name) return null;
          const vq = str(i.video_query, 80);
          return {
            name,
            sets: num(i.sets),
            reps: num(i.reps),
            load: str(i.load, 40),
            duration_min: num(i.duration_min),
            distance_km: num(i.distance_km),
            detail: str(i.detail, 200),
            video_query: vq && !/https?:|youtube\.com|youtu\.be|www\./i.test(vq) ? vq : null,
          };
        })
        .filter((i): i is SessionItem => i !== null);
      if (items.length === 0) return null;
      return { label: str(blk.label, 40) ?? 'Session', items };
    })
    .filter((b): b is SessionBlock => b !== null);
  if (blocks.length === 0) return null;
  return {
    blocks,
    note: str(raw.note, 400) ?? '',
    generated_at: new Date().toISOString(),
    version: 1,
  };
}

/**
 * Compact log lines for the prescribe prompt — a few rendered sentences, not raw JSON, so the
 * coach reads history the way a human would ("2026-07-13 — presses 15×50 lb, felt easy").
 */
function renderLogLines(rows: Array<{ date: string; log: { summary: string; items: Array<{ felt?: string }> } }>): string {
  if (rows.length === 0) return '[]';
  return rows
    .map((r) => {
      const felt = r.log.items.find((i) => i.felt)?.felt;
      return `- ${r.date}: ${r.log.summary}${felt ? ` (felt ${felt})` : ''}`;
    })
    .join('\n');
}

/**
 * The coaching arc, derived from data — no stored state: how many sessions of THIS activity
 * (by title, cross-plan) the user has actually logged decides how the coach behaves.
 *   discover  (0 logs) — a real coach's first session: EVALUATE, don't prescribe. Find baselines.
 *   calibrate (1-2)    — keep measuring what's unknown; gently apply what's already clear.
 *   progress  (3+)     — full evidence-based progression.
 */
function coachingPhase(logged: number): 'discover' | 'calibrate' | 'progress' {
  return logged === 0 ? 'discover' : logged < 3 ? 'calibrate' : 'progress';
}

// Single-flight per occurrence: a double-tap or two tabs must not double-spend a coach call.
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
    goals: JSON.stringify(goals.map((g) => ({ title: g.title, area: g.area, type: g.type, measure: g.measure, timeframe: g.timeframe }))),
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
export async function getOccurrenceDetail(userId: string, occurrenceId: string): Promise<OccurrenceWithActivity | null> {
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

const LB_PER_KG = 2.2046226218;

/**
 * Deterministic weigh-in capture — NO LLM (it's one number). Validates plausibility, stores the
 * point on the occurrence (value.weight_kg → the weight time series) via recordOccurrenceLog
 * (which also marks done + provenance and gives History a legible entry for free), and updates
 * baseline.weight_kg.current WITHOUT clobbering .start (jsonb || is shallow — merge app-side).
 * Returns null when the occurrence isn't this user's weigh-in row.
 */
export async function recordWeighIn(
  userId: string,
  occurrenceId: string,
  weight: number,
  unit: 'kg' | 'lb',
): Promise<{ weight_kg: number } | null> {
  if (!Number.isFinite(weight) || weight <= 0) return null;
  const kg = Math.round((unit === 'lb' ? weight / LB_PER_KG : weight) * 10) / 10;
  if (kg < 20 || kg > 500) return null; // same plausibility clamp as the Review weight editor

  const occ = await getOccurrenceWithActivity(userId, occurrenceId);
  if (!occ || occ.kind !== 'system' || !/weigh/i.test(occ.title)) return null;

  const shown = unit === 'lb' ? `${weight} lb` : `${kg} kg`;
  const logged_at = new Date().toISOString();
  const ok = await recordOccurrenceLog(userId, occurrenceId, {
    log: { items: [], summary: `Weighed in at ${shown}.`, raw_text: shown, logged_at },
    value: { weight_kg: kg },
    provenance: { source: 'self_report', auto: false, recorded_at: logged_at },
  });
  if (!ok) return null;

  const user = await getUser(userId);
  const prev = (user?.baseline as { weight_kg?: Record<string, unknown> } | null)?.weight_kg ?? {};
  await mergeBaseline(userId, {
    weight_kg: { ...prev, current: kg, source: 'self_report' },
    weight_unit: unit,
  } as never);

  return { weight_kg: kg };
}

const MAX_LOG_TEXT = 2000;
const FELTS = new Set(['easy', 'right', 'hard']);

/** App-side assertion for parse-session-log output (same stance as normalizeSession). */
function normalizeLogItems(raw: unknown): OccurrenceLogItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .slice(0, MAX_ITEMS)
    .map((it): OccurrenceLogItem | null => {
      const i = it as Record<string, unknown>;
      const name = str(i.name, 120);
      if (!name) return null;
      return {
        name,
        done: typeof i.done === 'boolean' ? i.done : true,
        sets: num(i.sets),
        reps: num(i.reps),
        load: str(i.load, 40),
        duration_min: num(i.duration_min),
        distance_km: num(i.distance_km),
        felt: typeof i.felt === 'string' && FELTS.has(i.felt) ? (i.felt as OccurrenceLogItem['felt']) : undefined,
      };
    })
    .filter((i): i is OccurrenceLogItem => i !== null);
}

/**
 * The Log half: parse the user's own words into a structured report and store it (log +
 * numeric rollups + provenance + done). PARSE FAILURE NEVER EATS THEIR WORDS — an unparseable
 * broker response falls back to {items:[], summary: their first words, raw_text} and still
 * marks the session done: reporting it IS completing it. Returns null when the occurrence
 * isn't this user's (route → 404).
 */
export async function logOccurrence(
  userId: string,
  occurrenceId: string,
  text: string,
): Promise<{ log: OccurrenceLog; summary: string } | null> {
  const raw_text = text.trim().slice(0, MAX_LOG_TEXT);
  if (!raw_text) return null;

  const occ = await getOccurrenceWithActivity(userId, occurrenceId);
  if (!occ) return null;

  let parsed: Record<string, unknown> | null = null;
  try {
    const res = await runJobBySlug(userId, 'parse-session-log', {
      user_text: raw_text,
      session: JSON.stringify(occ.session ?? {}),
      activity: JSON.stringify({ title: occ.title, category: occ.category ?? undefined }),
    });
    parsed = parseJson(res.formatted ?? res.raw ?? '');
  } catch (e) {
    console.error('[parse-session-log]', e); // fall through to the raw-text fallback
  }

  const items = normalizeLogItems(parsed?.items);
  const summary = str(parsed?.summary, 240) ?? raw_text.slice(0, 140);
  const metricsRaw = (parsed?.metrics ?? {}) as Record<string, unknown>;
  const value: Record<string, number> = {};
  for (const [k, v] of Object.entries(metricsRaw)) {
    if (typeof v === 'number' && Number.isFinite(v) && Object.keys(value).length < 12) value[k.slice(0, 40)] = v;
  }

  const log: OccurrenceLog = { items, summary, raw_text, logged_at: new Date().toISOString() };
  const ok = await recordOccurrenceLog(userId, occurrenceId, {
    log,
    value,
    provenance: { source: 'self_report', auto: false, recorded_at: log.logged_at },
  });
  if (!ok) return null;

  // Accomplishments stated in the log ("finished Dune last night") → goal_events. Best-effort:
  // an event write failing must never fail the log. goal_id rides the activity's link when one
  // exists (often null today — events still power History; count cards also have a manual add).
  const eventsRaw = Array.isArray(parsed?.events) ? (parsed!.events as unknown[]).slice(0, 3) : [];
  let events = 0;
  for (const ev of eventsRaw) {
    const label = str((ev as Record<string, unknown>).label, 120);
    if (!label) continue;
    try {
      await insertGoalEvent(userId, {
        goal_id: occ.goal_id ?? null,
        kind: 'completion',
        label,
        meta: { occurrence_id: occurrenceId, activity_title: occ.title },
      });
      events++;
    } catch (e) {
      console.error('[goal-event]', e);
    }
  }

  void logAi(userId, {
    kind: 'parse_session_log',
    input: { occurrenceId, title: occ.title, text: raw_text },
    output: log,
    meta: { items: items.length, parsed: !!parsed, events },
  });
  return { log, summary };
}
