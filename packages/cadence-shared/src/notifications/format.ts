/* ════════════════════════════════════════════════════════════════
   Small text helpers shared by the copy builders
   ════════════════════════════════════════════════════════════════ */

/**
 * These live apart from the copy so a sentence stays readable as a sentence. They are all pure and
 * all boring on purpose — a notification is not the place for clever formatting, and every one of
 * these exists because getting it wrong produces a line that reads as written by a machine.
 */

/** 7:30, 18:05 — the user's own clock face. Minutes are dropped on the hour ("6", not "6:00"). */
export function clockLabel(hour: number, minute: number): string {
  const h = Math.max(0, Math.min(23, Math.trunc(hour)));
  const m = Math.max(0, Math.min(59, Math.trunc(minute)));
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * Number words for the small counts a nudge actually says. Spelled out because "3 weeks to race
 * day" reads like a dashboard and "Three weeks to race day" reads like someone told you.
 *
 * Falls back to digits above the table rather than growing it — past thirty or so the digit IS how
 * a person would say it, and a half-finished word table is how "twenty-oneth" ships.
 */
const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
] as const;

const ROUND_WORDS: Record<number, string> = { 14: 'fourteen', 20: 'twenty', 21: 'twenty-one', 30: 'thirty' };

export function numberWord(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  const i = Math.trunc(n);
  return NUMBER_WORDS[i] ?? ROUND_WORDS[i] ?? String(i);
}

/** Sentence-initial form of `numberWord`. */
export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * "half an hour" / "about 40 minutes" — the way someone says a gap out loud.
 *
 * Rounded to the nearest five because a nudge that claims "43 minutes until quiet hours" is
 * claiming a precision it does not have (it was scheduled, not measured) and sounds like a timer
 * rather than a coach.
 */
export function durationLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes / 5) * 5);
  if (m === 30) return 'half an hour';
  if (m === 60) return 'an hour';
  if (m === 0) return 'a moment';
  return `${m} minutes`;
}

/**
 * Subject-verb agreement for a title built from the user's own activity name.
 *
 * "Your stretch still fits" and "Four breaths still fit" are both required by the catalog, and
 * getting this wrong is the exact tell that a template wrote the sentence. The plural test is
 * deliberately crude — trailing `s` that is not a `ss`/`us`/`is` ending — because the alternative
 * is a lexicon, and the cost of a miss here is one slightly odd sentence, not a wrong fact.
 */
export function isPluralish(title: string): boolean {
  const w = title.trim().toLowerCase().split(/\s+/).pop() ?? '';
  return /s$/.test(w) && !/(ss|us|is|ous)$/.test(w);
}

/** True when the title already opens with its own determiner or count ("Four breaths", "my sit"). */
export function hasLeadingDeterminer(title: string): boolean {
  return /^(a|an|the|my|your|some|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(title.trim());
}

/**
 * "Your stretch" / "Four breaths" — possessive only where the user's phrasing does not already
 * supply one. Prefixing blindly gives "Your Four breaths", which reads as a mail merge.
 */
export function possessive(title: string): string {
  const t = title.trim();
  return hasLeadingDeterminer(t) ? t : `Your ${t}`;
}
