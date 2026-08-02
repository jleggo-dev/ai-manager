/* ════════════════════════════════════════════════════════════════
   Grounding — the stepped micro-flow's game bank (REQ9 §4.3)
   ════════════════════════════════════════════════════════════════ */

/**
 * Reactive tools for a racing moment. These are the payloads of **chrome B**, the stepped
 * micro-flow: tap-forward cards on a fixed four-zone spine (spine / prompt / field / forward),
 * where a payload may only fill the *field*. Chained practices and the stepped programme inherit
 * the same shell later, which is why the shape lives here as data rather than in a screen.
 *
 * Two rules shape all of it:
 *
 *   • **This is a pacing surface, not an input surface.** Nothing accepts text. Typing would mean
 *     a keyboard over half the screen for the most dysregulated person in the product, and it
 *     would turn the answers into a record — and a record invites reading back, which turns
 *     grounding into content. You name the thing silently; the app just paces you.
 *   • **Nothing is ever checked.** `countback` asks for mental arithmetic precisely *because*
 *     doing it occupies the part of the mind that is spiralling — so there is no keypad, no
 *     running total, and no validation. You tap forward and the app believes you. Marking an
 *     answer wrong would inject failure into a tool whose whole job is relieving it.
 *
 * Leaving halfway is `done`, never `abandoned`: grounding has no required length, so there is no
 * such thing as a short one.
 */

export type GroundingGame = 'senses' | 'letters' | 'switch' | 'countback' | 'object' | 'cold';

export const GROUNDING_GAMES: readonly GroundingGame[] = ['senses', 'letters', 'switch', 'countback', 'object', 'cold'];

export function isGroundingGame(v: string | null | undefined): v is GroundingGame {
  return typeof v === 'string' && (GROUNDING_GAMES as readonly string[]).includes(v);
}

/** What fills zone 3. `targets` = N tappable discs; `letter` = one large character; `arc` = a
 *  timed sweep with no numerals; `none` = an instruction card with nothing to do. */
export type GroundingField = 'targets' | 'letter' | 'arc' | 'none';

export interface GroundingStep {
  /** Zone 2. Sentence case, ends with a full stop, at most two lines. */
  prompt: string;
  /** Zone 2's optional second line. Five words at most — it is a cue, not copy. */
  instruction?: string;
  field: GroundingField;
  /** `targets` only — how many discs. Never more than five on screen (Design's redline). */
  targets?: number;
  /** `letter` only — the character shown large. */
  letter?: string;
  /** `arc` only — how long the sweep runs. */
  seconds?: number;
  /** Zone 4's label. Position and height never change; only this does. */
  forward: string;
  /** An optional second control, e.g. skipping a letter you can't answer. */
  secondary?: string;
}

export interface GroundingSpec {
  game: GroundingGame;
  /** Shown to the coach and used as the log line's subject. */
  name: string;
  /** Open-ended flows have no known length, so they get a static label where the spine would be —
   *  never a progress bar that cannot fill. */
  openEnded: boolean;
  /** The static label for open-ended flows (zone 1). */
  label: string;
  steps: GroundingStep[];
}

const LETTER_BANKS: Record<string, { noun: string; label: string }> = {
  animals: { noun: 'An animal', label: 'A → Z · ANIMALS' },
  foods: { noun: 'Something you eat', label: 'A → Z · FOODS' },
  cities: { noun: 'A place', label: 'A → Z · PLACES' },
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** 5-4-3-2-1 through the senses. The only game that counts down — and it does that by having
 *  fewer circles, never by saying a number out loud. */
function sensesSteps(): GroundingStep[] {
  const rows: Array<[number, string]> = [
    [5, 'Five things you can see.'],
    [4, 'Four things you can hear.'],
    [3, 'Three things you can feel.'],
    [2, 'Two things you can smell.'],
    [1, 'One thing you can taste.'],
  ];
  return rows.map(([n, prompt], i) => ({
    prompt,
    instruction: i === 0 ? 'tap one for each' : undefined,
    field: 'targets' as const,
    targets: n,
    forward: 'Next',
  }));
}

/** A → Z naming. Open-ended: skipping a letter is normal, and stopping early is finishing. */
function letterSteps(bank: string): GroundingStep[] {
  const b = LETTER_BANKS[bank] ?? LETTER_BANKS.animals;
  const noun = b?.noun ?? 'An animal';
  return ALPHABET.map((letter) => ({
    prompt: `${noun} with —`,
    field: 'letter' as const,
    letter,
    forward: 'Got one',
    secondary: 'Skip',
  }));
}

/** Category switching — the same shape as letters without the alphabet to hang it on. */
function switchSteps(): GroundingStep[] {
  const cats = [
    'Something blue in this room.',
    'A song you know all the words to.',
    'A street you could walk from memory.',
    'Something you ate this week.',
    'A name you have not said in years.',
    'A door you could draw from memory.',
  ];
  return cats.map((prompt) => ({ prompt, field: 'none' as const, forward: 'Got it', secondary: 'Skip' }));
}

/**
 * Counting back from 100 by sevens. Deliberately the same prompt every step: there is nothing to
 * enter and nothing to check, so the card does not need to know — or want to know — where you are.
 */
function countbackSteps(): GroundingStep[] {
  return Array.from({ length: 14 }, (_, i) => ({
    prompt: i === 0 ? 'Start at 100 and take away seven.' : 'Take away seven again.',
    instruction: i === 0 ? "in your head — I'm not checking" : undefined,
    field: 'none' as const,
    forward: 'Got it',
  }));
}

/** Build the ordered steps for a game. Pure and total — an unknown game degrades to `senses`. */
export function groundingSteps(game: GroundingGame, bank?: string | null): GroundingStep[] {
  switch (game) {
    case 'senses':
      return sensesSteps();
    case 'letters':
      return letterSteps(bank ?? 'animals');
    case 'switch':
      return switchSteps();
    case 'countback':
      return countbackSteps();
    case 'object':
      return [
        {
          prompt: 'Pick one object. Stay with it.',
          instruction: 'I will chime at the end',
          field: 'arc',
          seconds: 60,
          forward: "I'm done",
        },
      ];
    case 'cold':
      return [
        {
          prompt: 'Cool water on your face, or your wrists.',
          instruction: 'take your time',
          field: 'none',
          forward: "I'm done",
        },
      ];
    default: {
      const _exhaustive: never = game;
      void _exhaustive;
      return sensesSteps();
    }
  }
}

/** Everything a renderer needs for one game. */
export function groundingSpec(game: GroundingGame, bank?: string | null): GroundingSpec {
  const openEnded = game === 'letters' || game === 'switch' || game === 'countback';
  const label =
    game === 'letters'
      ? ((LETTER_BANKS[bank ?? 'animals'] ?? LETTER_BANKS.animals)?.label ?? 'A → Z')
      : game === 'countback'
        ? 'BACK FROM 100'
        : game === 'switch'
          ? 'ONE THING AT A TIME'
          : game === 'object'
            ? 'ONE MINUTE'
            : game === 'cold'
              ? 'TAKE YOUR TIME'
              : '';
  return { game, name: GROUNDING_NAMES[game], openEnded, label, steps: groundingSteps(game, bank) };
}

/** Plain names — used in logs and in the coach's catalog, never as a score. */
export const GROUNDING_NAMES: Record<GroundingGame, string> = {
  senses: 'Five senses',
  letters: 'A to Z',
  switch: 'One thing at a time',
  countback: 'Counting back',
  object: 'One object',
  cold: 'Cool water',
};

/**
 * The one-line receipt. Leaving halfway is **done, not abandoned** — grounding has no required
 * length — so a partial run still reads as something that happened, and an open-ended game never
 * reports a fraction at all (there was no target to fall short of).
 */
export function groundingLogLine(game: GroundingGame, stepsDone: number, total: number, openEnded: boolean): string {
  const name = GROUNDING_NAMES[game];
  if (openEnded || stepsDone >= total) return `${name} · done`;
  return `${name} · ${stepsDone} of ${total} · that counts`;
}

/** Was anything actually done? Used to decide whether a flow logs at all. */
export function groundingDidSomething(stepsDone: number): boolean {
  return stepsDone > 0;
}
