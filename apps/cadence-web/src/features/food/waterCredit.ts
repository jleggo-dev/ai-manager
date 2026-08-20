import { GLASS_ML } from '../nutrition/WaterRow.tsx';

/**
 * "Counts as two glasses of water too" (design 07). A recovery drink after a hot run is both a
 * drink and water, so the water in it is credited as water — said in the glass this app already
 * counts in, and never as a target.
 */
export function waterCreditLine(ml: number): string {
  const glasses = Math.round((ml / GLASS_ML) * 10) / 10;
  const said = Number.isInteger(glasses) ? String(glasses) : glasses.toFixed(1);
  return `Counts as ${said} glass${glasses === 1 ? '' : 'es'} of water too — ${ml} ml, and a glass is ${GLASS_ML}.`;
}
