/* ════════════════════════════════════════════════════════════════
   Timed free-write — a pill variant, not a mode (Design "Journal v2" §1b)
   ════════════════════════════════════════════════════════════════ */

/**
 * "Write continuously for 20 minutes." A duration and a journal entry are the same act here, not
 * two tools stapled together: the coach issues **one duration**, the picker offers that same timed
 * free-write pointed at different topics, and **pressing a row starts the clock** — that press is
 * the commitment. There is no untimed path into a free-write.
 *
 * Everything in this module exists to keep the clock from becoming a scoreboard:
 *
 *   • **Time remaining only.** No words-per-minute, no word count, no "incomplete" state anywhere.
 *     A timer that grades you is a different product.
 *   • **Pausing is never punished.** The idle line is a nudge that fades on the next keystroke; it
 *     never touches, fades, or deletes what someone wrote.
 *   • **Finishing early is an ordinary save.** The duration is mentioned only when the clock
 *     actually ran out — `freeWriteKeptLine` is for that moment and nowhere else.
 *
 * Pure and DOM-free so both the clock hook and its tests can use it.
 */

/** The coach asks for what it means; the app keeps it sane. */
export const MIN_FREE_WRITE_MINUTES = 3;
export const MAX_FREE_WRITE_MINUTES = 60;
export const DEFAULT_FREE_WRITE_MINUTES = 20;

/**
 * Durations offered when the person starts a timed write THEMSELVES (owner, 2026-08-04). Design's
 * §1b assumed the coach always issues the duration, but a timed free-write is a thing people do
 * unprompted — a writer sitting down for twenty minutes does not need permission. The coach's
 * duration wins when it sent one; otherwise these are the choice, and 20 is the default.
 */
export const FREE_WRITE_PRESETS = [5, 10, 20, 30] as const;

/**
 * Where the writing actually happens. `paper` is the case Design's §1b didn't cover (owner,
 * 2026-08-04): **a physical journal with a timer running** — the person writes in their notebook
 * and the app is only the clock. It changes three things and nothing else:
 *
 *   • there is no text area and no keyboard, so the idle nudge does not apply — `shouldNudge`
 *     returns false and nothing is ever shown for "not typing", because not typing IS the mode;
 *   • the kept entry carries no body and is secret by nature, exactly like an untimed paper row —
 *     we never held those words and must not imply we did;
 *   • the clock is the whole screen's job, so the hairline is the only thing that moves.
 *
 * The chime, the "Twenty minutes — kept." line, and early-save-is-an-ordinary-save are identical.
 */
export type FreeWriteSurface = 'typed' | 'paper';

/**
 * Whether the idle nudge may appear. Paper never nudges — the person is writing by hand, and a
 * "keep going" line aimed at a keyboard they aren't using would be nagging about nothing.
 */
export function shouldNudge(surface: FreeWriteSurface, idleMs: number): boolean {
  return surface === 'typed' && idleMs >= FREE_WRITE_IDLE_MS;
}

/** Keyboard idle before the nudge appears. Long enough that a pause to think is never interrupted. */
export const FREE_WRITE_IDLE_MS = 10_000;

/** The nudge itself — an offer, never enforcement. Lowercase on purpose: it is an aside, not a rule. */
export const FREE_WRITE_NUDGE = 'keep going — anything counts';

/** The picker's footer, stating the commitment plainly before anyone taps. */
export const FREE_WRITE_COMMITMENT = 'Choosing starts the timer.';

export function clampFreeWriteMinutes(minutes: number | undefined | null): number {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return DEFAULT_FREE_WRITE_MINUTES;
  return Math.min(MAX_FREE_WRITE_MINUTES, Math.max(MIN_FREE_WRITE_MINUTES, Math.round(minutes)));
}

/** "12:24 left" — the chip shown on tapping the hairline, then gone again. Never counts up. */
export function timeLeftLabel(secondsLeft: number): string {
  const safe = Math.max(0, Math.floor(secondsLeft));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')} left`;
}

/** 0–1 of the way through, for the hairline's fill. Clamped so a paused or overrun clock can't
 *  push the bar past full or negative. */
export function freeWriteProgress(elapsedSec: number, totalSec: number): number {
  if (totalSec <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedSec / totalSec));
}

const WORDS: Record<number, string> = {
  3: 'Three',
  5: 'Five',
  10: 'Ten',
  15: 'Fifteen',
  20: 'Twenty',
  25: 'Twenty-five',
  30: 'Thirty',
  40: 'Forty',
  45: 'Forty-five',
  60: 'An hour',
};

/**
 * The line at time's up — "Twenty minutes — kept." Words rather than digits because this is the
 * coach speaking, not a readout, and because a numeral here would read like a score.
 *
 * ONLY for a clock that actually ran out. Saving early is the ordinary kept moment with the
 * ordinary line, and the duration is never mentioned — there is no partial credit to award because
 * nothing was incomplete.
 */
export function freeWriteKeptLine(minutes: number): string {
  const m = clampFreeWriteMinutes(minutes);
  const word = WORDS[m];
  if (word === 'An hour') return 'An hour — kept.';
  return `${word ?? m} minute${m === 1 ? '' : 's'} — kept.`;
}

/** The sheet header above the rows — "Twenty minutes — pick a place to start". */
export function freeWritePickerHead(minutes: number): string {
  const m = clampFreeWriteMinutes(minutes);
  const word = WORDS[m];
  const span = word === 'An hour' ? 'An hour' : `${word ?? m} minute${m === 1 ? '' : 's'}`;
  return `${span} — pick a place to start`;
}

/** The chip in the sheet header — "20 MIN". */
export function freeWriteDurationChip(minutes: number): string {
  return `${clampFreeWriteMinutes(minutes)} MIN`;
}

export interface FreeWriteRow {
  /** `null` marks the pure row — deterministic, always present, needs no coach input. */
  id: string | null;
  label: string;
  prompt: string;
}

/**
 * The pure free-write row. Pinned to the top of the picker and always offered, so a timed
 * free-write is reachable with no coach involvement at all — the deterministic floor under
 * whatever topics the coach proposes above it.
 *
 * Its prompt is the `free_write` bank's primary phrasing; they are the same question.
 */
export const PURE_FREE_WRITE: FreeWriteRow = {
  id: null,
  label: 'Pure free-write',
  prompt: "Write continuously — whatever comes. Don't stop, don't edit; anything counts.",
};

/**
 * The picker's rows: the pure row first, then whatever topics the coach proposed, deduped against
 * it and capped. Coach topics are ordinary strings; a blank or duplicate one is dropped rather
 * than rendered as an empty row.
 */
export const MAX_FREE_WRITE_TOPICS = 4;

export function freeWriteRows(topics: readonly { label: string; prompt: string }[] = []): FreeWriteRow[] {
  const rows: FreeWriteRow[] = [PURE_FREE_WRITE];
  const seen = new Set([PURE_FREE_WRITE.prompt.toLowerCase()]);
  for (const t of topics) {
    if (rows.length > MAX_FREE_WRITE_TOPICS) break;
    const label = t?.label?.trim();
    const prompt = t?.prompt?.trim();
    if (!label || !prompt) continue;
    const key = prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ id: `t${rows.length}`, label, prompt });
  }
  return rows;
}
