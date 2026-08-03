/**
 * The ＋ sheet's present-tense section — "Do something now" (REQ10 §6, REQ9 §3.1).
 *
 * Composed AHEAD of the tap and cached, because nobody mid-spiral waits eight seconds for a menu.
 * Same shape as `day-recap`: a Broker job, a process-local cache, and a soft failure that returns
 * an empty list rather than an error — an empty menu simply hides the section, which is a real
 * state and not a fault.
 *
 * The coach writes the label; **this module never lets it write the meta line** — that is derived
 * from the parameters that will actually play (`nowMenuMeta` in @cadence/shared), so a row can't
 * promise five minutes and deliver ten.
 */
import {
  BREATH_PATTERNS,
  GROUNDING_NAMES,
  SESSION_TOOL_KINDS,
  normalizeNowMenu,
  patternCounts,
  type NowMenuItem,
} from '@cadence/shared';
import { sql } from '../db/sql.ts';
import { runJobBySlug } from '../ai/aim.ts';

interface Cached {
  items: NowMenuItem[];
  at: number;
}

const cache = new Map<string, Cached>();
/** Long enough that a tap never waits, short enough that a re-plan shows up the same day. */
const TTL_MS = 6 * 60 * 60 * 1000;

/** Test seam — clear the process cache. */
export function __clearNowMenuCacheForTests(): void {
  cache.clear();
}

/** Drop this user's menu so the next read recomposes — call after anything that changes the plan. */
export function invalidateNowMenu(userId: string): void {
  cache.delete(userId);
}

interface ActivityRow {
  activity_id: string;
  title: string;
  area: string | null;
}

async function planActivities(userId: string): Promise<ActivityRow[]> {
  return sql<ActivityRow[]>`
    select a.activity_id, a.title, g.area
    from cadence.activities a
    join cadence.plans p on p.plan_id = a.plan_id
    left join cadence.goals g on g.goal_id = a.goal_id
    where p.user_id = ${userId} and p.status = 'committed' and a.kind = 'user'
    order by a.title`;
}

async function goalLines(userId: string): Promise<string[]> {
  const rows = await sql<{ title: string; area: string | null }[]>`
    select title, area from cadence.goals
    where user_id = ${userId} and status in ('confirmed', 'committed')
    order by created_at`;
  return rows.map((r) => `${r.title}${r.area ? ` (${r.area})` : ''}`);
}

/** The last handful of things they actually did — enough for "the one from Tuesday" to make sense. */
async function recentLines(userId: string): Promise<string[]> {
  const rows = await sql<{ title: string; date: string }[]>`
    select a.title, o.date::text as date
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.status = 'done'
    order by o.date desc
    limit 6`;
  return rows.map((r) => `${r.title} (${r.date})`);
}

/** Flat coach output → the nested action shape the client renders. Flat on purpose: models are far
 *  more reliable filling sibling fields than nested objects, exactly as session items already are. */
function toItems(raw: string): { items: unknown[] } {
  let parsed: { items?: unknown[] };
  try {
    parsed = JSON.parse(raw) as { items?: unknown[] };
  } catch {
    return { items: [] };
  }
  const flat = Array.isArray(parsed.items) ? parsed.items : [];
  const items = flat.map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const f = entry as Record<string, unknown>;
    const action =
      f.kind === 'activity'
        ? { kind: 'activity', activityId: f.activity_id }
        : {
            kind: 'tool',
            tool: f.tool,
            params: {
              breath_pattern: f.breath_pattern ?? undefined,
              breath_cycles: f.breath_cycles ?? undefined,
              duration_min: f.duration_min ?? undefined,
              meditate_bells: f.meditate_bells ?? undefined,
              grounding_game: f.grounding_game ?? undefined,
              journal_bank: f.journal_bank ?? undefined,
            },
          };
    return { label: f.label, area: f.area, action, pinned: f.pinned === true, coachLine: f.coach_line };
  });
  return { items };
}

/**
 * The menu for this user — cached, soft-failing to an empty list. Composition reads the plan so a
 * row can point at a real activity ("the 15-minute stretch — the one from Tuesday"), and the
 * activity ids are re-checked at normalize time so a deleted one is dropped rather than rendered.
 */
export async function getNowMenu(userId: string): Promise<NowMenuItem[]> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;

  try {
    const [acts, goals, recent] = await Promise.all([
      planActivities(userId).catch(() => [] as ActivityRow[]),
      goalLines(userId).catch(() => [] as string[]),
      recentLines(userId).catch(() => [] as string[]),
    ]);

    const res = await runJobBySlug(userId, 'compose-now-menu', {
      goals: goals.join('; ') || 'none set',
      activities: acts.map((a) => `${a.activity_id} — ${a.title}${a.area ? ` (${a.area})` : ''}`).join('\n') || 'none',
      recent: recent.join('; ') || 'nothing logged yet',
      situation: '',
      tools: SESSION_TOOL_KINDS.join(', '),
      breath_patterns: BREATH_PATTERNS.map((p) => `${p.id} (${patternCounts(p)})`).join(', '),
      grounding_games: Object.keys(GROUNDING_NAMES).join(', '),
    });

    const items = normalizeNowMenu(
      toItems(res.formatted ?? res.raw ?? ''),
      SESSION_TOOL_KINDS,
      acts.map((a) => a.activity_id),
    );
    cache.set(userId, { items, at: Date.now() });
    return items;
  } catch (err) {
    // Soft-fail to empty: the section disappears, the log section still works, nothing errors.
    console.warn('[now-menu]', err instanceof Error ? err.message : err);
    cache.set(userId, { items: [], at: Date.now() });
    return [];
  }
}
