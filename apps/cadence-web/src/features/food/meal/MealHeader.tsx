/**
 * The meal's header (canvas 1b B1–B3): ‹ back, the OPEN chip, ⋯, the meal-kind chip
 * (inferred from the clock, changeable in one tap, asked once — the "change ⌄" hint retires
 * after the first change), and the window line — visible on-surface, never a silent rule.
 */
import { useState } from 'react';
import { MEAL_KINDS, type MealKind } from '@cadence/shared';

function windowLine(opts: {
  empty: boolean;
  date?: string;
  openedClock: string | null;
  count: number;
  addsUntil: string | null;
}): string {
  const { empty, date, openedClock, count, addsUntil } = opts;
  if (empty) {
    const day = date
      ? new Date(`${date}T12:00:00`)
          .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
          .toUpperCase()
      : null;
    return [day, openedClock, 'nothing in it yet'].filter(Boolean).join(' · ');
  }
  const WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE'];
  const things = `${WORDS[count] ?? count} ${count === 1 ? 'THING' : 'THINGS'}`;
  return [openedClock, things, addsUntil].filter(Boolean).join(' · ');
}

export function MealHeader({
  kind,
  date,
  count,
  openLabel,
  openedClock,
  addsUntil,
  busy,
  onBack,
  onKind,
  onMenu,
}: {
  kind: MealKind;
  date?: string;
  count: number;
  openLabel: string | null;
  openedClock: string | null;
  addsUntil: string | null;
  busy?: boolean;
  onBack: () => void;
  onKind: (k: MealKind) => void;
  onMenu: () => void;
}) {
  const [changed, setChanged] = useState(false);
  return (
    <div className="ms-head">
      <div className="ms-head-row">
        <button type="button" className="ms-back" aria-label="Back" onClick={onBack}>
          ‹
        </button>
        {openLabel && <span className="ms-open">{openLabel}</span>}
        <span className="ms-head-space" />
        <button type="button" className="ms-menu-btn" aria-label="More for this meal" onClick={onMenu}>
          ⋯
        </button>
      </div>
      <span className="ms-kind">
        <span className="ms-kind-name">{kind}</span>
        {!changed && <span className="ms-kind-change">change ⌄</span>}
        <select
          aria-label="Meal"
          value={kind}
          disabled={busy}
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
      <div className="ms-window">{windowLine({ empty: count === 0, date, openedClock, count, addsUntil })}</div>
    </div>
  );
}
