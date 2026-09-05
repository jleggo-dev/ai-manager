import { listGoals } from '../repos/goals.ts';
import { setPendingRepertoireReview } from '../repos/users.ts';
import { matchActivity } from './plan-edit.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `offer_repertoire_review` — she shows them everything in a collection; they mark what they know.
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
  /**
   * 797 of the 800 the action rule allows (TOOL-HARNESS.md §1). The harness's own audit only reads
   * the tools declared every turn, so this one is asserted in coach-action-offer-repertoire.test.ts
   * — same rules, checked where a tail tool can actually be reached.
   *
   * PLAIN WORDS, NO METAPHOR (owner ruling 2026-09-03): *"We need to use plain simple and concise
   * language to explain the capabilities they can find and not insert flowery/poetic language like
   * 'lay a whole book out'. The user says 'hey, I want to practice my kata at home so I can get
   * better at karate' — why would Grok or Claude think that a tool about books will help?"* So it
   * says what the tool DOES ("show the user everything in a named collection"), defines what a
   * collection is, and names four domains rather than one.
   *
   * The closing "say one short line and stop" moved OUT of this string and lives only in what the
   * tool hands back, where it already was word for word. That is where it belongs (TOOL-HARNESS.md
   * §4: tell her what to do next, scoped to THIS result), and it is what made the owner's wording
   * fit — at 901 characters the string as written was over the bound, and trimming the example
   * alone could not have reached it.
   */
  description:
    'Show the user everything in a named collection they are learning from, in its own order, as a checklist on their screen. A collection is anything with a fixed sequence of items to learn: a book, an exam grade, a grading syllabus, a reading list, a set of poems. Use it when they say they are partway through such a collection, instead of asking them to type the items out; use update_repertoire when they name individual items. This saves nothing: no item goes on their list until they mark it and confirm on that screen. Pass {"collection": "Suzuki Piano Book 2", "where_you_are": "Hungarian Folk Song", "goal": "Practice piano"}. "where_you_are" is the item they said they are on; with it, everything before it starts marked as known. Omit it and nothing starts marked. Omit "goal" if none fits.',
  parameters: {
    properties: {
      collection: {
        type: 'string',
        description: 'The book, syllabus, grade, or list they named, by its own name.',
      },
      where_you_are: {
        type: 'string',
        description:
          'The item they said they are on, in their words. Omit it and nothing starts marked — they tap it themselves.',
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
      return 'No collection was named, so nothing was put up. Ask them which book, syllabus, grade or list it is — by its name — and call this again with it.';
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
      'It is up for them to check. Do not list the pieces and do not count them. Wait for them to look.',
    ].join('\n');
  },
};
