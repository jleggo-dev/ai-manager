/** "2 slice", "1 venti" — what they said; an amount nobody gave is a question, not a number. */
export function amountWords(row: { qty?: number; unit?: string }): string {
  if (row.qty == null) return 'how much?';
  return [row.qty, row.unit].filter((x) => x != null && x !== '').join(' ');
}
