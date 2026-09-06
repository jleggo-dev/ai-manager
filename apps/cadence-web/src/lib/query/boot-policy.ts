/**
 * What last launch's answers may be painted from disk, and for how long.
 *
 * The boot paint used to run off an allowlist of three keys. That was the right shape for a
 * screen and the wrong shape for an app: the Progress tab reads `progress.window('month')` and
 * the list held `progress.all`, so the whole dashboard cold-loaded on every single launch, and
 * nobody noticed for weeks because nothing about an allowlist tells you what is missing from it.
 * The owner's ruling (2026-09-05) is the inversion: **persist everything, name the exceptions.**
 * A key added tomorrow is painted tomorrow, with no list to remember to edit.
 *
 * So this file is two tables and nothing else — the ones anybody touching the boot paint has to
 * read, kept out of the machinery that reads them:
 *
 *   DENIED   — answers that must never be painted stale, whatever their age.
 *   FAMILIES — how long each family stays worth painting, and what gets dropped first when the
 *              snapshot will not fit in its share of the origin quota.
 *
 * Both are keyed by a query key's FIRST segment, which is how `keys.ts` already groups them.
 * Anything unrecognized gets `DEFAULT_POLICY` — the point of the inversion is that a new read
 * needs no ceremony to be painted, only a reason to be excluded.
 */
import { localTodayIso, queryKeys } from './keys.ts';
import { revivePlanSnapshot } from './usePlan.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type BootPolicy = {
  /**
   * How old an answer may be and still be worth painting for the moment before the server
   * replies. This is a question about RELEVANCE, never about trust — nothing here is trusted, and
   * every seeded entry is already stale on arrival — so the bound is "would a fresh read say
   * roughly this?", not "how long until this decays".
   */
  ttlMs: number;
  /**
   * Who goes to disk first when the snapshot will not fit. Lower is kept. The old file dropped
   * the WHOLE snapshot over budget, on the reasoning that half a screen is worse than a skeleton —
   * true of three keys that were all the same screen, false now: dropping the dashboard to keep
   * the week is exactly the trade a phone should make, and dropping both to keep neither is not.
   */
  rank: number;
  /**
   * Adjust an answer for the time that has passed, or return null to refuse it. Gets the key as
   * well as the timestamp, because two families need it: the plan to tell its own week from the
   * scrolled-back ones, and the food day to tell today's date from yesterday's.
   */
  revive?: (data: unknown, at: number, key: readonly unknown[]) => unknown | null;
};

/**
 * Never painted from disk. Two entries, and both are here because a stale answer would make the
 * app DO something rather than merely show something out of date:
 *
 *   dailyCheckin — the one moment Cadence speaks uninvited. A `true` from yesterday would open
 *                  the check-in at someone who has already done it.
 *   layout draft — the coach's proposed page shape, awaiting a yes. Painting one she has since
 *                  withdrawn puts a card on screen offering a change nobody is still proposing.
 *
 * The coach transcript is absent on purpose: it has its own cache (coach-transcript-cache.ts),
 * written on a settled turn rather than per streaming delta, and it never enters the query cache.
 */
const DENIED: readonly (readonly unknown[])[] = [queryKeys.dailyCheckin.all, queryKeys.progressLayout.draft];

const FAMILIES: Record<string, BootPolicy> = {
  // The week. First thing on screen, and the one entry that must be adjusted rather than merely
  // aged out: a snapshot taken on Tuesday describes days that have since become yesterday.
  // `revivePlanSnapshot` owns that; the scrolled-back weeks under `plan/earlier` are a different
  // shape and are passed through untouched.
  plan: {
    ttlMs: 7 * DAY,
    rank: 0,
    revive: (d, _at, key) => (key.length === 1 ? revivePlanSnapshot(d) : d),
  },
  // Where they live. A week, because a home does not move — and because this is the entry that
  // stops the header asking someone who has had a place on file since August to set one.
  location: { ttlMs: 7 * DAY, rank: 5 },
  // The sky. An hour, matching the soft TTL the server keeps on its own snapshot: inside it we
  // are painting what a fresh read would have said, outside it we are putting yesterday's rain
  // over today's sun.
  weather: { ttlMs: HOUR, rank: 10 },
  // The days ahead, behind the sky's tap. Same hour as the sky, for the same reason — and painted
  // so the sheet opens on last launch's forecast even before the network has answered.
  forecast: { ttlMs: HOUR, rank: 11 },
  // Today's food, for the trail's strip. The date is IN the key, so age is the wrong guard —
  // yesterday's day is refused by name, however recently it was written.
  nutritionDay: {
    ttlMs: 2 * DAY,
    rank: 15,
    revive: (d, _at, key) => (key[1] === localTodayIso() ? d : null),
  },
  // Display units. A month: it is a preference, it changes when someone changes it, and the
  // trail's own labels read the clock format from it.
  units: { ttlMs: 30 * DAY, rank: 20 },
  // Quiet hours + the notification dial. A preference like the units, and on the first screen for
  // the same reason: the header's quiet-hours chip reads it from early evening. The one family
  // here whose key is declared outside keys.ts (settings/notifications/useNotificationPrefs.ts) —
  // it is named anyway, because ranking it by hand beats letting the default decide a first paint.
  notificationPrefs: { ttlMs: 7 * DAY, rank: 22 },
  // Goals, tools, the baseline; and what we work around. A week, like the place they live and for
  // the same reason: these are the slowest-moving facts the app holds, and Settings exists to show
  // them rather than to act on them — the worst a stale one can do is name yesterday's count for
  // the moment before the server names today's.
  review: { ttlMs: 7 * DAY, rank: 24 },
  constraints: { ttlMs: 7 * DAY, rank: 25 },
  // What they've built, what they cook from, what they can't eat. All slow-moving, all read by
  // more than one surface, and every one of them a screen that used to open empty. Ranked here
  // rather than higher because they are moderate in size and back rooms you walk INTO; the
  // cookbook sits further down still (below), being the one of them that can run to real weight.
  routines: { ttlMs: 7 * DAY, rank: 26 },
  dietaryProfile: { ttlMs: 7 * DAY, rank: 27 },
  recentMeals: { ttlMs: DAY, rank: 28 },
  mealPlan: { ttlMs: 2 * DAY, rank: 29 },
  repertoireList: { ttlMs: 2 * DAY, rank: 32 },
  progress: { ttlMs: DAY, rank: 30 },
  progressLayout: { ttlMs: 7 * DAY, rank: 35 },
  progressExtras: { ttlMs: DAY, rank: 40 },
  progressHistory: { ttlMs: DAY, rank: 45 },
  datedSessions: { ttlMs: DAY, rank: 50 },
  healthDigest: { ttlMs: DAY, rank: 55 },
  recaps: { ttlMs: 7 * DAY, rank: 60 },
  // Every saved recipe with its ingredients and steps — the heaviest thing here that is not a
  // photo, so it goes to disk after the dashboards and gives way before them.
  recipes: { ttlMs: 2 * DAY, rank: 65 },
  // Photos are the one family whose payload can go bad rather than merely stale: the slots carry
  // signed Storage URLs, and an expired one paints a broken image, which is worse than the empty
  // frame it replaced. Short-lived and first to be dropped — they are also the heaviest thing here.
  progressPhotos: { ttlMs: HOUR, rank: 70 },
};

/** A read nobody has ruled on. Painted, because that is the ruling — a day is the safe middle. */
export const DEFAULT_POLICY: BootPolicy = { ttlMs: DAY, rank: 50 };

/** Does `key` start with `prefix`? Prefix matching so a family and one member can be named apart. */
function startsWith(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.length <= key.length && prefix.every((seg, i) => seg === key[i]);
}

/** True for a key that must never reach disk, checked on the way IN and again on the way out. */
export function isDenied(key: readonly unknown[]): boolean {
  return DENIED.some((prefix) => startsWith(key, prefix));
}

export function policyFor(key: readonly unknown[]): BootPolicy {
  return FAMILIES[String(key[0])] ?? DEFAULT_POLICY;
}
