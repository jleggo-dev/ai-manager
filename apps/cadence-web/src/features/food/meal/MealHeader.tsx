/**
 * The meal's header (canvas 1b B1–B3): ‹ back, the OPEN / LOGGED chip, ⋯, the meal-kind chip
 * (inferred from the clock, changeable in one tap, asked once — the "change ⌄" hint retires
 * after the first change), and one quiet line under it.
 *
 * That line used to read "08:02 · ONE THING · ADDS UNTIL 11:02" — the opened clock and a count
 * of rows the eye can see right below (owner, 2026-09-07: "superfluous text"). It now says the
 * one thing the list cannot: the window while the cart is open ("adds until 11:02"), that adds
 * count at once when the meal is logged, and "nothing in it yet" when it is empty.
 */
import { useState } from 'react';
import { MEAL_KINDS, type MealKind } from '@cadence/shared';

function windowLine(opts: { empty: boolean; logged: boolean; addsUntil: string | null }): string {
  const { empty, logged, addsUntil } = opts;
  if (logged) return 'logged · anything you add counts right away';
  if (empty) return [addsUntil, 'nothing in it yet'].filter(Boolean).join(' · ');
  return addsUntil ?? '';
}

export function MealHeader({
  kind,
  count,
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
  logged: boolean;
  openLabel: string | null;
  addsUntil: string | null;
  busy?: boolean;
  onBack: () => void;
  onKind: (k: MealKind) => void;
  onMenu: () => void;
}) {
  const [changed, setChanged] = useState(false);
  const line = windowLine({ empty: count === 0, logged, addsUntil });
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
