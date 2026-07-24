/**
 * Canonical body-metric conversion for Review's About-you step.
 *
 * Weight is stored in kg; height in cm. Display/edit may use lbs or ft/in.
 * Commits convert + clamp ONCE on blur so typing never round-trips through a
 * lossy conversion (that path previously corrupted stored weight — e.g. 5078 kg).
 */

export const LB_TO_KG = 0.453592;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Human body-weight band used as the persist gate (inclusive). */
export function plausibleKg(n?: number): n is number {
  return n != null && Number.isFinite(n) && n >= 20 && n <= 500;
}

/** Human height band used as the persist gate (inclusive, whole cm). */
export function plausibleCm(n?: number): n is number {
  return n != null && Number.isFinite(n) && n >= 80 && n <= 260;
}

export function kgToLbs(kg: number): number {
  return round1(kg / LB_TO_KG);
}

export function lbsToKg(lbs: number): number {
  // 2-dp so a whole-lb input round-trips back to whole lbs on display (0.1 kg was off by .1: 195→195.1).
  return Math.round(lbs * LB_TO_KG * 100) / 100;
}

export function cmToFtIn(cm: number): { ft: number; in: number } {
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn - ft * 12);
  return { ft, in: inches };
}

export function ftInToCm(ft: number, inches: number): number {
  return Math.round((ft * 12 + inches) * 2.54);
}

/**
 * Guard a previously-corrupted `current` (pre-fix data) by falling back to `start`.
 */
export function resolveWeightKg(weightKg?: { current?: number; start?: number }): number | undefined {
  if (plausibleKg(weightKg?.current)) return weightKg!.current;
  if (plausibleKg(weightKg?.start)) return weightKg!.start;
  return undefined;
}

export function formatWeightDisplay(kg: number | undefined, unit: 'kg' | 'lbs'): string {
  if (kg == null) return '';
  return String(unit === 'lbs' ? kgToLbs(kg) : round1(kg));
}

/** Parse a weight draft in the display unit → canonical kg, or undefined if rejected. */
export function parseWeightDraft(raw: string, unit: 'kg' | 'lbs'): number | undefined {
  if (!raw.trim()) return undefined;
  const displayVal = Number(raw.trim());
  if (!Number.isFinite(displayVal) || displayVal <= 0) return undefined;
  const kg = unit === 'lbs' ? lbsToKg(displayVal) : round1(displayVal);
  if (!plausibleKg(kg)) return undefined;
  return kg;
}

export function parseHeightCmDraft(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const cm = Math.round(Number(raw));
  if (!plausibleCm(cm)) return undefined;
  return cm;
}

export function parseHeightFtDraft(d: { ft: string; in: string }): number | undefined {
  const cm = ftInToCm(Number(d.ft) || 0, Number(d.in) || 0);
  if (!plausibleCm(cm)) return undefined;
  return cm;
}
