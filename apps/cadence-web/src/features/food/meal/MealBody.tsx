/**
 * The meal's body (canvas 1b B2): the draft's rows drawn in the bracket grammar, with the full
 * gesture set and every gesture's boring twin behind each part's ⋯. Row content is the
 * amounts idiom (MealDraftRow); the B3 offer surfaces inline at the bottom after several
 * quick adds — a preview of the mark, not a dialog.
 */
import { useMemo, useState } from 'react';
import { BracketList } from '../bracket/BracketList.tsx';
import { NamePartCard } from '../bracket/NamePartCard.tsx';
import { PartMenu } from '../bracket/PartMenu.tsx';
import { SelectMode } from '../bracket/SelectMode.tsx';
import { membersOf, looseItems, orderedRows, partLabel, partTotal } from '../bracket/partModel.ts';
import { useBracketGestures } from '../bracket/useBracketGestures.ts';
import { nameChips } from './nameChips.ts';
import { MealDraftRow } from './MealDraftRow.tsx';
import type { MealDraft } from './useMealDraft.ts';

type Picker =
  | { kind: 'menu'; part: string }
  | { kind: 'select'; mode: 'group' | 'takeOut'; part?: string }
  | { kind: 'name'; part: string };

export function MealBody({
  draft,
  offerVisible,
  onOfferAccept,
  onOfferDecline,
  onAddAnother,
}: {
  draft: MealDraft;
  offerVisible: boolean;
  onOfferAccept: (name: string | null) => void;
  onOfferDecline: () => void;
  onAddAnother: () => void;
}) {
  const { items } = draft;
  const parts = useMemo(() => draft.meal?.parts ?? [], [draft.meal]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [picker, setPicker] = useState<Picker | null>(null);
  const [offerName, setOfferName] = useState<string | null>(null);

  const rows = useMemo(() => orderedRows(items, parts), [items, parts]);
  const gestures = useBracketGestures(rows, {
    onGroup: (indexes) => draft.editParts({ op: 'group', item_indexes: indexes }),
    onAddToPart: (partKey, index) => draft.editParts({ op: 'add', part: partKey, index }),
    onRemoveFromPart: (partKey, index) => draft.editParts({ op: 'remove', part: partKey, index }),
    onLongPress: () => setPicker({ kind: 'select', mode: 'group' }),
  });

  const menuPart = picker?.kind === 'menu' ? parts.find((p) => p.key === picker.part) : null;
  const namePart = picker?.kind === 'name' ? parts.find((p) => p.key === picker.part) : null;
  const loose = looseItems(items, parts);

  return (
    <div className="ms-body">
      <BracketList
        items={items}
        parts={parts}
        collapsed={collapsed}
        onToggleCollapse={(key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
        onOpenMenu={(key) => setPicker({ kind: 'menu', part: key })}
        gestures={gestures}
        renderRow={(item, index) => (
          <MealDraftRow
            item={item}
            index={index}
            tag={draft.provenance(index)}
            busy={draft.busy}
            onQty={draft.setAmount}
            onRemove={(i) => void draft.removeItem(i)}
          />
        )}
      />
      <button type="button" className="ms-add-another" onClick={onAddAnother}>
        <span className="ms-add-plus" aria-hidden="true">
          ＋
        </span>
        <b>Add another thing</b>
        <span>search · say · scan</span>
      </button>
      {offerVisible && (
        <NamePartCard
          variant="offer"
          count={items.length}
          est={draft.total}
          chips={nameChips(
            draft.rawTexts,
            items.map((i) => i.name),
          )}
          previewNames={items.map((i) => i.name.split(/[,·(]/)[0]!.trim().split(/\s+/)[0]!.toLowerCase())}
          onName={setOfferName}
          onYield={() => {}}
          onSave={() => onOfferAccept(offerName)}
          onCancel={onOfferDecline}
        />
      )}
      {menuPart && (
        <PartMenu
          label={partLabel(menuPart, membersOf(items, menuPart.key).length)}
          memberCount={membersOf(items, menuPart.key).length}
          kcal={partTotal(items, menuPart.key).kcal}
          several={(menuPart.yield_servings ?? 1) > 1}
          inCookbook={!!menuPart.recipe_id}
          mealKcal={draft.total.kcal}
          readsNow={rows.length}
          onRename={() => setPicker({ kind: 'name', part: menuPart.key })}
          onAddTo={() => {
            setPicker(null);
            onAddAnother();
          }}
          onTakeOut={() => setPicker({ kind: 'select', mode: 'takeOut', part: menuPart.key })}
          onUngroup={() => {
            draft.editParts({ op: 'ungroup', part: menuPart.key });
            setPicker(null);
          }}
          onYield={() => setPicker({ kind: 'name', part: menuPart.key })}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === 'select' && (
        <SelectMode
          mode={picker.mode}
          items={items}
          eligible={picker.mode === 'group' ? loose : picker.part ? membersOf(items, picker.part) : []}
          mealName={draft.meal?.meal}
          partLabel={
            picker.mode === 'takeOut' && picker.part
              ? (draft.meal?.parts?.find((p) => p.key === picker.part)?.name ?? undefined)
              : undefined
          }
          onConfirm={(indexes) => {
            if (picker.mode === 'group') draft.editParts({ op: 'group', item_indexes: indexes });
            else if (picker.part)
              for (const i of indexes) draft.editParts({ op: 'remove', part: picker.part, index: i });
            setPicker(null);
          }}
          onCancel={() => setPicker(null)}
        />
      )}
      {namePart && (
        <PartNameFlow
          draft={draft}
          partKey={namePart.key}
          initialName={namePart.name ?? undefined}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** Rename / yield for one bracket — the ⋯'s certain path, no cookbook write. */
function PartNameFlow({
  draft,
  partKey,
  initialName,
  onClose,
}: {
  draft: MealDraft;
  partKey: string;
  initialName?: string;
  onClose: () => void;
}) {
  const members = membersOf(draft.items, partKey);
  const [name, setName] = useState<string | null>(initialName ?? null);
  const [servings, setServings] = useState(1);
  return (
    <div className="ms-sheet-backdrop" onClick={onClose}>
      <div className="ms-sheet" role="dialog" aria-label="Name this" onClick={(e) => e.stopPropagation()}>
        <NamePartCard
          count={members.length}
          est={partTotal(draft.items, partKey)}
          chips={nameChips(
            draft.rawTexts,
            members.map((i) => draft.items[i]?.name ?? ''),
          )}
          initialName={initialName}
          onName={setName}
          onYield={setServings}
          onSave={() => {
            draft.editParts({ op: 'rename', part: partKey, name: name ?? '' });
            if (servings > 1) draft.editParts({ op: 'set_yield', part: partKey, yield_servings: servings });
            onClose();
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
