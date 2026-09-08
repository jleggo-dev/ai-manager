/**
 * The meal's header (canvas 1b B1–B3): ‹ back, the OPEN / LOGGED chip, ⋯, the meal-kind chip
 * (inferred from the clock, changeable in one tap, asked once — the "change ⌄" hint retires
 * after the first change), and one quiet line under it.
 *
 * That line used to read "08:02 · ONE THING · ADDS UNTIL 11:02" — the opened clock and a count
 * of rows the eye can see right below (owner, 2026-09-07: "superfluous text"). It says only what
 * the list cannot — windowLine.ts decides which sentence, and its table test pins the order.
 */
import { useState } from 'react';
import { MEAL_KINDS, type MealKind } from '@cadence/shared';
import { windowLine } from './windowLine.ts';

export function MealHeader({
  kind,
  count,
  loose,
  logged,
  openLabel,
  addsUntil,
  busy,
  onBack,
  onKind,
  onMenu,
}: {
  kind: MealKind;
  count: number;
  /** Items outside every bracket. Defaults to none so read-only hosts never show the hint. */
  loose?: number;
  logged: boolean;
  openLabel: string | null;
  addsUntil: string | null;
  busy?: boolean;
  onBack: () => void;
  onKind: (k: MealKind) => void;
  onMenu: () => void;
}) {
  const [changed, setChanged] = useState(false);
  const line = windowLine({ empty: count === 0, logged, addsUntil, loose: loose ?? 0 });
  return (
    <div className="ms-head">
      <div className="ms-head-row">
        <button type="button" className="ms-back" aria-label="Back" onClick={onBack}>
          ‹
        </button>
        {openLabel && <span className={`ms-open${logged ? ' ms-open-logged' : ''}`}>{openLabel}</span>}
        <span className="ms-head-space" />
        <button type="button" className="ms-menu-btn" aria-label="More for this meal" onClick={onMenu}>
          ⋯
        </button>
      </div>
      <span className="ms-kind">
        <span className="ms-kind-name">{kind}</span>
        {!changed && !logged && <span className="ms-kind-change">change ⌄</span>}
        <select
          aria-label="Meal"
          value={kind}
          disabled={busy || logged}
          onChange={(e) => {
            setChanged(true);
            onKind(e.target.value as MealKind);
          }}
        >
          {MEAL_KINDS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </span>
      {line && <div className="ms-window">{line}</div>}
    </div>
  );
}
