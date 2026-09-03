/**
 * The empty state (design frame 1d) — the door someone opens themselves the first time, before
 * anything is on file. Same three doors the ＋ menu offers (learning the empty screen is learning
 * the list), but the collection field leads here instead of hiding behind a row: it is the door
 * most people take first, so it is first and largest, with its promise written under it.
 *
 * "FROM YOUR GOALS" chips only make sense when this screen has no goal of its own yet (opened
 * unscoped, "everything you keep") — a goal-scoped empty state already knows where new material
 * belongs, so it never shows them.
 */
import { useEffect, useState } from 'react';
import { getReview } from '../../lib/api/review.ts';
import { COLLECTION_LOOKUP_PLACEHOLDER } from './itemFieldCopy.ts';

export const EMPTY_HEADLINE = "Tell me what you already play, and I'll stop asking.";
export const EMPTY_COLLECTION_PROMISE =
  "I'll list everything in it. You mark what you already know. Nothing is saved until you say so.";

interface GoalChip {
  goal_id: string;
  title: string;
}

export interface EmptyStateProps {
  goalId: string | null;
  onStartCollection: (collection: string) => void;
  onAddByHand: () => void;
  onOpenChat: () => void;
  /** Which goal new material should attach to, when the person picks one of their own. */
  onPickGoal?: (goalId: string | null) => void;
}

export function EmptyState({ goalId, onStartCollection, onAddByHand, onOpenChat, onPickGoal }: EmptyStateProps) {
  const [collection, setCollection] = useState('');
  const [goals, setGoals] = useState<GoalChip[]>([]);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (goalId !== null) return; // already scoped to one goal — nothing to pick
    let live = true;
    void getReview()
      .then((r) => {
        if (live) setGoals(r.goals.map((g) => ({ goal_id: g.goal_id, title: g.title })));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [goalId]);

  function submitCollection() {
    const trimmed = collection.trim();
    if (trimmed) onStartCollection(trimmed);
  }

  function pickGoal(id: string) {
    const next = picked === id ? null : id;
    setPicked(next);
    onPickGoal?.(next);
  }

  return (
    <div className="scrollbody rl-empty">
      <p className="rl-empty-headline">{EMPTY_HEADLINE}</p>

      <div className="rl-empty-field">
        <label className="ri-label" htmlFor="rl-empty-collection">
          Name a collection
        </label>
        <input
          id="rl-empty-collection"
          className="ri-input rl-empty-input"
          value={collection}
          placeholder={COLLECTION_LOOKUP_PLACEHOLDER}
          onChange={(e) => setCollection(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitCollection()}
        />
        <p className="rl-empty-promise">{EMPTY_COLLECTION_PROMISE}</p>
        <button type="button" className="cta" disabled={!collection.trim()} onClick={submitCollection}>
          Look it up
        </button>
      </div>

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

      {goalId === null && goals.length > 0 && (
        <div className="rl-empty-goals">
          <div className="rl-hairline">FROM YOUR GOALS</div>
          <div className="detour-chips">
            {goals.map((g) => (
              <button
                key={g.goal_id}
                type="button"
                className={`detour-chip${picked === g.goal_id ? ' on' : ''}`}
                aria-pressed={picked === g.goal_id}
                onClick={() => pickGoal(g.goal_id)}
              >
                {g.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
