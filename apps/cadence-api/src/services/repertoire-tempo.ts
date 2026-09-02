import { type MetronomeSpec, normalizeMetronome, settledTempo } from '@cadence/shared';
import { listRepertoire, setSettledTempo } from '../repos/repertoire.ts';
import { findItemForTitle, invalidateSessionsFor } from './repertoire-practice.ts';

/**
 * The settled tempo write-back — the other half of "she remembers".
 *
 * The dock knows the tempo someone actually plays a piece at; until now that lived in
 * `localStorage` and nowhere else, so a new phone lost it and the coach could never see it. This
 * moves it onto the piece itself (`repertoire.meta`), which is what makes it durable AND readable:
 * `renderRepertoire` prints it into both `get_repertoire` and prescribe-session's
 * `{{repertoire}}`, so she can meet someone at the tempo they actually practise.
 *
 * Matching reuses `findItemForTitle` rather than trusting the client with an item id — the client
 * knows a step title, and the rules for turning a title into a piece (goal scope, whole words, the
 * label's core) already exist and must not be spelled a second time.
 *
 * A tempo change invalidates the goal's cached sessions for exactly the reason a repertoire change
 * does: prescriptions are generated once and cached, so without this a week warmed in one burst
 * would carry last week's tempo all week.
 */
export async function settleTempoForTitle(
  userId: string,
  title: string,
  raw: { bpm: number; meter?: number },
  opts: { goalId?: string | null } = {},
): Promise<{ label: string; tempo: MetronomeSpec } | null> {
  const tempo = normalizeMetronome(raw.bpm, raw.meter);
  if (!tempo) return null;

  const items = await listRepertoire(userId);
  const item = findItemForTitle(items, title, opts.goalId);
  // No match is the ordinary case, not a fault: most steps are not a piece on file ("Scales",
  // "Warm up"). The dock keeps its local copy either way, so nothing is lost by saying nothing.
  if (!item) return null;

  // Writing the identical tempo back on every session would churn the row and its updated_at for
  // no gain — and, worse, invalidate cached sessions on a night nothing actually changed.
  const current = settledTempo(item.meta);
  if (current && current.bpm === tempo.bpm && current.meter === tempo.meter) {
    return { label: item.label, tempo };
  }

  await setSettledTempo(userId, item.item_id, tempo);
  await invalidateSessionsFor(userId, [item]);
  return { label: item.label, tempo };
}
