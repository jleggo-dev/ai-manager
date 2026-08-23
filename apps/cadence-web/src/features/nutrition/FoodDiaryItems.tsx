import type { MealMacros } from '../../lib/api.ts';
import { cell, type DiaryRow } from './foodDiaryRows.ts';

/**
 * The day's foods, with their macros — brief 04.
 *
 *   "We should have columns, by food, for all the macros. I should be able to see which foods are
 *    contributing to a high fat content for the day."
 *
 * The data was never the hard part; it is all already stored per item. The hard part is four
 * numbers on a phone that still read as a LIST OF FOOD rather than a spreadsheet. What keeps it a
 * list: the name stays the largest thing in the row and owns the full width, with the numbers on
 * a second line in a fixed grid underneath — so the eye reads down the foods first and across the
 * numbers only when it wants to. A four-column row with the name squeezed into whatever is left
 * turns the day into a table of digits with some words at the front.
 *
 * FOUR COLUMNS, NOT FIVE. Sodium is the one nutrient with a ceiling, and putting it in a row of
 * floors would flatten a distinction the whole nutrition frame is built on — a ceiling drawn like
 * a goal to fill is actively bad advice. It lives in the item sheet, where there is room to say
 * which direction it runs.
 *
 * NO COLOUR. Never judge: nothing here is high or over, it is simply what was eaten. The moment a
 * fat number goes amber the day becomes a scoreboard, and this is a hearth.
 */
const COLUMNS: Array<{ key: keyof MealMacros; head: string }> = [
  { key: 'kcal', head: 'kcal' },
  { key: 'protein_g', head: 'P' },
  { key: 'carbs_g', head: 'C' },
  { key: 'fat_g', head: 'F' },
];

const fmt = (n: number): string => n.toLocaleString('en-US');

export function FoodDiaryItems({
  rows,
  onOpen,
  onAdd,
  addLabel,
}: {
  rows: DiaryRow[];
  onOpen: (row: DiaryRow) => void;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div className="fh-items">
      <div className="fh-item-head" aria-hidden>
        <span className="fh-item-n" />
        {COLUMNS.map((c) => (
          <span className="fh-item-c" key={c.key}>
            {c.head}
          </span>
        ))}
      </div>

      {rows.map((row) => (
        <button
          type="button"
          className="fh-item"
          key={row.key}
          onClick={() => onOpen(row)}
          aria-label={`${row.name} — open to see what it contributed`}
        >
          <span className="fh-item-top">
            <span className="fh-item-n">{row.name}</span>
            {row.amount && <span className="fh-item-q">{row.amount}</span>}
          </span>
          {row.brand && <span className="fh-item-b">{row.brand}</span>}
          {/* Never an error and never a spinner: the numbers below are real, they are just the
              first estimate while the label is looked up. Counting what happened, not what is
              missing. */}
          {row.pending && <span className="fh-item-p">still checking the label…</span>}
          <span className="fh-item-nums">
            {COLUMNS.map((c) => {
              const v = cell(row.macros, c.key);
              return (
                <span className="fh-item-c" key={c.key}>
                  {/* Never 0 for absent. A blank says we don't hold numbers for this food; a zero
                      would be a claim about the food itself, and a false one. */}
                  {v == null ? '—' : fmt(v)}
                </span>
              );
            })}
          </span>
        </button>
      ))}

      {onAdd && (
        <button className="fh-item-add" onClick={onAdd}>
          <i aria-hidden>＋</i> {addLabel}
        </button>
      )}
    </div>
  );
}
