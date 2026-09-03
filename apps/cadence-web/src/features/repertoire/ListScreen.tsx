/**
 * "What I'm learning" (P6 "the room", design frames 1a/2a/3a/1d) — the full repertoire list: four
 * standing groups, both add doors, and the routing that makes the item screen (P2) and the seed
 * review (P4) reachable. Pushed from the Progress repertoire card and from a goal's own page
 * (BoundWidget.tsx/ProgressView.tsx wire the one entry point that exists today — see the report).
 *
 * The list is the record; there is no AI on this screen. It never derives counts, order, or
 * collisions itself: `GET /progress/repertoire/items` and `@cadence/shared`'s own helpers
 * (`orderGroupItems`, `pieceQualifiers`) are read, never re-decided, so the coach and this screen
 * can never disagree about what a group holds or what order it reads in.
 */
import { useCallback, useEffect, useState } from 'react';
import type { RepertoireItem, RepertoirePayload, RepertoireStatus } from '@cadence/shared';
import { REPERTOIRE_GROUPS } from '@cadence/shared';
import { useProgressRepertoire } from '../../lib/query/index.ts';
import { getRepertoireListItems, type RepertoireCollisionGroup } from '../../lib/api/repertoire-list.ts';
import { patchRepertoireItem } from '../../lib/api/repertoire-item.ts';
import { headerCountLine, moveQueuedRank, orderGroupItems } from './repertoireListCopy.ts';
import { RepertoireGroup } from './RepertoireGroup.tsx';
import { EmptyState } from './EmptyState.tsx';
import { AddDoor } from './AddDoor.tsx';
import { HandAddSheet } from './HandAddSheet.tsx';
import { ItemScreen } from './ItemScreen.tsx';
import { SeedReview } from './SeedReview.tsx';

type Load = { kind: 'loading' } | { kind: 'fault'; fault: string } | { kind: 'ready' };

export interface ListScreenProps {
  /** null = everything they keep (unattached material included); a goal's own id scopes to it. */
  goalId: string | null;
  /** The warm heading to show — a goal's title when scoped, or null when it is not. */
  goalName: string | null;
  onBack: () => void;
  /** "Just tell me in chat" — hands the coach a note and switches to its tab. Omitted, the door
   *  simply does not render (there is nowhere for it to send the person). */
  onOpenChat?: (note: string) => void;
}

const CHAT_NOTE =
  'They opened "What I\'m learning" and want to just tell me what they play or are working on, ' +
  "rather than typing it into a list. Ask what they'd like to add.";

export function ListScreen({ goalId, goalName, onBack, onOpenChat }: ListScreenProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [items, setItems] = useState<RepertoireItem[]>([]);
  const [collisions, setCollisions] = useState<RepertoireCollisionGroup[]>([]);
  // The collections already in use, for the item screen's Collection select. Read here rather than
  // there because this screen already holds the list read that carries them.
  const [collections, setCollections] = useState<string[]>([]);
  const [actionError, setActionError] = useState('');
  const [openItem, setOpenItem] = useState<{ item: RepertoireItem; collidesWithLabel: string | null } | null>(null);
  const [seedCollection, setSeedCollection] = useState<string | null>(null);
  const [addDoorOpen, setAddDoorOpen] = useState(false);
  const [handAddOpen, setHandAddOpen] = useState(false);
  const [pendingGoalId, setPendingGoalId] = useState<string | null>(null);
  const { data: card } = useProgressRepertoire(goalId ?? undefined);

  const refresh = useCallback(() => {
    return getRepertoireListItems(goalId).then((res) => {
      if (!res.ok) return setLoad({ kind: 'fault', fault: res.fault });
      setItems(res.items);
      setCollisions(res.collisions);
      setCollections(res.collections);
      setLoad({ kind: 'ready' });
    });
  }, [goalId]);

  useEffect(() => {
    setLoad({ kind: 'loading' });
    void refresh();
  }, [refresh]);

  function openRow(item: RepertoireItem, collidesWithLabel: string | null) {
    setOpenItem({ item, collidesWithLabel });
  }

  function changeStanding(item: RepertoireItem, status: RepertoireStatus) {
    setActionError('');
    patchRepertoireItem(item.item_id, { status })
      .then(() => refresh())
      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : 'That did not save — try again.'));
  }

  function move(item: RepertoireItem, direction: 'up' | 'down') {
    const queued = orderGroupItems(
      'queued',
      items.filter((i) => i.status === 'queued'),
    );
    const index = queued.findIndex((i) => i.item_id === item.item_id);
    const changes = moveQueuedRank(queued, index, direction);
    if (!changes.length) return;
    setActionError('');
    Promise.all(changes.map((c) => patchRepertoireItem(c.item_id, { rank: c.rank })))
      .then(() => refresh())
      .catch((err: unknown) =>
        setActionError(err instanceof Error ? err.message : 'That reorder did not save — try again.'),
      );
  }

  const goalForNewMaterial = goalId ?? pendingGoalId;

  const chatNote = onOpenChat && (() => onOpenChat(CHAT_NOTE));

  if (openItem) {
    return (
      <ItemScreen
        item={openItem.item}
        collidesWithLabel={openItem.collidesWithLabel}
        collections={collections}
        onBack={() => {
          setOpenItem(null);
          void refresh();
        }}
        onDeleted={() => {
          setOpenItem(null);
          void refresh();
        }}
      />
    );
  }

  if (seedCollection !== null) {
    return (
      <SeedReview
        collection={seedCollection}
        onDone={() => {
          setSeedCollection(null);
          void refresh();
        }}
      />
    );
  }

  const totalCount = items.length;
  let cardData: RepertoirePayload | null = null;
  if (card && !('omission' in card)) cardData = card;

  return (
    <div className="js" role="dialog" aria-label="What I'm learning">
      <div className="js-bar">
        <button className="jw-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div className="screen-title">What I&rsquo;m learning</div>
        {load.kind === 'ready' && items.length > 0 && (
          <button type="button" className="rl-add-btn" aria-label="Add" onClick={() => setAddDoorOpen(true)}>
            ＋
          </button>
        )}
      </div>

      <div className="scrollbody">
        {load.kind === 'loading' && <p className="screen-sub">Reading your shelf…</p>}

        {load.kind === 'fault' && (
          <div className="pw-card sr-fault">
            <p className="sr-fault-t">{load.fault}</p>
            <button type="button" className="detour-chip" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        )}

        {load.kind === 'ready' && items.length === 0 && (
          <EmptyState
            goalId={goalId}
            onStartCollection={setSeedCollection}
            onAddByHand={() => setHandAddOpen(true)}
            onOpenChat={() => chatNote?.()}
            onPickGoal={setPendingGoalId}
          />
        )}

        {load.kind === 'ready' && items.length > 0 && (
          <>
            {goalName && <div className="rl-goalname">{goalName}</div>}
            {cardData && (
              <div className="pw-head-tag rl-counts">
                {headerCountLine(totalCount, cardData.learned_in_year, cardData.noun)}
              </div>
            )}
            {actionError && <p className="ri-save-err">{actionError}</p>}

            {REPERTOIRE_GROUPS.map((g) => (
              <RepertoireGroup
                key={g.status}
                status={g.status}
                items={items.filter((i) => i.status === g.status)}
                collisions={collisions}
                onOpen={openRow}
                onChangeStanding={changeStanding}
                onMove={g.status === 'queued' ? move : undefined}
              />
            ))}
          </>
        )}
      </div>

      {addDoorOpen && (
        <AddDoor
          onClose={() => setAddDoorOpen(false)}
          onStartCollection={(collection) => {
            setAddDoorOpen(false);
            setSeedCollection(collection);
          }}
          onAddByHand={() => {
            setAddDoorOpen(false);
            setHandAddOpen(true);
          }}
          onOpenChat={() => {
            setAddDoorOpen(false);
            chatNote?.();
          }}
        />
      )}

      {handAddOpen && (
        <HandAddSheet
          goalId={goalForNewMaterial}
          onClose={() => setHandAddOpen(false)}
          onSaved={() => {
            setHandAddOpen(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
