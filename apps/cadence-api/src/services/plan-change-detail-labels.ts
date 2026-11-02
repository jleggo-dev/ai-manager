import { ANYTIME } from './plan-edit.ts';

/** "6:30 pm", "7 am" — the user's own 12-hour clock, minutes dropped on the hour. Anything that
 *  isn't a bare HH:MM passes through unchanged, except the literal `anytime` plan-edit.ts stores
 *  for "no particular time" — spelled out the same way its own card lines already say it. */
export function clockLabel12(raw: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return raw === ANYTIME ? 'any time' : raw;
  const minute = Number(m[2]);
  let hour = Number(m[1]) % 12;
  if (hour === 0) hour = 12;
  const suffix = Number(m[1]) >= 12 ? 'pm' : 'am';
  return minute === 0 ? `${hour} ${suffix}` : `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
}
