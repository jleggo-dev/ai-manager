/**
 * The words for a played session (walkthrough v3 Phase 6): the pill a set is drawn as, the name
 * a combined group goes by, and the log-line shapes on the design's Redlines board:
 *
 *   "circuit · 3 rounds · bench + row"   — a combined group plays and logs as a circuit
 *   "3×45 s · one at a time"             — a set dragged out of its group
 *
 * Beside set-loads.ts and timed-sets.ts, which hold the other half of the log-line grammar. No
 * React, no clock, nothing a model writes.
 */
import { secondsText } from './timed-sets.ts';
import type { StepTool, WalkthroughStep } from './walkthrough.ts';
import type { CombineMode } from './played-shape.ts';

/** The tail a spread step's log line wears: "3×45 s · one at a time". */
export const SPREAD_TAIL = ' · one at a time';

/** Last words that name the kind of move rather than the move: the first word says more then
 *  ("Bench press" → Bench, where "Dumbbell row" → Row). */
const GENERIC_LAST_WORDS = new Set(['press', 'raise', 'curl', 'extension', 'hold', 'pull', 'push', 'walk']);

/**
 * The one word a set pill and a turn chip go by: "Bench press" → "Bench", "Dumbbell row" → "Row",
 * "Farmer carry" → "Carry", "Dead hang" → "Hang", "Pull-ups" → "Pull-up". The last word, unless it
 * only names the kind of move; a plural loses its s. A one-word title is itself.
 */
export function shortName(title: string): string {
  const words = title
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const last = words[words.length - 1];
  const first = words[0];
  if (last === undefined || first === undefined) return title.trim();
  const pick = words.length > 1 && GENERIC_LAST_WORDS.has(last.toLowerCase()) ? first : last;
  const singular = /[^s]s$/i.test(pick) && pick.length > 3 ? pick.slice(0, -1) : pick;
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

/** Short names for a set of titles — the full titles when two would read the same. */
export function shortNames(titles: readonly string[]): string[] {
  const short = titles.map(shortName);
  const clash = short.some((s, i) => short.findIndex((o) => o.toLowerCase() === s.toLowerCase()) !== i);
  return clash ? titles.map((t) => t.trim()) : short;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "Bench press + dumbbell row" — the row title of a combined group. */
export function groupTitle(titles: readonly string[]): string {
  return titles.map((t, i) => (i === 0 ? t.trim() : lowerFirst(t.trim()))).join(' + ');
}

/** "bench + row" — the eyebrow's and the summary's name for a combined group. */
export function groupNick(titles: readonly string[]): string {
  return shortNames(titles)
    .map((s) => s.toLowerCase())
    .join(' + ');
}

/** "Bench + row" — the recap row's name for a combined group. */
export function groupRecapTitle(titles: readonly string[]): string {
  const nick = groupNick(titles);
  return nick.charAt(0).toUpperCase() + nick.slice(1);
}

/** The pill one set is drawn as: "Pull-up 5", "Hang 45 s", "4 moves × 3 rounds", "6 min". */
export function pillLabel(step: Pick<WalkthroughStep, 'title' | 'tool' | 'minutes'>): string {
  const t = step.tool;
  const short = shortName(step.title);
  if (t.kind === 'reps') return t.reps != null ? `${short} ${t.reps}` : short;
  if (t.kind === 'timer') return `${short} ${secondsText(t.seconds)}`;
  if (t.kind === 'circuit') return `${t.exercises.length} moves × ${t.rounds} rounds`;
  return `${step.minutes} min`;
}

/** The meta word beside a group's title: "3 sets", "1 set", "3 rounds". */
export function groupMeta(turns: number, tool: StepTool | undefined): string {
  if (tool?.kind === 'circuit') return `${tool.rounds} rounds`;
  return `${turns} set${turns === 1 ? '' : 's'}`;
}

/**
 * The log line of a combined group. Alternating turns are a circuit: "circuit · 3 rounds", or
 * "circuit · 2 of 3 rounds" when it stopped early. One step's sets then the other's are a
 * sequence: "in sequence", or "4 of 6 sets · in sequence". Counts what happened, never what broke.
 */
export function groupLogLine(
  mode: CombineMode,
  done: { turns: number; rounds: number },
  total: { turns: number; rounds: number },
): string {
  if (mode === 'alternate') {
    return done.rounds >= total.rounds
      ? `circuit · ${total.rounds} rounds`
      : `circuit · ${done.rounds} of ${total.rounds} rounds`;
  }
  return done.turns >= total.turns ? 'in sequence' : `${done.turns} of ${total.turns} sets · in sequence`;
}

/** What a combined group contributes to the summary the coach reads: its name, its line, and each
 *  member's own numbers behind it — "bench + row circuit · 3 rounds (bench press 3×8 @ 95 lb, dumbbell row 3×10)". */
export function groupSummary(
  nick: string,
  line: string,
  members: ReadonlyArray<{ title: string; line: string }>,
): string {
  const inside = members.map((m) => `${m.title.toLowerCase()} ${m.line}`).join(', ');
  return `${nick} ${line}${inside ? ` (${inside})` : ''}`;
}

/** The eyebrow over a turn: "Circuit · Round 1 of 3 · bench + row", or "Sequence · Set 2 of 3 · bench + row". */
export function groupEyebrow(mode: CombineMode | undefined, round: number, rounds: number, nick: string): string {
  const head = mode === 'sequence' ? `Sequence · Set ${round} of ${rounds}` : `Circuit · Round ${round} of ${rounds}`;
  return `${head} · ${nick}`;
}

/** A turn chip's two lines: "Bench" over "R1". */
export function turnChip(title: string, set: number): { name: string; round: string } {
  return { name: shortName(title), round: `R${set + 1}` };
}
