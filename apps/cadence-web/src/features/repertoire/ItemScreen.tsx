import { useState } from 'react';
import type { RepertoireItem } from '@cadence/shared';
import { pieceQualifiers } from '@cadence/shared';
import { buildCaption } from './repertoireItemCopy.ts';
import { ItemNameFields } from './ItemNameFields.tsx';
import { StandingControl } from './StandingControl.tsx';
import { ItemHistoryTempo } from './ItemHistoryTempo.tsx';
import { ItemRemove } from './ItemRemove.tsx';
import '../../styles/progress-widgets.css';
// repertoire-item.css now loads centrally from main.tsx (P6: this screen is real navigation now,
// not preview-only, and the list screen's own collision card reuses `.ri-collision` from it too).

/** The one sentence this screen renders verbatim when the shelf has a collision — the app never
 *  proposes the distinction, only names that one exists (brief: "the app never proposes the
 *  distinction"). Exported so the collision card's copy has one spelling everywhere it is read. */
export const COLLISION_NOTICE = "Only you know how they differ — add a word here or there and I'll stop asking.";

export interface ItemScreenProps {
  item: RepertoireItem;
  /** The other piece this one's title collides with on the shelf (same `samePiece`, or a shared
   *  needle), or null/undefined when there is none. Computed by the caller, who already holds
   *  every item on the shelf to render it — this screen only shows the notice. */
  collidesWithLabel?: string | null;
  /** Sessions logged against this item, when the caller has that count; the header caption omits
   *  the segment rather than guessing when it is not supplied. */
  sessionCount?: number;
  onBack: () => void;
  /** Called once a delete is confirmed by the server. */
  onDeleted?: (itemId: string) => void;
}

/**
 * The item, opened (P2) — one repertoire item as a full screen: rename it, give it a composer,
 * collection or catalogue number, change its standing, or remove it for good. Nothing done here
 * loses the item's history: identity is the row (`item_id`), never the label.
 *
 * Deterministic throughout — no coach call, no AI. Every write goes through
 * `lib/api/repertoire-item.ts`'s PATCH/DELETE, and each section keeps its own local state; this
 * component's only job is to hold the current row and re-render the header when a child reports
 * a fresh one back.
 */
export function ItemScreen({ item: initial, collidesWithLabel, sessionCount, onBack, onDeleted }: ItemScreenProps) {
  const [item, setItem] = useState(initial);
  const q = pieceQualifiers(item.meta);

  return (
    <div className="js" role="dialog" aria-label={item.label}>
      <div className="js-bar">
        <button className="jw-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div>
          <div className="screen-title">{item.label}</div>
          <div className="screen-sub">{buildCaption(item, sessionCount)}</div>
        </div>
      </div>

      <div className="scrollbody">
        {collidesWithLabel && (
          <div className="ri-collision">
            <p>
              This also matches <b>&ldquo;{collidesWithLabel}&rdquo;</b>.
            </p>
            <p>{COLLISION_NOTICE}</p>
          </div>
        )}

        <ItemNameFields
          itemId={item.item_id}
          initialLabel={item.label}
          initialComposer={q.composer ?? ''}
          initialCollection={q.collection ?? ''}
          initialCatalogue={q.catalogue ?? ''}
          onSaved={setItem}
        />

        <StandingControl itemId={item.item_id} status={item.status} onChanged={setItem} />

        <ItemHistoryTempo item={item} />

        <ItemRemove itemId={item.item_id} onDeleted={() => onDeleted?.(item.item_id)} />
      </div>
    </div>
  );
}
