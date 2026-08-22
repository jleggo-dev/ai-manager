import type { AmountRow } from './useMealAmounts.ts';

/** Ask about at most this many in one card — it is a light question, not a form. */
const MAX_ASKS = 2;

/**
 * Which rows are worth asking a vendor for (A23 §1b): the ones we could not match to a food we
 * already hold and whose vendor nobody named. Everything else is either already priced from the
 * ledger or already carries its brand, and asking again would be exactly the repetition Cadence
 * promises not to do.
 *
 * It self-limits without any "asked already" bookkeeping: whatever they answer — or skip — gets
 * pinned as a food on confirm, so the same words next time come back matched, and silent.
 */
export function vendorAskRows(rows: AmountRow[]): Array<{ row: AmountRow; index: number }> {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.matched && !row.brand)
    .slice(0, MAX_ASKS);
}
