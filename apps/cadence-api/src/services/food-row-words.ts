/**
 * The words on a picked row, when the record's own words would say something that did not happen.
 *
 * "Pint of guinness on draft" priced from FatSecret's "Draught (Can)", kept per can: the numbers
 * were the right beer's, and the card read "Guinness Draught (Can)", "1.1 can" for a pint poured
 * from a tap (owner, 2026-11-04). The record stays what it is and the store still does the
 * arithmetic; these two rules only decide what the row calls it.
 */
import type { Food } from '@cadence/shared';
import { stripAmount } from './food-candidate-book.ts';
import { parseMeasure } from './portion-measure.ts';

/** A container in brackets at the end of a record's name: "Draught (Can)", "Lager (Bottle)". */
const CONTAINER_TAIL = /\s*\((?:tall\s+)?(can|bottle|tin)\)\s*$/i;

/** The record's name, less a container they did not say. "A can of guinness" keeps its can. */
export function nameForRow(name: string, said: string): string {
  const container = CONTAINER_TAIL.exec(name)?.[1];
  if (!container || new RegExp(`\\b${container}s?\\b`, 'i').test(said)) return name;
  return name.replace(CONTAINER_TAIL, '') || name;
}

/**
 * The amount as they said it, for a record kept per item. Such a record has no weight or volume to
 * state a pint in, so the model works out how many of its measure a pint is, and that sum is what
 * the card showed ("1.1 can"). A weight or a volume they said is the amount they had, and it stays
 * on the row; the numbers are the model's count of the record, and the confirm keeps them because
 * the store cannot read a pint back on a per-item food (food-pick-portion.ts). Null otherwise: a
 * food kept by weight reads the amount itself, and a count ("2 cans") is the record's own measure.
 */
export function amountAsSaid(food: Pick<Food, 'base_unit'>, said: string): { qty: number; unit: string } | null {
  if (food.base_unit !== 'item') return null;
  const words = stripAmount(said).measure;
  if (!words) return null;
  const m = parseMeasure(words);
  return m.kind === 'count' ? null : { qty: m.qty, unit: m.unit };
}
