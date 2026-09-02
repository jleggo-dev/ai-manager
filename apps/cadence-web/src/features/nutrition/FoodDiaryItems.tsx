import { useState } from 'react';
import type { MealMacros } from '../../lib/api.ts';
import { cell, type DiaryGroup, type DiaryPartGroup, type DiaryRow } from './foodDiaryRows.ts';

/**
 * The day's foods, with their macros — brief 04, now read through the bracket (rework P6).
 *
 *   "We should have columns, by food, for all the macros. I should be able to see which foods are
 *    contributing to a high fat content for the day."
 *
 * The data was never the hard part; it is all already stored per item. The hard part is four
 * numbers on a phone that still read as a LIST OF FOOD rather than a spreadsheet. What keeps it a
 * list: the name stays the largest thing in the row and owns the full width, with the numbers on
 * a second line in a fixed grid underneath — so the eye reads down the foods first and across the
 * numbers only when it wants to.
 *
 * The bracket rides in as ONE collapsed row per part — "Chia bowl · 4 things · 348 ⌄" (canvas A4)
 * — drawn with the same `.mb-*` mark as everywhere else: green rail one portion, butter rail makes
 * several, "1 of 4 servings" on the same row type. Expanding it in place reveals the member rows,
 * each still carrying its logId+index correction address. Loose items are untouched.
 *
 * FOUR COLUMNS, NOT FIVE. Sodium is the one nutrient with a ceiling, and putting it in a row of
 * floors would flatten a distinction the whole nutrition frame is built on — a ceiling drawn like
 * a goal to fill is actively bad advice. It lives in the item sheet, where there is room to say
 * which direction it runs.
 *
 * NO COLOUR on the numbers. Never judge: nothing here is high or over, it is simply what was
 * eaten. The moment a fat number goes amber the day becomes a scoreboard, and this is a hearth.
 */
const COLUMNS: Array<{ key: keyof MealMacros; head: string }> = [
  { key: 'kcal', head: 'kcal' },
  { key: 'protein_g', head: 'P' },
  { key: 'carbs_g', head: 'C' },
  { key: 'fat_g', head: 'F' },
];

const fmt = (n: number): string => n.toLocaleString('en-US');

function ItemRow({ row, onOpen }: { row: DiaryRow; onOpen: (row: DiaryRow) => void }) {
  return (
    <button
      type="button"
      className="fh-item"
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
  );
}

/**
 * One bracket in the diary. Collapsed by default — the relief IS the point ("seven ingredients
 * read as a bowl, a coffee, a muffin") — and it expands in place, never to a new screen. The ⋯
 * only appears on the expanded head, and only for a real part: the legacy adapter has no part to
 * address, so it reads and expands but takes no ops.
 */
function PartBlock({
  group,
  onOpen,
  onOpenPartMenu,
}: {
  group: DiaryPartGroup;
  onOpen: (row: DiaryRow) => void;
  onOpenPartMenu?: ((group: DiaryPartGroup) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const kcalText = group.kcal == null ? '—' : fmt(group.kcal);
  if (!open) {
    return (
      <div className={`mb-block cs-part${group.several ? ' mb-part--yield' : ''}`}>
        <div className="mb-rail mb-rail--short" />
        <button
          type="button"
          className="mb-collapsed-row"
          aria-expanded={false}
          aria-label={`${group.label} — ${group.sub}, expand to see what went in`}
          onClick={() => setOpen(true)}
        >
          <span className="mb-collapsed-main">
            <span className="mb-collapsed-name">{group.label}</span>
            <span className="mb-collapsed-sub">{group.sub}</span>
          </span>
          <span className="mb-collapsed-kcal">{kcalText}</span>
          <span className="mb-chevron" aria-hidden>
            ⌄
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className={`mb-block cs-part${group.several ? ' mb-part--yield' : ''}`}>
      <div className="mb-rail" />
      <div className="cs-part-body">
        <div className="cs-part-head">
          <span className="mb-pill">{group.label}</span>
          <span className="mb-head-kcal">{`${group.sub} · ${kcalText}`}</span>
          <span className="mb-head-space" />
          <button type="button" className="mb-ctrl" aria-label={`Collapse ${group.label}`} onClick={() => setOpen(false)}>
            ⌃
          </button>
          {onOpenPartMenu && group.partKey && (
            <button type="button" className="mb-ctrl" aria-label={`More for ${group.label}`} onClick={() => onOpenPartMenu(group)}>
              ⋯
            </button>
          )}
        </div>
        {group.rows.map((row) => (
          <ItemRow key={row.key} row={row} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

export function FoodDiaryItems({
  groups,
  onOpen,
  onAdd,
  addLabel,
  onGroupThings,
  onOpenPartMenu,
}: {
  groups: DiaryGroup[];
  onOpen: (row: DiaryRow) => void;
  onAdd?: () => void;
  addLabel?: string;
  /** The ⋯ twin of the group gesture (the meal screen owns gestures; the diary gets the certain
   *  path only). Present when some meal in the slot has two or more loose items. */
  onGroupThings?: () => void;
  onOpenPartMenu?: (group: DiaryPartGroup) => void;
}) {
  return (
    <div className="fh-items">
      <div className="fh-item-head">
        <span className="fh-item-n">
          {onGroupThings && (
            <button type="button" className="cs-group-btn" aria-label="Group things" onClick={onGroupThings}>
              ⋯
            </button>
          )}
        </span>
        {COLUMNS.map((c) => (
          <span className="fh-item-c" key={c.key} aria-hidden>
            {c.head}
          </span>
        ))}
      </div>

      {groups.map((g) =>
        g.kind === 'item' ? (
          <ItemRow key={g.key} row={g.row} onOpen={onOpen} />
        ) : (
          <PartBlock key={g.key} group={g} onOpen={onOpen} onOpenPartMenu={onOpenPartMenu} />
        ),
      )}

      {onAdd && (
        <button className="fh-item-add" onClick={onAdd}>
          <i aria-hidden>＋</i> {addLabel}
        </button>
      )}
    </div>
  );
}
