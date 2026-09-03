/**
 * One of the list screen's four standing groups (P6 "the room"): a header naming the standing, its
 * count, and its own warm line (`GROUP_LINES`, the coach's voice — never `@cadence/shared`'s
 * `REPERTOIRE_GROUPS` header text, which is a prompt string written for the model); then its rows,
 * in the order `orderGroupItems` says this standing reads in; a title collision as a butter card
 * right under the row it is about; and, when this group holds material with no goal, a "NOT TIED
 * TO A GOAL" hairline ahead of those rows.
 *
 * Renders nothing for an empty group — the screen never shows a standing with nothing in it.
 *
 * Books, 200 long (P8): once an all-book Learned group passes 30 items (`shouldCollapseByYear`),
 * individual rows give way to year buckets behind a find field — a reading record cannot stay a
 * flat scroll the way a repertoire of a few dozen pieces can. Every other group, and a books group
 * under the threshold, renders exactly as it always has; the collapse never touches the
 * linked/unattached split, which only applies below the threshold.
 *
 * Kata, a ladder (P8): this component, not `RepertoireRow`, decides whether the WHOLE group is a
 * ladder (`isFullLadder`) and only then hands each row its own rank to show. A single row never
 * makes that call for itself — a book-seeded piece carries a rank too, and must never look ranked.
 */
import { useState } from 'react';
import type { RepertoireItem, RepertoireStatus } from '@cadence/shared';
import { pieceQualifiers } from '@cadence/shared';
import type { RepertoireCollisionGroup } from '../../lib/api/repertoire-list.ts';
import {
  bucketsByYear,
  collisionPartnersFor,
  findMatches,
  GROUP_LINES,
  groupStandingWord,
  isFullLadder,
  orderGroupItems,
  shouldCollapseByYear,
  splitUnattached,
  yearBucketLine,
} from './repertoireListCopy.ts';
import { RepertoireRow } from './RepertoireRow.tsx';
import { CollisionCard } from './CollisionCard.tsx';

/** Which face the collapsed view shows: the year buckets, or one year's rows opened from a bucket.
 *  Local to this component — the collapse is a presentation choice, not state the screen or the
 *  server needs to know about. */
type YearView = { kind: 'buckets' } | { kind: 'year'; year: number | null };

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
  // Hooks run on every render regardless of the empty-group early return below
  // (react-hooks/rules-of-hooks) — both are only ever read once collapse is possible (retired).
  const [find, setFind] = useState('');
  const [yearView, setYearView] = useState<YearView>({ kind: 'buckets' });

  if (items.length === 0) return null;

  const ordered = orderGroupItems(status, items);
  const indexOf = new Map(ordered.map((item, i) => [item.item_id, i] as const));
  const { linked, unattached } = splitUnattached(ordered);
  const headWord = groupStandingWord(status, items);
  // Whole-group decision, same input `orderGroupItems` itself checks — a ladder's rows show their
  // rank; nothing else ever does, even a piece that happens to carry one (P4's book seed writes
  // rank on every row it expands).
  const ladder = isFullLadder(items);

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
          rank={ladder ? pieceQualifiers(item.meta).rank : undefined}
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

  const collapsed = shouldCollapseByYear(status, items);
  const query = find.trim();

  return (
    <section className="rl-group" aria-label={headWord}>
      <header className="rl-group-head">
        <div className="rl-group-name">
          <span className="rl-group-name-word">{headWord}</span> <span className="rl-group-count">{items.length}</span>
        </div>
        <p className="rl-group-instruction">{GROUP_LINES[status]}</p>
      </header>

      {!collapsed && (
        <>
          <div className="rl-group-rows">{linked.map(row)}</div>
          {unattached.length > 0 && (
            <div className="rl-group-unattached">
              <div className="rl-hairline">NOT TIED TO A GOAL</div>
              {unattached.map(row)}
            </div>
          )}
        </>
      )}

      {collapsed && (
        <div className="rl-year-collapse">
          <input
            type="text"
            className="rl-find"
            placeholder="Find a title"
            aria-label="Find a title"
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />

          {query ? (
            <div className="rl-group-rows">{findMatches(ordered, query).map(row)}</div>
          ) : yearView.kind === 'buckets' ? (
            <div className="rl-year-buckets">
              {bucketsByYear(ordered).map((bucket) => (
                <button
                  key={String(bucket.year)}
                  type="button"
                  className="rl-year-bucket"
                  onClick={() => setYearView({ kind: 'year', year: bucket.year })}
                >
                  {yearBucketLine(bucket)}
                </button>
              ))}
            </div>
          ) : (
            <>
              <button type="button" className="rl-year-back" onClick={() => setYearView({ kind: 'buckets' })}>
                ‹ All years
              </button>
              <div className="rl-group-rows">
                {ordered
                  .filter((i) => (i.learned_at ? Number(i.learned_at.slice(0, 4)) : null) === yearView.year)
                  .map(row)}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
