import type { ActiveEpisode } from '../../lib/api.ts';

/**
 * The bar's one sentence. Its own module because the component file may only export components
 * (react-refresh), and because the day arithmetic is worth testing without rendering anything.
 */
/** "You're on an alternate plan — traveling, day 2 of 7". */
export function barLine(e: ActiveEpisode): string {
  // A pause has no alternate plan to be on — nothing was put in the plan's place, so counting
  // "day 2 of 7" of an empty stretch would announce a shape that is not there. It says the one
  // thing that is true: when the plan comes back. `end` is the last paused day, so the day it
  // reads is the day after.
  if (e.paused) return `Paused until ${dayName(addDays(e.end, 1))}`;
  const total = spanDays(e.start, e.end);
  const day = Math.min(Math.max(spanDays(e.start, todayIso()), 1), total);
  return `You're on an alternate plan — ${WORD[e.type]}, day ${day} of ${total}`;
}

/** "Mon 14 Sep" — the same shorthand the rest of the plan uses for a date you glance at. */
function dayName(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** The user-facing word for each kind — plain words for hard things, never euphemism (BRAND.md). */
const WORD: Record<ActiveEpisode['type'], string> = {
  travel: 'traveling',
  illness: 'unwell',
  injury: 'injured',
  recovery: 'recovering',
  custom: 'off the usual shape',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Inclusive, so a detour that starts and ends today reads "day 1 of 1" rather than 0. */
function spanDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}
