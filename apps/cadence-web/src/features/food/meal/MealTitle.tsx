/**
 * The quick log's title row (2026-10-28): the meal's name IS the picker — tap it and the slots
 * drop down, the current one ticked — then Cadence's face, then ⋯. Nothing else. The OPEN pill,
 * the "change ⌄" hint and the window line all went: the list below says what is in the meal,
 * and the drawer swipes down instead of carrying a ‹.
 *
 * The face is the one door to advice on this surface. It hops to the coach with a note that
 * carries the cart; it never speaks here. Shown only when the host can route there.
 */
import { useState } from 'react';
import { MEAL_KINDS, type MealKind } from '@cadence/shared';
import { CoachFace } from '../../../components/CoachFace.tsx';

export function MealTitle({
  kind,
  busy,
  locked,
  onKind,
  onCoach,
  onMenu,
}: {
  kind: MealKind;
  busy?: boolean;
  /** A logged meal keeps its slot. */
  locked?: boolean;
  onKind: (k: MealKind) => void;
  onCoach?: () => void;
  onMenu: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ms-title">
      <button
        type="button"
        className="ms-title-kind"
        aria-label="Meal"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={busy || locked}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ms-title-name">{kind}</span>
        {!locked && (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden className="ms-title-caret">
            <path
              d="M6 9l6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <span className="ms-title-space" />
      {onCoach && (
        <button type="button" className="ms-face" aria-label="Talk to Cadence about this meal" onClick={onCoach}>
          <CoachFace size={44} ring={false} />
        </button>
      )}
      <button type="button" className="ms-menu-btn" aria-label="More for this meal" onClick={onMenu}>
        ⋯
      </button>
      {open && (
        <>
          <div className="ms-title-scrim" aria-hidden onClick={() => setOpen(false)} />
          <div className="ms-title-menu" role="listbox" aria-label="Meal">
            {MEAL_KINDS.map((m) => (
              <button
                type="button"
                role="option"
                aria-selected={m === kind}
                key={m}
                className={`ms-title-opt${m === kind ? ' is-on' : ''}`}
                onClick={() => {
                  setOpen(false);
                  if (m !== kind) onKind(m);
                }}
              >
                <span>{m}</span>
                {m === kind && <i aria-hidden>✓</i>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
