import { useState } from 'react';
import type { RepertoireItem } from '@cadence/shared';
import { patchRepertoireItem, type RepertoireItemPatch } from '../../lib/api/repertoire-item.ts';

export interface ItemNameFieldsProps {
  itemId: string;
  initialLabel: string;
  initialComposer: string;
  initialCollection: string;
  initialCatalogue: string;
  /** Called with the fresh row once the server confirms the save. */
  onSaved: (item: RepertoireItem) => void;
}

/**
 * HOW YOU NAME IT — NAME, COMPOSER, CATALOGUE NO. (optional), COLLECTION, plus the reassurance
 * sentence and "Save the name". Rename is the whole point of this parcel: identity is the row
 * (`item_id`), never the label, so nothing typed here can ever lose a session, a settled tempo,
 * or a date — the sentence under the fields says so in the coach's own words.
 *
 * Composer/collection/catalogue can only ever be SET here, never cleared back to blank: the repo
 * merges `meta` with jsonb `||` (repos/repertoire.ts's `updateRepertoireItem`, the same pattern
 * `setSettledTempo` uses), which has no way to remove a key — only overwrite it with another
 * value. A blank field is therefore simply left out of the request rather than sent as "".
 */
export function ItemNameFields({
  itemId,
  initialLabel,
  initialComposer,
  initialCollection,
  initialCatalogue,
  onSaved,
}: ItemNameFieldsProps) {
  const [label, setLabel] = useState(initialLabel);
  const [composer, setComposer] = useState(initialComposer);
  const [collection, setCollection] = useState(initialCollection);
  const [catalogue, setCatalogue] = useState(initialCatalogue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave = label.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const patch: RepertoireItemPatch = { label: label.trim() };
    if (composer.trim()) patch.composer = composer.trim();
    if (collection.trim()) patch.collection = collection.trim();
    if (catalogue.trim()) patch.catalogue = catalogue.trim();
    try {
      const saved = await patchRepertoireItem(itemId, patch);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save — try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pw-card">
      <div className="pw-sect">
        <span>How you name it</span>
      </div>
      <div className="ri-field">
        <label className="ri-label" htmlFor="ri-name">
          Name
        </label>
        <input
          id="ri-name"
          className="ri-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={120}
        />
      </div>
      <div className="ri-field">
        <label className="ri-label" htmlFor="ri-composer">
          Composer
        </label>
        <input
          id="ri-composer"
          className="ri-input"
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          maxLength={120}
        />
      </div>
      <div className="ri-field">
        <label className="ri-label" htmlFor="ri-catalogue">
          Catalogue no. (optional)
        </label>
        <input
          id="ri-catalogue"
          className="ri-input"
          value={catalogue}
          onChange={(e) => setCatalogue(e.target.value)}
          maxLength={120}
        />
      </div>
      <div className="ri-field">
        <label className="ri-label" htmlFor="ri-collection">
          Collection
        </label>
        <input
          id="ri-collection"
          className="ri-input"
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
          maxLength={120}
        />
      </div>
      <div className="pw-footer">
        Whatever you call it, it keeps its sessions, tempo and dates. Only the words change.
      </div>
      <button className="ri-save" disabled={!canSave} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save the name'}
      </button>
      {error && <div className="ri-save-err">{error}</div>}
    </div>
  );
}
