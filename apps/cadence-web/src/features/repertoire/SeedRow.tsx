/**
 * One row of the seed review: the tick, the item, the line naming who made it, and the standing
 * it will be written with.
 *
 * The title is a BUTTON because tapping it is the screen's main move — "this is where I am" —
 * and the tick is a separate control beside it, because "include this" and "I am here" are two
 * different statements and one press must never mean both.
 */
import type { SeedStatus } from '@cadence/shared';
import { STANDING_WORD, type SeedRowState } from './seedRows.ts';

/** Said on a row whose title would name two pieces once saved — the person can fix it here. */
const AMBIGUOUS_NOTE =
  'This title names more than one thing. Add whoever made it, or whatever tells them apart, so it names just one.';

interface Props {
  row: SeedRowState;
  /** The standing this row will be written with, or null when it will not be written. */
  standing: SeedStatus | null;
  /** True when this is the piece they said they are on. */
  here: boolean;
  /**
   * True when this row's name cannot be saved as it stands. The row then shows its name as a
   * FIELD rather than a title, because renaming it is the only thing that moves the screen
   * forward — and once it is renamed the mark clears and the title comes back. Tapping "I am
   * here" is unavailable while that is true, which is the state resolving itself: fix the name,
   * get the row back.
   */
  blocked: boolean;
  onTick: () => void;
  onHere: () => void;
  onLabel: (value: string) => void;
}

export function SeedRow({ row, standing, here, blocked, onTick, onHere, onLabel }: Props) {
  const qualifier = [row.composer, row.collection].filter(Boolean).join(' · ');
  return (
    <div className={`pw-rep-row sr-row${here ? ' sr-row--here' : ''}${blocked ? ' sr-row--blocked' : ''}`}>
      <button
        type="button"
        className="occ-check sr-tick"
        aria-pressed={row.selected}
        aria-label={`Include ${row.label || 'this one'}`}
        onClick={onTick}
      >
        {row.selected ? '✓' : ''}
      </button>
      <div className="occ-body sr-body">
        {row.added || blocked ? (
          <input
            className="sr-input"
            value={row.label}
            placeholder="What you call it"
            onChange={(e) => onLabel(e.target.value)}
          />
        ) : (
          <button type="button" className="pw-rep-label sr-title" onClick={onHere}>
            {row.label}
          </button>
        )}
        {qualifier ? <div className="sr-sub">{qualifier}</div> : null}
        {blocked ? <div className="pw-rep-note sr-note">{AMBIGUOUS_NOTE}</div> : null}
      </div>
      <span className="pw-rep-standing sr-standing">{standing ? STANDING_WORD[standing] : '—'}</span>
    </div>
  );
}
