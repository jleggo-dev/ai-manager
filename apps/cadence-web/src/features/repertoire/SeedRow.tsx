/**
 * One row of the seed review: the tick, the piece, its composer/catalogue line, and the standing
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
  'This title names more than one piece. Add the composer or the catalogue number so it names just one.';

interface Props {
  row: SeedRowState;
  /** The standing this row will be written with, or null when it will not be written. */
  standing: SeedStatus | null;
  /** True when this is the piece they said they are on. */
  here: boolean;
  onTick: () => void;
  onHere: () => void;
  onLabel: (value: string) => void;
}

export function SeedRow({ row, standing, here, onTick, onHere, onLabel }: Props) {
  const qualifier = [row.composer, row.catalogue].filter(Boolean).join(' · ');
  return (
    <div className={`pw-rep-row sr-row${here ? ' sr-row--here' : ''}`}>
      <button
        type="button"
        className="occ-check sr-tick"
        aria-pressed={row.selected}
        aria-label={`Include ${row.label || 'this piece'}`}
        onClick={onTick}
      >
        {row.selected ? '✓' : ''}
      </button>
      <div className="occ-body sr-body">
        {row.added ? (
          <input
            className="sr-input"
            value={row.label}
            placeholder="Name the piece"
            onChange={(e) => onLabel(e.target.value)}
          />
        ) : (
          <button type="button" className="pw-rep-label sr-title" onClick={onHere}>
            {row.label}
          </button>
        )}
        {qualifier ? <div className="sr-sub">{qualifier}</div> : null}
        {row.ambiguous ? <div className="pw-rep-note sr-note">{AMBIGUOUS_NOTE}</div> : null}
      </div>
      <span className="pw-rep-standing sr-standing">{standing ? STANDING_WORD[standing] : '—'}</span>
    </div>
  );
}
