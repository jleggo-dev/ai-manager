import { stepBucket, type PaletteStepKind } from './builderSession.ts';

/**
 * The palette's own copy (design C) — plain names, one-line "whens", grouped by what the log
 * gets: **Do** records that it happened, **Capture** records what you put in. Audited against
 * `StepTool`/`inferTool` and the walkthrough tools directory (`features/walkthrough/tools/`):
 * `photo` is EXCLUDED on purpose — `Walkthrough.tsx`'s `renderTool` has no case for it, so a
 * photo step silently falls through to a bare checkoff with no camera affordance at all. Shipping
 * it in the palette would be exactly the "aspirational, no dead tools" rule this file exists to
 * enforce breaking.
 */
export interface PaletteEntry {
  kind: PaletteStepKind;
  group: 'Do' | 'Capture';
  label: string;
  when: string;
  /** The card's own tool chip text (design 1B) — lowercase, matching the drawn chips. */
  chipLabel: string;
}

export const PALETTE: PaletteEntry[] = [
  { kind: 'timer', group: 'Do', label: 'Timer', when: 'one effort, held', chipLabel: 'timer' },
  { kind: 'interval', group: 'Do', label: 'Intervals', when: 'work / rest × rounds', chipLabel: 'intervals' },
  { kind: 'reps', group: 'Do', label: 'Reps & sets', when: 'counted, logged', chipLabel: 'reps' },
  { kind: 'circuit', group: 'Do', label: 'Circuit', when: 'rotate moves, rounds', chipLabel: 'circuit' },
  { kind: 'breathing', group: 'Do', label: 'Breathing', when: 'paced, pattern by name', chipLabel: 'breathing' },
  { kind: 'meditate', group: 'Do', label: 'Quiet sit', when: 'silence + bells', chipLabel: 'quiet sit' },
  { kind: 'grounding', group: 'Do', label: 'Grounding', when: 'a noticing game', chipLabel: 'grounding' },
  { kind: 'checkoff', group: 'Do', label: 'Check off', when: 'did it — a distance, an errand', chipLabel: 'check off' },
  { kind: 'read', group: 'Do', label: 'Cue card', when: 'words to follow', chipLabel: 'cue' },
  { kind: 'journal', group: 'Capture', label: 'Write', when: 'a prompt, kept to reread', chipLabel: 'write' },
  {
    kind: 'feeling_log',
    group: 'Capture',
    label: 'Feeling check-in',
    when: 'one word, 20 seconds',
    chipLabel: 'check-in',
  },
  { kind: 'measure', group: 'Capture', label: 'Measure', when: 'a number — weight, distance', chipLabel: 'measure' },
];

export function paletteEntry(kind: PaletteStepKind): PaletteEntry {
  return PALETTE.find((p) => p.kind === kind) ?? (PALETTE[0] as PaletteEntry);
}

const PALETTE_KINDS = new Set<string>(PALETTE.map((p) => p.kind));

/** Narrows any resolved `StepToolKind` (which also covers the coach-only `photo`/`rings`/
 *  `insight`) down to one the builder actually authors. The builder only ever writes items whose
 *  `inferTool` lands in the palette, so a `false` here is unreachable in practice — this exists so
 *  a card never trusts an untyped string into `chipStyleFor`/`paletteEntry` without checking. */
export function isPaletteKind(kind: string): kind is PaletteStepKind {
  return PALETTE_KINDS.has(kind);
}

/** A card's tool chip colour — grouped by `stepBucket`, the SAME grouping the footer counts by,
 *  so a card can never wear a colour the total wouldn't also count it under. */
export const CHIP_STYLE: Record<string, { bg: string; fg: string }> = {
  cue: { bg: 'oklch(95% 0.012 85)', fg: 'oklch(50% 0.02 120)' },
  timed: { bg: 'oklch(95% 0.035 74)', fg: 'oklch(48% 0.11 60)' },
  set: { bg: 'oklch(94% 0.03 152)', fg: 'oklch(38% 0.09 152)' },
  write: { bg: 'oklch(94% 0.025 300)', fg: 'oklch(42% 0.07 300)' },
  'check-in': { bg: 'oklch(94% 0.025 300)', fg: 'oklch(42% 0.07 300)' },
  measure: { bg: 'oklch(94% 0.025 300)', fg: 'oklch(42% 0.07 300)' },
  grounding: { bg: 'oklch(96.5% 0.015 250)', fg: 'oklch(45% 0.06 250)' },
};

const NEUTRAL_CHIP = { bg: 'oklch(95% 0.012 85)', fg: 'oklch(50% 0.02 120)' };

/** `chipStyleFor('circuit')` etc. — resolves a palette kind straight to its chip colours via the
 *  shared bucket grouping (never a second, hand-kept colour table). Every `PaletteStepKind` is a
 *  `StepToolKind`, so `stepBucket` always resolves — the `NEUTRAL_CHIP` fallback is unreachable
 *  defensiveness, never a real case. */
export function chipStyleFor(kind: PaletteStepKind): { bg: string; fg: string } {
  const bucket = stepBucket(kind);
  return (bucket && CHIP_STYLE[bucket]) || NEUTRAL_CHIP;
}
