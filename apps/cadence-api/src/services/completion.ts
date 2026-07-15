import type { EquipmentWear } from '@cadence/shared';
import { getActiveFootwear, updateWear } from '../repos/equipment.ts';
import { applyRun } from './shoe-mileage.ts';

/**
 * On run completion (self-report or HealthKit), add its distance to the user's
 * ACTIVE footwear (spec §5.3, §6.4). Returns the updated wear (so the caller can
 * prompt a replacement at `retire_soon`), or null if there's no tracked active shoe.
 *
 * Pure mileage math lives in shoe-mileage.ts; this is the DB-backed action.
 */
export async function addRunMileage(userId: string, runKm: number): Promise<EquipmentWear | null> {
  const shoe = await getActiveFootwear(userId);
  if (!shoe?.wear?.tracks_mileage) return null;
  const next = applyRun(shoe.wear, runKm);
  await updateWear(userId, shoe.equipment_id, next);
  return next;
}
