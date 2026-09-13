import type { PlanDay, PlanOccurrence } from '../../lib/api.ts';

/**
 * Nodes the trail draws that are NOT rows on the server — stand-ins with the node's shape, an
 * id that says what they are, and nothing downstream can mistake for a row (`isSyntheticOccurrence`
 * is the gate's own check before opening anything, and the trail wires no hold on them).
 *
 *  - `previewOccurrences` — a locked day nothing has written yet carries the rhythm the server
 *    projected onto it (`preview`, the API's plan-preview.ts): the same muted discs a locked
 *    day's real rows get, there to see and to tap for the gate prompt.
 *  - `checkinOccurrence` — the weekly check-in as a task on its own day (owner, 2026-09-13: "it
 *    should be either as a task today or otherwise indicated in the UI… on the day where it's
 *    demanded"). The server's own "Weekly check-in" row is retired from the trail (check-in
 *    rebuild, step 7) because its date follows the plan's recurrence, not the week clock; this
 *    one sits on `ends_on` — or on today once that day is past — and a tap starts the check-in.
 */
const PREVIEW_ID = 'preview:';
const CHECKIN_ID = 'checkin:';

export const CHECKIN_TITLE = 'Weekly check-in';

export function previewOccurrences(day: Pick<PlanDay, 'date' | 'preview'>): PlanOccurrence[] {
  return (day.preview ?? []).map((p, i) => ({
    occurrence_id: `${PREVIEW_ID}${day.date}:${i}`,
    activity_id: '',
    title: p.title,
    kind: 'user',
    status: 'pending',
    ...(p.time_of_day ? { time_of_day: p.time_of_day } : {}),
    ...(p.area ? { area: p.area } : {}),
  }));
}

export function checkinOccurrence(date: string): PlanOccurrence {
  return {
    occurrence_id: `${CHECKIN_ID}${date}`,
    activity_id: '',
    title: CHECKIN_TITLE,
    kind: 'system',
    status: 'pending',
  };
}

export const isPreviewOccurrence = (occ: Pick<PlanOccurrence, 'occurrence_id'>): boolean =>
  occ.occurrence_id.startsWith(PREVIEW_ID);

export const isCheckinOccurrence = (occ: Pick<PlanOccurrence, 'occurrence_id'>): boolean =>
  occ.occurrence_id.startsWith(CHECKIN_ID);

export const isSyntheticOccurrence = (occ: Pick<PlanOccurrence, 'occurrence_id'>): boolean =>
  isPreviewOccurrence(occ) || isCheckinOccurrence(occ);
