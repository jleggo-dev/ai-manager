/**
 * One of the list screen's four standing groups (P6 "the room"): a header naming the standing, its
 * count, and its own warm line (`GROUP_LINES`, the coach's voice — never `@cadence/shared`'s
 * `REPERTOIRE_GROUPS` header text, which is a prompt string written for the model); then its rows,
 * in the order `orderGroupItems` says this standing reads in; a title collision as a butter card
 * right under the row it is about; and, when this group holds material with no goal, a "NOT TIED
 * TO A GOAL" hairline ahead of those rows.
 *
 * Renders nothing for an empty group — the screen never shows a standing with nothing in it.
 */
import type { RepertoireItem, RepertoireStatus } from '@cadence/shared';
import type { RepertoireCollisionGroup } from '../../lib/api/repertoire-list.ts';
import { STANDING_WORDS } from './repertoireItemCopy.ts';
import { collisionPartnersFor, GROUP_LINES, orderGroupItems, splitUnattached } from './repertoireListCopy.ts';
import { RepertoireRow } from './RepertoireRow.tsx';
import { CollisionCard } from './CollisionCard.tsx';

export interface RepertoireGroupProps {
  status: RepertoireStatus;
  items: RepertoireItem[];
  collisions: RepertoireCollisionGroup[];
  onOpen: (item: RepertoireItem, collidesWithLabel: string | null) => void;
  onChangeStanding: (item: RepertoireItem, status: RepertoireStatus) => void;
  /** Present only so the Up next group can offer "Move up"/"Move down" — every other group omits
   *  it, and RepertoireRow renders no reorder control without it. */
  onMove?: (item: RepertoireItem, direction: 'up' | 'down') => void;
  now?: Date;
}

export function RepertoireGroup({
  status,
  items,
  collisions,
  onOpen,
  onChangeStanding,
  onMove,
  now,
}: RepertoireGroupProps) {
  if (items.length === 0) return null;

  const ordered = orderGroupItems(status, items);
  const indexOf = new Map(ordered.map((item, i) => [item.item_id, i] as const));
  const { linked, unattached } = splitUnattached(ordered);

  const row = (item: RepertoireItem) => {
    const partners = collisionPartnersFor(item.label, collisions);
    const i = indexOf.get(item.item_id) ?? 0;
    const canMove = status === 'queued' && Boolean(onMove);
    return (
      <div key={item.item_id} className="rl-row-slot">
        <RepertoireRow
          item={item}
          onOpen={() => onOpen(item, partners[0] ?? null)}
          onChangeStanding={(next) => onChangeStanding(item, next)}
          onMoveUp={canMove && i > 0 ? () => onMove!(item, 'up') : undefined}
          onMoveDown={canMove && i < ordered.length - 1 ? () => onMove!(item, 'down') : undefined}
          now={now}
        />
        {partners.length > 0 && (
          <CollisionCard
            label={item.label}
            otherLabels={partners}
            onNameApart={() => onOpen(item, partners[0] ?? null)}
          />
        )}
      </div>
    );
  };

  return (
    <section className="rl-group" aria-label={STANDING_WORDS[status]}>
      <header className="rl-group-head">
        <div className="rl-group-name">
          <span className="rl-group-name-word">{STANDING_WORDS[status]}</span>{' '}
          <span className="rl-group-count">{items.length}</span>
        </div>
        <p className="rl-group-instruction">{GROUP_LINES[status]}</p>
      </header>
      <div className="rl-group-rows">{linked.map(row)}</div>
      {unattached.length > 0 && (
        <div className="rl-group-unattached">
          <div className="rl-hairline">NOT TIED TO A GOAL</div>
          {unattached.map(row)}
        </div>
      )}
    </section>
  );
}
