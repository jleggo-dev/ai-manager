import type { EquipmentWear } from '@cadence/shared';

const RETIRE_SOON_RATIO = 0.85; // spec §5.3: retire_soon at ~85% of threshold

/** Pure: wear status from accumulated mileage vs threshold. */
export function wearStatus(accumulatedKm: number, thresholdKm: number): EquipmentWear['status'] {
  if (thresholdKm <= 0) return 'active';
  const ratio = accumulatedKm / thresholdKm;
  if (ratio >= 1) return 'retired';
  if (ratio >= RETIRE_SOON_RATIO) return 'retire_soon';
  return 'active';
}

/** Pure: apply a completed run's distance to a shoe's wear record. */
export function applyRun(wear: EquipmentWear, runKm: number): EquipmentWear {
  const accumulated_km = Math.round((wear.accumulated_km + runKm) * 10) / 10;
  return { ...wear, accumulated_km, status: wearStatus(accumulated_km, wear.threshold_km) };
}
