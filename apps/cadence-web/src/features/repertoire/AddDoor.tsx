/**
 * The ＋ door (P6 "the room", top right of the list screen): three rows, always in this order —
 * start from a collection, add one by hand, or just say it in chat. Reuses the app's generic
 * bottom-sheet chrome (`.sheet-scrim`/`.sheet`/`.sheet-head`/`.sheet-body`, styles.css) and its
 * quick-add row shape (`.ld-row`/`.ld-row-t`, the same rows the ＋ tab's own sheet uses) rather
 * than inventing a second "a few tappable rows" pattern.
 *
 * "Start from a collection" needs a name before P4's seed review has anything to look up, and the
 * brief is explicit that this field belongs to THIS parcel "on the empty state and behind the +
 * door" — so tapping that row turns this same sheet into a two-step flow rather than opening a
 * second file for one text field. "Add one by hand" and "Just tell me in chat" only ever report
 * the tap; where each leads is ListScreen's job.
 */
import { useState } from 'react';

export interface AddDoorProps {
  onStartCollection: (collection: string) => void;
  onAddByHand: () => void;
  onOpenChat: () => void;
  onClose: () => void;
}

export function AddDoor({ onStartCollection, onAddByHand, onOpenChat, onClose }: AddDoorProps) {
  const [naming, setNaming] = useState(false);
  const [collection, setCollection] = useState('');

  function submitCollection() {
    const trimmed = collection.trim();
    if (trimmed) onStartCollection(trimmed);
  }

  return (
    <div className="sheet-scrim" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Add to what I'm learning" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div className="sheet-title">
            <b>{naming ? 'Name the collection' : 'Add something'}</b>
          </div>
          <button type="button" className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {naming ? (
          <div className="sheet-body">
            <div className="ri-field">
              <label className="ri-label" htmlFor="rl-door-collection">
                Collection
              </label>
              <input
                id="rl-door-collection"
                className="ri-input"
                value={collection}
                placeholder="Suzuki Piano Book 2, ABRSM Grade 3…"
                onChange={(e) => setCollection(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitCollection()}
              />
            </div>
            <button type="button" className="cta" disabled={!collection.trim()} onClick={submitCollection}>
              Look it up
            </button>
          </div>
        ) : (
          <div className="sheet-body">
            <button type="button" className="ld-row" onClick={() => setNaming(true)}>
              <span className="ld-row-t">
                <b>Start from a collection</b>
                <span>a book, a syllabus, a grading ladder</span>
              </span>
              <span className="rl-chevron" aria-hidden="true">
                ›
              </span>
            </button>
            <button type="button" className="ld-row" onClick={onAddByHand}>
              <span className="ld-row-t">
                <b>Add one by hand</b>
                <span>just this one, right now</span>
              </span>
              <span className="rl-chevron" aria-hidden="true">
                ›
              </span>
            </button>
            <button type="button" className="ld-row" onClick={onOpenChat}>
              <span className="ld-row-t">
                <b>Just tell me in chat</b>
                <span>say it however you&rsquo;d say it to me</span>
              </span>
              <span className="rl-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
