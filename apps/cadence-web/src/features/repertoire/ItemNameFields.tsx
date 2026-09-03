import { useState } from 'react';
import type { RepertoireCollection, RepertoireItem } from '@cadence/shared';
import { DESCRIPTION_MAX } from '@cadence/shared';
import { patchRepertoireItem, type RepertoireItemPatch } from '../../lib/api/repertoire-item.ts';
import { FIELD_HINTS } from './itemFieldCopy.ts';
import { CollectionPicker } from './CollectionPicker.tsx';

export interface ItemNameFieldsProps {
  itemId: string;
  initialLabel: string;
  initialComposer: string;
  /** The collection this item is in, by id (migration 0056), or null for none. */
  initialCollectionId: string | null;
  /** Its name — used only to keep it in the picker when a stale read did not carry the row. */
  initialCollectionName: string | null;
  /** Their own words for WHICH ONE this is — free text, and the field that replaced the
   *  music-only catalogue number (owner ruling 2026-09-03). */
  initialDescription: string;
  /** How the work is going — editable for every kind, unlike the tempo line, which stays read-only
   *  music-only history. */
  initialNote: string;
  /** Every collection this person has, most-used first, from the list read. The field offers these
   *  rather than a free-text box: a collection only groups if it is one group. */
  collections: RepertoireCollection[];
  /** Opens the collections screen from the picker's "Manage collections…" entry. */
  onManageCollections?: () => void;
  /** Called with the fresh row once the server confirms the save. */
  onSaved: (item: RepertoireItem) => void;
}

/**
 * HOW YOU NAME IT — Name, By, Collection, Description, Notes, then "Save the name".
 *
 * Rename is the whole point of this section: identity is the row (`item_id`), never the label, so
 * nothing typed here can lose a session, a settled tempo, or a date — the sentence under the fields
 * says so in the coach's own words.
 *
 * Every TEXT field is set-only, never cleared back to blank: the repo merges `meta` with jsonb `||`
 * (`updateRepertoireItem`), which has no way to remove a key — only overwrite it. A blank field is
 * therefore left out of the request rather than sent as "". The Collection is the exception, and
 * for a reason that is not an inconsistency: it is a COLUMN, not a meta key, so it can be cleared,
 * and "in no collection" is a state the person can choose.
 *
 * TWO OWNER RULINGS SHAPE THIS SCREEN (2026-09-03):
 *
 *  - **No hint may narrow the field to one domain.** *"'bars 9-16' means absolutely nothing to a
 *    karateka trying to enter heian shodan in the app. This is a multi-purpose list screen. Stop
 *    narrowing the focus."* So each hint says what the field is FOR, in plain words, and lists no
 *    examples. The strings live in `itemFieldCopy.ts` so the screen and its tests read one copy.
 *  - **A collection is chosen, not typed.** *"A collection only works if it's not free-text"* —
 *    grouping by a typed string drifts, so the control is a picker over the collections this person
 *    has, and it picks an id (`CollectionPicker.tsx`, migration 0056). The spelling guard that used
 *    to hold this together is gone with the free text: a name is unique per person in the database
 *    now, so two spellings cannot become two groups however they are written.
 */
export function ItemNameFields({
  itemId,
  initialLabel,
  initialComposer,
  initialCollectionId,
  initialCollectionName,
  initialDescription,
  initialNote,
  collections,
  onManageCollections,
  onSaved,
}: ItemNameFieldsProps) {
  const [label, setLabel] = useState(initialLabel);
  const [composer, setComposer] = useState(initialComposer);
  const [description, setDescription] = useState(initialDescription);
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [collectionId, setCollectionId] = useState<string | null>(initialCollectionId);

  const canSave = label.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    // `collection_id` is sent EVERY time, unlike the text fields: null is a real value here — it
    // means "in no collection" — so leaving it out would make None unsavable. jsonb `||` cannot
    // remove a key, which is why the text fields have to be omitted instead of blanked; a column
    // has no such problem.
    const patch: RepertoireItemPatch = { label: label.trim(), collection_id: collectionId };
    if (composer.trim()) patch.composer = composer.trim();
    if (description.trim()) patch.description = description.trim();
    if (note.trim()) patch.note = note.trim();
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
          By
        </label>
        <input
          id="ri-composer"
          className="ri-input"
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          maxLength={120}
        />
        <p className="ri-hint">{FIELD_HINTS.composer}</p>
      </div>
      <CollectionPicker
        collections={collections}
        value={collectionId}
        valueName={initialCollectionName}
        onChange={setCollectionId}
        onManage={onManageCollections}
      />
      <div className="ri-field">
        <label className="ri-label" htmlFor="ri-description">
          Description (optional)
        </label>
        <textarea
          id="ri-description"
          className="ri-input"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DESCRIPTION_MAX}
        />
        <p className="ri-hint">{FIELD_HINTS.description}</p>
      </div>
      <div className="ri-field">
        <label className="ri-label" htmlFor="ri-note">
          Notes (optional)
        </label>
        <input
          id="ri-note"
          className="ri-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={120}
        />
        <p className="ri-hint">{FIELD_HINTS.note}</p>
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
