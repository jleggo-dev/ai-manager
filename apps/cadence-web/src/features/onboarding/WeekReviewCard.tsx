import { useEffect, useState } from 'react';
import { dismissPendingWeekReview, getPendingWeekReview } from '../../lib/api.ts';

/** "Aug 16" — a plain short date, the same shape ConfirmCard and the meal-plan day labels use. */
function shortDate(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * "Your week is up — take a look?"
 *
 * ChangeCard's sibling for the check-in: `open_week_review` persists a POINTER (which plan week)
 * server-side rather than the review itself, because the chat wire is pure SSE prose — a tool call
 * never reaches the browser. This card asks the server what is pending and draws the label from
 * that alone, so a turn that describes the week loosely still points at the real one underneath.
 *
 * Deliberately thin: tapping Open only tells the host to mount the review surface (a placeholder
 * today; the real full-screen sheet is a later step). No auto-open — there is no precedent
 * anywhere in this app for a tool call yanking the screen out from under someone mid-conversation.
 */
export function WeekReviewCard({ onOpen }: { onOpen?: () => void }) {
  const [review, setReview] = useState<{ from: string; to: string } | null>(null);
  const [state, setState] = useState<'idle' | 'gone'>('idle');

  useEffect(() => {
    let alive = true;
    void getPendingWeekReview()
      .then((r) => {
        if (alive) setReview(r);
      })
      .catch(() => {
        /* the prose still says her week is up; a missing card is not a broken turn */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Nothing pending (never called, already opened, or dismissed on another device) — render
  // nothing rather than an empty frame promising a review that isn't there.
  if (!review || state === 'gone') return null;

  async function dismiss() {
    setState('gone');
    await dismissPendingWeekReview().catch(() => {
      /* it stays pending server-side; the next card will show it again */
    });
  }

  return (
    <div className="cfm chg">
      <div className="chg-t">Week review</div>
      <div className="cfm-mute">
        {shortDate(review.from)}–{shortDate(review.to)} · built from your log
      </div>
      <button type="button" className="cfm-build" onClick={() => onOpen?.()}>
        Open
      </button>
      <button type="button" className="cfm-more" onClick={() => void dismiss()}>
        Not now
      </button>
    </div>
  );
}
