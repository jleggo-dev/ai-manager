import { useState } from 'react';
import type { RepertoireCollection } from '@cadence/shared';
import { addCollection } from '../../lib/api/repertoire-collections.ts';
import { ADD_A_COLLECTION, FIELD_HINTS, NO_COLLECTION } from './itemFieldCopy.ts';
import { COLLECTION_NAME_HINT, COLLECTION_NAME_LABEL, MANAGE_COLLECTIONS } from './collectionsCopy.ts';

export interface CollectionPickerProps {
  /** Every collection this person has, most-used first, as the server ordered them. */
  collections: RepertoireCollection[];
  /** The collection this item is in, by id, or null for none. */
  value: string | null;
  /** Its name, used only to keep it in the list when a stale read did not carry it. */
  valueName: string | null;
  /** Reports the id to save — a real id, or null for "in no collection". */
  onChange: (collectionId: string | null) => void;
  /** Opens the collections screen. Omitted, "Manage collections…" is not offered at all — there is
   *  nowhere for it to go. */
  onManage?: () => void;
}

/**
 * The Collection control — a picker over the person's collections, never a text box (owner ruling
 * 2026-09-03: *"a collection only works if it's not free-text"*).
 *
 * It picks an ID, not a name (migration 0056). That is the whole difference from the version this
 * replaced: a name had to be matched by spelling, so "Suzuki Book 2", "Suzuki book 2" and "suzuki
 * bk 2" were three groups where the person meant one, and nothing on any screen ever showed them
 * that. An id cannot drift, and renaming the collection renames it on every item at once.
 *
 * Own file because it is its own responsibility now: it reads a list, writes a new collection
 * through the API, and routes to a screen — none of which the name fields around it do.
 *
 * "Add a collection…" makes the collection IMMEDIATELY, before the item is saved, and selects it.
 * The alternative — carrying a typed name until the item's own save — would have to invent a
 * second way for a collection to come into existence, and a duplicate would surface as a failure
 * to save the item rather than as what it is. A duplicate name shows the server's own sentence,
 * which names the spelling already on file, so the person can pick that one instead.
 */
export function CollectionPicker({ collections, value, valueName, onChange, onManage }: CollectionPickerProps) {
  const [typed, setTyped] = useState('');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<RepertoireCollection[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The item's own collection always appears, even when the list read did not carry it — a picker
  // that silently drops the value it was given would read as "you never chose one".
  const known = [...collections, ...added];
  const options =
    value && !known.some((c) => c.collection_id === value)
      ? [{ collection_id: value, name: valueName ?? '', item_count: 0 }, ...known]
      : known;

  const choice = adding ? ADD_A_COLLECTION : (value ?? NO_COLLECTION);

  function choose(next: string) {
    setError('');
    if (next === MANAGE_COLLECTIONS) return void onManage?.();
    if (next === ADD_A_COLLECTION) return void setAdding(true);
    setAdding(false);
    onChange(next === NO_COLLECTION ? null : next);
  }

  async function add() {
    const name = typed.trim();
    if (!name || busy) return;
    setBusy(true);
    setError('');
    const res = await addCollection(name);
    setBusy(false);
    if (!res.ok) return void setError(res.fault);
    setAdded((prev) => [...prev, res.collection]);
    setTyped('');
    setAdding(false);
    onChange(res.collection.collection_id);
  }

  return (
    <div className="ri-field">
      <label className="ri-label" htmlFor="ri-collection">
        Collection
      </label>
      <select id="ri-collection" className="ri-input" value={choice} onChange={(e) => choose(e.target.value)}>
        <option value={NO_COLLECTION}>{NO_COLLECTION}</option>
        {options.map((c) => (
          <option key={c.collection_id} value={c.collection_id}>
            {c.name}
          </option>
        ))}
        <option value={ADD_A_COLLECTION}>{ADD_A_COLLECTION}</option>
        {onManage && <option value={MANAGE_COLLECTIONS}>{MANAGE_COLLECTIONS}</option>}
      </select>
      {adding && (
        <div className="ri-add-collection">
          <label className="ri-label" htmlFor="ri-collection-new">
            {COLLECTION_NAME_LABEL}
          </label>
          <input
            id="ri-collection-new"
            className="ri-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            maxLength={120}
          />
          <p className="ri-hint">{COLLECTION_NAME_HINT}</p>
          <button type="button" className="detour-chip" disabled={!typed.trim() || busy} onClick={() => void add()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}
      {error && <div className="ri-save-err">{error}</div>}
      <p className="ri-hint">{FIELD_HINTS.collection}</p>
    </div>
  );
}
