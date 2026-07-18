import { runJob } from '../ai/aim.ts';
import { cadenceConfig } from '../config.ts';
import type { CaptureExtractResult, GoalArea, GoalType, EquipmentCategory } from '@cadence/shared';
import { insertGoal, listGoalsByStatus, deleteCapturedWithoutMilestones } from '../repos/goals.ts';
import { insertEquipment, deleteAllEquipment } from '../repos/equipment.ts';
import { mergeBaseline, setName } from '../repos/users.ts';
import { logAi } from './ai-log.ts';
import { normalizeBaseline, normTitle, selectCapturedGoals } from './capture-normalize.ts';

const GOAL_AREAS: GoalArea[] = ['movement', 'nourishment', 'mind', 'practice'];
const GOAL_TYPES: GoalType[] = ['milestone', 'target', 'recurring'];
const EQUIP_CATEGORIES: EquipmentCategory[] = [
  'footwear',
  'cardio',
  'strength',
  'accessory',
  'reading',
  'practice',
  'craft',
  'study',
  'other',
];

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

function coerceArea(raw: unknown, coerced: string[]): GoalArea {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if ((GOAL_AREAS as string[]).includes(s)) return s as GoalArea;
  const mapped = LEGACY_AREA[s];
  coerced.push(`area "${s || '(empty)'}" → ${mapped ?? 'practice'}`);
  return mapped ?? 'practice';
}

export interface CaptureResult extends CaptureExtractResult {
  persisted: { goals: number; equipment: number; baseline: boolean };
}

/**
 * Broker job `capture_extract` (spec §6.1, §C4) + persistence. Conversation window
 * in → flat top-level JSON out → captured records upserted (status 'captured').
 * The job's build-rule chain does the first contract pass; we re-validate here and
 * only persist rows that satisfy the DB CHECK constraints.
 */
export async function runCaptureExtract(
  userId: string,
  variables: { conversation_window: string },
): Promise<CaptureResult> {
  const result = await runJob(userId, cadenceConfig.aim.jobs.captureExtract, variables);
  const text = result.formatted ?? result.raw ?? '{}';

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('capture_extract did not return valid JSON');
  }

  const out: CaptureExtractResult = {
    goals: Array.isArray(parsed.goals) ? (parsed.goals as CaptureExtractResult['goals']) : [],
    equipment: Array.isArray(parsed.equipment) ? (parsed.equipment as CaptureExtractResult['equipment']) : [],
    baseline_updates:
      parsed.baseline_updates && typeof parsed.baseline_updates === 'object'
        ? (parsed.baseline_updates as CaptureExtractResult['baseline_updates'])
        : {},
    confidence:
      parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
        ? parsed.confidence
        : 'low',
  };

  // Persist the user's name (top-level, not baseline) when the Broker extracted it.
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  if (name) await setName(userId, name);

  // Capture runs on the FULL conversation and returns the user's consolidated set, so we REPLACE
  // the pre-confirmation goals each run (rather than append) — robust against the model rephrasing
  // a goal between turns, which exact-title dedup missed. Confirmed/locked goals are preserved and
  // never re-inserted; milestone-bearing captured goals are "sticky" (durable intent — the user
  // added stepping-stones) so they survive a re-run and their rephrased re-extractions are skipped.
  const confirmed = new Set(
    (await listGoalsByStatus(userId, ['confirmed', 'committed'])).map((g) => normTitle(g.title)),
  );
  const stickyTitles = (await listGoalsByStatus(userId, ['captured']))
    .filter((g) => (g.milestones?.length ?? 0) > 0)
    .map((g) => normTitle(g.title));
  await deleteCapturedWithoutMilestones(userId);

  // Persist goals — de-duplicated against confirmed, sticky, AND each other (selectCapturedGoals is
  // the deterministic backstop: a model that returns two near-duplicate goals in one run yields ONE
  // card), then coerced — never dropped for out-of-enum labels (see coerceArea).
  const coerced: string[] = [];
  let goals = 0;
  for (const g of selectCapturedGoals(out.goals, confirmed, stickyTitles)) {
    // The prompt emits `area`; tolerate the legacy `category` key from stale prompts.
    const rawArea = g.area ?? (g as Record<string, unknown>).category;
    const area = coerceArea(rawArea, coerced);
    let type = g.type;
    if (!type || !GOAL_TYPES.includes(type)) {
      coerced.push(`type "${String(g.type ?? '(empty)')}" → recurring`);
      type = 'recurring';
    }
    await insertGoal(userId, { ...g, area, type });
    goals++;
  }

  // Equipment has no confirm status pre-lock; replace the set when capture returned any (an
  // empty capture leaves existing equipment untouched so we don't wipe on a sparse turn).
  // Unknown categories are coerced to 'other', never dropped.
  const namedEquip = out.equipment.filter((e) => e.name);
  let equipment = 0;
  if (namedEquip.length) {
    await deleteAllEquipment(userId);
    for (const e of namedEquip) {
      let category = e.category;
      if (!category || !EQUIP_CATEGORIES.includes(category)) {
        coerced.push(`equipment category "${String(e.category ?? '(empty)')}" → other`);
        category = 'other';
      }
      await insertEquipment(userId, { ...e, category });
      equipment++;
    }
  }

  let baseline = false;
  const normBaseline = normalizeBaseline((out.baseline_updates ?? {}) as Record<string, unknown>);
  if (Object.keys(normBaseline).length > 0) {
    await mergeBaseline(userId, normBaseline as unknown as Parameters<typeof mergeBaseline>[1]);
    baseline = true;
  }

  const persisted = { goals, equipment, baseline };
  if (coerced.length) console.warn('[capture] coerced out-of-enum values:', coerced.join(' | '));
  await logAi(userId, {
    kind: 'capture',
    input: { window: variables.conversation_window },
    output: { raw: text, parsed: out },
    meta: { persisted, confidence: out.confidence, ...(coerced.length ? { coerced } : {}) },
  });
  return { ...out, persisted };
}
