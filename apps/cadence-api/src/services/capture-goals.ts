import { randomUUID } from 'node:crypto';
import type { Goal, GoalArea, GoalMilestone, GoalType } from '@cadence/shared';
import { deleteGoal, insertGoal, listGoalsByStatus, updateGoal } from '../repos/goals.ts';
import { describeIncoherentMeasure, normalizeBrief, selectCapturedGoals } from './capture-normalize.ts';
import { planGoalWrites, type GoalDraft } from './capture-goal-merge.ts';
import { screenGoal, type GoalScreenResult } from './goal-screen.ts';

/**
 * The goal half of a capture run: coerce → screen → match against what the user already has →
 * write. Split out of capture.ts so the persistence rule that decides whether someone's goal is a
 * new card or the same card reworded lives in one readable place.
 */

const GOAL_AREAS: GoalArea[] = ['movement', 'nourishment', 'mind', 'practice'];
const GOAL_TYPES: GoalType[] = ['milestone', 'target', 'recurring'];

/**
 * NEVER silently drop a capture (brand promise: nothing you say is lost). Unknown or
 * legacy area labels are coerced to the nearest area and the coercion is logged, so
 * prompt/validator skew during rollouts is visible instead of eating goals.
 */
const LEGACY_AREA: Record<string, GoalArea> = {
  fitness: 'movement',
  training: 'movement',
  body: 'movement',
  nutrition: 'nourishment',
  weight: 'nourishment',
  habit: 'practice',
  mental_health: 'mind',
  mental: 'mind',
  sobriety: 'mind',
  spiritual: 'practice',
  spirit: 'practice',
  creative: 'practice',
  craft: 'practice',
  learning: 'practice',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Milestones from the Broker (the reframe path: "the novel finished by December, as a milestone
 * on a daily writing practice"). The model emits {label, target_date}; every OTHER writer of
 * milestones is the client, which mints an `id` at creation — and consumers key on it — so ids
 * are minted HERE for extracted ones, or the first captured reframe ships rows half the UI can't
 * address. Junk shapes drop silently to []: a milestone is an enrichment, never worth failing a
 * capture over.
 */
function normalizeMilestones(raw: unknown): GoalMilestone[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((m): m is { label: string; target_date?: unknown } => !!m && typeof (m as GoalMilestone).label === 'string')
    .map((m) => ({
      id: randomUUID(),
      label: String(m.label).trim(),
      ...(typeof m.target_date === 'string' && ISO_DATE.test(m.target_date) ? { target_date: m.target_date } : {}),
    }))
    .filter((m) => m.label.length > 0)
    .slice(0, 6);
  return out.length ? out : undefined;
}

function coerceArea(raw: unknown, coerced: string[]): GoalArea {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if ((GOAL_AREAS as string[]).includes(s)) return s as GoalArea;
  const mapped = LEGACY_AREA[s];
  coerced.push(`area "${s || '(empty)'}" → ${mapped ?? 'practice'}`);
  return mapped ?? 'practice';
}

export interface CapturedGoalsOutcome {
  /** Rows written this run (inserted + merged-into). */
  persisted: number;
  screened: Array<{ title: string; result: GoalScreenResult }>;
  coerced: string[];
}

/** Shape one raw extraction into a persistable draft, or null when the screen refuses it. */
function shapeDraft(g: Partial<Goal>, weightKg: number | undefined, out: CapturedGoalsOutcome): GoalDraft | null {
  // The prompt emits `area`; tolerate the legacy `category` key from stale prompts.
  const area = coerceArea(g.area ?? (g as Record<string, unknown>).category, out.coerced);
  let type = g.type;
  if (!type || !GOAL_TYPES.includes(type)) {
    out.coerced.push(`type "${String(g.type ?? '(empty)')}" → recurring`);
    type = 'recurring';
  }
  // Scope/safety screen (goal-screen.ts). 'refuse' is the ONE case where the never-drop rule
  // yields: a self-harm goal must not become a card the user can commit. It is not silent —
  // the note goes to the coach, who has to address it in the conversation this turn.
  const result = screenGoal({ ...g, area, type }, weightKg);
  out.screened.push({ title: g.title ?? '(untitled)', result });
  if (result.verdict === 'refuse') return null;
  // A measure whose arithmetic cannot be true ("lose weight, from 195 to 195" — a real capture)
  // is dropped rather than persisted: the GOAL still lands, so nothing the user said is lost and
  // the coach can ask again, but a number they never chose never becomes the thing every plan
  // and every progress read anchors to. Logged like every other coercion, never silent.
  const badMeasure = describeIncoherentMeasure(g.measure);
  if (badMeasure) out.coerced.push(`measure dropped on "${g.title ?? '(untitled)'}" — ${badMeasure}`);
  // The brief carries the facts that decide how hard the work has to be (see Goal.brief). It is
  // capped and whitespace-collapsed here, never rewritten — it is their sentences, not ours.
  return {
    ...g,
    title: g.title ?? '',
    area,
    type,
    brief: normalizeBrief(g.brief),
    measure: badMeasure ? undefined : g.measure,
    milestones: normalizeMilestones(g.milestones),
  };
}

/**
 * Persist this run's goals against the user's existing ones.
 *
 * Capture runs on the FULL conversation every turn, so the model re-expresses its own earlier
 * extractions in new words. Goals are therefore MATCHED and MERGED, never replaced: a reworded
 * re-extraction updates the row it belongs to (keeping the fuller title and the richer brief),
 * and a goal this turn happened not to mention keeps its card. See capture-goal-merge.ts for why
 * the previous delete-then-reinsert approach had to go.
 */
export async function persistCapturedGoals(
  userId: string,
  goals: Partial<Goal>[],
  weightKg: number | undefined,
): Promise<CapturedGoalsOutcome> {
  const out: CapturedGoalsOutcome = { persisted: 0, screened: [], coerced: [] };

  const confirmed = (await listGoalsByStatus(userId, ['confirmed', 'committed'])).map((g) => g.title);
  const existing = await listGoalsByStatus(userId, ['captured']);

  const drafts: GoalDraft[] = [];
  for (const g of selectCapturedGoals(goals, confirmed)) {
    const draft = shapeDraft(g, weightKg, out);
    if (draft) drafts.push(draft);
  }

  const plan = planGoalWrites(existing, drafts);
  for (const id of plan.deletes) await deleteGoal(userId, id);
  for (const u of plan.updates) await updateGoal(userId, u.goal_id, u.patch);
  for (const draft of plan.inserts) await insertGoal(userId, draft);

  out.coerced.push(...plan.notes);
  out.persisted = plan.inserts.length + plan.updates.length;
  return out;
}
