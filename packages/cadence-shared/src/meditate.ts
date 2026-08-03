/* ════════════════════════════════════════════════════════════════
   Meditation timer — bells, and the "came back" tap (REQ9 §4.2)
   ════════════════════════════════════════════════════════════════ */

/**
 * A held quiet. Structurally this is the existing step timer with two additions: **bells** (start,
 * end, and optionally an interval) and the **"came back" tap** — an optional target the person
 * presses when they notice their attention wandered and they returned.
 *
 * The rule that shapes everything here: **noticing the drift IS the practice, so there is nothing
 * to fail.** That is why the tap has no running count on screen (a visible tally turns wandering
 * into something being measured while you are trying not to measure things) and why zero taps
 * produces no closing sentence at all — zero could mean a settled sit or a forgotten gesture, and
 * the app must not guess which.
 *
 * Dependency-free and pure, like `breathing.ts`: the renderer owns the clock and calls these.
 */

/**
 * How sitting works, in plain words — shown behind "What's this?" on the card, the same
 * affordance breathing and grounding use.
 */
export const MEDITATE_HOW =
  'Sit, and let the clock keep the time so you do not have to. A bell marks the start and the end, so you can close your eyes and stop wondering how long is left. When you notice your attention has wandered, that IS the practice working — come back, and carry on.';

/** Which bells ring. `interval` implies start and end too. */
export type MeditateBells = 'none' | 'start_end' | 'interval';

export const MEDITATE_BELL_KINDS: readonly MeditateBells[] = ['none', 'start_end', 'interval'];

export function isMeditateBells(v: string | null | undefined): v is MeditateBells {
  return typeof v === 'string' && (MEDITATE_BELL_KINDS as readonly string[]).includes(v);
}

/* ── Bounds (clamped app-side; the coach cannot exceed them) ───────────────────────────────── */

export const MIN_SIT_MINUTES = 1;
/** An hour is past where a coached app should be prescribing unsupervised sitting. */
export const MAX_SIT_MINUTES = 60;
export const DEFAULT_SIT_MINUTES = 10;
/** Interval bells closer than this turn a sit into a metronome. */
export const MIN_INTERVAL_MINUTES = 1;
export const DEFAULT_INTERVAL_MINUTES = 5;

/** Whole minutes the sit runs for, bounded. Missing/garbage falls back to the default. */
export function clampSitMinutes(minutes: number | null | undefined): number {
  const asked = typeof minutes === 'number' && Number.isFinite(minutes) ? Math.round(minutes) : DEFAULT_SIT_MINUTES;
  return Math.min(MAX_SIT_MINUTES, Math.max(MIN_SIT_MINUTES, asked));
}

/**
 * Interval spacing in minutes, bounded and never longer than the sit itself (an interval bell that
 * can't ring is just a confusing setting).
 */
export function clampIntervalMinutes(sitMinutes: number, interval: number | null | undefined): number {
  const sit = clampSitMinutes(sitMinutes);
  const asked =
    typeof interval === 'number' && Number.isFinite(interval) ? Math.round(interval) : DEFAULT_INTERVAL_MINUTES;
  return Math.min(sit, Math.max(MIN_INTERVAL_MINUTES, asked));
}

/**
 * The elapsed-second marks at which a bell rings — excluding the start bell (which the player
 * rings as it begins) and including the end. Deterministic, so the renderer just checks
 * membership as the clock advances rather than tracking its own schedule.
 */
export function bellMarks(sitMinutes: number, bells: MeditateBells, intervalMinutes?: number | null): number[] {
  const total = clampSitMinutes(sitMinutes) * 60;
  if (bells === 'none') return [];
  const marks: number[] = [];
  if (bells === 'interval') {
    const step = clampIntervalMinutes(sitMinutes, intervalMinutes) * 60;
    for (let t = step; t < total; t += step) marks.push(t);
  }
  marks.push(total);
  return marks;
}

/** Does a bell ring on this exact elapsed second? */
export function ringsAt(
  elapsedSec: number,
  sitMinutes: number,
  bells: MeditateBells,
  intervalMinutes?: number | null,
): boolean {
  return bellMarks(sitMinutes, bells, intervalMinutes).includes(Math.round(elapsedSec));
}

const WORDS = [
  'zero',
  'once',
  'twice',
  'three times',
  'four times',
  'five times',
  'six times',
  'seven times',
  'eight times',
  'nine times',
  'ten times',
  'eleven times',
  'twelve times',
];

/**
 * The one sentence shown at the close — "You noticed four times." — or **null when the count is
 * zero**, which is deliberate: a zero could be a settled sit or a forgotten gesture, and praising
 * it ("perfect focus") would both guess wrong and turn the tap into a score.
 *
 * Always words, never a digit badge, and never compared to a previous sit, an average, or a trend.
 */
export function returnsSentence(returns: number): string | null {
  const n = Math.max(0, Math.round(returns));
  if (n === 0) return null;
  const word = WORDS[n] ?? 'a good few times';
  return `You noticed ${word}.`;
}

/** The steady line under it. Fixed copy — the point of the practice, said the same way every time. */
export const RETURNS_FOOTER = 'That noticing is the practice — there is nothing to beat.';

/** The one-line receipt a finished or abandoned sit contributes to the occurrence log. */
export function sitLogLine(elapsedSec: number, targetSec: number): string {
  const target = Math.max(0, Math.round(targetSec / 60));
  if (elapsedSec >= targetSec) return `${target} min`;
  // "0 of 10 min" reads like a failure; sitting down at all is the thing being credited.
  if (elapsedSec < 60) return `less than a minute · that counts`;
  return `${Math.round(elapsedSec / 60)} of ${target} min · that counts`;
}
