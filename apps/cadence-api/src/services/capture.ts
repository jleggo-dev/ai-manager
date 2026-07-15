import { randomUUID } from 'node:crypto';
import { runJob } from '../ai/aim.ts';
import { cadenceConfig } from '../config.ts';
import type { CaptureExtractResult, GoalArea, GoalType, EquipmentCategory, Constraint } from '@cadence/shared';
import { insertGoal, listGoalsByStatus, deleteGoalsByStatus, deleteCapturedWithoutMilestones } from '../repos/goals.ts';
import { insertEquipment, deleteAllEquipment } from '../repos/equipment.ts';
import { mergeBaseline, setName } from '../repos/users.ts';
import { logAi } from './ai-log.ts';

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
  const s = String(raw ?? '').trim().toLowerCase();
  if ((GOAL_AREAS as string[]).includes(s)) return s as GoalArea;
  const mapped = LEGACY_AREA[s];
  coerced.push(`area "${s || '(empty)'}" → ${mapped ?? 'practice'}`);
  return mapped ?? 'practice';
}

export interface CaptureResult extends CaptureExtractResult {
  persisted: { goals: number; equipment: number; baseline: boolean };
}

const LB_TO_KG = 0.453592;

/**
 * Coerce the Broker's free-form baseline_updates into the typed Baseline shape. Notably,
 * weight can arrive as { value, unit }, weight_kg, weight_lbs, or a bare number — we store
 * the canonical kg in weight_kg AND the user's unit in weight_unit so the app can display it
 * in the UOM they used (fixes weight landing in a field the UI can't read).
 */
function normalizeBaseline(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof raw.age === 'number') out.age = raw.age;
  if (typeof raw.height_cm === 'number') out.height_cm = raw.height_cm;

  let value: number | undefined;
  let unit: 'kg' | 'lbs' | undefined;
  const w = raw.weight as { value?: unknown; unit?: unknown } | number | undefined;
  if (w && typeof w === 'object' && typeof w.value === 'number') {
    value = w.value;
    unit = w.unit === 'lbs' ? 'lbs' : 'kg';
  } else if (typeof raw.weight_lbs === 'number') {
    value = raw.weight_lbs as number;
    unit = 'lbs';
  } else if (typeof raw.weight_kg === 'number') {
    value = raw.weight_kg as number;
    unit = 'kg';
  } else if (typeof raw.weight === 'number') {
    value = raw.weight;
    unit = 'kg';
  }
  if (typeof value === 'number' && value > 0) {
    const kg = unit === 'lbs' ? Math.round(value * LB_TO_KG * 10) / 10 : value;
    out.weight_kg = { current: kg, start: kg, source: 'captured', updated_at: new Date().toISOString() };
    out.weight_unit = unit ?? 'kg';
  }

  // Unified "what we work around" list. The prompt asks for constraints
  // [{label, kind, plan_around}]; legacy shapes (injuries [{area, condition}] or bare
  // strings) are mapped, never dropped.
  const constraints: Constraint[] = [];
  const pushConstraint = (label: string, kind: Constraint['kind'], plan_around: boolean) => {
    const l = label.trim();
    if (l) constraints.push({ id: randomUUID(), label: l, kind, plan_around });
  };
  if (Array.isArray(raw.constraints)) {
    for (const c of raw.constraints as Array<Record<string, unknown> | string>) {
      if (typeof c === 'string') pushConstraint(c, 'life', false);
      else if (c && typeof c === 'object') {
        const kind = c.kind === 'physical' || c.kind === 'life' || c.kind === 'other' ? c.kind : 'other';
        pushConstraint(String(c.label ?? [c.area, c.condition].filter(Boolean).join(' — ')), kind, !!c.plan_around);
      }
    }
  }
  if (Array.isArray(raw.injuries)) {
    for (const i of raw.injuries as Array<Record<string, unknown>>) {
      if (i && typeof i === 'object') {
        pushConstraint([i.area, i.condition].filter(Boolean).join(' — '), 'physical', i.plan_around !== false);
      }
    }
  }
  if (constraints.length) out.constraints = constraints;
  return out;
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
    equipment: Array.isArray(parsed.equipment)
      ? (parsed.equipment as CaptureExtractResult['equipment'])
      : [],
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

  // Capture now runs on the FULL conversation and returns the user's consolidated set, so we
  // REPLACE the pre-confirmation goals each run (rather than append) — this is robust against
  // the model rephrasing a goal between turns, which exact-title dedup missed. Confirmed/locked
  // goals are preserved and never re-inserted.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const confirmed = new Set((await listGoalsByStatus(userId, ['confirmed', 'committed'])).map((g) => norm(g.title)));
  // A captured goal the user has added stepping-stones to carries durable intent — it must survive
  // a capture re-run even though the model may rephrase the same goal ("Run a 10k" → "Run a 10k this
  // spring"). So we DON'T delete milestone-bearing captured goals, and we fuzzy-skip re-extracted
  // goals that duplicate one of them (either title contains the other) to avoid a near-dup.
  const stickyTitles = (await listGoalsByStatus(userId, ['captured']))
    .filter((g) => (g.milestones?.length ?? 0) > 0)
    .map((g) => norm(g.title));
  await deleteCapturedWithoutMilestones(userId);

  // Persist goals — coercing, never dropping, out-of-enum labels (see coerceArea).
  const coerced: string[] = [];
  let goals = 0;
  for (const g of out.goals) {
    if (!g.title || confirmed.has(norm(g.title))) continue;
    // Don't re-insert a goal that duplicates a preserved milestone-bearing one (fuzzy title match).
    const nt = norm(g.title);
    if (stickyTitles.some((s) => s === nt || s.includes(nt) || nt.includes(s))) continue;
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
