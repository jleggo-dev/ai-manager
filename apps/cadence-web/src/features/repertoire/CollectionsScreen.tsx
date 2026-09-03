/**
 * "Your collections" (P11, migration 0056) — the one place a collection can be renamed or removed.
 *
 * A collection became a row of its own so that this screen could exist: while it was a name copied
 * onto every item there was nothing to open, nothing to rename in one place, and no way to see the
 * groups a person actually has. Each row is a fact — its name and how many things point at it —
 * and the two things you can do to it.
 *
 * There is deliberately NO "add" here. A collection is something you file material into, so you
 * make one from the item you are filing (the picker's "Add a collection…") or when you look a book
 * up; the empty line says exactly that rather than offering a button that would leave the person
 * with a named empty box and nothing to put in it.
 *
 * Own file, reached from the list screen's ＋ door and from the item picker's "Manage collections…".
 * The list is the record: this screen never derives a count, it renders the one the server sent.
 */
import { useCallback, useEffect, useState } from 'react';
import type { RepertoireCollection } from '@cadence/shared';
import { getCollections, removeCollection, renameCollection } from '../../lib/api/repertoire-collections.ts';
import { CollectionRow } from './CollectionRow.tsx';
import { COLLECTIONS_EMPTY, COLLECTIONS_TITLE } from './collectionsCopy.ts';

type Load = { kind: 'loading' } | { kind: 'fault'; fault: string } | { kind: 'ready' };

export interface CollectionsScreenProps {
  onBack: () => void;
  /** Called after a rename or a remove, so the screen behind can pick the change up — an item's
   *  second line carries its collection's name, and a removed collection ungroups its items. */
  onChanged?: () => void;
}

export function CollectionsScreen({ onBack, onChanged }: CollectionsScreenProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [collections, setCollections] = useState<RepertoireCollection[]>([]);

  const refresh = useCallback(async () => {
    const res = await getCollections();
    if (!res.ok) return void setLoad({ kind: 'fault', fault: res.fault });
    setCollections(res.collections);
    setLoad({ kind: 'ready' });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Both actions answer with a SENTENCE or '' — the row shows it in place, beside the collection it
  // is about, rather than at the top of a screen where the person has to work out which row failed.
  const rename = useCallback(
    async (id: string, name: string): Promise<string> => {
      const res = await renameCollection(id, name);
      if (!res.ok) return res.fault;
      await refresh();
      onChanged?.();
      return '';
    },
    [refresh, onChanged],
  );

  const remove = useCallback(
    async (id: string): Promise<string> => {
      const res = await removeCollection(id);
      if (!res.ok) return res.fault;
      await refresh();
      onChanged?.();
      return '';
    },
    [refresh, onChanged],
  );

  return (
    <div className="js" role="dialog" aria-label={COLLECTIONS_TITLE}>
      <div className="js-bar">
        <button className="jw-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div className="screen-title">{COLLECTIONS_TITLE}</div>
      </div>

      <div className="scrollbody">
        {load.kind === 'loading' && <p className="screen-sub">Reading your collections…</p>}

        {load.kind === 'fault' && (
          <div className="pw-card sr-fault">
            <p className="sr-fault-t">{load.fault}</p>
            <button type="button" className="detour-chip" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        )}

        {load.kind === 'ready' && collections.length === 0 && <p className="screen-sub">{COLLECTIONS_EMPTY}</p>}

        {load.kind === 'ready' && collections.length > 0 && (
          <div className="pw-card">
            {collections.map((c) => (
              <CollectionRow key={c.collection_id} collection={c} onRename={rename} onRemove={remove} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
