import { useState } from 'react';
import type { Equipment, EquipmentCategory } from '@cadence/shared';
import { addEquipment, deleteEquipmentItem } from '../../lib/api.ts';
import '../../styles/settings-editors.css';

/**
 * The review flow's Tools step, rebuilt on the Settings Room's chip grid (design 1b, the same
 * ruling that killed the settings wizard: no category picker anywhere a USER picks one — the
 * store categorises, the user just names things). Same live-write behavior the old step had:
 * every chip removal and add hits the API immediately; `setEquip` keeps the wizard's local list
 * in step. Renaming left with the category select — a mis-named tool is remove + retype, which
 * is the chip grammar's own verb.
 */

const DEFAULT_CATEGORY: EquipmentCategory = 'other';

type Props = {
  equipment: Equipment[];
  setEquip: (equipment: Equipment[]) => void;
};

export function GearStep({ equipment, setEquip }: Props) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const created = await addEquipment({ name, category: DEFAULT_CATEGORY });
      setEquip([...equipment, created]);
      setDraft('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wiz-list">
      <div className="screen-sub">
        {"What you're working with — a barbell, a journal, running shoes. Remove anything that's gone, add what's missing."}
      </div>
      {equipment.length === 0 && <div className="wiz-empty">No tools noted yet.</div>}
      {equipment.length > 0 && (
        <div className="se-chips">
          {equipment.map((eq) => (
            <span className="se-chip" key={eq.equipment_id}>
              {eq.name}
              <button
                type="button"
                className="se-chip-x se-chip-x-warm"
                onClick={() => {
                  setEquip(equipment.filter((x) => x.equipment_id !== eq.equipment_id));
                  void deleteEquipmentItem(eq.equipment_id);
                }}
                aria-label={`Remove ${eq.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="se-add-row">
        <input
          className="wiz-in"
          value={draft}
          placeholder='e.g. "kettlebell"'
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button type="button" className="se-add-btn" disabled={busy || !draft.trim()} onClick={() => void add()}>
          Add
        </button>
      </div>
      <div className="se-note">
        {'You don’t file these under anything — that’s my job. “Kettlebell” and “the park pull-up bar” both just go on the list.'}
      </div>
    </div>
  );
}
