import type { RepertoireItem } from '@cadence/shared';
import { settledTempo } from '@cadence/shared';
import { formatDate, formatLastPracticed, formatTempoCaption } from './repertoireItemCopy.ts';

/**
 * TEMPO — read-only, and absent entirely when nothing is on file. This is the player's own
 * datum (the metronome dock writes it once someone actually settles on a speed); the coach reads
 * it and never writes it, and this screen does not either — there is no input here to edit it,
 * on purpose (see CLAUDE.md: "Do not add a coach-writable tempo anywhere", the same rule extended
 * to every other writer).
 */
function TempoSection({ item }: { item: RepertoireItem }) {
  const tempo = settledTempo(item.meta);
  if (!tempo) return null;
  return (
    <div className="pw-card">
      <div className="pw-sect">
        <span>Tempo</span>
      </div>
      <div className="ri-tempo">{formatTempoCaption(tempo)}</div>
    </div>
  );
}

/**
 * HISTORY — Learned (date), Started (date), last practised (relative under 14 days, then a bare
 * date). "Learned" only appears once the item has actually crossed into Keeping up or Learned —
 * `queued`/`working` material has not been learned yet, so there is nothing honest to show there.
 * A backfilled learned item (known/retired with no `learned_at`) still gets the row, worded
 * plainly rather than inventing a date it does not have.
 */
export function ItemHistoryTempo({ item, now = new Date() }: { item: RepertoireItem; now?: Date }) {
  const showLearned = item.status === 'known' || item.status === 'retired';
  return (
    <>
      <TempoSection item={item} />
      <div className="pw-card">
        <div className="pw-sect">
          <span>History</span>
        </div>
        {showLearned && (
          <div className="ri-hist-row">
            <span className="ri-hist-label">Learned</span>
            <span className="ri-hist-value">{item.learned_at ? formatDate(item.learned_at, now) : 'not recorded'}</span>
          </div>
        )}
        <div className="ri-hist-row">
          <span className="ri-hist-label">Started</span>
          <span className="ri-hist-value">{formatDate(item.started_at, now)}</span>
        </div>
        <div className="ri-hist-row">
          <span className="ri-hist-label">Last practised</span>
          <span className="ri-hist-value">{formatLastPracticed(item.last_practiced_at, now)}</span>
        </div>
      </div>
    </>
  );
}
