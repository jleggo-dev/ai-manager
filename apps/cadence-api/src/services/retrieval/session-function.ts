import { isCalendarDate, type OccurrenceSession, type SessionItem } from '@cadence/shared';
import { getUser } from '../../repos/users.ts';
import { getOccurrenceSessionById, listDatedSessions, type DatedSessionRow } from '../../repos/occurrence-sessions.ts';
import { localDayIso } from '../plan-day.ts';
import { matchActivity } from '../plan-edit.ts';
import { addDays } from './calendar-function.ts';
import type { RetrievalFunction } from './types.ts';

/**
 * `get_session` — every step of ONE dated session, as the Start sheet shows it.
 *
 * The 2026-11-01 incident: the owner opened today's "Obstacle strength", tapped "Custom — let's
 * talk" ("About today's Obstacle strength: …") and said the bike wasn't set up. The coach answered
 * "I can only see the first eight steps of that session, and the bike isn't one of them." No read
 * of hers carried a dated session's steps at all — the plan read lists commitments, the calendar
 * lists titles, get_recent_logs carries past write-ups — and the nearest thing in her pack was the
 * Activity Builder line, which names a routine's first eight steps and "+N more". She read that as
 * the session and could not see its warm-up, which was step 1 of what was on the user's screen.
 *
 * Owner ruling 2026-11-01: a drawer read, not the pack. The pack is pinned for the conversation's
 * life, so a session she rebuilds mid-conversation would read stale there; this reads the row as
 * it is now, and costs nothing until she asks.
 *
 * Bounded, never silently: every step is listed with its amounts. If the steps' cue lines would
 * push past the budget they are dropped, all of them together, and the answer says so — the steps
 * themselves are never the part that is cut.
 */

/** How far ahead an undated ask looks — the same window `revise_session` aims within. */
export const SESSION_LOOKAHEAD_DAYS = 28;
/** Room under TOOL_RESPONSE_LIMIT (7,400) so the generic cut never lands on a step. */
export const SESSION_TEXT_BUDGET = 6_800;

const STATUS_WORDS: Record<string, string> = {
  pending: 'still to do',
  done: 'done',
  skipped: 'skipped',
  missed: 'missed',
  paused: 'paused',
};

type SessionResult =
  | { kind: 'found'; row: DatedSessionRow; today: string; session: OccurrenceSession | null }
  | { kind: 'no_name' }
  | { kind: 'no_match'; query: string; date: string | null; today: string; to: string; nearby: DatedSessionRow[] };

/** The amounts on one step, in the walkthrough's own terms. '' when it carries none. */
function amounts(i: SessionItem): string {
  const parts: string[] = [];
  if (i.sets && i.reps) parts.push(`${i.sets} × ${i.reps}`);
  else if (i.sets) parts.push(`${i.sets} sets`);
  else if (i.reps) parts.push(`${i.reps} reps`);
  if (i.per_side) parts.push('each side');
  if (i.load) parts.push(i.load);
  if (i.duration_min) parts.push(`${i.duration_min} min`);
  if (i.distance_km) parts.push(`${i.distance_km} km`);
  if (i.interval_work_sec && i.interval_rounds) {
    const rest = i.interval_recover_sec ? ` / ${i.interval_recover_sec}s easy` : '';
    parts.push(`${i.interval_rounds} rounds of ${i.interval_work_sec}s on${rest}`);
  }
  if (i.metronome_bpm) parts.push(`at ${i.metronome_bpm} bpm`);
  if (i.tool) parts.push(`plays as: ${i.tool}`);
  return parts.join(' · ');
}

function blockHeader(label: string, mode?: string, rounds?: number): string {
  if (mode === 'circuit') return `${label} (circuit${rounds ? `, ${rounds} rounds` : ''}):`;
  if (mode && mode !== 'straight') return `${label} (${mode}):`;
  return `${label}:`;
}

/** The steps, numbered straight through the blocks the way the Start sheet lists them. */
export function renderSessionSteps(session: OccurrenceSession, withCues: boolean): string[] {
  const lines: string[] = [];
  let n = 0;
  for (const block of session.blocks) {
    lines.push(blockHeader(block.label, block.mode, block.rounds));
    for (const item of block.items) {
      n += 1;
      const amt = amounts(item);
      const cue = withCues && item.detail ? ` — ${item.detail}` : '';
      lines.push(`  ${n}. ${item.name}${amt ? ` — ${amt}` : ''}${cue}`);
    }
  }
  return lines;
}

export function stepCount(session: OccurrenceSession): number {
  return session.blocks.reduce((total, b) => total + b.items.length, 0);
}

function whenLabel(date: string, today: string): string {
  if (date === today) return `${date} (today)`;
  if (date === addDays(today, 1)) return `${date} (tomorrow)`;
  return date;
}

/** One session, whole. Exported for the table tests. */
export function renderSession(row: DatedSessionRow, session: OccurrenceSession | null, today: string): string {
  const status = STATUS_WORDS[row.status] ?? row.status;
  const head = `${row.title} — ${whenLabel(row.date, today)}, ${status}.`;
  if (!session || stepCount(session) === 0) {
    return [
      head,
      'No steps are written for it yet: a session is written the first time they open it on their plan, so there is nothing missing — there is nothing to read until then.',
      'If they want it built around something now, rebuild it from their words (the rebuild tool).',
    ].join('\n');
  }
  const total = stepCount(session);
  const count = `${total} step${total === 1 ? '' : 's'} in ${session.blocks.length} block${session.blocks.length === 1 ? '' : 's'} — every step, in the order they see them:`;
  const note = session.note ? `The note written with it: "${session.note}"` : '';
  const full = [head, count, ...renderSessionSteps(session, true), note].filter(Boolean).join('\n');
  if (full.length <= SESSION_TEXT_BUDGET) return full;
  return [
    head,
    count,
    ...renderSessionSteps(session, false),
    note,
    `Each step's one-line how-to was left out so all ${total} steps fit here; the steps and amounts above are complete.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Distinct titles first, then the soonest row under the one title that matched — several weeks
 *  of the same session are one session to ask about, not an ambiguity. `revise_session` refuses
 *  the same undated ask on purpose, because a rebuild of the wrong week cannot be taken back; a
 *  read names the date it read, so the soonest is safe here. Two DIFFERENT titles still refuse. */
export function pickSession(rows: DatedSessionRow[], query: string): DatedSessionRow | null {
  const titles = [...new Set(rows.map((r) => r.title))].map((title) => ({ title }));
  const hit = matchActivity(titles, query);
  return hit ? (rows.find((r) => r.title === hit.title) ?? null) : null;
}

export const GET_SESSION: RetrievalFunction = {
  name: 'get_session',
  mutates: 'none',
  description:
    'Every step of one dated session as the user sees it: each exercise in order with its sets, reps, load or minutes, its cue line, and the note written with it. Use when they ask about what is in a session, want a step changed, or start "About today\'s …". Pass {"session": "Obstacle strength"} for the soonest one from today, or add {"date": "2026-11-01"} for that day.',
  domains: ['plans', 'occurrences'],
  async run(userId, params): Promise<SessionResult> {
    const query = typeof params?.session === 'string' ? params.session.trim() : '';
    if (!query) return { kind: 'no_name' };
    const asked = typeof params?.date === 'string' ? params.date.trim() : '';
    const date = isCalendarDate(asked) ? asked : null;
    const user = await getUser(userId);
    const today = localDayIso(new Date(), user?.timezone);
    const from = date ?? today;
    const to = date ?? addDays(today, SESSION_LOOKAHEAD_DAYS - 1);
    const rows = await listDatedSessions(userId, from, to);
    const row = pickSession(rows, query);
    if (!row) return { kind: 'no_match', query, date, today, to, nearby: rows.slice(0, 8) };
    return { kind: 'found', row, today, session: await getOccurrenceSessionById(userId, row.occurrence_id) };
  },
  render(r) {
    const result = r as SessionResult;
    if (result.kind === 'no_name') return 'No session was named — ask which one they mean.';
    if (result.kind === 'no_match') {
      const span = result.date ? `on ${result.date}` : `from ${result.today} through ${result.to}`;
      const nearby = result.nearby.map((x) => `${x.date} ${x.title}`).join('; ');
      return `No session ${span} clearly matches "${result.query}". On the calendar: ${nearby || 'nothing'}. Ask which they mean, or pass the title as listed.`;
    }
    return renderSession(result.row, result.session, result.today);
  },
  rows(r) {
    const result = r as SessionResult;
    return result.kind === 'found' && result.session ? stepCount(result.session) : 0;
  },
};
