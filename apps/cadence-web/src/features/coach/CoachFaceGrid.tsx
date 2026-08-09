import { PICKABLE_COACH_FACES, type CoachFaceId } from '@cadence/shared';
import { Orb } from '../../components/Orb.tsx';

/**
 * The portrait picker, shared by onboarding and Settings so the two can never drift.
 *
 * **No names under the tiles, on purpose.** Cadence is one coach with one voice; these are
 * pictures. The moment a tile is captioned "Steady Pacer" the grid starts reading as a choice
 * of temperament, and the user reasonably wonders which one remembers them and whether they
 * picked the wrong personality. Accessible labels are positional ("Face 3") for the same
 * reason, and because a description of a drawn person would be the app asserting who they are.
 *
 * Faces without art aren't rendered as "coming soon" tiles; they're absent (see
 * PICKABLE_COACH_FACES). An unbuildable option is not an option.
 *
 * `withMark` adds a tile carrying the brand mark — "no face, just the logo" — and it goes **last,
 * after every portrait** (owner ruling 2026-08-09). By the time anyone sees this grid Cadence
 * already has a face, drawn at random when they met her, and it is ticked. So the mark is not the
 * default anyone falls back into; it is a deliberate choice you have to scroll to and tap, which
 * is the right amount of friction for trading a person's face for a logo.
 */
export function CoachFaceGrid({
  selected,
  onPick,
  withMark = false,
}: {
  selected: CoachFaceId | null;
  onPick: (id: CoachFaceId | null) => void;
  withMark?: boolean;
}) {
  return (
    <div className="cfgrid" role="radiogroup" aria-label="Cadence's face">
      {PICKABLE_COACH_FACES.map((face) => {
        const picked = face.id === selected;
        return (
          <button
            key={face.id}
            type="button"
            role="radio"
            aria-checked={picked}
            aria-label={face.label}
            className={`cfgrid-tile${picked ? ' is-picked' : ''}`}
            onClick={() => onPick(face.id)}
          >
            <img src={face.art ?? ''} alt="" loading="lazy" decoding="async" />
            {picked && (
              <span className="cfgrid-check" aria-hidden>
                ✓
              </span>
            )}
          </button>
        );
      })}
      {withMark && (
        <button
          type="button"
          role="radio"
          aria-checked={selected === null}
          aria-label="No face — keep the mark"
          className={`cfgrid-tile cfgrid-mark${selected === null ? ' is-picked' : ''}`}
          onClick={() => onPick(null)}
        >
          <Orb />
          {selected === null && (
            <span className="cfgrid-check" aria-hidden>
              ✓
            </span>
          )}
        </button>
      )}
    </div>
  );
}
