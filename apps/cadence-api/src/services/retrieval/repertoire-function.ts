import { REPERTOIRE_GROUPS, type RepertoireItem, type RepertoireStatus } from '@cadence/shared';
import { renderRepertoireForCoach } from '../repertoire-practice.ts';
import { listRepertoire } from '../../repos/repertoire.ts';
import type { RetrievalFunction } from './types.ts';

/**
 * `get_repertoire` — what they are learning and what they already have, per skills practice.
 *
 * Layer 2 (tail read, category `practice`): free until asked for, and the Broker can hand it into
 * the pack whenever the conversation is about practice content. The write half is
 * `update_repertoire` (always-on — an action found is not an action called).
 *
 * FACTS ONLY (owner ruling 2026-09-03): the render carries each item's standing, when it was last
 * worked, its settled tempo and its practice note, and marks nothing. It used to name the rotation's
 * "DUE NEXT" pick, and the description used to promise it — both are gone, along with `pickDueNext`.
 *
 * The two parameters exist because the same ruling capped ONE group. Learned only grows, so the
 * context block shows the 12 most recently touched and states the total; this tool is how she
 * reaches the rest of a 500-item reading record when the conversation is actually about it, instead
 * of that record riding every turn. `standing` narrows to one group; `all` lifts the Learned cap.
 * Omit both and it behaves exactly as it did — the whole shelf, Learned capped at 12.
 */

/** The four schema words, read off the one place they are defined rather than typed again here. */
const STANDINGS: readonly string[] = REPERTOIRE_GROUPS.map((g) => g.status);

/** The wrapper `run` hands to `render`: the rows, plus whether she asked for the whole Learned
 *  list. The shape follows `nutrition-facade.ts`'s `{ view, inner }` — `render` takes only the
 *  result, so a flag it must honour has to travel inside one. */
export interface RepertoireRead {
  items: RepertoireItem[];
  allLearned: boolean;
}

export const GET_REPERTOIRE: RetrievalFunction = {
  name: 'get_repertoire',
  // The standings are named by their SCHEMA words, because that is what the returned rows carry
  // and what update_repertoire takes back. The render translates them into the group headers she
  // reads ("Keeping up", "Learned"); a description naming only those labels would leave her
  // guessing which word to write. 513 of the 520-char read bound.
  description:
    'What the user is learning and already knows for a skills practice — pieces, katas, poems, techniques — with each item\'s standing (queued = not started, working = being worked on, known = learned and still played, retired = finished), when it was last worked, and its settled tempo. Use to answer what they can already do. Your copy shows only the 12 most recently finished; pass {"standing": "retired", "all": true} for all of them. To write this list, use update_repertoire; for time totals, get_practice_totals.',
  domains: ['repertoire', 'goals'],
  async run(userId, params): Promise<RepertoireRead> {
    const asked = typeof params?.standing === 'string' ? params.standing.trim().toLowerCase() : '';
    const standing = STANDINGS.includes(asked) ? (asked as RepertoireStatus) : null;
    const items = await listRepertoire(userId);
    return {
      items: standing ? items.filter((i) => i.status === standing) : items,
      allLearned: params?.all === true,
    };
  },
  render(r) {
    const { items, allLearned } = r as RepertoireRead;
    return renderRepertoireForCoach(items, undefined, { allLearned });
  },
  rows(r) {
    return (r as RepertoireRead).items.length;
  },
};
