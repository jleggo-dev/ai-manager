import type { Equipment, EquipmentCategory } from '@cadence/shared';
import { deleteEquipment, insertEquipment, listEquipment, updateEquipment } from '../repos/equipment.ts';
import { sameEquipmentName } from './fact-tokens.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `update_equipment` — the WRITE half of what they own. The read half (get_equipment) rides the
 * mandatory context pack; until 2026-08-31 there was no write half at all, and the coach spent a
 * session searching find_tools seven times ("equipment update correct", "edit equipment weight
 * correct dumbbell update inventory", …) for a tool that did not exist, told the owner "let me
 * get that corrected on your file", and the file kept saying 50lb after he had said 25.
 *
 * Ambient capture still adds gear people mention in passing; this tool exists for the moments the
 * capture path cannot serve — a correction ("they're 25lb, not 50"), a removal ("sold the
 * treadmill"), a deliberate add mid-plan-talk. Tail tier by default (owner ruling 2026-08-30:
 * accuracy comes from the drawer, not promotion) with a DRAWER_HOOKS line so she can find it.
 *
 * Same verification contract as update_constraint: every return describes a FRESH READ of the
 * file, never the write's intent.
 */

const CATEGORIES: EquipmentCategory[] = [
  'footwear',
  'cardio',
  'strength',
  'accessory',
  'reading',
  'practice',
  'craft',
  'study',
  'other',
];

/** Every stored row whose name is the same item as `name` — duplicates included on purpose:
 *  acting on "the dumbbells" must cover a twin the older matcher let in. */
function matching(rows: Equipment[], name: string): Equipment[] {
  return rows.filter((r) => sameEquipmentName(r.name, name));
}

export const UPDATE_EQUIPMENT: CoachActionTool = {
  name: 'update_equipment',
  description:
    'Change what equipment is on their file — what they own to train, practice, or study with. Takes effect immediately. Use add when they got something new mid-conversation and you need it on file NOW (mentioning gear in passing is captured automatically — do not add what you merely heard); remove when they no longer have it or it was recorded wrongly; reword (with new_label) when the item is right but the name is wrong — "2x50lb dumbbells" when they actually own 25s. Read get_equipment first and name the item as listed. Pass {"item": "2x50lb dumbbells", "action": "reword", "new_label": "2x25lb dumbbells"}; {"item": "rowing machine", "action": "add", "category": "cardio"}; {"item": "treadmill", "action": "remove"}.',
  parameters: {
    properties: {
      item: {
        type: 'string',
        description: 'Which item, by its name as get_equipment lists it (for add: the new name).',
      },
      action: {
        type: 'string',
        enum: ['add', 'remove', 'reword'],
        description:
          'add = new gear on file now; remove = gone or was never true; reword = same item, wrong name — give new_label.',
      },
      new_label: {
        type: 'string',
        description: 'Required for reword: what the item should be called instead — their words for it.',
      },
      category: {
        type: 'string',
        enum: CATEGORIES,
        description: 'For add: what kind of thing it is. Defaults to other.',
      },
    },
    required: ['item', 'action'],
  },
  async run(userId, params) {
    const item = String(params.item ?? '').trim();
    const action = String(params.action ?? '');
    if (!item) return 'No item was named, so nothing changed. Ask which piece of equipment they mean.';

    const rows = await listEquipment(userId);
    const hits = matching(rows, item);

    if (action === 'add') {
      if (hits.length) {
        return `"${hits[0]!.name}" is already on their file — nothing was added. If the name is wrong, use reword; if they own a second one, add it under a name that tells the two apart ("second kettlebell, 24kg").`;
      }
      const category = CATEGORIES.includes(params.category as EquipmentCategory)
        ? (params.category as EquipmentCategory)
        : 'other';
      await insertEquipment(userId, { name: item, category, owned: true });
      const after = matching(await listEquipment(userId), item);
      return after.length
        ? `On file and verified: they own "${after[0]!.name}". Say it back in one line so they can correct you.`
        : `"${item}" is NOT on their file after that write — it did not take. Do not say it is done; say you could not save it just now.`;
    }

    if (action === 'remove') {
      if (!hits.length) {
        const names = rows.map((r) => r.name).join(', ') || 'none on file';
        return `Nothing on file matches "${item}", so nothing was removed. What they have: ${names}. Ask which they mean.`;
      }
      for (const h of hits) await deleteEquipment(userId, h.equipment_id);
      const still = matching(await listEquipment(userId), item);
      if (still.length) {
        return `"${item}" is STILL on their file — the removal did not take. Do NOT tell them it is gone; say you could not remove it just now.`;
      }
      return `Removed "${hits.map((h) => h.name).join('", "')}" — verified gone from their file. Say so briefly and move on.`;
    }

    if (action === 'reword') {
      const next = String(params.new_label ?? '').trim();
      if (!next) return `No new wording was given, so "${item}" is unchanged. Ask what it should be called instead.`;
      if (!hits.length) {
        const names = rows.map((r) => r.name).join(', ') || 'none on file';
        return `Nothing on file matches "${item}", so nothing was reworded. What they have: ${names}. Ask which they mean.`;
      }
      // The first match takes the new name; a twin the older matcher let in would now COLLIDE
      // with it, so the rest are removed rather than left as stale duplicates of the fresh name.
      const [keep, ...dupes] = hits;
      await updateEquipment(userId, keep!.equipment_id, { name: next });
      for (const d of dupes) await deleteEquipment(userId, d.equipment_id);
      const after = await listEquipment(userId);
      const landed = after.some((r) => r.name.trim() === next);
      return landed
        ? `Reworded and verified: "${keep!.name}" now reads "${next}" on their file${dupes.length ? ` (${dupes.length} duplicate row${dupes.length > 1 ? 's' : ''} of it folded in)` : ''}. Say it back in one line so they can correct you.`
        : `"${item}" did NOT get reworded — the change did not take. Do not say it is fixed; say you could not save it just now.`;
    }

    return `"${action}" is not something this tool does. The actions are: add, remove, reword.`;
  },
};
