/**
 * "Add one by hand" (P6 "the room") — a minimal name sheet for one piece. The item screen (P2) has
 * no create mode (it is props-driven over an existing row with an `item_id`), so a brand-new piece
 * has nowhere else to be typed in; this posts it as a one-row seed confirm
 * (`lib/api/repertoire-seed.ts`), the same write "Start from a collection" ends on, rather than a
 * second write path for the same table.
 *
 * A hand-added piece starts `working` ("Learning") — the same default a bare mention gets from the
 * coach's own `update_repertoire` (a new item starts working; CLAUDE.md's derive-don't-duplicate
 * rule stops at behaviour that lives once server-side, and this mirrors that default rather than
 * inventing a different one for the same fact).
 */
import { useState } from 'react';
import { confirmSeed } from '../../lib/api/repertoire-seed.ts';

export interface HandAddSheetProps {
  /** null = no goal — the write still keeps. */
  goalId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function HandAddSheet({ goalId, onClose, onSaved }: HandAddSheetProps) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const trimmed = label.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    const res = await confirmSeed(
      [{ label: trimmed, composer: null, collection: null, catalogue: null, rank: 1, status: 'working' }],
      goalId,
    );
    setBusy(false);
    if (!res.ok) return setError(res.fault);
    if (res.refused.length > 0) {
      setError(res.refused[0]?.reason ?? 'That name did not save — try a fuller one.');
      return;
    }
    onSaved();
  }

  return (
    <div className="sheet-scrim" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Add one by hand" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div className="sheet-title">
            <b>Add one by hand</b>
            <span>just this one, right now</span>
          </div>
          <button type="button" className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="sheet-body">
          <div className="ri-field">
            <label className="ri-label" htmlFor="rl-hand-add-name">
              Name
            </label>
            <input
              id="rl-hand-add-name"
              className="ri-input"
              value={label}
              disabled={busy}
              placeholder="what is it?"
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
          </div>
          <button type="button" className="ri-save" disabled={!label.trim() || busy} onClick={() => void save()}>
            Save
          </button>
          {error && <p className="ri-save-err">{error}</p>}
        </div>
      </div>
    </div>
  );
}
