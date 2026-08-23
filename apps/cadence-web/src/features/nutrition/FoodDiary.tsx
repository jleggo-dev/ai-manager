import { useState } from 'react';
import type { Meal, MealKind, NutritionDayData } from '../../lib/api.ts';
import { FoodDiaryItems } from './FoodDiaryItems.tsx';
import { MealItemSheet } from './MealItemSheet.tsx';
import { diaryRows, mealName, type DiaryRow } from './foodDiaryRows.ts';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** The four standing slots, in eating order; drinks and one-offs get their own row only when present. */
const SLOTS: Array<{ kind: MealKind; label: string }> = [
  { kind: 'breakfast', label: 'Breakfast' },
  { kind: 'lunch', label: 'Lunch' },
  { kind: 'dinner', label: 'Dinner' },
  { kind: 'snack', label: 'Snacks' },
];
const EXTRA: Array<{ kind: MealKind; label: string }> = [
  { kind: 'drink', label: 'Drinks' },
  { kind: 'other', label: 'Other' },
];

function slotSum(meals: Meal[]): { kcal: number; protein: number; items: number; provisional: boolean } {
  let kcal = 0;
  let protein = 0;
  let items = 0;
  let provisional = false;
  for (const m of meals) {
    kcal += m.macros?.kcal ?? 0;
    protein += m.macros?.protein_g ?? 0;
    items += Math.max(1, m.items?.length ?? 0);
    if (m.provisional) provisional = true;
  }
  return { kcal, protein, items, provisional };
}

/**
 * THE DAY on the Food screen (Food Journey 02 + 08) — one row per meal slot, so the day always
 * shows its whole shape: logged slots read their kcal (a `~` while any of it is provisional),
 * empty slots stay dashed with a Log chip.
 *
 * Slice 3 opens them. Tapping a logged slot expands it into the things that actually went into it,
 * each with its own calories, and offers to add one more — which is the difference between a
 * number you have to trust and a number you can check. Provisional meals keep the one-tap confirm:
 * nothing counts until the user says so, and the saying is one tap.
 *
 * A day behind you expands and reads, but does not offer to log — the writes all land on today.
 */
function SlotRow({
  label,
  meals,
  open,
  onToggle,
  isToday,
  confirming,
  onConfirm,
  onLog,
  onOpenItem,
}: {
  label: string;
  meals: Meal[];
  open: boolean;
  onToggle: () => void;
  isToday: boolean;
  confirming: string | null;
  onConfirm: (logId: string) => void;
  onLog: () => void;
  onOpenItem: (row: DiaryRow) => void;
}) {
  const { kcal, protein, items, provisional } = slotSum(meals);
  const sub = [
    `${items} ${items === 1 ? 'item' : 'items'}`,
    `${provisional ? '~' : ''}${fmt(kcal)} kcal`,
    protein > 0 ? `${fmt(protein)}g protein` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`fh-slot${open ? ' is-open-row' : ''}`}>
      <button className="fh-slot-row" onClick={onToggle} aria-expanded={open} aria-label={`${label} — ${sub}`}>
        <span className="fh-slot-name">
          {label}
          {provisional && <i className="fh-slot-prov">provisional</i>}
        </span>
        <span className="fh-slot-sub">{sub}</span>
        <i className="fh-slot-chev" aria-hidden>
          {open ? '⌃' : '⌄'}
        </i>
      </button>
      {open && (
        <FoodDiaryItems
          rows={diaryRows(meals)}
          onOpen={onOpenItem}
          {...(isToday ? { onAdd: onLog, addLabel: `Add to ${label.toLowerCase()}` } : {})}
        />
      )}
      {meals
        .filter((m) => m.provisional)
        .map((m) => (
          <div className="fh-prov-row" key={m.log_id}>
            <span className="fh-prov-name">{mealName(m)}</span>
            <button
              className="fh-confirm"
              onClick={() => onConfirm(m.log_id)}
              disabled={confirming === m.log_id}
              aria-label={`Confirm the estimate for ${mealName(m)}`}
            >
              {confirming === m.log_id ? '…' : '✓'}
            </button>
          </div>
        ))}
    </div>
  );
}

export function FoodDiary({
  day,
  isToday = true,
  confirming,
  onConfirm,
  onLog,
  onCorrected,
}: {
  day: NutritionDayData | null;
  isToday?: boolean;
  confirming: string | null;
  onConfirm: (logId: string) => void;
  onLog: (meal: MealKind) => void;
  /** A correction landed — the day's totals moved, so whoever owns them should re-read. */
  onCorrected?: () => void;
}) {
  const [open, setOpen] = useState<MealKind | null>(null);
  const [item, setItem] = useState<DiaryRow | null>(null);
  const meals = day?.meals ?? [];
  const byKind = (kind: MealKind) => meals.filter((m) => m.meal === kind);
  const rows = [...SLOTS, ...EXTRA.filter(({ kind }) => byKind(kind).length > 0)];

  return (
    <div className="fh-diary">
      <div className="fh-sec-head">
        <span>{isToday ? 'TODAY' : 'THE DAY'}</span>
      </div>
      {rows.map(({ kind, label }) => {
        const slot = byKind(kind);
        if (slot.length === 0) {
          // A slot behind you that was never logged is simply a slot nobody logged — not a gap to fill.
          if (!isToday) {
            return (
              <div key={kind} className="fh-slot is-quiet">
                <span className="fh-slot-name">{label}</span>
                <span className="fh-slot-sub">nothing logged</span>
              </div>
            );
          }
          return (
            <button key={kind} className="fh-slot is-open" onClick={() => onLog(kind)}>
              <span className="fh-slot-name">{label}</span>
              <span className="fh-slot-log">Log</span>
            </button>
          );
        }
        return (
          <SlotRow
            key={kind}
            label={label}
            meals={slot}
            open={open === kind}
            onToggle={() => setOpen(open === kind ? null : kind)}
            isToday={isToday}
            confirming={confirming}
            onConfirm={onConfirm}
            onLog={() => onLog(kind)}
            onOpenItem={setItem}
          />
        );
      })}

      {item && (
        <MealItemSheet
          row={item}
          siblings={diaryRows(meals.filter((m) => m.log_id === item.logId))}
          onClose={() => setItem(null)}
          onChanged={() => onCorrected?.()}
        />
      )}
    </div>
  );
}
