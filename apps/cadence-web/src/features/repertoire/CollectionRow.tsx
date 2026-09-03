import { useState } from 'react';
import type { RepertoireCollection } from '@cadence/shared';
import { REMOVE_COLLECTION_CONFIRM, itemCountLine } from './collectionsCopy.ts';

export interface CollectionRowProps {
  collection: RepertoireCollection;
  /** Save a new name. Resolves to an error sentence to show in place, or '' when it saved. */
  onRename: (id: string, name: string) => Promise<string>;
  /** Remove it. Same contract: a sentence to show, or '' when it went. */
  onRemove: (id: string) => Promise<string>;
}

/**
 * One collection — its name, how many things are in it, and the two things you can do to it.
 *
 * Own file because a row holds its own state: the rename is an inline field that opens over the
 * name and closes when it saves, and the error from either action belongs on THIS row rather than
 * at the top of a screen where the person has to work out which one it is about.
 *
 * Remove says the consequence at the point of choice, in the confirmation itself: an item in a
 * removed collection stays exactly where it was, ungrouped (the foreign key is `on delete set
 * null`). Nobody will find that out by trying it, so the sentence has to say it first.
 */
export function CollectionRow({ collection, onRename, onRemove }: CollectionRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [typed, setTyped] = useState(collection.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function saveName() {
    const name = typed.trim();
    if (!name || busy) return;
    setBusy(true);
    setError('');
    const fault = await onRename(collection.collection_id, name);
    setBusy(false);
    setError(fault);
    // The field stays open on a refusal, holding what they typed, so the fix is one edit away.
    if (!fault) setRenaming(false);
  }

  async function remove() {
    if (busy || !window.confirm(REMOVE_COLLECTION_CONFIRM)) return;
    setBusy(true);
    setError('');
    const fault = await onRemove(collection.collection_id);
    setBusy(false);
    setError(fault);
  }

  return (
    <div className="rc-row">
      {renaming ? (
        <div className="ri-field">
          <input
            className="ri-input"
            aria-label={`Rename ${collection.name}`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void saveName()}
            maxLength={120}
          />
          <div className="rc-actions">
            <button type="button" className="detour-chip" disabled={!typed.trim() || busy} onClick={() => void saveName()}>
              Save
            </button>
            <button
              type="button"
              className="detour-chip"
              disabled={busy}
              onClick={() => {
                setTyped(collection.name);
                setError('');
                setRenaming(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <span className="rc-name">
            <b>{collection.name}</b>
            <span className="rc-count">{itemCountLine(collection.item_count)}</span>
          </span>
          <div className="rc-actions">
            <button
              type="button"
              className="detour-chip"
              aria-label={`Rename ${collection.name}`}
              onClick={() => setRenaming(true)}
            >
              Rename
            </button>
            <button
              type="button"
              className="detour-chip"
              aria-label={`Remove ${collection.name}`}
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </button>
          </div>
        </>
      )}
      {error && <div className="ri-save-err">{error}</div>}
    </div>
  );
}
