import { useState } from 'react';
import { MEAL_KINDS, type MealItem } from '@cadence/shared';
import { editMealParts, type Meal, type MealKind, type MealPartOp, type NutritionDayData } from '../../lib/api.ts';
import { PartMenu } from '../food/bracket/PartMenu.tsx';
import { SelectMode } from '../food/bracket/SelectMode.tsx';
import { FoodDiaryItems } from './FoodDiaryItems.tsx';
import { MealItemSheet } from './MealItemSheet.tsx';
import {
  diaryGroups,
  diaryRows,
  isMealOpen,
  looseIndexesOf,
  mealName,
  type DiaryPartGroup,
  type DiaryRow,
} from './foodDiaryRows.ts';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Every slot needs a name, and `Record<MealKind, …>` is what makes the compiler say so. */
const MEAL_LABELS: Record<MealKind, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
  drink: 'Drinks',
  other: 'Other',
};

/** The four standing slots, in eating order. */
const STANDING: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const labelled = (kind: MealKind): { kind: MealKind; label: string } => ({ kind, label: MEAL_LABELS[kind] });

const SLOTS = STANDING.map(labelled);
/** Everything else — drinks and one-offs today — gets a row only when it has something in it.
 *  Derived rather than listed, so a slot added later shows up here instead of vanishing. */
const EXTRA = MEAL_KINDS.filter((k) => !STANDING.includes(k)).map(labelled);

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
 * THE DAY on the Food screen (Food Journey 02 + 08, brackets from the meal-logging rework) — one
 * row per meal slot, so the day always shows its whole shape: logged slots read their kcal (a `~`
 * while any of it is provisional), empty slots stay dashed with a Log chip. An OPEN meal's slot
 * says so with a small tag — it is already in the totals (server ruling), the tag only keeps the
 * read honest.
 *
 * Tapping a logged slot expands it into the things that actually went into it. Bracketed things
 * arrive as one collapsed row each (canvas A4) and expand in place; every member row keeps its
 * logId+index correction address, so MealItemSheet works exactly as before.
 *
 * A day behind you expands and reads, but does not offer to log — the writes all land on today.
 * Grouping the past, though, is legal on any day: it changes no numbers, only the read-back.
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
  onGroupThings,
  onOpenPartMenu,
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
  onGroupThings: (() => void) | undefined;
  onOpenPartMenu: (group: DiaryPartGroup) => void;
}) {
  const { kcal, protein, items, provisional } = slotSum(meals);
  const openMeal = meals.some(isMealOpen);
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
          {openMeal && <i className="cs-open-tag">OPEN</i>}
          {provisional && <i className="fh-slot-prov">provisional</i>}
        </span>
        <span className="fh-slot-sub">{sub}</span>
        <i className="fh-slot-chev" aria-hidden>
          {open ? '⌃' : '⌄'}
        </i>
      </button>
      {open && (
        <FoodDiaryItems
          groups={diaryGroups(meals)}
          onOpen={onOpenItem}
          onOpenPartMenu={onOpenPartMenu}
          {...(onGroupThings ? { onGroupThings } : {})}
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

/** Rename a bracket — the certain twin. NamePartCard is the SAVE card and says "saves as a meal",
 *  which a rename must not promise, so the diary keeps its own quieter sheet. */
function RenameSheet({
  initial,
  busy,
  onSave,
  onClose,
}: {
  initial: string;
  busy: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet cs-sheet" role="dialog" aria-label="Rename it">
        <div className="sheet-grab" aria-hidden />
        <p className="mis-note">The numbers stay as they are — this only changes what it’s called.</p>
        <input
          className="mis-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="What do you call this?"
          placeholder="What do you call this?"
        />
        <button className="fa-log" disabled={busy || !name.trim()} onClick={() => onSave(name.trim())}>
          {busy ? 'Saving…' : 'Save the name'}
        </button>
        <button className="lockbtn ghost" onClick={onClose}>
          Back
        </button>
      </div>
    </>
  );
}

/** Yield on the same mark — "1 of 4 servings" with no new row type. Numbers never move. */
function YieldSheet({
  label,
  initialYield,
  busy,
  onSave,
  onClose,
}: {
  label: string;
  initialYield: number | null;
  busy: boolean;
  onSave: (yieldServings: number, servingsLogged: number) => void;
  onClose: () => void;
}) {
  const [made, setMade] = useState(Math.max(2, initialYield ?? 4));
  const [ate, setAte] = useState(1);
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet cs-sheet" role="dialog" aria-label={`${label} makes several portions`}>
        <div className="sheet-grab" aria-hidden />
        <p className="mis-note">Same food, same numbers — this only says the pot made more than one plate.</p>
        <div className="cs-yield-row">
          <span className="cs-yield-lab">HOW MANY PORTIONS DID IT MAKE?</span>
          <span className="cs-stepper">
            <button
              type="button"
              aria-label="Fewer portions"
              disabled={busy || made <= 2}
              onClick={() => {
                const n = made - 1;
                setMade(n);
                setAte((a) => Math.min(a, n));
              }}
            >
              −
            </button>
            <b>{made}</b>
            <button
              type="button"
              aria-label="More portions"
              disabled={busy || made >= 12}
              onClick={() => setMade(made + 1)}
            >
              ＋
            </button>
          </span>
        </div>
        <div className="cs-yield-row">
          <span className="cs-yield-lab">THIS MEAL WAS</span>
          <span className="cs-stepper">
            <button
              type="button"
              aria-label="Fewer servings"
              disabled={busy || ate <= 1}
              onClick={() => setAte(ate - 1)}
            >
              −
            </button>
            <b>{`${ate} of ${made} servings`}</b>
            <button
              type="button"
              aria-label="More servings"
              disabled={busy || ate >= made}
              onClick={() => setAte(ate + 1)}
            >
              ＋
            </button>
          </span>
        </div>
        <button className="fa-log" disabled={busy} onClick={() => onSave(made, ate)}>
          {busy ? 'Saving…' : 'Save it'}
        </button>
        <button className="lockbtn ghost" onClick={onClose}>
          Back
        </button>
      </div>
    </>
  );
}

type SelectTask =
  | { kind: 'group'; logId: string; eligible: number[]; slotLabel: string }
  | { kind: 'takeOut'; logId: string; partKey: string; eligible: number[]; slotLabel: string; partName: string | null }
  | { kind: 'addTo'; logId: string; partKey: string; eligible: number[]; slotLabel: string };

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
  const [menu, setMenu] = useState<DiaryPartGroup | null>(null);
  const [select, setSelect] = useState<SelectTask | null>(null);
  const [rename, setRename] = useState<DiaryPartGroup | null>(null);
  const [yielding, setYielding] = useState<DiaryPartGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const meals = day?.meals ?? [];
  const byKind = (kind: MealKind) => meals.filter((m) => m.meal === kind);
  const rows = [...SLOTS, ...EXTRA.filter(({ kind }) => byKind(kind).length > 0)];
  const mealOf = (logId: string) => meals.find((m) => m.log_id === logId);
  const slotLabelOf = (logId: string) => (MEAL_LABELS[mealOf(logId)?.meal ?? 'other'] ?? 'meal').toLowerCase();

  /**
   * Parts ops in sequence, then a re-read either way: the server owns the truth, and a
   * half-landed sequence must not leave a stale day on screen. Indexes stay valid across the
   * whole run — parts ops only move `part` pointers, they never reorder or remove items.
   */
  async function runOps(logId: string, ops: MealPartOp[]) {
    setBusy(true);
    setFailed(false);
    try {
      for (const op of ops) await editMealParts(logId, op);
      setRename(null);
      setYielding(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      onCorrected?.();
    }
  }

  function confirmSelect(task: SelectTask, indexes: number[]) {
    setSelect(null);
    if (indexes.length === 0) return;
    let ops: MealPartOp[];
    if (task.kind === 'group') {
      ops = [{ op: 'group', item_indexes: indexes }];
    } else if (task.kind === 'takeOut') {
      // Taking the second-to-last member out dissolves the bracket and frees the rest, so a
      // full-house pick needs one fewer op — the last remove would address a part already gone.
      const picks = indexes.length >= task.eligible.length ? indexes.slice(0, -1) : indexes;
      ops = picks.map((index) => ({ op: 'remove', part: task.partKey, index }));
    } else {
      ops = indexes.map((index) => ({ op: 'add', part: task.partKey, index }));
    }
    void runOps(task.logId, ops);
  }

  const selectItems = select ? ((mealOf(select.logId)?.items ?? []) as MealItem[]) : null;

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
        // The ⋯ twin of the group gesture: the first meal here with two or more loose things.
        const groupTarget = slot
          .map((m) => ({ logId: m.log_id, loose: looseIndexesOf(m) }))
          .find((t) => t.loose.length >= 2);
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
            onGroupThings={
              groupTarget
                ? () =>
                    setSelect({
                      kind: 'group',
                      logId: groupTarget.logId,
                      eligible: groupTarget.loose,
                      slotLabel: label.toLowerCase(),
                    })
                : undefined
            }
            onOpenPartMenu={setMenu}
          />
        );
      })}

      {failed && (
        <p className="cs-note">That didn’t save — the day re-read itself, so what you see is what’s stored.</p>
      )}

      {item && (
        <MealItemSheet
          row={item}
          siblings={diaryRows(meals.filter((m) => m.log_id === item.logId))}
          onClose={() => setItem(null)}
          onChanged={() => onCorrected?.()}
        />
      )}

      {menu &&
        menu.partKey &&
        (() => {
          const g = menu;
          const partKey = menu.partKey;
          const meal = mealOf(g.logId);
          const mealKcal = meal?.macros?.kcal;
          const readsNow = meal ? diaryGroups([meal]).length : undefined;
          return (
            <PartMenu
              label={g.label}
              memberCount={g.memberCount}
              {...(g.kcal != null ? { kcal: g.kcal } : {})}
              several={g.several}
              inCookbook={g.inCookbook}
              {...(typeof mealKcal === 'number' ? { mealKcal } : {})}
              {...(typeof readsNow === 'number' ? { readsNow } : {})}
              onRename={() => {
                setMenu(null);
                setRename(g);
              }}
              onAddTo={() => {
                setMenu(null);
                const loose = meal ? looseIndexesOf(meal) : [];
                if (loose.length > 0)
                  setSelect({
                    kind: 'addTo',
                    logId: g.logId,
                    partKey,
                    eligible: loose,
                    slotLabel: slotLabelOf(g.logId),
                  });
              }}
              onTakeOut={() => {
                setMenu(null);
                const eligible = g.rows.map((r) => r.index).filter((i): i is number => i != null);
                setSelect({
                  kind: 'takeOut',
                  logId: g.logId,
                  partKey,
                  eligible,
                  slotLabel: slotLabelOf(g.logId),
                  partName: g.partName,
                });
              }}
              onUngroup={() => {
                setMenu(null);
                void runOps(g.logId, [{ op: 'ungroup', part: partKey }]);
              }}
              onYield={() => {
                setMenu(null);
                setYielding(g);
              }}
              onClose={() => setMenu(null)}
            />
          );
        })()}

      {select && selectItems && (
        <>
          <div className="sheet-scrim" onClick={() => setSelect(null)} aria-hidden />
          <div className="sheet cs-select">
            <div className="sheet-grab" aria-hidden />
            <SelectMode
              mode={select.kind === 'takeOut' ? 'takeOut' : 'group'}
              items={selectItems}
              eligible={select.eligible}
              mealName={select.slotLabel}
              partLabel={select.kind === 'takeOut' ? (select.partName ?? undefined) : undefined}
              onConfirm={(indexes) => confirmSelect(select, indexes)}
              onCancel={() => setSelect(null)}
            />
          </div>
        </>
      )}

      {rename && rename.partKey && (
        <RenameSheet
          initial={rename.partName ?? ''}
          busy={busy}
          onSave={(name) => void runOps(rename.logId, [{ op: 'rename', part: rename.partKey!, name }])}
          onClose={() => setRename(null)}
        />
      )}

      {yielding && yielding.partKey && (
        <YieldSheet
          label={yielding.label}
          initialYield={yielding.yieldServings}
          busy={busy}
          onSave={(yieldServings, servingsLogged) =>
            void runOps(yielding.logId, [
              {
                op: 'set_yield',
                part: yielding.partKey!,
                yield_servings: yieldServings,
                servings_logged: servingsLogged,
              },
            ])
          }
          onClose={() => setYielding(null)}
        />
      )}
    </div>
  );
}
