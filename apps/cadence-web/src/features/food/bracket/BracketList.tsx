/**
 * The bracket grammar, drawn (docs/cadence/MEAL-LOGGING.md — one mark, learned once, drawn
 * identically in the meal, the diary, the cookbook, and coach proposals):
 *
 *   • open part: name pill at the head, member rows indented beneath, the bracket down the left;
 *   • collapsed part: one row — "Chia bowl · 4 things · 348" with a ⌄ (canvas A4);
 *   • loose item: no bracket, no indent — a dormant notch in the gutter;
 *   • yield rides the same mark: green = one portion, butter = makes several, and the collapsed
 *     row reads "1 of 4 servings" with no new row type.
 *
 * Row CONTENT comes from `renderRow` — the meal screen and the diary inject their own — and all
 * gesture/menu wiring is optional: without it this is an inert read, which is the diary.
 */
import type { ReactNode } from 'react';
import type { MealItem, MealPart } from '@cadence/shared';
import { collapsedSub, makesSeveral, orderedRows, partLabel, partTotal } from './partModel.ts';
import { fmtKcal } from './copy.ts';
import type { BracketGestures } from './useBracketGestures.ts';

export interface BracketListProps {
  items: MealItem[];
  parts: MealPart[];
  renderRow: (item: MealItem, index: number) => ReactNode;
  /** Collapsed state per part key. Absent key = open. */
  collapsed?: Record<string, boolean>;
  onToggleCollapse?: (partKey: string) => void;
  /** The part's ⋯ — opens PartMenu. Absent = no ⋯ drawn. */
  onOpenMenu?: (partKey: string) => void;
  /** From useBracketGestures. Absent = the list is inert. */
  gestures?: BracketGestures;
}

function OpenPart({
  part,
  memberIndexes,
  rowIdx,
  props,
}: {
  part: MealPart;
  memberIndexes: number[];
  rowIdx: number;
  props: BracketListProps;
}) {
  const { items, renderRow, onToggleCollapse, onOpenMenu, gestures } = props;
  const label = partLabel(part, memberIndexes.length);
  const total = partTotal(items, part.key);
  const drag = gestures?.drag;
  const joining = drag?.kind === 'join' && drag.partKey === part.key;
  const resizing = drag?.kind === 'resize' && drag.partKey === part.key;
  return (
    <div
      className={`mb-block mb-part${makesSeveral(part) ? ' mb-part--yield' : ''}${joining ? ' mb-part--joining' : ''}`}
      ref={gestures?.registerRow(rowIdx)}
    >
      <div className="mb-rail" />
      {gestures?.enabled.resize && (
        <>
          <button type="button" className="mb-end mb-end--head" aria-label={`Resize ${label} from the top`} {...gestures.endProps(part.key, 'head')} />
          <button type="button" className="mb-end mb-end--tail" aria-label={`Resize ${label} from the bottom`} {...gestures.endProps(part.key, 'tail')} />
        </>
      )}
      <div className="mb-part-body">
        <div className="mb-head">
          <span className="mb-pill">{label}</span>
          <span className="mb-head-kcal">{fmtKcal(total.kcal)} kcal</span>
          <span className="mb-head-space" />
          {onToggleCollapse && (
            <button type="button" className="mb-ctrl" aria-label={`Collapse ${label}`} onClick={() => onToggleCollapse(part.key)}>
              ⌃
            </button>
          )}
          {onOpenMenu && (
            <button type="button" className="mb-ctrl" aria-label={`More for ${label}`} onClick={() => onOpenMenu(part.key)}>
              ⋯
            </button>
          )}
        </div>
        <div className="mb-card">
          {memberIndexes.map((i, n) => {
            const item = items[i];
            if (!item) return null;
            const leaving = drag?.kind === 'leave' && drag.index === i;
            const removing = resizing && drag.kind === 'resize' && drag.remove.includes(i);
            return (
              <div
                key={i}
                ref={gestures?.registerMember(i)}
                className={`mb-member${n > 0 ? ' mb-member--rule' : ''}${leaving ? ' mb-member--leaving' : ''}${removing ? ' mb-member--removing' : ''}`}
                style={leaving && drag.kind === 'leave' ? { transform: `translateX(${Math.max(drag.dx, -96)}px)` } : undefined}
                {...gestures?.memberProps(part.key, i)}
              >
                {renderRow(item, i)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CollapsedPart({
  part,
  memberIndexes,
  props,
}: {
  part: MealPart;
  memberIndexes: number[];
  props: BracketListProps;
}) {
  const { items, onToggleCollapse } = props;
  const label = partLabel(part, memberIndexes.length);
  const total = partTotal(items, part.key);
  return (
    <div className={`mb-block mb-collapsed${makesSeveral(part) ? ' mb-part--yield' : ''}`}>
      <div className="mb-rail mb-rail--short" />
      <button type="button" className="mb-collapsed-row" aria-label={`Expand ${label}`} onClick={() => onToggleCollapse?.(part.key)}>
        <span className="mb-collapsed-main">
          <span className="mb-collapsed-name">{label}</span>
          <span className="mb-collapsed-sub">{collapsedSub(part, memberIndexes.length)}</span>
        </span>
        <span className="mb-collapsed-kcal">{fmtKcal(total.kcal)}</span>
        <span className="mb-chevron">⌄</span>
      </button>
    </div>
  );
}

function LooseRow({ item, index, rowIdx, props }: { item: MealItem; index: number; rowIdx: number; props: BracketListProps }) {
  const { renderRow, gestures } = props;
  const drag = gestures?.drag;
  const taken = drag?.kind === 'group' && drag.itemIndexes.includes(index);
  const joining = drag?.kind === 'join' && drag.index === index;
  const adding = drag?.kind === 'resize' && drag.add.includes(index);
  const notch = <span className={`mb-notch${taken || adding ? ' mb-notch--taken' : ''}`} />;
  return (
    <div className="mb-block mb-loose-block" ref={gestures?.registerRow(rowIdx)}>
      <div className="mb-gutter">
        {gestures?.enabled.group ? (
          <button type="button" className="mb-notch-handle" aria-label={`Pull down to bring ${item.name} together with other rows`} {...gestures.notchProps(rowIdx, index)}>
            {notch}
          </button>
        ) : (
          notch
        )}
      </div>
      <div
        className={`mb-card mb-loose${taken || adding ? ' mb-loose--taken' : ''}${joining ? ' mb-loose--joining' : ''}`}
        style={joining && drag.kind === 'join' ? { transform: `translateX(${Math.min(drag.dx, 24)}px)` } : undefined}
        {...gestures?.rowProps(rowIdx, index)}
      >
        {renderRow(item, index)}
      </div>
    </div>
  );
}

export function BracketList(props: BracketListProps) {
  const { items, parts, collapsed, gestures } = props;
  const rows = orderedRows(items, parts);
  const drag = gestures?.drag;
  return (
    <div className="mb-list">
      {rows.map((row, rowIdx) => {
        if (row.kind === 'item') {
          return <LooseRow key={`i${row.index}`} item={row.item} index={row.index} rowIdx={rowIdx} props={props} />;
        }
        const block = collapsed?.[row.part.key] ? (
          <CollapsedPart key={row.part.key} part={row.part} memberIndexes={row.memberIndexes} props={props} />
        ) : (
          <OpenPart key={row.part.key} part={row.part} memberIndexes={row.memberIndexes} rowIdx={rowIdx} props={props} />
        );
        /* Where a member dragged out will land (canvas A2): a dashed gutter under its bracket. */
        const showDrop = drag?.kind === 'leave' && drag.partKey === row.part.key && drag.past;
        return showDrop ? (
          <div key={row.part.key} className="mb-drop-wrap">
            {block}
            <div className="mb-block">
              <div className="mb-gutter" />
              <div className="mb-drop-hint">{'DROPS HERE · ON ITS OWN'}</div>
            </div>
          </div>
        ) : (
          block
        );
      })}
    </div>
  );
}
