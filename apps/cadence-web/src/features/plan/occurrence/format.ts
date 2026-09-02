import { isWeeklyCheckinTitle } from '@cadence/shared';
import type { MealKind, OccurrenceDetail } from '../../../lib/api.ts';

/** YouTube SEARCH result page from a model-supplied query — never a model-supplied URL. */
export const ytSearch = (q: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(q.replace(/\s+/g, ' ').trim())}`;

/** System food/meal/nutrition rows — open even when already ticked done. Also matches the per-meal
 *  split tasks ("Log breakfast/lunch/dinner/snack"), which carry no "food"/"meal" token. */
export const isFoodRow = (d: OccurrenceDetail | null): boolean =>
  !!d && d.kind === 'system' && /food|meal|nutrition|breakfast|lunch|dinner|snack/i.test(d.title);

/** The meal a split task names ("Log breakfast" → breakfast), or null for a generic food task —
 *  lets the meal capture pre-select the right meal instead of guessing from the clock. */
export const mealFromTitle = (title: string): MealKind | null => {
  const m = title.toLowerCase().match(/breakfast|lunch|dinner|snack/);
  return (m?.[0] as MealKind | undefined) ?? null;
};

/**
 * The weekly check-in row (A23 §2b). Backed by the canonical matcher in `@cadence/shared`
 * (`isWeeklyCheckinTitle`), shared with the server's local-notification producer
 * (`notify/local-plan.ts` findWeeklyCheckin): the notification is the door and this is the room,
 * and they must not disagree about which occurrence is which.
 *
 * Typed on just the two fields it reads (not the full `OccurrenceDetail`) so the trail — which
 * only ever holds the slimmer `PlanOccurrence` list shape (no `date`/`schedule`/etc.) — can reuse
 * this SAME matcher to retire the row visually (check-in rebuild, step 6) instead of growing a
 * second regex that could drift from this one.
 */
export const isWeeklyCheckin = (d: Pick<OccurrenceDetail, 'kind' | 'title'>): boolean =>
  d.kind === 'system' && isWeeklyCheckinTitle(d.title);

/** Sensible default meal for right now — the user can always switch it. */
export const mealForNow = (now = new Date()): MealKind => {
  const h = now.getHours();
  return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 17 ? 'snack' : h < 21 ? 'dinner' : 'snack';
};

/**
 * Downscale a photo client-side (max 1024px, JPEG q0.8) so a 10MB phone shot becomes a
 * ~100-300KB upload — well inside the server's caps. Returns a data URL.
 */
export function downscalePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}

/** Longest side after the 1024px cap — pure math for the canvas resize step. */
export function downscaleDimensions(width: number, height: number, maxSide = 1024): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
