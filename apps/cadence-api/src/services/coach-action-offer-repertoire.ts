import { listGoals } from '../repos/goals.ts';
import { setPendingRepertoireReview } from '../repos/users.ts';
import { matchActivity } from './plan-edit.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `offer_repertoire_review` — she offers to lay a whole collection out; the person ticks it.
 *
 * The moment this exists for: "started Suzuki Book 2 last autumn — I'm on the Hungarian folk song
 * now, everything before it is fine." Twelve pieces are sitting in that sentence and none of them
 * are named. `update_repertoire` cannot help, because she does not know the book's contents and
 * anything she guessed would land on the person's record as if they had said it. So this tool puts
 * the BOOK up instead, in its own order, with her heard split pre-marked — and the person confirms.
 *
 * Own file from day one, like `open_week_review` and `update_constraint` before it: coach-actions.ts
 * is near its size gate, and a tool whose whole contract is a boundary wants the room to state it.
 *
 * **She may offer and she may pre-mark. She may not write a row from this door.** That is the
 * ruling, and it is why `run` below touches the users table and nothing else — no repertoire
 * import, deliberately. The pieces reach the person's file through exactly one path, the same one
 * their own ＋ door already uses: POST /progress/repertoire/seed/confirm, from a screen they are
 * looking at. The two doors open the same room; hers opens it pre-marked.
 *
 * The mechanism is `open_week_review`'s, copied rather than reinvented (coach-action-week-review.ts):
 * the chat wire is pure SSE prose, so a tool call never reaches the browser. Persisting a POINTER
 * is what makes "the review is up on their screen" true — the client polls for it and renders the
 * offer from that alone. There is no second step and no tag, so this tool is complete in one call
 * (TOOL-HARNESS.md §5). What it must never do is claim the other half of the story: the pointer is
 * an offer, and the return text says so in words she cannot skim past.
 *
 * `where_you_are` carries the person's OWN words for the piece ("the Hungarian folk song"), not a
 * position. Resolving those words onto a row is the screen's job (seedRows.ts), and it pre-marks
 * nothing when the words name more than one piece — the coach may not invent a distinction between
 * two titles, so an ambiguous phrase becomes a tap the person makes rather than a guess she makes.
 */

/** How much of a name is worth storing. A collection title is a book, not a paragraph. */
const MAX_COLLECTION = 120;
/** Their words for one piece, not a description of the book. */
const MAX_WHERE = 120;

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const OFFER_REPERTOIRE_REVIEW: CoachActionTool = {
  name: 'offer_repertoire_review',
  // Bounded at 800 by the action rule (TOOL-HARNESS.md §1). The harness's own audit only reads the
  // tools declared every turn, so this one is asserted in coach-action-offer-repertoire.test.ts —
  // same rules, checked where a tail tool can actually be reached.
  description:
    'Put a whole collection up on their screen as a tickable list — every piece in a named book, method, syllabus, or grade, in its own order. Use it when they say they are partway through a collection, instead of asking them to type the pieces out; use update_repertoire when they name individual pieces rather than a book. This does NOT change anything and does NOT add anything to their list: nothing goes on their file until they tick and confirm on that screen. Pass {"collection": "Suzuki Piano Book 2", "where_you_are": "Hungarian Folk Song", "goal": "Practice piano"} — "where_you_are" is the piece they said they are on, so everything before it starts marked; omit it and nothing starts marked. Omit "goal" if none fits. Then say ONE short line that it is up, and stop.',
  parameters: {
    properties: {
      collection: {
        type: 'string',
        description: 'The book, method, syllabus, or grade they named, by its own name.',
      },
      where_you_are: {
        type: 'string',
        description:
          'The piece they said they are on, in their words. Omit it and no piece starts marked — they tap it themselves.',
      },
      goal: {
        type: 'string',
        description: 'Which goal this collection serves, by its title exactly as listed. Omit if none fits.',
      },
    },
    required: ['collection'],
  },
  async run(userId, params) {
    const collection = text(params.collection, MAX_COLLECTION);
    if (!collection) {
      return 'No collection was named, so nothing was put up. Ask them which book, method, syllabus, or grade it is — by its name — and call this again with it.';
    }
    const whereYouAre = text(params.where_you_are, MAX_WHERE) || null;

    // Goal link is best-effort, exactly as in update_repertoire: a fuzzy miss puts the book up
    // unlinked rather than refusing it, and the person can pick a goal on the screen anyway. A
    // failed READ is the same outcome as a failed match — the offer is the point, the link is not.
    const goalQuery = text(params.goal, 120);
    let goalId: string | null = null;
    let goalNote = '';
    if (goalQuery) {
      const goals = await listGoals(userId).catch((e): null => {
        console.error('[repertoire offer] goal read failed:', e);
        return null;
      });
      const live = (goals ?? []).filter((g) => !['completed', 'abandoned'].includes(g.status));
      const goal = matchActivity(live, goalQuery);
      if (goal) goalId = goal.goal_id;
      else
        goalNote = ` No goal matched "${goalQuery}", so the review is up without one — they can pick a goal on the screen.`;
    }

    await setPendingRepertoireReview(userId, {
      collection,
      where_you_are: whereYouAre,
      goal_id: goalId,
      offered_at: new Date().toISOString(),
    });

    const split = whereYouAre
      ? `The pieces before "${whereYouAre}" start marked as ones they keep up, and "${whereYouAre}" as the one they are learning.`
      : 'Nothing is marked yet — they tap the piece they are on and the screen works the rest out.';

    return [
      `Done — the user now has "${collection}" up on their screen as a list they can tick.${goalNote}`,
      split,
      'NOTHING is on their file: no piece is stored until they confirm on that screen, and you have not read the book — the screen has. Do not say anything is recorded, on their list, or done.',
      'Say ONE short line that it is up for them to check, and STOP. Do not list the pieces and do not count them. Wait for them to look.',
    ].join('\n');
  },
};
