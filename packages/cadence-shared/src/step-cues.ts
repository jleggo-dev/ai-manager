/* ════════════════════════════════════════════════════════════════
   Step cues — the deterministic reads of a step's own words
   ════════════════════════════════════════════════════════════════ */

/**
 * Three small decisions the walkthrough makes from a step's title, cue text and length. Each is a
 * regex or a threshold that decides behaviour, so each lives here ONCE with a table test beside it
 * (the owner's rule: a router that fails silently ships with positives AND near-misses).
 *
 * They came out of one ruck on 2026-09-06:
 *  • the 50-min ruck timer auto-advanced at 50:00 and could not be told the ruck ran to 110;
 *  • the calf stretch said "switch sides" in its cue and nothing marked the halfway point;
 *  • a "Knee check-in" step was prescribed as a feeling_log and asked about the person's head.
 */

/** A timer at least this long is an EFFORT, not a hold — it keeps running past its target. */
export const OPEN_ENDED_TIMER_MIN = 10;

/**
 * Whether a timer of `seconds` should keep running past its target until the person stops it.
 *
 * A 60-second calf stretch and a 50-minute ruck are the same tool, but not the same step. The
 * stretch is a HOLD: the clock ending is the instruction to let go, so it chimes and moves on. The
 * ruck is an EFFORT: the clock ending is a milestone, and the ruck lasts as long as the ruck lasts.
 * Ten minutes is the line — nothing anyone holds runs that long, and every walk, ruck, run, ride
 * or practice block does.
 */
export function isOpenEndedTimer(seconds: number): boolean {
  return seconds >= OPEN_ENDED_TIMER_MIN * 60;
}

/**
 * Whether a step's words ask for the work to be done on each side — a stretch, a single-leg
 * hold, a carry. The timer then marks the halfway point with a chime and a visible "switch
 * sides", so the second leg gets the same time as the first without the person doing arithmetic
 * on a clock. Reads the cue AND the title: "Calf stretch (each side)" carries it in the name.
 *
 * This is the FALLBACK, not the source of truth. The coach states the fact as `per_side` on the
 * item (tool-catalog.ts), and `timerTool` never reads the words when she has said anything.
 * The words only decide for sessions prescribed before the field existed — the reason it stays
 * deliberately narrow: "side plank" is ONE side, "side steps" and "lateral" name a direction, and
 * only the phrasings that mean "then do the other one" match.
 */
export function mentionsSides(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\b(?:switch|swap|change)\s+(?:sides?|legs?|arms?)\b|\b(?:each|per|both|either|other)\s+(?:side|leg|arm|foot|hand|hip|shoulder|knee|ankle|calf|wrist)s?\b|\bon\s+the\s+other\s+(?:side|leg|arm)\b/i.test(
    text,
  );
}

/** The parts of the body a check-in step can be about. Matched as whole words. */
const BODY_PARTS = [
  'knee',
  'knees',
  'ankle',
  'ankles',
  'hip',
  'hips',
  'back',
  'lower back',
  'shoulder',
  'shoulders',
  'neck',
  'calf',
  'calves',
  'foot',
  'feet',
  'heel',
  'heels',
  'wrist',
  'wrists',
  'elbow',
  'elbows',
  'hamstring',
  'hamstrings',
  'quad',
  'quads',
  'glute',
  'glutes',
  'achilles',
  'shin',
  'shins',
  'groin',
  'it band',
] as const;

const BODY_PART_RE = new RegExp(`\\b(${BODY_PARTS.join('|')})\\b`, 'i');

/**
 * The body part a step is checking on, or null when it is not a body check at all.
 *
 * A feeling_log asks ONE word for how the person is doing — settled, wired, heavy. Prescribed as
 * "Knee check-in" it asks the wrong question with a straight face: the vocabulary is entirely
 * about the head, and a knee is not settled or foggy. So a step whose words name a body part is
 * a body check, and the walkthrough renders it as a free-text note about that part instead.
 *
 * Only the NAMED part counts: "How are you doing?", "Mood check", "Energy check-in" stay a feeling
 * log. "Back" alone is ambiguous ("back to the mat") so it needs the check-in shape around it —
 * the caller passes a title, and a title that is only a cue never reaches here.
 */
export function bodyCheckinPart(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = BODY_PART_RE.exec(text);
  if (!m) return null;
  const part = (m[1] ?? '').toLowerCase();
  // "back" is the one word that is also a direction. It only counts as the body part when the
  // step is plainly a check on it ("Back check-in", "How's your back") — never "back to the mat".
  if (part === 'back' && !/\b(?:back\s+check|your\s+back|lower\s+back|back\s+pain|back\s+feel)/i.test(text))
    return null;
  return part;
}

/** The question a body check asks, in the coach's plain voice: "How's the knee?" */
export function bodyCheckinPrompt(part: string): string {
  const plural = /s$|feet$/.test(part) && !/achilles/.test(part);
  return `How ${plural ? 'are' : 'is'} the ${part}?`;
}
