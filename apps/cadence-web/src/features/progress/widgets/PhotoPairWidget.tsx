import type { PhotoPairPayload, ProgressPhotoSlot } from '@cadence/shared';

/** 'YYYY-MM-DD' → 'Jan 5' (the caption CSS uppercases it). An unreadable date shows as itself. */
function slotDate(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Jan 5 · 86.0 kg" — the date, and the user's own nearest weigh-in when one existed. A photo
 *  with no close weigh-in shows its date alone; a weight is never invented. */
function caption(slot: ProgressPhotoSlot): string {
  const date = slotDate(slot.date);
  return slot.weight_kg === null ? date : `${date} · ${slot.weight_kg.toFixed(1)} kg`;
}

function Slot({ slot, alt, single }: { slot: ProgressPhotoSlot; alt: string; single?: boolean }) {
  // A lone photo keeps the pair's slot width — the empty half is where the next one will sit.
  return (
    <div className={single ? 'pw-photos-slot pw-photos-slot--single' : 'pw-photos-slot'}>
      <img className="pw-photos-img" src={slot.url} alt={alt} loading="lazy" />
      <div className="pw-photos-cap">{caption(slot)}</div>
    </div>
  );
}

/**
 * `photo_pair` — the earliest and latest progress photos side by side (owner design 1a, "PHOTOS ·
 * every 4 weeks · optional"). Dates and weights only: nothing here compares, scores, or judges
 * the two pictures — that they sit side by side IS the whole reading, and it belongs to the user.
 * One photo renders one slot plus an honest line, never the same picture twice. "All photos" is
 * display-only until the drill screen lands (a later parcel) — rendered disabled, only when there
 * is more than the pair to see.
 */
export function PhotoPairWidget({ data }: { data: PhotoPairPayload }) {
  return (
    <div>
      <div className="pw-photos">
        <Slot slot={data.first} alt={`Progress photo, ${slotDate(data.first.date)}`} single={!data.latest} />
        {data.latest && <Slot slot={data.latest} alt={`Progress photo, ${slotDate(data.latest.date)}`} />}
      </div>
      {!data.latest && <div className="pw-photos-note">One photo so far — the next one makes this a pair.</div>}
      {data.next_due && (
        <div className="pw-photos-due">
          <span className="pw-photos-due-t">Next photo due {slotDate(data.next_due)}</span>
          {data.count > 2 && (
            <button type="button" className="pw-photos-all" disabled aria-disabled="true">
              All photos ›
            </button>
          )}
        </div>
      )}
    </div>
  );
}
