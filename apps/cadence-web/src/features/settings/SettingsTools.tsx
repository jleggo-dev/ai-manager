/**
 * Settings Room 1b — "What you're working with" (SR-4). The chip-grid replacement for the July
 * review wizard's four-select Tools step (deleted with the wizard): no category picker,
 * no per-item form, just a flat list of removable chips plus a type-to-add. The server still wants
 * a category on every row (`addEquipment` requires one) — this screen passes 'other', the same
 * neutral default the old wizard's "+ Add a tool" button always used, and never surfaces a picker
 * for it. The user never chooses one; that sorting is Cadence's job, not theirs (footer line).
 *
 * Standalone: fetches its own data via getReview() and takes only onBack/onCoach, so the Settings
 * Room parcel can mount it without knowing anything about review state.
 */
import { useEffect, useState } from 'react';
import type { Equipment, EquipmentCategory } from '@cadence/shared';
import { addEquipment, deleteEquipmentItem, getReview, sendGymPhotos } from '../../lib/api.ts';
import { downscalePhoto } from '../plan/occurrence/format.ts';
import '../../styles/settings-editors.css';

const EQUIPMENT_DEFAULT_CATEGORY: EquipmentCategory = 'other';

export function SettingsTools({ onBack }: { onBack: () => void; onCoach?: (note: string) => void }) {
  const [equipment, setEquipment] = useState<Equipment[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getReview()
      .then((r) => {
        if (alive) setEquipment(r.equipment);
      })
      .catch(() => {
        if (alive) setLoadErr(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function remove(item: Equipment) {
    if (!equipment) return;
    setEquipment(equipment.filter((x) => x.equipment_id !== item.equipment_id));
    try {
      await deleteEquipmentItem(item.equipment_id);
    } catch {
      // Best-effort: a failed delete just means it reappears on next load, which is honest enough
      // for a chip removal — no error banner for something this low-stakes.
    }
  }

  async function add() {
    const name = draft.trim();
    if (!name || busy || !equipment) return;
    setBusy(true);
    try {
      const created = await addEquipment({ name, category: EQUIPMENT_DEFAULT_CATEGORY });
      setEquipment([...equipment, created]);
      setDraft('');
    } catch {
      // Leave the draft in place so the tap isn't lost — they can just try again.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fh">
      <div className="fh-head">
        <button className="fh-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <b className="fh-title">Tools</b>
      </div>
      <div className="fh-body">
        <div className="se-kicker">Tools · yours to edit</div>
        <div className="se-intro">
          {
            "Workout equipment, books, kitchen appliances — list the tools that drive your success. Remove anything that's gone."
          }
        </div>

        <div className="se-card">
          {loadErr && <div className="se-note">{"Couldn't load your tools just now — try again shortly."}</div>}
          {equipment === null && !loadErr && <div className="se-empty">Loading…</div>}
          {equipment !== null && (
            <>
              {equipment.length === 0 && <div className="se-empty">Nothing on the list yet.</div>}
              {equipment.length > 0 && (
                <div className="se-chips">
                  {equipment.map((eq) => (
                    <span className="se-chip" key={eq.equipment_id}>
                      {eq.name}
                      <button
                        type="button"
                        className="se-chip-x se-chip-x-warm"
                        onClick={() => void remove(eq)}
                        aria-label={`Remove ${eq.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="se-add-row">
                <input
                  className="wiz-in"
                  value={draft}
                  placeholder='e.g. "kettlebell"'
                  disabled={busy}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void add();
                    }
                  }}
                />
                <button className="se-add-btn" onClick={() => void add()} disabled={busy || !draft.trim()}>
                  Add
                </button>
              </div>
            </>
          )}
        </div>

        <GymPhotoCard />

        <div className="se-footer">
          {
            'You don\'t file these under anything — that\'s my job. "Kettlebell" and "the park pull-up bar" both just go on the list.'
          }
        </div>
      </div>
    </div>
  );
}

/**
 * "Snap the gym" reuses the exact detour photo path (PlanView.tsx's sendGym) rather than a new
 * one. That path is scoped to an ACTIVE detour episode server-side (equipment-photo route: "the
 * photo only means something inside one" — 409 without one), so outside a detour this card's
 * honest answer is "not right now", not a fabricated "couldn't read the photo".
 */
function GymPhotoCard() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function sendGym(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    setNote('');
    try {
      const photos = await Promise.all([...files].slice(0, 4).map((f) => downscalePhoto(f)));
      const r = await sendGymPhotos(photos);
      if (r.ok && r.saw) {
        setNote(r.saw.length ? `I can see: ${r.saw.join(', ')}.` : 'Looks like a bare room — noted.');
      } else {
        setNote(
          "That only works while I'm actively reworking a detour week — outside one, just tell me about your gear in chat.",
        );
      }
    } catch {
      setNote("Couldn't read that photo — try another angle?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="se-card">
      <div className="se-card-t">Snap the gym</div>
      <div className="se-card-sub">One photo — I&apos;ll work out what&apos;s there</div>
      <label className="se-photo-btn">
        {busy ? 'Looking…' : '📷 Take a photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          disabled={busy}
          onChange={(e) => {
            void sendGym(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {note && <div className="se-note">{note}</div>}
    </div>
  );
}
