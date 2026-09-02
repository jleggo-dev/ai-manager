/**
 * The checkmark path (canvas turn-2 B1, kept as the certain twin of the gestures):
 *
 *   • `group` mode — circles on rows, tap what belongs together, one bar at the bottom,
 *     "Group these four";
 *   • `takeOut` mode — the same list ticking what should LEAVE a bracket (A3's tick-list).
 *
 * Same component, one `mode` prop; emits the ticked item indexes and nothing else.
 */
import { useState } from 'react';
import type { MealItem } from '@cadence/shared';
import { sumEst } from './partModel.ts';
import { fmtKcal, macroLine, numberWord } from './copy.ts';

export interface SelectModeProps {
  mode: 'group' | 'takeOut';
  items: MealItem[];
  /** Which item indexes can be ticked. Group mode: the loose rows. TakeOut: the part's members. */
  eligible: number[];
  initial?: number[];
  /** Names the slot in the group-mode sub-line ("They stay in the same breakfast either way."). */
  mealName?: string;
  onConfirm: (indexes: number[]) => void;
  onCancel: () => void;
}

function rowSub(item: MealItem): string {
  const amount = item.qty != null ? [item.qty, item.unit].filter(Boolean).join(' ') : null;
  const kcal = typeof item.est?.kcal === 'number' ? `${fmtKcal(item.est.kcal)} kcal` : null;
  return [amount, kcal].filter(Boolean).join(' · ');
}

export function SelectMode({ mode, items, eligible, initial, mealName, onConfirm, onCancel }: SelectModeProps) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(initial ?? []));
  const toggle = (i: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  const all = () => setPicked(new Set(eligible));
  const chosen = eligible.filter((i) => picked.has(i));
  const total = sumEst(items, chosen);
  const macros = macroLine(total);
  const n = chosen.length;
  const confirmLabel =
    mode === 'group' ? `Group these ${numberWord(n)}` : n === 1 ? 'Take it out' : `Take these ${numberWord(n)} out`;
  const disabled = mode === 'group' ? n < 2 : n < 1;
  return (
    <div className="mb-select" role="dialog" aria-label={mode === 'group' ? 'Group things' : 'Take something out'}>
      <div className="mb-select-bar">
        <button type="button" className="mb-select-cancel" onClick={onCancel}>
          Cancel
        </button>
        <span className="mb-select-heading">{mode === 'group' ? 'Group things' : 'Take something out'}</span>
        <button type="button" className="mb-select-all" onClick={all}>
          All
        </button>
      </div>
      <div className="mb-select-lede">
        {mode === 'group'
          ? `Tap what belongs together. They stay in the same ${mealName ?? 'meal'} either way.`
          : 'Tick what should leave.'}
      </div>
      <div className="mb-select-rows">
        {eligible.map((i) => {
          const item = items[i];
          if (!item) return null;
          const on = picked.has(i);
          const sub = rowSub(item);
          return (
            <button
              key={i}
              type="button"
              className={`mb-select-row${on ? ' mb-select-row--on' : ''}`}
              aria-pressed={on}
              onClick={() => toggle(i)}
            >
              <span className={`mb-tick${on ? ' mb-tick--on' : ''}`} aria-hidden="true">
                {on ? '✓' : ''}
              </span>
              <span className="mb-select-words">
                <span className="mb-select-name">{item.name}</span>
                {sub && <span className="mb-select-sub">{sub}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mb-select-foot">
        <div className="mb-select-count">
          <div className="mb-rail mb-rail--mini" />
          <span className="mb-select-tally">{`${n} selected · ${fmtKcal(total.kcal)} kcal`}</span>
          {macros && <span className="mb-select-macros">{macros}</span>}
        </div>
        <button type="button" className="mb-amber-btn" disabled={disabled} onClick={() => onConfirm(chosen)}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
