import type { SessionItem } from '@cadence/shared';
import type { MealKind, MealMacros, OccurrenceDetail } from '../../../lib/api.ts';

/** "3×8 @ 55 lb · 12 min · 5 km" — compose only from the fields the item actually has. */
export function qty(i: SessionItem): string {
  const parts: string[] = [];
  if (i.sets && i.reps) parts.push(`${i.sets}×${i.reps}`);
  else if (i.sets) parts.push(`${i.sets} sets`);
  else if (i.reps) parts.push(`${i.reps} reps`);
  if (i.load) parts.push(`@ ${i.load}`);
  if (i.duration_min) parts.push(`${i.duration_min} min`);
  if (i.distance_km) parts.push(`${i.distance_km} km`);
  return parts.join(' · ');
}

/**
 * "40 min (allow 50)" for the sheet header — the effort, then the time to actually keep free.
 *
 * `schedule.duration_min` is the effort alone (owner ruling 2026-08-17), and the honest total here
 * is not an estimate: the session has already been written, so the sum of its prescribed blocks —
 * warm-up and cool-down included — is exactly what `deriveWalkthrough` puts on the Start button.
 * Reading the total from the same place the button does is what stops this header contradicting
 * the button twenty lines below it, which it did whenever a session ran longer than its schedule.
 *
 * Falls back to the bare effort when no session has been prescribed yet, rather than guessing:
 * the rows without one are check-ins and food logs, which have no warm-up to allow for anyway.
 */
export function sheetMinutes(detail: OccurrenceDetail, wt: { total_min: number } | null): string | null {
  const effort = detail.schedule?.duration_min;
  if (!effort) return null;
  const total = wt?.total_min;
  return total && total > effort ? `${effort} min (allow ${total})` : `${effort} min`;
}

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

/** Pending system weigh-in — deterministic capture, no LLM. */
export const isWeighInPending = (d: OccurrenceDetail): boolean =>
  d.kind === 'system' && /weigh/i.test(d.title) && d.status === 'pending';

/** "1400 · P0 C110 F35 left" — what's remaining toward targets (no ~; these are the goal). */
export function leftLine(m?: MealMacros | null): string {
  if (!m) return '';
  const bits: string[] = [];
  if (m.kcal != null) bits.push(`${m.kcal} kcal`);
  const pcf = [
    m.protein_g != null ? `P${Math.round(m.protein_g)}` : '',
    m.carbs_g != null ? `C${Math.round(m.carbs_g)}` : '',
    m.fat_g != null ? `F${Math.round(m.fat_g)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (pcf) bits.push(pcf);
  return bits.length ? `${bits.join(' · ')} left` : '';
}

/** "~320 kcal · P18 C34 F12" — estimates wear a ~ on purpose. */
export function macroLine(m?: MealMacros): string {
  if (!m?.kcal && !m?.protein_g && !m?.carbs_g && !m?.fat_g) return '';
  const bits: string[] = [];
  if (m.kcal) bits.push(`~${m.kcal} kcal`);
  const pcf = [
    m.protein_g ? `P${Math.round(m.protein_g)}` : '',
    m.carbs_g ? `C${Math.round(m.carbs_g)}` : '',
    m.fat_g ? `F${Math.round(m.fat_g)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (pcf) bits.push(pcf);
  return bits.join(' · ');
}

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
