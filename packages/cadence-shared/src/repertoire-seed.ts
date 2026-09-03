/**
 * Seeding a collection — the two facts the job prompt, the API service, the route schema and the
 * review screen must all agree on.
 *
 * Both are unions-as-arrays for the reason CLAUDE.md gives: a hand-copied union drifts, and it
 * drifts silently. FOOD_SOURCES went stale in the web client and killed quick-add for weeks.
 * Here the drift would be worse than a dead feature — a fourth standing leaking into the seed
 * writes sixty wrong rows in one press.
 */
import type { RepertoireStatus } from './types/repertoire.ts';

/**
 * The standings a seed may write, and the only ones.
 *
 * `retired` ("Learned") is absent because a book is not a record of what you finished: filing
 * sixty pieces as finished states something about the person that they did not say. The
 * `learned` VERB is absent for the sharper reason — it stores `known` AND stamps `learned_at`,
 * so a seed carrying it would date sixty crossings to today and hand the recap "you learned
 * sixty pieces this week". Backfill is quiet; only a real crossing celebrates.
 *
 * Ordered the way the review screen reads down a book: everything before where they are is
 * `known`, the piece they are on is `working`, everything after is `queued`.
 */
export const SEED_STATUSES = ['known', 'working', 'queued'] as const satisfies readonly RepertoireStatus[];

/** A standing a seed is allowed to write. A strict subset of `RepertoireStatus`. */
export type SeedStatus = (typeof SEED_STATUSES)[number];

/** Guard for anything crossing a boundary — a request body, a stored draft, model output. */
export function isSeedStatus(value: unknown): value is SeedStatus {
  return typeof value === 'string' && (SEED_STATUSES as readonly string[]).includes(value);
}

/**
 * How many rows one seed carries, end to end: the job is told to return no more, the service
 * cuts to it, the route rejects past it and the screen never offers more.
 *
 * Sixty covers the longest method book anyone actually works through in one go (Suzuki Piano
 * Book 2 is seventeen; ABRSM's syllabus lists are shorter), and it bounds both the prompt's
 * output and the confirm's write burst.
 */
export const MAX_SEED_ITEMS = 60;
