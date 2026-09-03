import { useEffect, useState } from 'react';
import { clearRepertoireOffer, getRepertoireOffer, type RepertoireOffer } from '../../lib/api/repertoire-offer.ts';
import { SeedReview } from '../repertoire/SeedReview.tsx';

/**
 * "Want me to lay them out?" — the coach's door onto the seed review (design frame 1e, P7).
 *
 * Someone says they are partway through a book. Twelve pieces are in that sentence and none are
 * named, so she offers the BOOK rather than typing out titles she does not know. Her tool wrote a
 * pointer (`offer_repertoire_review`) because the chat wire is pure SSE prose — a tool call never
 * reaches the browser — so this asks the server what is offered and draws nothing when the answer
 * is nothing, exactly as WeekReviewCard and ChangeCard do beside it. A turn that describes the
 * offer loosely still cannot change which book is up: the pointer is the truth.
 *
 * BOTH DOORS OPEN ONE ROOM. "Lay them out" mounts P4's `SeedReview` — the same screen the ＋ door
 * on the list opens, with the same confirm — and the only thing hers adds is `whereYouAre`, her
 * heard split pre-applied. There is no second review, and she writes nothing: the confirm on that
 * screen is still the only writer, which is why "Lay them out" alone changes nothing at all.
 *
 * What comes back afterwards is a RECEIPT, not another card. The person has already decided; a
 * second editable card would ask them to decide again. So: one row saying what landed with a way
 * into the list, and a note telling the coach the list is real now so she can use it in her next
 * line rather than asking about it.
 */

/** No stylesheet of its own: the offer wears ChangeCard/WeekReviewCard's frame (`cfm chg`), and
 *  the review wears the full-screen page class the list and item screens already use (`js`). */
const OFFER_LINE =
  "I can lay the whole thing out so you can tick what's yours. Nothing goes on your list until you say so.";

/** The receipt's own words. The count is a fact about what the person confirmed, so it comes from
 *  what the review actually wrote — never from what she offered. */
function receiptLine(written: number): string {
  return `${written} ${written === 1 ? 'piece' : 'pieces'} added to What I'm learning`;
}

/**
 * What the coach is told once the rows land. She never saw the book and did not choose the ticks,
 * so this says both — and points her at the read, because using the list is the next beat and
 * naming a piece she has not read back would be a guess.
 */
function seededNote(collection: string, written: number): string {
  return (
    `The user has just confirmed the collection you offered: ${written} piece(s) from "${collection}" are now on ` +
    'their list. You did not choose those pieces and you have not seen them — they ticked them. Read the list ' +
    'back (get_repertoire) before you name anything from it, then say in ONE line what you would do with it ' +
    'next. Do not list the pieces back to them and do not thank them for the list.'
  );
}

type View = 'offer' | 'review' | 'receipt' | 'gone';

export function RepertoireOfferCard({
  onOpenList,
  onSeeded,
}: {
  /** "Open ›" on the receipt — the host takes them to the list. This surface never opens a second
   *  one: the list lives on the Progress tab and there is one of it. */
  onOpenList?: () => void;
  /** The rows landed — the host hands the coach this note so she speaks next. A note, not a sent
   *  message: showing the user a bubble they never wrote would be the app talking in their voice. */
  onSeeded?: (note: string) => void;
}) {
  const [offer, setOffer] = useState<RepertoireOffer | null>(null);
  const [view, setView] = useState<View>('offer');
  const [written, setWritten] = useState(0);

  useEffect(() => {
    let alive = true;
    void getRepertoireOffer()
      .then((o) => {
        if (alive) setOffer(o);
      })
      .catch(() => {
        /* her prose still says she can lay it out; a missing card is not a broken turn */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!offer || view === 'gone') return null;

  /** Both answers land here — declined, or a finished review. Neither has anything else to undo. */
  function answered() {
    void clearRepertoireOffer().catch(() => {
      /* it stays offered server-side; the next finished turn shows it again */
    });
  }

  function notNow() {
    setView('gone');
    answered();
  }

  function done(count: number) {
    answered();
    // A review that wrote nothing is not a receipt — saying "0 pieces added" would be a sentence
    // about their book that nothing happened to.
    if (count < 1) return setView('gone');
    setWritten(count);
    setView('receipt');
    onSeeded?.(seededNote(offer!.collection, count));
  }

  if (view === 'review') {
    return (
      <div className="js" role="dialog" aria-label="Lay out a collection">
        <div className="js-bar">
          <button type="button" className="jw-back" onClick={() => setView('offer')} aria-label="Close">
            ‹
          </button>
        </div>
        <SeedReview collection={offer.collection} whereYouAre={offer.where_you_are ?? undefined} onDone={done} />
      </div>
    );
  }

  if (view === 'receipt') {
    return (
      <div className="cfm chg">
        <div className="cfm-mute">{receiptLine(written)}</div>
        {/* No host to take them there (onboarding mounts this chat too) — then the row simply says
            what landed. A control that does nothing when tapped is worse than no control. */}
        {onOpenList && (
          <button type="button" className="cfm-more" onClick={onOpenList}>
            Open ›
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="cfm chg">
      <div className="chg-t">{offer.collection}</div>
      <div className="cfm-mute">{OFFER_LINE}</div>
      <button type="button" className="cfm-build" onClick={() => setView('review')}>
        Lay them out
      </button>
      <button type="button" className="cfm-more" onClick={notNow}>
        Not now
      </button>
    </div>
  );
}
