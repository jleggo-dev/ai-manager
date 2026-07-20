import type { Equipment, EquipmentCategory } from '@cadence/shared';
import { addEquipment, deleteEquipmentItem, updateEquipment } from '../../lib/api.ts';
import { EQUIP_CATS, EQUIP_LABELS } from './reviewConstants.ts';
import { TrashIcon } from './TrashIcon.tsx';

type Props = {
  equipment: Equipment[];
  setEquip: (equipment: Equipment[]) => void;
};

export function GearStep({ equipment, setEquip }: Props) {
  return (
    <div className="wiz-list">
      <div className="screen-sub">
        What you're working with — a barbell, a journal, running shoes. Remove anything wrong, add what's missing.
      </div>
      {equipment.length === 0 && <div className="wiz-empty">No tools noted yet.</div>}
      {equipment.map((eq) => (
        <div className="wiz-card wiz-card-tight" key={eq.equipment_id}>
          <div className="wiz-row">
            <input
              className="wiz-in"
              value={eq.name}
              onChange={(e) =>
                setEquip(
                  equipment.map((x) => (x.equipment_id === eq.equipment_id ? { ...x, name: e.target.value } : x)),
                )
              }
              onBlur={(e) => updateEquipment(eq.equipment_id, { name: e.target.value })}
            />
            <select
              className="wiz-sel"
              value={eq.category}
              onChange={(e) => {
                const category = e.target.value as EquipmentCategory;
                setEquip(equipment.map((x) => (x.equipment_id === eq.equipment_id ? { ...x, category } : x)));
                updateEquipment(eq.equipment_id, { category });
              }}
            >
              {EQUIP_CATS.map((c) => (
                <option key={c} value={c}>
                  {EQUIP_LABELS[c]}
                </option>
              ))}
            </select>
            <button
              className="wiz-del"
              onClick={() => {
                setEquip(equipment.filter((x) => x.equipment_id !== eq.equipment_id));
                deleteEquipmentItem(eq.equipment_id);
              }}
              aria-label="Remove"
            >
              <TrashIcon />
            </button>
          </div>
        </div>
      ))}
      <button
        className="wiz-add"
        onClick={async () => {
          const e = await addEquipment({ name: 'New item', category: 'other' });
          setEquip([...equipment, e]);
        }}
      >
        + Add a tool
      </button>
    </div>
  );
}
