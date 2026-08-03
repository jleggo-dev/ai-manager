/* ════════════════════════════════════════════════════════════════
   The feeling vocabulary — the mind pillar's instrument (REQ9 §4.4)
   ════════════════════════════════════════════════════════════════ */

/**
 * Twenty seconds: pick the word that fits, say how much room it's taking, optionally add a line.
 * The mind side's weigh-in — it feeds baselines and the cross-pillar correlations that are the
 * product's moat, so it has to be light enough to do daily and specific enough to be worth
 * reading later.
 *
 * The vocabulary is **deterministic and shared** — it lives here, never varies by person, and the
 * coach may reorder families by recency but may never edit the words. Two rules decide what's in
 * it:
 *
 *   • **Every word is one you'd say out loud to a friend.** That is why `anxious` is here (owner
 *     ruling): the register bans clinical language *we* impose, not the plainest word someone has
 *     for their own state. Leaving it out would make people hunt for a euphemism for their own
 *     feeling.
 *   • **Nothing a clinician would write down about you.** `depressed`, `panicked`, `triggered`,
 *     `manic`, `numb`, `hopeless`, `stable`, `symptom`, `disorder` — and `mood`, which is what a
 *     chart would call this and no person ever does.
 *
 * Two taps deep by design: six family tiles are one glance, thirty-six words are a reading task.
 * The family word is itself selectable, so someone who only knows "wired" is never forced to be
 * more precise than they actually are.
 */

export type FeelingFamilyId = 'settled' | 'bright' | 'wired' | 'heavy' | 'prickly' | 'foggy';

export interface FeelingFamily {
  id: FeelingFamilyId;
  /** The family word — selectable in its own right ("just: wired"). */
  name: string;
  words: readonly string[];
}

export const FEELING_FAMILIES: readonly FeelingFamily[] = [
  { id: 'settled', name: 'Settled', words: ['steady', 'rested', 'at ease', 'quiet', 'unhurried'] },
  { id: 'bright', name: 'Bright', words: ['glad', 'warm', 'eager', 'grateful', 'light'] },
  // `anxious` sits here by owner ruling — see the module note above.
  { id: 'wired', name: 'Wired', words: ['restless', 'keyed up', 'anxious', 'on edge', 'impatient'] },
  { id: 'heavy', name: 'Heavy', words: ['tired', 'flat', 'low', 'tender', 'worn out'] },
  { id: 'prickly', name: 'Prickly', words: ['irritated', 'frustrated', 'resentful', 'snappy', 'fed up'] },
  { id: 'foggy', name: 'Foggy', words: ['scattered', 'dull', 'far away', 'stuck', 'undecided'] },
];

/** Words reachable only through "look for a different word" — real words that didn't fit a family
 *  of five. Kept selectable so the search never comes up empty for a word someone actually uses. */
const EXTRA_WORDS: readonly string[] = ['racing', 'wistful', 'lonely', 'proud', 'restive', 'wired-tired'];

/** Never selectable, and never shown: the words a clinician writes down about you rather than the
 *  ones you'd say. Exported so a test can hold the line. */
export const BANNED_FEELING_WORDS: readonly string[] = [
  'depressed',
  'panicked',
  'triggered',
  'manic',
  'numb',
  'hopeless',
  'stable',
  'symptom',
  'disorder',
  'mood',
];

/** How much room it's taking. Spatial, never a severity scale — stored 1–3 for correlation maths,
 *  and the numbers never render anywhere in the product. */
export type FeelingRoom = 1 | 2 | 3;

export const FEELING_ROOMS: ReadonlyArray<{ value: FeelingRoom; label: string }> = [
  { value: 1, label: 'in the background' },
  { value: 2, label: 'here' },
  { value: 3, label: 'filling the room' },
];

/** The three example words shown on a family tile — enough that step two confirms rather than
 *  discovers. */
export function familyExamples(family: FeelingFamily): string[] {
  return family.words.slice(0, 3);
}

/** Every selectable word: the thirty family words, the six family names, and the extras. */
export function allFeelingWords(): string[] {
  const words = FEELING_FAMILIES.flatMap((f) => [f.name.toLowerCase(), ...f.words]);
  return [...new Set([...words, ...EXTRA_WORDS])].sort((a, b) => a.localeCompare(b));
}

export function findFamily(id: string | null | undefined): FeelingFamily | undefined {
  return FEELING_FAMILIES.find((f) => f.id === id);
}

/** Which family a word belongs to, if any — extras and family names resolve too. */
export function familyForWord(word: string): FeelingFamily | undefined {
  const w = word.trim().toLowerCase();
  return FEELING_FAMILIES.find((f) => f.name.toLowerCase() === w || f.words.includes(w));
}

/** Is this a word we actually offer? Guards stored data and anything a coach might echo back. */
export function isFeelingWord(word: string | null | undefined): boolean {
  return typeof word === 'string' && allFeelingWords().includes(word.trim().toLowerCase());
}

export function isFeelingRoom(v: unknown): v is FeelingRoom {
  return v === 1 || v === 2 || v === 3;
}

/**
 * The one acknowledgment shown after saving — it repeats the word and the room back, and that is
 * the whole reward. There is deliberately nowhere in the app to go and look at your feelings, so
 * this sentence is the entire visible surface of the instrument.
 */
export function feelingAcknowledgement(word: string, room: FeelingRoom): string {
  const w = word.trim();
  const shown = w.charAt(0).toUpperCase() + w.slice(1);
  const tail = room === 1 ? "it's in the background" : room === 2 ? "it's here" : "it's filling the room";
  return `${shown}, and ${tail}. Got it — thank you for telling me.`;
}

/** The quiet second line under it. Fixed copy: a promise about the coach, not about a chart. */
export const FEELING_FOOTER = "I'll bring it up when it's useful.";

/** The one-line receipt for the day's log. Never a score, never a comparison. */
export function feelingLogLine(word: string, room: FeelingRoom): string {
  const label = FEELING_ROOMS.find((r) => r.value === room)?.label ?? 'here';
  return `${word.trim()} · ${label}`;
}
