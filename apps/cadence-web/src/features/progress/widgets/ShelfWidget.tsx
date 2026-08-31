import type { ShelfPayload } from '@cadence/shared';

/** "Aug 21" — the shelf shows the day a thing happened, not an ISO fragment. */
function shelfDate(at: string): string {
  try {
    return new Date(`${at.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return at.slice(5);
  }
}

/**
 * `shelf` — bests & firsts as a vertical list (owner design 1a, repertoire card): each row a
 * small filled circle with a check, the label, the date at the right. Every event the payload
 * carries IS an accomplishment — done, warm (dawn-3) — so there are no ring/grey states here;
 * the design's "polishing"/"up next" rows belong to payloads that distinguish in-progress, and
 * this one doesn't. No invented states.
 */
export function ShelfWidget({ data }: { data: ShelfPayload }) {
  return (
    <div className="pw-shelf">
      {data.events.map((e, i) => (
        <div className="pw-shelf-row" key={`${e.label}-${i}`}>
          <span className="pw-shelf-mark" aria-hidden>
            ✓
          </span>
          <span className="pw-shelf-label">{e.label}</span>
          <span className="pw-shelf-date">{shelfDate(e.at)}</span>
        </div>
      ))}
    </div>
  );
}
