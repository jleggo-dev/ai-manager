import { useState } from 'react';
import { deleteRepertoireItem } from '../../lib/api/repertoire-item.ts';

export interface ItemRemoveProps {
  itemId: string;
  /** Called once the delete is confirmed by the server. */
  onDeleted: () => void;
}

/** The exact sentence the brief specifies, stated at the point of choice rather than only inside
 *  the confirm dialog — so the consequence is visible before anyone taps anything. */
export const REMOVE_CONSEQUENCE = 'gone for good, with its sessions. Mark it Learned if you might come back.';

/**
 * Remove from my list — a real delete, distinct from retiring: the row disappears, but sessions
 * and logs that named it keep their own text (repos/repertoire.ts's `deleteRepertoireItem`); only
 * this link goes. No AI, no coach call — a plain confirm, then the request.
 */
export function ItemRemove({ itemId, onDeleted }: ItemRemoveProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    if (busy) return;
    if (!window.confirm(`Remove this for good? It ${REMOVE_CONSEQUENCE}`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteRepertoireItem(itemId);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not remove — try again.');
      setBusy(false);
    }
  }

  return (
    <div className="pw-card">
      <div className="ri-remove-note">{REMOVE_CONSEQUENCE}</div>
      <button className="ri-remove-btn" disabled={busy} onClick={() => void remove()}>
        {busy ? 'Removing…' : 'Remove from my list'}
      </button>
      {error && <div className="ri-remove-err">{error}</div>}
    </div>
  );
}
