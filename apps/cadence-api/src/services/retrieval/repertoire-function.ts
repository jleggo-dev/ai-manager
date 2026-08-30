import { renderRepertoire, type RepertoireItem } from '@cadence/shared';
import { listRepertoire } from '../../repos/repertoire.ts';
import type { RetrievalFunction } from './types.ts';

/**
 * `get_repertoire` — what they are learning and what they already have, per skills practice.
 *
 * Layer 2 (tail read, category `practice`): free until asked for, and the Broker can hand it into
 * the pack whenever the conversation is about practice content. The write half is
 * `update_repertoire` (always-on — an action found is not an action called). The render marks the
 * rotation's DUE NEXT pick so choosing today's review piece is reading, not inventing — she can
 * override it, out loud, for a reason.
 */
export const GET_REPERTOIRE: RetrievalFunction = {
  name: 'get_repertoire',
  description:
    "What the user is learning and what they already know for a skills practice — pieces, katas, poems, techniques — with each item's standing (working on now / known / set aside), when it was last worked, and which known item is due next by longest rest. Use before picking practice or review material, and to answer what they can already do. To write this list, use update_repertoire; for time totals, get_practice_totals.",
  domains: ['repertoire', 'goals'],
  async run(userId) {
    return listRepertoire(userId);
  },
  render(r) {
    return renderRepertoire(r as RepertoireItem[]);
  },
  rows(r) {
    return (r as unknown[]).length;
  },
};
