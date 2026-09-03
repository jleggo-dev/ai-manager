import { useState } from 'react';
import type { RepertoireItem } from '@cadence/shared';
import { DESCRIPTION_MAX } from '@cadence/shared';
import { patchRepertoireItem, type RepertoireItemPatch } from '../../lib/api/repertoire-item.ts';
import { ADD_A_COLLECTION, FIELD_HINTS, NO_COLLECTION } from './itemFieldCopy.ts';

export interface ItemNameFieldsProps {
  itemId: string;
  initialLabel: string;
  initialComposer: string;
  initialCollection: string;
  /** Their own words for WHICH ONE this is — free text, and the field that replaced the
   *  music-only catalogue number (owner ruling 2026-09-03). */
  initialDescription: string;
  /** How the work is going — editable for every kind, unlike the tempo line, which stays read-only
   *  music-only history. */
  initialNote: string;
  /** Collections already in use on this person's shelf, most-used first, from the list read. The
   *  field offers these rather than a free-text box: a collection only groups if it is one group. */
  collections: string[];
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
 * Every field is set-only, never cleared back to blank: the repo merges `meta` with jsonb `||`
 * (`updateRepertoireItem`), which has no way to remove a key — only overwrite it. A blank field is
 * therefore left out of the request rather than sent as "".
 *
 * TWO OWNER RULINGS SHAPE THIS SCREEN (2026-09-03):
 *
 *  - **No hint may narrow the field to one domain.** *"'bars 9-16' means absolutely nothing to a
 *    karateka trying to enter heian shodan in the app. This is a multi-purpose list screen. Stop
 *    narrowing the focus."* So each hint says what the field is FOR, in plain words, and lists no
 *    examples. The strings live in `itemFieldCopy.ts` so the screen and its tests read one copy.
 *  - **A collection is chosen, not typed.** *"A collection only works if it's not free-text"* —
 *    grouping by a typed string drifts, so this is a select over what is already on the shelf, with
 *    one option to add a new name. A name typed anyway is folded onto an existing spelling by the
 *    server (`collapseCollection`), which is the guard for the case this control cannot cover: the
 *    coach and the seed write collections too.
 */
export function ItemNameFields({
  itemId,
  initialLabel,
  initialComposer,
  initialCollection,
  initialDescription,
  initialNote,
  collections,
  onSaved,
}: ItemNameFieldsProps) {
  const [label, setLabel] = useState(initialLabel);
  const [composer, setComposer] = useState(initialComposer);
  const [description, setDescription] = useState(initialDescription);
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // The item's own collection always appears in the list, even when it is the only row carrying it
  // and a goal-scoped read did not return it — a select that silently drops the value it was given
  // would look like the person had never chosen one.
  const options =
    collections.includes(initialCollection) || !initialCollection ? collections : [initialCollection, ...collections];
  const [choice, setChoice] = useState(initialCollection || NO_COLLECTION);
  const [typed, setTyped] = useState('');
  const adding = choice === ADD_A_COLLECTION;
  const collection = adding ? typed : choice === NO_COLLECTION ? '' : choice;

  const canSave = label.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const patch: RepertoireItemPatch = { label: label.trim() };
    if (composer.trim()) patch.composer = composer.trim();
    if (collection.trim()) patch.collection = collection.trim();
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
      <div className="ri-field">
        <label className="ri-label" htmlFor="ri-collection">
          Collection
        </label>
        <select id="ri-collection" className="ri-input" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value={NO_COLLECTION}>{NO_COLLECTION}</option>
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={ADD_A_COLLECTION}>{ADD_A_COLLECTION}</option>
        </select>
        {adding && (
          <input
            id="ri-collection-new"
            className="ri-input"
            aria-label={ADD_A_COLLECTION}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={120}
          />
        )}
        <p className="ri-hint">{FIELD_HINTS.collection}</p>
      </div>
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
