import { useEffect, useRef, useState } from 'react';
import type { UserConstraint } from '../../lib/api.ts';

/**
 * One thing we work around, with its wording in the hands of the person it describes.
 *
 * The Broker writes these labels out of conversation, and it sometimes writes an instruction where
 * a fact belongs — "ramp gently because of tendinitis" is a coaching note wearing a constraint's
 * clothes, and it then shapes every plan that reads it. Asked repeatedly to fix that wording, the
 * coach agreed repeatedly and nothing changed. Owner: *"so we miss the promise on 'fix the
 * wording'."*
 *
 * The coach can reword one now too. This is the path that cannot fail quietly: a sentence about
 * someone's body is theirs, and changing it should not require persuading a model.
 */
export function ConstraintRow({
  constraint: c,
  busy,
  onRename,
  onRemove,
}: {
  constraint: UserConstraint;
  busy: boolean;
  onRename: (label: string) => Promise<void>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.label);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function open() {
    setDraft(c.label);
    setEditing(true);
  }

  async function save() {
    const next = draft.trim();
    // Nothing to say and nothing to save — an empty label would leave a row nobody can identify.
    if (!next || next === c.label) return void setEditing(false);
    await onRename(next);
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="cons-row cons-row-edit">
        <input
          ref={input}
          className="cons-input"
          value={draft}
          maxLength={120}
          disabled={busy}
          aria-label={`Wording for ${c.label}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <button className="cons-save" onClick={() => void save()} disabled={busy}>
          {busy ? '…' : 'Save'}
        </button>
        <button className="cons-drop" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li className="cons-row">
      <span className="cons-what">
        <b>{c.label}</b>
        <span>
          {/* `plan_around` is the one that actually changes the plan, so it leads. Status is how it
              is doing; a quiet constraint is still planned around until it is not. */}
          {c.plan_around === false ? 'not planned around' : 'planned around'}
          {c.status ? ` · ${c.status}` : ''}
        </span>
      </span>
      <button className="cons-drop" onClick={open} disabled={busy} aria-label={`Reword ${c.label}`}>
        Reword
      </button>
      <button className="cons-drop" onClick={onRemove} disabled={busy} aria-label={`Remove ${c.label}`}>
        {busy ? '…' : 'Remove'}
      </button>
    </li>
  );
}
