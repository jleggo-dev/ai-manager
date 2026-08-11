import type { Goal } from '@cadence/shared';
import { sameGoalTitle } from './goal-identity.ts';

/**
 * Decide what capture should WRITE for goals: which existing rows to update, what to insert, and
 * which pre-existing rows are duplicates of each other and should be folded together.
 *
 * This replaces "delete every captured goal, then re-insert whatever the model said this turn".
 * That strategy did collapse a rephrase back to one card, but only by making a goal's row — and
 * its goal_id — disposable, and it had two costs a real device run made visible:
 *
 *  1. a turn whose extraction returned NO goals (the user answering "mornings" to a question about
 *     time of day) deleted every captured goal and inserted nothing. The cards vanished mid-
 *     conversation. The equipment path right beside it had always guarded against exactly this;
 *     goals never did.
 *  2. two spellings of one race in a SINGLE run ("Spartan Ultrabeast" and "Spartan Ultra Beast")
 *     were two inserts, because the sameness test could not see through a moved word boundary.
 *
 * So goals now persist by matching and merging. A goal keeps its row, its id and everything ever
 * said about it; an extraction the matcher does not recognise becomes a new goal; and a goal the
 * model simply stopped mentioning this turn is LEFT ALONE rather than deleted — silence in one
 * extraction is not a retraction, and the review wizard is where a user removes a goal they meant
 * to drop.
 *
 * Pure: no DB, no engine imports. The caller applies the plan.
 */

export type GoalDraft = Partial<Goal> & { title: string };

export interface GoalWritePlan {
  /** Existing rows to patch in place — only fields that got strictly richer are present. */
  updates: Array<{ goal_id: string; patch: Partial<Goal> }>;
  inserts: GoalDraft[];
  /** Pre-existing rows folded into a survivor. Their content is merged first, never discarded. */
  deletes: string[];
  /** One line per merge, for the capture log — a goal changing shape is never silent. */
  notes: string[];
}

/** The longer text wins, and an existing value never loses to a thinner one or to nothing. */
function richerText(existing: string | undefined, incoming: string | undefined): string | undefined {
  const inc = (incoming ?? '').trim();
  return inc.length > (existing ?? '').trim().length ? inc : undefined;
}

const keyCount = (o: unknown): number => (o && typeof o === 'object' ? Object.keys(o).length : 0);

/** More stated facts wins. A measure or timeframe already on the row is never blanked by a
 *  sparser re-extraction — the model dropping a field this turn is not the user retracting it. */
function richerObject<T>(existing: T | undefined, incoming: T | undefined): T | undefined {
  return keyCount(incoming) > keyCount(existing) ? incoming : undefined;
}

/**
 * Fold `incoming` into `base`, returning ONLY the fields that got richer (so an empty patch means
 * nothing to write, and `updateGoal`'s coalesce leaves everything else standing).
 *
 * `area` and `type` are deliberately absent: they are the row's most-edited fields in the review
 * wizard and the model's least stable output, and letting them flap turn-to-turn would overwrite
 * the user's own correction with the coach's third guess. The first read stands until a human
 * changes it. Milestones are taken only into an empty list — stepping-stones are investment
 * (coach-proposed, user-edited) and a capture that mentions none is not a request to delete them.
 */
export function mergeGoalPatch(base: Partial<Goal>, incoming: Partial<Goal>): Partial<Goal> {
  const patch: Partial<Goal> = {};
  const title = richerText(base.title, incoming.title);
  if (title) patch.title = title;
  const brief = richerText(base.brief, incoming.brief);
  if (brief) patch.brief = brief;
  const measure = richerObject(base.measure, incoming.measure);
  if (measure) patch.measure = measure;
  const timeframe = richerObject(base.timeframe, incoming.timeframe);
  if (timeframe) patch.timeframe = timeframe;
  if (!(base.milestones?.length ?? 0) && incoming.milestones?.length) patch.milestones = incoming.milestones;
  return patch;
}

/** One existing goal plus everything this run decided belongs to it. */
interface Bucket {
  row: Goal;
  merged: Partial<Goal>;
  absorbed: string[];
}

/**
 * Group existing rows by identity, anchored on the first row of each group rather than on "any
 * member" — anchoring keeps sameness non-transitive, so a chain of loose matches (A~B, B~C, A≁C)
 * can never quietly pull two unrelated goals into one bucket.
 *
 * The survivor of a group is the row carrying stepping-stones if there is one, otherwise the
 * oldest — the row with the most invested in it keeps its id.
 */
function bucketExisting(existing: Goal[]): Bucket[] {
  const groups: Goal[][] = [];
  for (const g of existing) {
    const group = groups.find((grp) => sameGoalTitle(grp[0]!.title, g.title));
    if (group) group.push(g);
    else groups.push([g]);
  }
  return groups.map((group) => {
    const row = group.find((g) => (g.milestones?.length ?? 0) > 0) ?? group[0]!;
    const bucket: Bucket = { row, merged: { ...row }, absorbed: [] };
    for (const dup of group) {
      if (dup.goal_id === row.goal_id) continue;
      bucket.merged = { ...bucket.merged, ...mergeGoalPatch(bucket.merged, dup) };
      bucket.absorbed.push(dup.goal_id);
    }
    return bucket;
  });
}

/**
 * `existing` must be the user's current pre-confirmation (`captured`) goals, oldest first.
 * `drafts` are this run's extractions, already coerced, screened and intra-run de-duplicated.
 */
export function planGoalWrites(existing: Goal[], drafts: GoalDraft[]): GoalWritePlan {
  const buckets = bucketExisting(existing);
  const plan: GoalWritePlan = { updates: [], inserts: [], deletes: [], notes: [] };

  for (const bucket of buckets) {
    for (const id of bucket.absorbed) plan.deletes.push(id);
    if (bucket.absorbed.length)
      plan.notes.push(`folded ${bucket.absorbed.length} duplicate(s) into "${bucket.row.title}"`);
  }

  for (const draft of drafts) {
    const bucket = buckets.find((b) => sameGoalTitle(b.merged.title ?? b.row.title, draft.title));
    if (!bucket) {
      plan.inserts.push(draft);
      continue;
    }
    const patch = mergeGoalPatch(bucket.merged, draft);
    bucket.merged = { ...bucket.merged, ...patch };
    if (patch.title && patch.title !== bucket.row.title)
      plan.notes.push(`re-extraction "${draft.title}" merged into existing goal "${bucket.row.title}"`);
  }

  for (const bucket of buckets) {
    const patch = mergeGoalPatch(bucket.row, bucket.merged);
    if (Object.keys(patch).length) plan.updates.push({ goal_id: bucket.row.goal_id, patch });
  }
  return plan;
}
