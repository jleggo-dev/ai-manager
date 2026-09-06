import { useState } from 'react';
import { displayWeightUnit, formatWeight, type ProgressPhotoSlot, type WeightUnit } from '@cadence/shared';
import type { ProgressPhotoList } from '../../lib/api.ts';
import { useProgressPhotoPair, useProgressPhotos, useUnits, useUploadProgressPhoto } from '../../lib/query/index.ts';
import { localTodayIso } from '../../lib/query/keys.ts';
import { downscalePhoto } from '../plan/occurrence/format.ts';
import '../../styles/progress-widgets.css';

/**
 * The "All photos" screen (SR-5, Settings Room wave) — every progress photo the user has, oldest
 * to newest, dated and weight-stamped, never scored (docs/cadence/BRAND.md). Opt-in end to end:
 * off shows one quiet line pointing at Settings and nothing else; the due card only ever appears
 * for a user who turned this on. SessionListScreen's idiom (back header + scrollbody) — this
 * parcel does not touch ProgressView.tsx, BoundWidget.tsx, or widgets/; `PhotosRow` below is the
 * unwired door another wave hangs on the Progress page.
 */

/** 'YYYY-MM-DD' → 'Jan 5' — the same reading PhotoPairWidget.tsx uses, so a date never looks
 *  different depending on which screen shows it. */
function slotDate(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Jan 5 · 86.0 kg" (or "· 189.6 lb") — date, plus the user's own nearest weigh-in when one
 *  existed, in THEIR unit. Absent weight shows the date alone; never a zero, never invented. */
function caption(slot: ProgressPhotoSlot, unit: WeightUnit): string {
  const date = slotDate(slot.date);
  return slot.weight_kg === null ? date : `${date} · ${formatWeight(slot.weight_kg, unit)}`;
}

/** "3 photos" / "1 photo" / "none yet" — facts only, no framing either way. */
function photoCountLabel(count: number): string {
  return count > 0 ? `${count} photo${count === 1 ? '' : 's'}` : 'none yet';
}

/** Due once the server's next-due date has arrived, OR there has never been a photo at all — the
 *  empty-but-on state invites the first one the same warm way. A future next_due stays quiet. */
function photoDue(list: ProgressPhotoList, today: string): boolean {
  return list.next_due === null || list.next_due <= today;
}

function PhotoCell({ slot, unit }: { slot: ProgressPhotoSlot; unit: WeightUnit }) {
  return (
    <div className="apg-cell">
      <img className="apg-img" src={slot.url} alt={`Progress photo, ${slotDate(slot.date)}`} loading="lazy" />
      <div className="pw-photos-cap">{caption(slot, unit)}</div>
    </div>
  );
}

/** The stamp speaks the user's own unit (resolved server-side — never re-derived here); a failed
 *  read falls back to kg rather than blocking the photos. Through the shared units entry, so the
 *  stamps are in the right unit on the first frame rather than flipping under the reader. */
function useBodyWeightUnit(): WeightUnit {
  const { data } = useUnits();
  return displayWeightUnit(data?.resolved?.body_weight);
}

function DueCard({
  onPick,
  busy,
  err,
}: {
  onPick: (file: File | null | undefined) => void;
  busy: boolean;
  err: string;
}) {
  return (
    <div className="apg-due">
      <div className="apg-due-t">
        <b>Time for this month&rsquo;s photo</b>
        <span>dated &amp; weight-stamped automatically</span>
      </div>
      {/* Same capture pattern the food flow uses: capture="environment" opens the rear camera on
          phones, a file picker on desktop (FridgeFromPhotoPanel.tsx). */}
      <label className="apg-due-btn">
        {busy ? 'Saving…' : 'Take or choose'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          disabled={busy}
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = ''; // same photo re-pickable
          }}
        />
      </label>
      {err && <div className="apg-due-err">{err}</div>}
    </div>
  );
}

export function PhotosScreen({ onBack }: { onBack: () => void }) {
  const { data, error } = useProgressPhotos();
  const upload = useUploadProgressPhoto();
  const unit = useBodyWeightUnit();
  const [captureErr, setCaptureErr] = useState('');

  async function pickPhoto(file: File | null | undefined) {
    if (!file || upload.isPending) return;
    setCaptureErr('');
    try {
      const photo = await downscalePhoto(file);
      const stored = await upload.mutateAsync({ photo });
      if (!stored) setCaptureErr("That didn't save — give it another try.");
    } catch {
      setCaptureErr("Couldn't read that photo — try a different one.");
    }
  }

  const due = data?.enabled === true && photoDue(data, localTodayIso());

  return (
    <div className="js" role="dialog" aria-label="All photos">
      <div className="js-bar">
        <button className="jw-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div>
          <div className="screen-title">All photos</div>
          {data && <div className="screen-sub">{photoCountLabel(data.count)}</div>}
        </div>
      </div>

      <div className="scrollbody">
        {error && !data && <div className="wiz-empty">{"Couldn't load your photos just now — try again shortly."}</div>}
        {data && !data.enabled && <div className="apg-off">Progress photos are off — turn them on in Settings.</div>}
        {data?.enabled && (
          <>
            {due && <DueCard onPick={pickPhoto} busy={upload.isPending} err={captureErr} />}
            {data.photos.length > 0 && (
              <div className="apg-grid">
                {data.photos.map((slot, i) => (
                  <PhotoCell key={`${slot.date}-${i}`} slot={slot} unit={unit} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The journal-row idiom (ProgressView.tsx's JournalRow) — the door SR-5 hands the lead to wire
 *  into the Progress page. Reads the pair query rather than the full list: the pair's `count`
 *  field is the same number and the widget (when present) has usually already paid for the
 *  fetch, so this never adds a second round trip just to show a headline count. Off and
 *  on-but-empty both read as the omission today — both are honestly "none yet" here. */
export function PhotosRow({ onOpen }: { onOpen: () => void }) {
  const { data } = useProgressPhotoPair();
  const count = data && 'count' in data ? data.count : 0;
  return (
    <button className="journal-row" onClick={onOpen}>
      <span className="journal-row-t">
        <b>Your photos</b>
        <span>{data ? photoCountLabel(count) : ''}</span>
      </span>
      <span aria-hidden>›</span>
    </button>
  );
}
