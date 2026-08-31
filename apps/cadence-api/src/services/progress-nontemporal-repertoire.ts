/**
 * `repertoire` — the list of what they're learning or already have (owner design "Cadence
 * Progress" 1a, piano card; the repertoire store shipped 2026-08-30). Binds to
 * `cadence.repertoire`, optionally scoped to one goal. Standing rules:
 *
 *  - known → 'learned'. `learned_month` comes from `learned_at`; a backfilled item (they already
 *    knew it when they told us, `learned_at` null) shows as learned WITHOUT a date — never an
 *    invented one.
 *  - working + practiced at least once → 'in_progress', with whole weeks since `started_at`
 *    (min 1). `last_practiced_at` IS the sessions evidence: `stampPracticed` writes it from
 *    session logs.
 *  - working, never practiced → 'not_started' (the coach proposed it; they haven't picked it up).
 *  - parked is EXCLUDED: deliberately set aside is not progress content.
 */
import type { RepertoireItem, RepertoirePayload, RepertoireCardItem, WidgetOmission } from '@cadence/shared';
import { listRepertoire } from '../repos/repertoire.ts';
import { omit } from './window-range.ts';

/** The card stays a card: counts cover everything, the list shows the most recent learned plus
 *  all in-progress/not-started (trimming from the oldest-learned end). */
const REPERTOIRE_CAP = 10;

const WEEK_MS = 7 * 86_400_000;

/** Whole weeks since `startedAt`, min 1 — "in progress · week 6". */
function weeksIn(startedAt: string, now: Date): number {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return 1;
  return Math.max(1, Math.floor((now.getTime() - started) / WEEK_MS));
}

/** Plural word for what these are, from the items' own `kind` values ('piece' → 'pieces').
 *  Majority wins; 'items' when nothing carries a kind. Naive pluralization on purpose — the
 *  coach's kinds are short plain nouns. */
function repertoireNoun(items: RepertoireItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const kind = item.kind?.trim().toLowerCase();
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [kind, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = kind;
  }
  if (!best) return 'items';
  return best.endsWith('s') ? best : `${best}s`;
}

function toCardItem(item: RepertoireItem, now: Date): RepertoireCardItem {
  if (item.status === 'known') {
    return { label: item.label, state: 'learned', learned_month: item.learned_at?.slice(0, 7) ?? null };
  }
  if (item.last_practiced_at) {
    return { label: item.label, state: 'in_progress', weeks_in: weeksIn(item.started_at, now) };
  }
  return { label: item.label, state: 'not_started' };
}

/** Learned first (oldest learned month up), then in progress, then not started — the design's
 *  reading order. Backfilled learned items (no date) lead: they were known before anything here. */
const STATE_ORDER: Record<RepertoireCardItem['state'], number> = { learned: 0, in_progress: 1, not_started: 2 };

function byStanding(a: RepertoireCardItem, b: RepertoireCardItem): number {
  if (STATE_ORDER[a.state] !== STATE_ORDER[b.state]) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (a.state === 'learned' && b.state === 'learned') {
    return (a.learned_month ?? '').localeCompare(b.learned_month ?? '');
  }
  return a.label.localeCompare(b.label);
}

/** Pure: fold already-fetched repertoire rows into the card shape. `goalId` scopes to one goal's
 *  items; null/undefined shows everything they keep. */
export function resolveRepertoire(
  items: RepertoireItem[],
  goalId?: string | null,
  now: Date = new Date(),
): RepertoirePayload | WidgetOmission {
  const inPlay = items.filter((i) => i.status !== 'parked' && (!goalId || i.goal_id === goalId));
  if (inPlay.length === 0) {
    return omit('repertoire', 'repertoire', goalId ? 'no repertoire items for this goal' : 'no repertoire on file');
  }
  const cards = inPlay.map((i) => toCardItem(i, now)).sort(byStanding);
  // Trimming from the front drops only the oldest learned rows — in-progress and not-started
  // items sort after them and always stay visible.
  const visible = cards.length > REPERTOIRE_CAP ? cards.slice(cards.length - REPERTOIRE_CAP) : cards;
  return {
    items: visible,
    learned: cards.filter((c) => c.state === 'learned').length,
    in_progress: cards.filter((c) => c.state === 'in_progress').length,
    noun: repertoireNoun(inPlay),
  };
}

/** Fetch + resolve for one user (optionally one goal's slice). */
export async function getRepertoireCard(
  userId: string,
  goalId?: string | null,
): Promise<RepertoirePayload | WidgetOmission> {
  const items = await listRepertoire(userId);
  return resolveRepertoire(items, goalId ?? null);
}
