/**
 * Deterministic weigh-in capture — NO LLM (it's one number). Validates plausibility, stores the
 * point on the occurrence (value.weight_kg → the weight time series) via recordOccurrenceLog
 * (which also marks done + provenance and gives History a legible entry for free), and updates
 * baseline.weight_kg.current WITHOUT clobbering .start (jsonb || is shallow — merge app-side).
 */
import { getOccurrenceWithActivity, recordOccurrenceLog } from '../repos/occurrences.ts';
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
  if (!occ || occ.kind !== 'system' || !/weigh/i.test(occ.title)) return null;

  const shown = unit === 'lb' ? `${weight} lb` : `${kg} kg`;
  const logged_at = new Date().toISOString();
  const ok = await recordOccurrenceLog(userId, occurrenceId, {
    log: { items: [], summary: `Weighed in at ${shown}.`, raw_text: shown, logged_at },
    value: { weight_kg: kg },
    provenance: { source: 'self_report', auto: false, recorded_at: logged_at },
  });
  if (!ok) return null;

  const user = await getUser(userId);
  const prev = (user?.baseline as { weight_kg?: Record<string, unknown> } | null)?.weight_kg ?? {};
  await mergeBaseline(userId, {
    weight_kg: { ...prev, current: kg, source: 'self_report' },
    weight_unit: unit,
  } as never);

  return { weight_kg: kg };
}
