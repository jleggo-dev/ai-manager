/**
 * `repertoire` — the list of what they're learning or already have (owner design "Cadence
 * Progress" 1a, piano card; the repertoire store shipped 2026-08-30). Binds to
 * `cadence.repertoire`, optionally scoped to one goal. Standing rules:
 *
 *  - known and retired → 'learned'. `learned_month` comes from `learned_at`; a backfilled item
 *    (they already knew it when they told us, `learned_at` null) shows as learned WITHOUT a date —
 *    never an invented one. Retired belongs here because retiring is finishing: it must never
 *    shrink what they have learned, only stop the item being scheduled.
 *  - working + practiced at least once → 'in_progress', with whole weeks since `started_at`
 *    (min 1). `last_practiced_at` IS the sessions evidence: `stampPracticed` writes it from
 *    session logs.
 *  - working, never practiced → 'not_started' (the coach proposed it; they haven't picked it up).
 *  - queued → 'not_started' as well: it is material they have yet to start, which is what that
 *    state already means.
 *  - nothing is excluded any more. 'parked' was, and it is gone (owner design 2026-09-02); the
 *    card's own redesign for the four standings comes later — this keeps it truthful meanwhile.
 *
 * "Progress counts what was learned this year" (design frame 2c, owner 2026-09-02) adds the
 * card's own measure: `learned_in_year`/`learned_by_month`/`years` count known-or-retired items
 * whose `learned_at` lands in a calendar year — always the CURRENT year, never the page's
 * Week/Month/All window (this card has no time axis; see `learnedInYear`). A backfilled item
 * (`learned_at` null) never counts into any year, and retiring one never un-counts it either.
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

/** Whole weeks from start to the day it was learned, rounded (not floored) and never below 1 —
 *  "how long this one took", a finished span, unlike `weeksIn`'s "how far in so far". */
function weeksTaken(startedAt: string, learnedAt: string): number {
  const started = new Date(startedAt).getTime();
  const learned = new Date(learnedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(learned)) return 1;
  return Math.max(1, Math.round((learned - started) / WEEK_MS));
}

/** True when an item counts as learned in `year` — known or retired, with a real `learned_at`
 *  landing in that calendar year. Retiring never un-counts it (both standings pass); a backfilled
 *  item (`learned_at` null) never does (owner ruling 2026-09-02: never counted into a year).
 *  String-sliced against the ISO date, not `Date#getFullYear()`, so the year read is the same
 *  regardless of the server's local timezone. */
function learnedInYear(item: RepertoireItem, year: number): boolean {
  if (item.status !== 'known' && item.status !== 'retired') return false;
  if (!item.learned_at) return false;
  return item.learned_at.slice(0, 4) === String(year);
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
  if (item.status === 'known' || item.status === 'retired') {
    return { label: item.label, state: 'learned', learned_month: item.learned_at?.slice(0, 7) ?? null };
  }
  if (item.status === 'queued') return { label: item.label, state: 'not_started' };
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
  const scoped = items.filter((i) => !goalId || i.goal_id === goalId);
  if (scoped.length === 0) {
    return omit('repertoire', 'repertoire', goalId ? 'no repertoire items for this goal' : 'no repertoire on file');
  }
  const cards = scoped.map((i) => toCardItem(i, now)).sort(byStanding);
  // Trimming from the front drops only the oldest learned rows — in-progress and not-started
  // items sort after them and always stay visible.
  const visible = cards.length > REPERTOIRE_CAP ? cards.slice(cards.length - REPERTOIRE_CAP) : cards;

  // "Progress counts what was learned this year" (design frame 2c) — always the CURRENT calendar
  // year, never the page's Week/Month/All window: a repertoire has no time axis (BoundWidget's
  // RepertoireBound honestly never passes window through, and neither does the route). Read off
  // the ISO string, not `now.getFullYear()`, for the same server-timezone-independence the rest
  // of this file already keeps.
  const currentYear = Number(now.toISOString().slice(0, 4));
  const learnedThisYear = scoped.filter((i) => learnedInYear(i, currentYear));
  const learned_by_month = learnedThisYear
    .map((i) => ({
      month: i.learned_at!.slice(0, 7),
      label: i.label,
      weeks: weeksTaken(i.started_at, i.learned_at!),
    }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.label.localeCompare(b.label));
  const years = [currentYear - 2, currentYear - 1, currentYear].map((year) => ({
    year,
    count: scoped.filter((i) => learnedInYear(i, year)).length,
  }));

  return {
    items: visible,
    learned: cards.filter((c) => c.state === 'learned').length,
    in_progress: cards.filter((c) => c.state === 'in_progress').length,
    noun: repertoireNoun(scoped),
    learned_in_year: learnedThisYear.length,
    learned_by_month,
    years,
    learning: scoped.filter((i) => i.status === 'working').length,
    keeping_up: scoped.filter((i) => i.status === 'known').length,
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
