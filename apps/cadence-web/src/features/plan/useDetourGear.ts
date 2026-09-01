import { useState } from 'react';
import { postponeDetour, sendDetourEquipment, sendGymPhotos } from '../../lib/api.ts';
import { downscalePhoto } from './occurrence/format.ts';

/** Detour gear failure line — plain, and never silent (PLAN-CHANGES.md Phase 0). */
const GEAR_FAIL = "Couldn't rework the week around that just now — try again in a moment.";

/**
 * The detour-day equipment answers, extracted from PlanView (which lives against the 500-line
 * cap): gym photos, the arrival-day gear chips, and "not yet". One busy flag and one verdict
 * line (`gymSaw`) across all three, because they share the single `.detour-saw` slot in the UI.
 *
 * The gym photos → equipment revision (PLAN §424). Several angles are ONE answer: files
 * accumulate in the input and send as one request; the banner shows what the model saw.
 */
export function useDetourGear({ refresh, bump }: { refresh: () => void; bump: () => void }) {
  const [gymBusy, setGymBusy] = useState(false);
  const [gymSaw, setGymSaw] = useState<string | null>(null);
  // Arrival-day answers (owner, 2026-08-04): the card asks once, on the scheduled start.
  const [arrivalGear, setArrivalGear] = useState<string[]>([]);

  async function sendGym(files: FileList | null) {
    if (!files?.length || gymBusy) return;
    setGymBusy(true);
    setGymSaw(null);
    try {
      const photos = await Promise.all([...files].slice(0, 4).map((f) => downscalePhoto(f)));
      const r = await sendGymPhotos(photos);
      if (r.ok && r.saw) {
        setGymSaw(
          r.saw.length
            ? `I can see: ${r.saw.join(', ')}.${r.revised ? ' Reworking your week around it.' : ''}`
            : 'Looks like a bare room — keeping things equipment-free.',
        );
        if (r.revised) {
          refresh();
          bump();
        }
      } else {
        setGymSaw("Couldn't read that photo — try another angle?");
      }
    } catch {
      setGymSaw("Couldn't read that photo — try another angle?");
    } finally {
      setGymBusy(false);
    }
  }

  async function confirmArrivalGear(explicitNone: boolean) {
    if (gymBusy) return;
    setGymBusy(true);
    try {
      const list = explicitNone ? [] : arrivalGear.map((name) => ({ name }));
      const r = await sendDetourEquipment(list);
      if (r.ok) {
        setGymSaw(
          explicitNone ? 'Equipment-free it is — reworking your days.' : 'Got it — reworking your days around that.',
        );
        refresh();
        bump();
      } else {
        // {ok:false} used to show NOTHING — a failed rework read exactly like a landed one.
        setGymSaw(GEAR_FAIL);
      }
    } catch {
      setGymSaw(GEAR_FAIL);
    } finally {
      setGymBusy(false);
    }
  }

  async function notArrivedYet() {
    await postponeDetour().catch(() => {});
    refresh(); // today's sessions come back; the card returns tomorrow
    bump();
  }

  return { gymBusy, gymSaw, arrivalGear, setArrivalGear, sendGym, confirmArrivalGear, notArrivedYet };
}
