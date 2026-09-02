/**
 * Deterministic weigh-in capture — NO LLM (it's one number). Validates plausibility, stores the
 * point on the occurrence (value.weight_kg → the weight time series) via recordOccurrenceLog
 * (which also marks done + provenance and gives History a legible entry for free), and updates
 * baseline.weight_kg.current WITHOUT clobbering .start (jsonb || is shallow — merge app-side).
 */
import { isWeighInTitle, type Baseline, type WeightTrend } from '@cadence/shared';
import {
  findWeighInActivity,
  getOccurrenceWithActivity,
  getOrInsertOccurrenceId,
  recordOccurrenceLog,
} from '../repos/occurrences.ts';
import { getUser, mergeBaseline } from '../repos/users.ts';

const LB_PER_KG = 2.2046226218;

/**
 * Returns null when the occurrence isn't this user's weigh-in row, or the weight fails the
 * plausibility clamp (20–500 kg).
 */
export async function recordWeighIn(
  userId: string,
  occurrenceId: string,
  weight: number,
  unit: 'kg' | 'lb',
): Promise<{ weight_kg: number } | null> {
  if (!Number.isFinite(weight) || weight <= 0) return null;
  const kg = Math.round((unit === 'lb' ? weight / LB_PER_KG : weight) * 10) / 10;
  if (kg < 20 || kg > 500) return null; // same plausibility clamp as the Review weight editor

  const occ = await getOccurrenceWithActivity(userId, occurrenceId);
  // The shared word-boundary rule: "Weighted hill intervals" is not a weigh-in, and the client
  // routes by the same import, so a tap that opens the scale sheet is one this accepts.
  if (!occ || occ.kind !== 'system' || !isWeighInTitle(occ.title)) return null;

  const shown = unit === 'lb' ? `${weight} lb` : `${kg} kg`;
  const logged_at = new Date().toISOString();
  const ok = await recordOccurrenceLog(userId, occurrenceId, {
    log: { items: [], summary: `Weighed in at ${shown}.`, raw_text: shown, logged_at },
    value: { weight_kg: kg },
    provenance: { source: 'self_report', auto: false, recorded_at: logged_at },
  });
  if (!ok) return null;

  const user = await getUser(userId);
  const prev = user?.baseline?.weight_kg;
  const start = typeof prev?.start === 'number' ? prev.start : kg;
  const weight_kg: WeightTrend = {
    current: kg,
    start,
    source: 'manual',
    updated_at: logged_at.slice(0, 10),
  };
  // Baseline stores display UOM as 'lbs' (plural); the weigh-in route accepts 'lb'.
  const weight_unit: NonNullable<Baseline['weight_unit']> = unit === 'lb' ? 'lbs' : 'kg';
  await mergeBaseline(userId, { weight_kg, weight_unit });

  return { weight_kg: kg };
}

/**
 * Log a weight on ANY day (A23 §2c) — what "daily weigh-ins" actually means in practice.
 *
 * The plan schedules one weigh-in a week and that stays true; this hangs today's reading off the
 * SAME activity via get-or-insert, so a daily logger's points land in the same series, the same
 * history, and the same trend as a weekly one. No parallel store, no second source of truth.
 *
 * Returns null when their plan has no weigh-in at all — the planner only schedules one for a
 * weight-shaped goal, and inventing an activity here would be this file overreaching.
 */
export async function recordWeighInToday(
  userId: string,
  weight: number,
  unit: 'kg' | 'lb',
  date = new Date().toISOString().slice(0, 10),
): Promise<{ weight_kg: number } | null> {
  const activity = await findWeighInActivity(userId);
  if (!activity) return null;
  const occurrenceId = await getOrInsertOccurrenceId(activity.activity_id, userId, date);
  return recordWeighIn(userId, occurrenceId, weight, unit);
}
