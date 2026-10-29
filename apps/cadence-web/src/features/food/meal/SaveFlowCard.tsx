/**
 * "What do you call this?" over the meal's bracket — the ⋯ menu's save-as / rename. With a
 * name, saving and naming are the same act (savePartAsRecipe); renaming alone never touches
 * the cookbook — grouping is not saving. Yield rides the same card (canvas C3).
 */
import { useState } from 'react';
import { NamePartCard } from '../bracket/NamePartCard.tsx';
import { membersOf, partTotal } from '../bracket/partModel.ts';
import { nameChips } from './nameChips.ts';
import type { MealDraft } from './useMealDraft.ts';

export type SaveFlow = { part: string; to: 'meal' | 'recipe' | 'rename' };

export function SaveFlowCard({ draft, flow, onClose }: { draft: MealDraft; flow: SaveFlow; onClose: () => void }) {
  const [name, setName] = useState<string | null>(null);
  const [servings, setServings] = useState(1);
  const members = membersOf(draft.items, flow.part);
  const count = members.length || draft.items.length;
  return (
    <div className="ms-sheet-backdrop" onClick={onClose}>
      <div className="ms-sheet" role="dialog" aria-label="What do you call this?" onClick={(e) => e.stopPropagation()}>
        <NamePartCard
          count={count}
          est={members.length ? partTotal(draft.items, flow.part) : draft.total}
          chips={nameChips(
            draft.rawTexts,
            (members.length ? members : draft.items.map((_, i) => i)).map((i) => draft.items[i]?.name ?? ''),
          )}
          onName={setName}
          onYield={setServings}
          onSave={() => {
            if (flow.to !== 'rename' && name) {
              void draft.saveAs({ part: flow.part, name, yield_servings: servings });
            } else {
              draft.editParts({ op: 'rename', part: flow.part, name: name ?? '' });
              if (servings > 1) draft.editParts({ op: 'set_yield', part: flow.part, yield_servings: servings });
            }
            onClose();
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
