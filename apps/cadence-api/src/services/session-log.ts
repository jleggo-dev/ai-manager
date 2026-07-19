/**
 * The Log half of Prescribe → Log → Adapt: parse the user's own words into a structured
 * report and store it. PARSE FAILURE NEVER EATS THEIR WORDS — an unparseable broker
 * response falls back to {items:[], summary: their first words, raw_text} and still marks
 * the session done.
 */
import type { OccurrenceLog, OccurrenceLogItem } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { getOccurrenceWithActivity, recordOccurrenceLog } from '../repos/occurrences.ts';
import { insertGoalEvent } from '../repos/goal-events.ts';
import { logAi } from './ai-log.ts';
import { MAX_ITEMS, num, str } from './session-normalize.ts';

const MAX_LOG_TEXT = 2000;
const FELTS = new Set(['easy', 'right', 'hard']);

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

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
 * Parse + store a session log (log + numeric rollups + provenance + done). Returns null when
 * the occurrence isn't this user's (route → 404).
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
